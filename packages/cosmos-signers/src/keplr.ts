import {
  AccountData,
  type CosmosNetworkConfig,
  createAccount,
  createSigner,
  endpoints,
  type FullAccountData,
  type Signer,
} from '@apophis-sdk/core';
import { pubkey } from '@apophis-sdk/core/crypto/pubkey.js';
import { Any } from '@apophis-sdk/core/encoding/protobuf/any.js';
import * as utils from '@apophis-sdk/core/utils.js';
import { Amino, Cosmos, CosmosTx, CosmosTxAmino, CosmosTxDirect, TxMarshaller } from '@apophis-sdk/cosmos';
import { type Window as KeplrWindow } from '@keplr-wallet/types';
import { signal } from '@preact/signals-core';
import { AuthInfo, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js';
import LOGO_DATA_URL from './logos/keplr.js';

declare global {
  interface Window {
    keplr: KeplrWindow['keplr'];
  }
}

const FAKERS = ['leap'];

export interface KeplrLikeSignerConfig {
  type: string;
  displayName: string;
  logoURL: string | URL | undefined;
  getBackend: () => any;
  probe: () => boolean;
  keystoreChangeEvent: string;
}

/** Create a new customized Keplr-like signer. This is intended for the integration of other Keplr-forked wallets like Leap.
 * To use Keplr in your own Dapp, use the exported `Keplr` constant instead.
 */
export function createKeplrSigner(config?: Partial<KeplrLikeSignerConfig>): Signer<CosmosNetworkConfig, CosmosTx> {
  const fullConfig: KeplrLikeSignerConfig = {
    type: 'Keplr',
    displayName: 'Keplr',
    logoURL: LOGO_DATA_URL,
    getBackend: () => typeof window !== 'undefined' ? window.keplr : undefined,
    probe: () => typeof window !== 'undefined' && !!window.keplr && !FAKERS.some(f => window.keplr === (window as any)[f]),
    keystoreChangeEvent: 'keplr_keystorechange',
    ...config,
  };

  const backend = fullConfig.getBackend();
  const available = signal(fullConfig.probe());
  const accounts = signal<AccountData<CosmosNetworkConfig>[]>([]);
  if (!backend) throw new Error(`${fullConfig.displayName} not available`);

  async function signAmino(account: FullAccountData<CosmosNetworkConfig>, tx: CosmosTxAmino) {
    const { network } = account;
    if (!network) throw new Error('No network provided');

    const keplrSigner = await backend.getOfflineSigner(network.chainId);
    const sig = signer.snapshot(account);

    const { signed, signature } = await keplrSigner.signAmino(account.address, TxMarshaller.marshal(tx.signDoc(sig)) as any);
    tx.messages = signed.msgs.map((msg: any) => Amino.decode(network, msg));
    tx.memo = signed.memo;
    tx.timeoutHeight = BigInt(signed.timeout_height ?? 0n);
    tx.gas = {
      amount: signed.fee.amount.map((coin: any) => Cosmos.coin(coin.amount, coin.denom)),
      gasLimit: BigInt(signed.fee.gas),
      granter: signed.fee.granter,
      payer: signed.fee.payer,
    };
    tx.setSignature(sig, utils.bytes(signature.signature));
  }

  async function signDirect(account: FullAccountData<CosmosNetworkConfig>, tx: CosmosTxDirect) {
    const { network } = account;
    if (!network) throw new Error('No network provided');

    const keplrSigner = await backend.getOfflineSigner(network.chainId);
    const sig = signer.snapshot(account);

    const { signed, signature } = await keplrSigner.signDirect(account.address, TxMarshaller.marshal(tx.signDoc(sig)) as any);
    const body = TxBody.decode(signed.bodyBytes);
    const authInfo = AuthInfo.decode(signed.authInfoBytes);

    tx.messages = body.messages.map(msg => Any.decode(network, msg));
    tx.memo = body.memo;
    tx.timeoutHeight = body.timeoutHeight;
    tx.gas = {
      amount: authInfo.fee!.amount.map(coin => Cosmos.coin(coin.amount, coin.denom)),
      gasLimit: authInfo.fee!.gasLimit,
      granter: authInfo.fee!.granter,
      payer: authInfo.fee!.payer,
    };
    if (tx instanceof CosmosTxDirect) {
      tx.extensionOptions = body.extensionOptions;
      tx.nonCriticalExtensionOptions = body.nonCriticalExtensionOptions;
    }
    tx.setSignature(sig, utils.bytes(signature.signature));
    return tx;
  }

  async function fetchAccountsForNetworks(networks: CosmosNetworkConfig[]): Promise<AccountData<CosmosNetworkConfig>[]> {
    if (!networks.length) return [];

    return await Promise.all(networks.map(async (network: CosmosNetworkConfig) => {
      const offlineSigner = await backend.getOfflineSigner(network.chainId);
      const accounts = await offlineSigner.getAccounts();
      return accounts.map((account: any) => createAccount(network, pubkey.secp256k1(account.pubkey)));
    })).then(accounts => accounts.flat());
  }

  async function resetAccounts() {
    if (!backend || !signer) return;

    const oldAccounts = accounts.peek();
    const networks = Array.from(new Set(oldAccounts.map(acc => acc.network)));

    if (networks.length > 0) {
      await backend.enable(networks.map(network => network.chainId));
      const newAccounts = await fetchAccountsForNetworks(networks);
      accounts.value = newAccounts;
    } else {
      accounts.value = [];
    }
  }

  const signer = createSigner<CosmosNetworkConfig, CosmosTx>((api) => {
    return {
      type: fullConfig.type,
      displayName: fullConfig.displayName,
      logoURL: fullConfig.logoURL,
      canAutoReconnect: true,
      available,
      accounts,

      probe: () => Promise.resolve(fullConfig.probe()),
      connect: async (networks: CosmosNetworkConfig[]) => {
        if (!networks.length) return [];

        await Promise.all(networks.map(async (network: CosmosNetworkConfig) => await backend.experimentalSuggestChain(toChainSuggestion(network))));
        await backend.enable(networks.map((network: CosmosNetworkConfig) => network.chainId));

        return await fetchAccountsForNetworks(networks);
      },
      sign: async (account: FullAccountData<CosmosNetworkConfig>, tx: CosmosTx) => {
        if (tx.encoding === 'amino') {
          await signAmino(account, tx);
        } else {
          await signDirect(account, tx);
        }
        return tx;
      },
      broadcast: async (tx: CosmosTx) => {
        if (!tx.network) throw new Error('Unsigned transaction');
        const hashbytes = await backend.sendTx(tx.network.chainId, tx.bytes(), 'sync' as any);
        const hash = utils.toHex(hashbytes);
        tx.confirm(hash);
        return hash;
      },
    };
  });

  if (typeof window !== 'undefined' && fullConfig.keystoreChangeEvent) {
    window.addEventListener(fullConfig.keystoreChangeEvent, resetAccounts);
  }

  return signer;
}

export const Keplr = createKeplrSigner();

function toChainSuggestion(network: CosmosNetworkConfig): Parameters<Required<KeplrWindow>['keplr']['experimentalSuggestChain']>[0] {
  return {
    chainId: network.chainId,
    chainName: network.prettyName,
    rpc: endpoints.get(network, 'rpc'),
    rest: endpoints.get(network, 'rest'),
    bip44: {
      coinType: network.slip44!,
    },
    currencies: network.assets.map(asset => ({
      coinDenom: asset.denom,
      coinMinimalDenom: asset.denom,
      coinDecimals: asset.decimals ?? 6,
      coinGeckoId: asset.cgid,
    })),
    feeCurrencies: network.gas.map(cfg => ({
      coinDenom: cfg.asset.denom,
      coinDecimals: cfg.asset.decimals ?? 6,
      coinMinimalDenom: cfg.asset.denom,
      coinGeckoId: cfg.asset.cgid,
      gasPriceStep: {
        low: parseFloat(cfg.lowPrice?.toString() ?? cfg.avgPrice.toString()),
        average: parseFloat(cfg.avgPrice.toString()),
        high: parseFloat(cfg.highPrice?.toString() ?? cfg.avgPrice.toString()),
      },
    })),
    bech32Config: {
      bech32PrefixAccAddr: network.addressPrefix,
      bech32PrefixAccPub: network.addressPrefix + 'pub',
      bech32PrefixValAddr: network.addressPrefix + 'valoper',
      bech32PrefixValPub: network.addressPrefix + 'valoperpub',
      bech32PrefixConsAddr: network.addressPrefix + 'valcons',
      bech32PrefixConsPub: network.addressPrefix + 'valconspub',
    },
    stakeCurrency: network.staking ? {
      coinDenom: network.staking.denom,
      coinMinimalDenom: network.staking.denom,
      coinDecimals: network.staking.decimals ?? 6,
      coinGeckoId: network.staking.cgid,
    } : undefined,
  };
}
