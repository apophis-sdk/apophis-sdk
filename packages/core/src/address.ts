import { base58, bech32 } from '@scure/base';
import { NetworkConfig, SolanaNetworkConfig } from './networks.js';
import { type MiddlewareAddresses, type MiddlewareImpl, mw } from './middleware.js';
import { DeepPartial } from 'cosmjs-types';
import { PublicKey } from './crypto/pubkey.js';
import { fromBase64 } from './utils.js';

export interface Addresses {
  /** Register an alias for the given address. */
  alias(address: string): string | undefined;

  /** Resolve an address for the given alias. */
  resolve(alias: string): string | undefined;

  /** Compute the address of the given public key for the given network. Different networks may use
   * different algorithms. For example, most Cosmos networks use `bech32(ripemd160(sha256(compressed)))`,
   * but Injective computes the bech32 representation of the Ethereum address, effectively using
   * `bech32(keccak256(uncompressed_pubkey[1:])[-20:])`.
   */
  compute(network: NetworkConfig, publicKey: PublicKey): string;

  /** Trim the given address. The resulting address will have `trimSize` characters from its start & end. */
  trim(address: string, options?: AddressTrimOptions): string;
}

export interface AddressTrimOptions {
  /** Defaults to `6`. */
  trimSize?: number;
  /** Defaults to `'both'`. */
  mode?: 'start' | 'end' | 'both';
  /** Defaults to `true`. */
  ellipsis?: boolean;
}

/** Registry of address aliases. Most of the time, humans can't remember addresses, which is why
 * name registries are often established. `addresses` is an extensible singleton using middlewares
 * that allow gathering address aliases from different sources, such as ICNS, a local contact book,
 * or a shared address list.
 */
export const addresses: Addresses = {
  alias: (address) => mw('addresses', 'alias').inv().fifoMaybe(address),
  resolve: (alias) => mw('addresses', 'resolve').inv().fifoMaybe(alias),
  compute: (network, publicKey) => mw('addresses', 'compute').inv().fifo(network, publicKey),

  trim(address, { trimSize = 6, mode = 'both', ellipsis: useEllipsis = true }: AddressTrimOptions = {}) {
    const ellipsis = useEllipsis ? '…' : '';
    let prefix = '';
    try {
      prefix = bech32.decode(address as any).prefix + '1';
      address = address.slice(prefix.length);
    } catch {}

    switch (mode) {
      case 'start':
        if (trimSize >= address.length) return address;
        return `${prefix}${ellipsis}${address.slice(-trimSize)}`;
      case 'end':
        if (trimSize >= address.length) return address;
        return `${prefix}${address.slice(0, trimSize)}${ellipsis}`;
      case 'both':
        if (trimSize * 2 >= address.length) return address;
        return `${prefix}${address.slice(0, trimSize)}${ellipsis}${address.slice(-trimSize)}`;
      default:
        throw new Error(`Invalid address trim mode: ${mode}`);
    }
  },
}

/** Middleware that stores address aliases in memory. */
export const MemoryAddressBook = new class implements MiddlewareImpl {
  #aliases: Record<string, string> = {};
  #resolutions: Record<string, string> = {};

  readonly addresses: DeepPartial<MiddlewareAddresses> = {
    alias: (address: string) => this.#aliases[address],
    resolve: (alias: string) => this.#resolutions[alias],
  }

  record(address: string, alias: string) {
    this.#aliases[address] = alias;
    this.#resolutions[alias] = address;
    return this;
  }

  clear(address: string) {
    const alias = this.#aliases[address];
    if (!alias) return this;
    delete this.#aliases[address];
    delete this.#resolutions[alias];
    return this;
  }
}

/** Middleware that stores address aliases in `localStorage`. */
export const LocalStorageAddressBook = new class implements MiddlewareImpl {
  readonly addresses: DeepPartial<MiddlewareAddresses> = {
    alias: (address: string) => localStorage.getItem(`@apophis-sdk:addresses:alias:${address}`) ?? undefined,
    resolve: (alias: string) => localStorage.getItem(`@apophis-sdk:addresses:resolve:${alias}`) ?? undefined,
  }

  record(address: string, alias: string) {
    localStorage.setItem(`@apophis-sdk:addresses:alias:${address}`, alias);
    localStorage.setItem(`@apophis-sdk:addresses:resolve:${alias}`, address);
    return this;
  }

  clear(address: string) {
    const alias = localStorage.getItem(`@apophis-sdk:addresses:alias:${address}`);
    if (!alias) return this;
    localStorage.removeItem(`@apophis-sdk:addresses:alias:${address}`);
    localStorage.removeItem(`@apophis-sdk:addresses:resolve:${alias}`);
    return this;
  }
}

/** Trim the given address. The resulting address will have `trimSize` characters from its start & end. */
export const trimAddress = (address: string, trimSize: number) => addresses.trim(address, { trimSize });

// TODO: move to `@apophis-sdk/solana` whenever we finally create it
function computeSolanaAddress(network: SolanaNetworkConfig, publicKey: PublicKey) {
  // see https://chainstack.com/how-do-ethereum-and-solana-generate-public-and-private-keys/#7-generating-account-address-from-private-key-for-solana
  // for the algorithm to derive address from private key
  if (publicKey.type !== 'secp256k1') throw new Error('Invalid pubkey type, expected secp256k1');
  if (publicKey.bytes.length !== 32) throw new Error('Invalid pubkey length, expected 32');
  return base58.encode(typeof publicKey.bytes === 'string' ? fromBase64(publicKey.bytes) : publicKey.bytes);
}
