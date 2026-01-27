import { type Bytes, createAccount, createSigner, endpoints, type Signer, type NetworkConfig, type CosmosNetworkConfig, fetchAccounts } from '@apophis-sdk/core';
import { pubkey } from '@apophis-sdk/core/crypto/pubkey.js';
import { BroadcastMode } from '@apophis-sdk/cosmos/types.sdk.js';
import * as utils from '@apophis-sdk/core/utils.js';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import * as secp256k1 from '@noble/secp256k1';
import { signal } from '@preact/signals-core';
import * as bip32 from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist as _wordlist } from '@scure/bip39/wordlists/english';
import { Cosmos } from './api.js';
import { type CosmosTx } from './tx.js';

if (!secp256k1.hashes.hmacSha256)
  secp256k1.hashes.hmacSha256 = (key, msg) => hmac(sha256, key, msg);
if (!secp256k1.hashes.sha256)
  secp256k1.hashes.sha256 = sha256;

export type CosmosLocalSignerConfig = PrivateKeyConfig | MnemonicConfig;
interface BaseConfig {
  /** Whether to automatically update the account's data before signing. Defaults to true. */
  autoUpdateAccountData?: boolean;
  /** Optional logo URL to display in the UI. */
  logoURL?: string;
}
interface PrivateKeyConfig extends BaseConfig {
  privateKey: Bytes;
}
interface MnemonicConfig extends BaseConfig {
  mnemonic: string;
  /** Optional passphrase for the mnemonic. */
  passphrase?: string;
  /** Optional wordlist to validate the mnemonic against. Defaults to `import('@scure/bip39/wordlists/english').wordlist`. */
  wordlist?: string[];
  /** Specific coin type to use for HD derivation. Defaults to `NetworkConfig.slip44`. */
  coinType?: number;
  /** Specific account index to use for HD derivation. Defaults to `0`. */
  accountIndex?: number;
}

/** Create a new Cosmos Local Signer. The `config` object will be used by reference, meaning
 * you can change the config object in retrospect and future method calls will reflect the changes.
 */
export async function createLocalSigner(config: CosmosLocalSignerConfig): Promise<Signer<CosmosNetworkConfig, CosmosTx>> {
  let getPrivateKey: (network: NetworkConfig) => Uint8Array;

  if ('privateKey' in config) {
    getPrivateKey = () => utils.bytes(config.privateKey);
  } else {
    if (!bip39.validateMnemonic(config.mnemonic, config.wordlist ?? _wordlist)) throw new Error('Invalid mnemonic');
    const seed = await bip39.mnemonicToSeed(config.mnemonic, config.passphrase);
    getPrivateKey = (network: NetworkConfig) => {
      const bs = bip32.HDKey
        .fromMasterSeed(seed)
        .derive(`m/44'/${config.coinType ?? network.slip44}'/${config.accountIndex ?? 0}'/0/0`)
        .privateKey;
      if (!bs) throw new Error('Failed to derive private key');
      return bs;
    };
  }

  const signer = createSigner<CosmosNetworkConfig, CosmosTx>((api) => ({
    type: 'cosmos.local',
    displayName: 'Cosmos Local Signer',
    available: signal(true),
    accounts: signal([]),
    get canAutoReconnect() { return config.autoUpdateAccountData ?? true; },
    get logoURL() { return config.logoURL; },

    probe: async () => true,
    connect: async (networks) => {
      if (!networks.length) return [];
      if (networks.find(network => network.ecosystem !== 'cosmos'))
        throw new Error('Cosmos Local Signer only supports Cosmos chains');
      return networks.map(
        network => createAccount(
          network,
          pubkey.secp256k1(secp256k1.getPublicKey(getPrivateKey(network), true))
        )
      );
    },
    sign: async (account, tx) => {
      if (config.autoUpdateAccountData)
        [account] = await fetchAccounts([account]);

      const sig = signer.snapshot(account);

      const bs = tx.signBytes(sig) as Uint8Array;
      const sigBs = secp256k1.sign(bs, getPrivateKey(sig.network));
      if (sigBs.length !== 64) throw new Error('Invalid signature length');
      if (!secp256k1.verify(sigBs, bs, utils.bytes(sig.publicKey.bytes)))
        throw new Error('Invalid signature');

      tx.setSignature(sig, sigBs);
      return tx;
    },
    broadcast: async (tx) => {
      const { network } = tx;
      if (!network) throw new Error('Unsigned transaction');

      const url = endpoints.get(network, 'rest');
      if (!url) throw new Error('No REST endpoint available');

      const { tx_response: response } = await Cosmos.rest(network).cosmos.tx.v1beta1.txs('POST', { mode: BroadcastMode.BROADCAST_MODE_SYNC, tx_bytes: tx.bytes() });
      if (response.code) {
        tx.reject(response.txhash, response.raw_log);
        throw new Error(`Transaction rejected with codespace ${response.codespace}, code ${response.code}, raw log: ${response.raw_log}`);
      } else {
        tx.confirm(response.txhash);
      }
      return response.txhash;
    },
  }));
  return signer;
}

export const generateMnemonic = (wordlist = _wordlist, strength = 256) =>
  bip39.generateMnemonic(wordlist, strength);

export const generatePrivateKey = () =>
  crypto.getRandomValues(new Uint8Array(32));
