import { type Signer, type SolanaNetworkConfig, type NetworkConfig, createSigner, type Bytes, createAccount, fetchAccounts } from '@apophis-sdk/core';
import { toBase64 } from '@apophis-sdk/core/utils.js';
import { pubkey } from '@apophis-sdk/core/crypto/pubkey.js';
import * as utils from '@apophis-sdk/core/utils.js';
import * as bip32 from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist as _wordlist } from '@scure/bip39/wordlists/english';
import * as ed25519 from '@noble/ed25519';
import { Solana } from './api.js';
import { SolanaTx } from './tx.js';
import { signal } from '@preact/signals-core';

export type SolanaLocalSignerConfig = PrivateKeyConfig | MnemonicConfig;
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

export async function createLocalSigner(config: SolanaLocalSignerConfig): Promise<Signer<SolanaNetworkConfig, SolanaTx>> {
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

  const signer = createSigner<SolanaNetworkConfig, SolanaTx>(() => {
    return {
      type: 'solana.local',
      displayName: 'Solana Local Signer',
      available: signal(true),
      accounts: signal([]),
      get canAutoReconnect() { return config.autoUpdateAccountData ?? true; },
      get logoURL() { return config.logoURL; },

      probe: async () => true,
      connect: async (networks) => {
        if (!networks.length) return [];
        if (networks.find(network => network.ecosystem !== 'solana'))
          throw new Error('Solana Local Signer only supports Solana chains');
        return networks.map(network => createAccount(network, pubkey.ed25519(ed25519.getPublicKey(getPrivateKey(network)))));
      },
      sign: async (account, tx) => {
        if (config.autoUpdateAccountData)
          [account] = await fetchAccounts([account]);

        const sig = signer.snapshot(account);

        const bs = tx.messageBytes(sig) as Uint8Array;
        const sigBytes = ed25519.sign(bs, getPrivateKey(sig.network));
        if (sigBytes.length !== 64) throw new Error('Invalid signature length');
        if (!ed25519.verify(sigBytes, bs, utils.bytes(sig.publicKey.bytes)))
          throw new Error('Invalid signature');

        tx.setSignature(sig, sigBytes);
        return tx;
      },
      broadcast: async (tx) => {
        if (!tx.signer) throw new Error('Unsigned transaction');
        const response = await Solana.rpc(tx.signer.network).sendTransaction(toBase64(tx.messageBytes(tx.signer) as Uint8Array));
        return response.value;
      },
    };
  });
  return signer;
}

export const generateMnemonic = (wordlist = _wordlist, strength = 256) =>
  bip39.generateMnemonic(wordlist, strength);

export const generatePrivateKey = () =>
  crypto.getRandomValues(new Uint8Array(32));
