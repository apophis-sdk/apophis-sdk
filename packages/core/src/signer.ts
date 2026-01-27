import { computed, type ReadonlySignal, signal, type Signal } from '@preact/signals-core';
import { addresses } from './address.js';
import type { PublicKey } from './crypto/pubkey.js';
import type { NetworkConfig } from './networks.js';
import { mw } from './middleware.js';
import type { TxBase } from './types.js';

export type AccountData<NetConf extends NetworkConfig = NetworkConfig> = FullAccountData<NetConf> | PartialAccountData<NetConf>;
type InputSignal<T> = T | Signal<T>;

export interface PartialAccountData<NetConf extends NetworkConfig = NetworkConfig> {
  network: NetConf;
  address: string;
  publicKey: PublicKey;
}

export interface FullAccountData<NetConf extends NetworkConfig = NetworkConfig> extends PartialAccountData<NetConf> {
  accountNumber: bigint;
  sequence: bigint;
}

export interface SignerConfig<NetConf extends NetworkConfig = NetworkConfig> {
  type: string;
  displayName: string;
  logoURL: string | URL | undefined;
  canAutoReconnect: boolean;
  available: ReadonlySignal<boolean>;
  accounts: Signal<AccountData<NetConf>[]>;
}

export interface SignerCallbacks<NetConf extends NetworkConfig = NetworkConfig, Tx extends TxBase = TxBase> {
  probe(): Promise<boolean>;
  connect(networks: NetConf[]): Promise<AccountData<NetConf>[]>;
  disconnect?(networks: NetConf[]): Promise<void>;
  sign(account: FullAccountData<NetConf>, tx: Tx): Promise<Tx>;
  broadcast(tx: Tx): Promise<string>;
}

export interface SignerApi<NetConf extends NetworkConfig = NetworkConfig> {
  /** Trigger a refresh of the accounts' onchain data such as account number & sequence. */
  updateAccounts(accounts: AccountData<NetConf>[]): Promise<void>;
}

export interface Signer<NetConf extends NetworkConfig = NetworkConfig, Tx extends TxBase = TxBase> extends Readonly<SignerConfig<NetConf>> {
  /** Known accounts of this signer. */
  readonly accounts: ReadonlySignal<AccountData<NetConf>[]>;
  /** Networks this signer is connected to, derived from its `accounts`. */
  readonly networks: ReadonlySignal<NetConf[]>;
  /** Connect the signer to the given networks. Any existing connections will be retained.
   * Only retains unique accounts (by address) across all networks.
   */
  connect(networks: NetConf[]): Promise<AccountData<NetConf>[]>;
  /** Disconnect the signer from the given networks. All accounts on that network will be dropped. */
  disconnect(networks: NetConf[]): Promise<void>
  /** Connect the signer to the given networks. Any existing connections will be retained.
   * Only retains unique accounts (by address) across all networks.
   */;
  sign(account: FullAccountData<NetConf>, tx: Tx): Promise<Tx>;
  /** Broadcast a signed transaction. Returns the tx hash if successful. Allows
   * the signer to use its own infrastructure if applicable.
   */
  broadcast(tx: Tx): Promise<string>;
  /** Prioritize the given account. It will take precedence over other accounts on the same network. */
  prioritizeAccount(account: AccountData<NetConf>): void;
  /** Bump the sequence number of the given account.
   *
   * Note: This is generally not necessary, but can be helpful when creating
   * multiple transactions without waiting for confirmation of each one first.
   */
  bumpSequence(account: FullAccountData<NetConf>): void;
  /** Bind the signer to a network. Returns a `BoundSigner` */
  bind(network: InputSignal<NetConf | undefined>): BoundSigner<NetConf, Tx>;
  /** Get a BoundSignerSnapshot for the given account. */
  snapshot(account: FullAccountData<NetConf>): BoundSignerSnapshot<NetConf, Tx>;
}

export interface BoundSigner<NetConf extends NetworkConfig = NetworkConfig, Tx extends TxBase = TxBase> {
  readonly network: Signal<NetConf | undefined>;
  readonly accounts: ReadonlySignal<AccountData<NetConf>[]>;
  readonly account: ReadonlySignal<AccountData<NetConf> | undefined>;
  readonly publicKey: ReadonlySignal<PublicKey | undefined>;
  readonly addresses: ReadonlySignal<string[]>;
  readonly address: ReadonlySignal<string | undefined>;
  sign(tx: Tx): Promise<Tx>;
  broadcast(tx: Tx): Promise<string>;
  /** Get a snapshot of this bound signer without any signals.
   * If this `BoundSigner` is not actually bound to a network, returns `undefined`.
   */
  snapshot(): BoundSignerSnapshot<NetConf, Tx> | undefined;
}

export interface BoundSignerSnapshot<NetConf extends NetworkConfig = NetworkConfig, Tx extends TxBase = TxBase> {
  network: NetConf;
  accounts: AccountData<NetConf>[];
  account: AccountData<NetConf>;
  publicKey: PublicKey;
  addresses: string[];
  address: string;
  sign(tx: Tx): Promise<Tx>;
  broadcast(tx: Tx): Promise<string>;
}

const _signers = signal<Signer[]>([]);
export const signers = _signers as ReadonlySignal<Signer[]>;

export function createSigner<
  NetConf extends NetworkConfig = NetworkConfig,
  Tx extends TxBase = TxBase,
