import { CosmosNetworkConfig, ExternalAccount, type NetworkConfig, Signer } from '@apophis-sdk/core';
import { pubkey, PublicKey } from '@apophis-sdk/core/crypto/pubkey.js';
import { fromBase64, fromHex, toBase64, toHex } from '@apophis-sdk/core/utils.js';
import { Cosmos, CosmosTx } from '@apophis-sdk/cosmos';
import { ReadonlySignal, signal } from '@preact/signals-core';
import { SignClient as _SignClient } from '@walletconnect/sign-client';
import { ProposalTypes, SessionTypes } from '@walletconnect/types';
import { AuthInfo, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js';
import LOGO_DATA_URL from '../logos/walletconnect.js';
import { type WalletConnectSignerConfig } from './config.js';
import { WalletConnectSignerError, WalletConnectSignerNotConnectedError } from './error.js';
import { PeerAccount, SignClient, SignResponse } from './types.api.js';

export interface WCSignerBase {
  /** Get the current connection state. If `undefined`, no connection has been attempted yet. */
  get state(): ReadonlySignal<ConnectState | undefined>;
}

export type ConnectState = ConnectState.Pending | ConnectState.Connected | ConnectState.Error;

export namespace ConnectState {
  export interface Pending {
    state: 'pending';
    uri: string | undefined;
    /** Cancel the current connection attempt. Will set the state to `error` with a `WalletConnectSignerError` with message `Cancelled`. */
    cancel: () => void;
    timestamp: Date;
  }
  export interface Connected {
    state: 'connected';
    session: SessionTypes.Struct;
    /** Whether this connection was restored from a previous session. */
    restored: boolean;
    timestamp: Date;
  }
  export interface Error {
    state: 'error';
    error: any;
    timestamp: Date;
  }
}

export type ConnectResponse = Awaited<ReturnType<SignClient['connect']>>;

var signers = new Set<WeakRef<WalletConnectCosmosSigner>>();

export class WalletConnectCosmosSigner extends Signer<CosmosTx> implements WCSignerBase {
  #session: SessionTypes.Struct | undefined;
  #signClient: Promise<SignClient>;
  #networks: CosmosNetworkConfig[] = [];
  #state = signal<ConnectState | undefined>();
  readonly type = 'walletconnect';
  readonly canAutoReconnect = true;
  readonly displayName = 'WalletConnect';
  readonly logoURL = LOGO_DATA_URL;

  constructor(public readonly config: WalletConnectSignerConfig) {
    super();
    this.available.value = true;
    this.#signClient = _SignClient.init({
      projectId: config.projectId,
      metadata: config.metadata,
    }).then(client => {
      client.on('session_update', (args) => {
        if (args.topic !== this.#session?.topic) return;
        this.#session.namespaces = args.params.namespaces;
        for (const network of this.#networks) {
          this.refreshAccounts(network);
        }
      });
      // TODO: what happens when the session is deleted or expires?
      return client;
    });
    signers.add(new WeakRef(this));
  }

  probe() {
    // WalletConnect cannot deterministically tell if the user has any other remote wallets, so it's
    // always available.
    return Promise.resolve(true);
  }

  connect(networks: NetworkConfig[]) {
    this.#networks = networks = networks.filter(network => network.ecosystem === 'cosmos') as CosmosNetworkConfig[];

    let timeout: ReturnType<typeof setTimeout> | undefined;

    const request = async () => {
      const client = await this.#signClient;

      const requiredNamespaces: ProposalTypes.RequiredNamespaces = {
        cosmos: {
          methods: ['cosmos_getAccounts', 'cosmos_signDirect', 'cosmos_signAmino'],
          events: [],
          chains: this.#networks.map(network => 'cosmos:' + network.chainId),
        },
      };

      const [session] = client.find({ requiredNamespaces }).filter(session => session.expiry > Date.now() / 1000);
      if (session) {
        this.#state.value = {
          state: 'connected',
          session,
          restored: true,
          timestamp: new Date(),
        };
        return;
      }

      const { uri, approval } = await client.connect({ requiredNamespaces });

      approval()
        .then(session => {
          clearTimeout(timeout);
          this.#state.value = {
            state: 'connected',
            session,
            restored: false,
            timestamp: new Date(),
          };
        })
        .catch(error => {
          if (error instanceof Error && error.message === 'Proposal expired') {
            request();
          } else {
            this.#state.value = {
              state: 'error',
              error,
              timestamp: new Date(),
            };
          }
        });

      this.#state.value = {
        state: 'pending',
        uri,
        timestamp: new Date(),
        cancel: () => {
          clearTimeout(timeout);
          this.#state.value = {
            state: 'error',
            error: new WalletConnectSignerError('Cancelled'),
            timestamp: new Date(),
          };
        },
      };
    };
    request();

    return new Promise<ExternalAccount[]>((resolve, reject) => {
      const unsub = this.#state.subscribe(state => {
        if (!state) return;
        switch (state.state) {
          case 'error':
            if (state.error instanceof Error && state.error.message === 'Proposal expired') break;
            setTimeout(() => unsub(), 1); // hack for when state is already set during initial run
            reject(state.error);
            break;
          case 'connected':
            setTimeout(() => unsub(), 1);
            this.#session = state.session;
            this._reinitAccounts(networks as CosmosNetworkConfig[]).then(resolve).catch(reject);
            break;
        }
      })
    });
  }

  async disconnect() {
    const client = await this.#signClient;
    for (const key of client.pairing.keys) {
      client.pairing.delete(key, { code: 6000, message: 'Disconnecting' });
    }
    for (const key of client.session.keys) {
      client.session.delete(key, { code: 6000, message: 'Disconnecting' });
    }
  }

  async sign(network: NetworkConfig, tx: CosmosTx): Promise<CosmosTx> {
    if (network.ecosystem !== 'cosmos') throw new Error('Currently, only Cosmos chains are supported');
    if (!this.#session) throw new WalletConnectSignerNotConnectedError();
    const client = await this.#signClient;
    const { topic } = this.#session;

    const signData = this.getSignData(network);
    if (!ExternalAccount.isComplete(signData))
      await this.updateSignData([this.getAccount(network)], [network]);
    if (!ExternalAccount.isComplete(signData)) throw new WalletConnectSignerError('Failed to load sign data');

    const sdkTx = tx.sdkTx(network, this);
    if (!sdkTx.authInfo || !sdkTx.body) throw new WalletConnectSignerError('Invalid transaction');

    const { signature, signed } = await client.request<SignResponse>({
      topic,
      chainId: 'cosmos:' + network.chainId,
      request: {
        method: 'cosmos_signDirect',
        params: {
          signerAddress: signData.address,
          signDoc: {
            chainId: network.chainId,
            accountNumber: signData.accountNumber.toString(),
            authInfoBytes: this.#encode(AuthInfo.encode(sdkTx.authInfo).finish()),
            bodyBytes: this.#encode(TxBody.encode(sdkTx.body).finish()),
          },
        },
      },
    });

    const signedAuthInfo = AuthInfo.decode(this.#decode(signed.authInfoBytes));
    const signedBody = TxBody.decode(this.#decode(signed.bodyBytes));

    tx.gas = {
      ...signedAuthInfo.fee,
      amount: signedAuthInfo.fee?.amount.map(coin => Cosmos.coin(coin.amount, coin.denom)) ?? tx.gas?.amount ?? [],
      gasLimit: signedAuthInfo.fee?.gasLimit ?? tx.gas?.gasLimit ?? 0n,
    };
    tx.memo = signedBody.memo;
    tx.timeoutHeight = signedBody.timeoutHeight;
    tx.setSignature(network, this, this.#decode(signature.signature));
    return tx;
  }

  async broadcast(tx: CosmosTx): Promise<string> {
    return await Cosmos.broadcast(tx.network!, tx);
  }

  /** Refresh accounts for a given network. */
  async refreshAccounts(network: NetworkConfig): Promise<PeerAccount[]> {
    if (!this.#session) throw new WalletConnectSignerNotConnectedError();
    const client = await this.#signClient;
    const { topic } = this.#session;
    const { storage } = client.core;

    const key = `apophis:pubkeys:${topic}:${network.chainId}`;
    await waitForPeer(client, this.#session);

    const accounts = await client.request<PeerAccount[]>({
      topic,
      chainId: 'cosmos:' + network.chainId,
      request: {
        method: 'cosmos_getAccounts',
        params: [],
      },
    });

    // note: accounts are stored
    await storage.setItem(key, accounts);

    return accounts;
  }

  protected async getAccounts(network: NetworkConfig): Promise<{ address: string; publicKey: PublicKey; }[]> {
    if (!this.#session) throw new WalletConnectSignerNotConnectedError();
    const client = await this.#signClient;

    const { topic } = this.#session;
    const { storage } = client.core;

    const key = `apophis:pubkeys:${topic}:${network.chainId}`;
    let accounts: PeerAccount[] | undefined = await storage.getItem(key);

    if (!accounts?.length) {
      accounts = await this.refreshAccounts(network);
    }

    return accounts.map(acc => {
      if (!['secp256k1', 'ed25519'].includes(acc.algo))
        throw new WalletConnectSignerError(`Unsupported algo: ${acc.algo}`);
      const publicKey = acc.algo === 'secp256k1' ? pubkey.secp256k1(this.#decode(acc.pubkey)) : pubkey.ed25519(this.#decode(acc.pubkey));
      return { address: acc.address, publicKey };
    });
  }

  protected async getPublicKeys(network: CosmosNetworkConfig) {
    const accs = await this.getAccounts(network);
    const result: Record<string, PublicKey> = {};
    for (const { publicKey } of accs) {
      const bs = typeof publicKey.bytes === 'string' ? publicKey.bytes : toBase64(publicKey.bytes);
      const key = `${publicKey.type}:${bs}`;
      result[key] = publicKey;
    }
    return Object.values(result);
  }

  async updateSignData(accounts: ExternalAccount[], networks = this.#networks) {
    await Promise.all(accounts.map(async acc => {
      await Promise.all(networks.map(async network => {
        if (!acc.isBound(network)) return;
        const data = acc.getSignData(network);
        const info = await Cosmos.getAccountInfo(network, data.peek().address).catch(() => null);
        if (info) {
          acc.setSignData(network, info.accountNumber, info.sequence);
        }
      }));
    }));
  }

  #encode = (data: Uint8Array) => encode(data, this.config.encoding);
  #decode = (data: string) => decode(data, this.config.encoding);

  /** Get a Heartbeat, a liveness monitor for the peer. Exposes a signal you can subscribe to.
   * The heartbeat must be destroyed when you're done with it.
   */
  heartbeat() {
    if (!this.#session) throw new WalletConnectSignerNotConnectedError();
    return new Heartbeat(this.#signClient, this.#session.topic).start();
  }

  get state() {
    return this.#state as ReadonlySignal<ConnectState | undefined>;
  }

  protected async _reinitAccounts(networks = this.#networks) {
    const accmap: Record<string, ExternalAccount> = {};
    for (const network of networks) {
      const pks = await this.getPublicKeys(network as CosmosNetworkConfig);
      this.initAccounts(accmap, network, pks);
    }

    const accounts = Object.values(accmap);
    // updateSignData only updates accounts bound to the given networks
    await this.updateSignData(accounts, networks as CosmosNetworkConfig[]);
    return this.accounts.value = accounts;
  }

  static async resetAll() {
    for (const signer of getSigners()) {
      await signer._reinitAccounts();
    }
  }

  static async updateAll() {
    for (const signer of getSigners()) {
      await signer.updateSignData(signer.accounts.peek());
    }
  }
}

class Heartbeat {
  #interval: ReturnType<typeof setInterval> | undefined;
  #status = signal<boolean>(false);

  constructor(public readonly client: Promise<SignClient>, public readonly topic: string) {}

  start() {
    this.#interval = setInterval(() => {
      let active = true;

      this.client
        .then(client => client.ping({ topic: this.topic }))
        .then(() => {
          if (!active) return;
          this.#status.value = true;
          active = false;
          clearTimeout(timeout);
        })
        .catch(() => {});

      const timeout = setTimeout(() => {
        if (!active) return;
        active = false;
        this.#status.value = false;
      }, 5000);
    }, 5000);
    return this;
  }

  destroy() {
    clearInterval(this.#interval);
    this.#interval = undefined;
  }

  get status() {
    return this.#status;
  }
}

function encode(data: Uint8Array, encoding: WalletConnectSignerConfig['encoding'] = 'base64') {
  if (encoding === 'base64') return toBase64(data);
  if (encoding === 'hex') return toHex(data);
  throw new WalletConnectSignerError(`Unsupported encoding: ${encoding}`);
}

function decode(data: string, encoding: WalletConnectSignerConfig['encoding'] = 'base64') {
  if (encoding === 'base64') return fromBase64(data);
  if (encoding === 'hex') return fromHex(data);
  throw new WalletConnectSignerError(`Unsupported encoding: ${encoding}`);
}

// periodically refresh sign data
setTimeout(WalletConnectCosmosSigner.updateAll, 30000);

function getSigners() {
  const result: WalletConnectCosmosSigner[] = [];
  for (const ref of signers) {
    const signer = ref.deref();
    if (signer) {
      result.push(signer);
    } else {
      signers.delete(ref);
    }
  }
  return result;
}

function waitForPeer(client: SignClient, session: SessionTypes.Struct, retries = Infinity) {
  return new Promise<void>((resolve, reject) => {
    let attempt = 0;
    const ping = () => client.ping({ topic: session.topic })
      .then(() => resolve())
      .catch(() => {
        if (attempt++ < retries) {
          setTimeout(ping, 1000);
        } else {
          reject(new WalletConnectSignerError('Failed to connect to peer'));
        }
      });
    ping();
  });
}