>(configFactory: (api: SignerApi<NetConf>) => SignerConfig<NetConf> & SignerCallbacks<NetConf, Tx>): Signer<NetConf, Tx> {
  const updateAccounts: SignerApi<NetConf>['updateAccounts'] = async () => {};

  const config = configFactory({ updateAccounts });

  const signer = {
    type: config.type,
    displayName: config.displayName,
    logoURL: config.logoURL,
    canAutoReconnect: config.canAutoReconnect,
    available: config.available,
    accounts: config.accounts,
    networks: computed((): NetConf[] => Array.from(new Set(config.accounts.value.map(acc => acc.network)))),

    connect: async (networks: NetConf[]) => {
      const accounts = config.accounts.peek().filter(acc => !networks.includes(acc.network));
      const newAccounts = await config.connect(networks);
      const result = config.accounts.value = [...accounts, ...newAccounts];
      updateAccounts(result).catch(() => {});
      return result;
    },
    disconnect: async (networks: NetConf[]) => {
      await config.disconnect?.(networks);
      config.accounts.value = config.accounts.peek().filter(acc => !networks.includes(acc.network));
    },
    sign: config.sign,
    broadcast: config.broadcast,

    prioritizeAccount: (account: AccountData<NetConf>) => {
      const idx = signer.accounts.peek().indexOf(account);
      if (idx === -1) throw new Error('Unknown account');
      const prev = config.accounts.peek();
      config.accounts.value = [
        account,
        ...prev.slice(0, idx),
        ...prev.slice(idx + 1),
      ];
    },

    bumpSequence: (account: FullAccountData<NetConf>) => {
      const idx = config.accounts.peek().indexOf(account);
      if (idx === -1) throw new Error('Unknown account');
      const prev = config.accounts.peek();
      config.accounts.value = [
        ...prev.slice(0, idx),
        { ...account, sequence: account.sequence + 1n },
        ...prev.slice(idx + 1),
      ];
    },

    bind: (network: InputSignal<NetConf | undefined>) => {
      network = network && 'value' in network ? network : signal(network);
      const accounts = computed(() => signer.accounts.value.filter(acc => acc.network === network.value));
      const account = computed(() => accounts.value[0]);
      const publicKey = computed(() => account.value?.publicKey);
      const addresses = computed(() => accounts.value.map(acc => acc.address));
      const address = computed(() => account.value?.address);

      return {
        network,
        accounts,
        account,
        publicKey,
        addresses,
        address,

        sign: async (tx: Tx) => {
          if (!account.value) throw new Error('No active account');
          if (!isFullAccountData(account.value)) throw new Error('Account data incomplete');
          return await signer.sign(account.value, tx);
        },

        broadcast: async (tx: Tx) => {
          return await signer.broadcast(tx);
        },

        snapshot: () => {
          if (!network.peek()) return undefined;
          const acc = account.peek();
          return {
            network: network.peek()!,
            accounts: accounts.peek(),
            account: account.peek()!,
            publicKey: publicKey.peek()!,
            addresses: addresses.peek(),
            address: address.peek()!,
            sign: async (tx: Tx) => {
              if (!acc || !isFullAccountData(acc)) throw new Error('Account data incomplete');
              return await signer.sign(acc, tx);
            },
            broadcast: async (tx: Tx) => {
              return await signer.broadcast(tx);
            },
          } satisfies BoundSignerSnapshot<NetConf, Tx>;
        },
      } satisfies BoundSigner<NetConf, Tx>;
    },

    snapshot: (account: FullAccountData<NetConf>) => {
      return {
        network: account.network,
        accounts: [account],
        account,
        publicKey: account.publicKey,
        addresses: [account.address],
        address: account.address,
        sign: async (tx: Tx) => {
          return await signer.sign(account, tx);
        },
        broadcast: async (tx: Tx) => {
          return await signer.broadcast(tx);
        },
      } satisfies BoundSignerSnapshot<NetConf, Tx>;
    },
  };

  _signers.value = [
    ..._signers.peek(),
    signer,
  ];

  return signer;
}

export const isFullAccountData = (account: AccountData): account is FullAccountData =>
  'accountNumber' in account && 'sequence' in account;

export const createAccount = <NetConf extends NetworkConfig = NetworkConfig>(network: NetConf, publicKey: PublicKey): PartialAccountData<NetConf> => ({
  network,
  address: addresses.compute(network, publicKey),
  publicKey,
});

export const updateAccount = <NetConf extends NetworkConfig = NetworkConfig>(account: AccountData<NetConf>, accountNumber: bigint, sequence: bigint): FullAccountData<NetConf> => ({
  ...account,
  accountNumber,
  sequence,
});

export async function fetchAccounts<NetConf extends NetworkConfig = NetworkConfig>(accounts: AccountData<NetConf>[]): Promise<FullAccountData<NetConf>[]> {
  return Promise.all(accounts.map(account => mw('accounts', 'fetch').inv().fifo(account) as any));
}

export const bumpSequence = <NetConf extends NetworkConfig = NetworkConfig>(account: FullAccountData<NetConf>): FullAccountData<NetConf> => ({
  ...account,
  sequence: account.sequence + 1n,
});

export const resetSequence = <NetConf extends NetworkConfig = NetworkConfig>(account: FullAccountData<NetConf>): FullAccountData<NetConf> => ({
  ...account,
  sequence: 0n,
});
