import { AccountData, Any, createAccount, createSigner, fetchAccounts, type CosmosNetworkConfig, type FullAccountData, type NetworkConfig, type Signer } from '@apophis-sdk/core';
import { pubkey, type PublicKey } from '@apophis-sdk/core/crypto/pubkey.js';
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

export interface WalletConnectCosmosSigner extends Signer<CosmosNetworkConfig, CosmosTx>, WCSignerBase {
  /** Refresh accounts for a given network. */
  refreshAccounts(network: NetworkConfig): Promise<PeerAccount[]>;
  /** Get a Heartbeat, a liveness monitor for the peer. Exposes a signal you can subscribe to.
   * The heartbeat must be destroyed when you're done with it.
   */
  heartbeat(): Heartbeat;
}

var signers = new Set<WeakRef<WalletConnectCosmosSigner>>();

export function createWalletConnectSigner(config: WalletConnectSignerConfig): WalletConnectCosmosSigner {
  let session: SessionTypes.Struct | undefined;
  const signClient = _SignClient.init({
    projectId: config.projectId,
    metadata: config.metadata,
  }).then(client => {
    client.on('session_update', (args) => {
      if (args.topic !== session?.topic) return;
      session!.namespaces = args.params.namespaces;
      for (const network of networks) {
        refreshAccounts(network);
      }
    });
    // TODO: what happens when the session is deleted or expires?
    return client;
  });

  let networks: CosmosNetworkConfig[] = [];
  const state = signal<ConnectState | undefined>();
  const accounts = signal<AccountData<CosmosNetworkConfig>[]>([]);

  const encode = (data: Uint8Array) => encodeData(data, config.encoding);
  const decode = (data: string) => decodeData(data, config.encoding);

  async function getAccountsForNetwork(network: NetworkConfig): Promise<{ address: string; publicKey: PublicKey; }[]> {
    if (!session) throw new WalletConnectSignerNotConnectedError();
    const client = await signClient;

    const { topic } = session;
    const { storage } = client.core;

    const key = `apophis:pubkeys:${topic}:${network.chainId}`;
    let peerAccounts: PeerAccount[] | undefined = await storage.getItem(key);

    if (!peerAccounts?.length) {
      peerAccounts = await refreshAccounts(network);
    }

    return peerAccounts.map(acc => {
      if (!['secp256k1', 'ed25519'].includes(acc.algo))
        throw new WalletConnectSignerError(`Unsupported algo: ${acc.algo}`);
      const publicKey = acc.algo === 'secp256k1' ? pubkey.secp256k1(decode(acc.pubkey)) : pubkey.ed25519(decode(acc.pubkey));
      return { address: acc.address, publicKey };
    });
  }

  async function getPublicKeys(network: CosmosNetworkConfig) {
    const accs = await getAccountsForNetwork(network);
    const result: Record<string, PublicKey> = {};
    for (const { publicKey } of accs) {
      const bs = typeof publicKey.bytes === 'string' ? publicKey.bytes : toBase64(publicKey.bytes);
      const key = `${publicKey.type}:${bs}`;
      result[key] = publicKey;
    }
    return Object.values(result);
  }

  async function refreshAccounts(network: NetworkConfig): Promise<PeerAccount[]> {
    if (!session) throw new WalletConnectSignerNotConnectedError();
    const client = await signClient;
    const { topic } = session;
    const { storage } = client.core;

    const key = `apophis:pubkeys:${topic}:${network.chainId}`;
    await waitForPeer(client, session);

    const peerAccounts = await client.request<PeerAccount[]>({
      topic,
      chainId: 'cosmos:' + network.chainId,
      request: {
        method: 'cosmos_getAccounts',
        params: [],
      },
    });

    // note: accounts are stored
    await storage.setItem(key, peerAccounts);

    return peerAccounts;
  }

  async function reinitAccounts(networksToUse = networks) {
    const accmap: Record<string, AccountData<CosmosNetworkConfig>> = {};
    for (const network of networksToUse) {
      const pks = await getPublicKeys(network);
      for (const pk of pks) {
        const account = createAccount(network, pk);
        const key = `${network.chainId}:${account.address}`;
        if (!accmap[key]) {
          accmap[key] = account;
        }
      }
    }

    const newAccounts = Object.values(accmap);
    accounts.value = newAccounts;
    return newAccounts;
  }

  const signer = createSigner<CosmosNetworkConfig, CosmosTx>((api) => {
    return {
      type: 'walletconnect',
      displayName: 'WalletConnect',
      logoURL: LOGO_DATA_URL,
      canAutoReconnect: true,
      available: signal(true),
      accounts,

      probe: async () => {
        // WalletConnect cannot deterministically tell if the user has any other remote wallets, so it's
        // always available.
        return true;
      },
      connect: async (networksToConnect: CosmosNetworkConfig[]) => {
        networks = networksToConnect.filter(network => network.ecosystem === 'cosmos') as CosmosNetworkConfig[];

        let timeout: ReturnType<typeof setTimeout> | undefined;

        const request = async () => {
          const client = await signClient;

          const requiredNamespaces: ProposalTypes.RequiredNamespaces = {
            cosmos: {
              methods: ['cosmos_getAccounts', 'cosmos_signDirect', 'cosmos_signAmino'],
              events: [],
              chains: networks.map(network => 'cosmos:' + network.chainId),
            },
          };

          const [existingSession] = client.find({ requiredNamespaces }).filter(s => s.expiry > Date.now() / 1000);
          if (existingSession) {
            session = existingSession;
            state.value = {
              state: 'connected',
              session: existingSession,
              restored: true,
              timestamp: new Date(),
            };
            return await reinitAccounts(networks);
          }

          const { uri, approval } = await client.connect({ requiredNamespaces });

          approval()
            .then(newSession => {
              clearTimeout(timeout);
              session = newSession;
              state.value = {
                state: 'connected',
                session: newSession,
                restored: false,
                timestamp: new Date(),
              };
              return reinitAccounts(networks);
            })
            .catch(error => {
              if (error instanceof Error && error.message === 'Proposal expired') {
                request();
              } else {
                state.value = {
                  state: 'error',
                  error,
                  timestamp: new Date(),
                };
              }
            });

          state.value = {
            state: 'pending',
            uri,
            timestamp: new Date(),
            cancel: () => {
              clearTimeout(timeout);
              state.value = {
                state: 'error',
                error: new WalletConnectSignerError('Cancelled'),
                timestamp: new Date(),
              };
            },
          };

          // Wait for connection
          return new Promise<AccountData<CosmosNetworkConfig>[]>((resolve, reject) => {
            const unsub = state.subscribe(currentState => {
              if (!currentState) return;
              switch (currentState.state) {
                case 'error':
                  if (currentState.error instanceof Error && currentState.error.message === 'Proposal expired') break;
                  setTimeout(() => unsub(), 1);
                  reject(currentState.error);
                  break;
                case 'connected':
                  setTimeout(() => unsub(), 1);
                  reinitAccounts(networks).then(resolve).catch(reject);
                  break;
              }
            });
          });
        };

        return await request();
      },
      disconnect: async (networksToDisconnect: CosmosNetworkConfig[]) => {
        const client = await signClient;
        for (const key of client.pairing.keys) {
          client.pairing.delete(key, { code: 6000, message: 'Disconnecting' });
        }
        for (const key of client.session.keys) {
          client.session.delete(key, { code: 6000, message: 'Disconnecting' });
        }
        networks = networks.filter(n => !networksToDisconnect.includes(n));
      },
      sign: async (account: FullAccountData<CosmosNetworkConfig>, tx: CosmosTx) => {
        if (!session) throw new WalletConnectSignerNotConnectedError();
        const client = await signClient;
        const { topic } = session;

        [account] = await fetchAccounts([account]);

        const snapshot = signer.snapshot(account);
        const sdkTx = tx.sdkTx(snapshot);
        if (!sdkTx.authInfo || !sdkTx.body) throw new WalletConnectSignerError('Invalid transaction');

        const { signature, signed } = await client.request<SignResponse>({
          topic,
          chainId: 'cosmos:' + account.network.chainId,
          request: {
            method: 'cosmos_signDirect',
            params: {
              signerAddress: account.address,
              signDoc: {
                chainId: account.network.chainId,
                accountNumber: account.accountNumber.toString(),
                authInfoBytes: encode(AuthInfo.encode(sdkTx.authInfo).finish()),
                bodyBytes: encode(TxBody.encode(sdkTx.body).finish()),
              },
            },
          },
        });

        const signedAuthInfo = AuthInfo.decode(decode(signed.authInfoBytes));
        const signedBody = TxBody.decode(decode(signed.bodyBytes));

        tx.gas = {
          ...signedAuthInfo.fee,
          amount: signedAuthInfo.fee?.amount.map((coin: any) => Cosmos.coin(coin.amount, coin.denom)) ?? tx.gas?.amount ?? [],
          gasLimit: signedAuthInfo.fee?.gasLimit ?? tx.gas?.gasLimit ?? 0n,
        };
        tx.messages = signedBody.messages.map(msg => Any.decode(account.network, msg));
        tx.memo = signedBody.memo;
        tx.timeoutHeight = signedBody.timeoutHeight;
        tx.setSignature(snapshot, decode(signature.signature));
        return tx;
      },
      broadcast: async (tx: CosmosTx) => {
        return await Cosmos.broadcast(tx.network!, tx);
      },
    };
  });

  // Extend signer with WalletConnect-specific methods
  const wcSigner = Object.assign(signer, {
    state: state as ReadonlySignal<ConnectState | undefined>,
    refreshAccounts,
    heartbeat() {
      if (!session) throw new WalletConnectSignerNotConnectedError();
      return new Heartbeat(signClient, session.topic).start();
    },
  }) as WalletConnectCosmosSigner;

  signers.add(new WeakRef(wcSigner));

  return wcSigner;
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

function encodeData(data: Uint8Array, encoding: WalletConnectSignerConfig['encoding'] = 'base64') {
  if (encoding === 'base64') return toBase64(data);
  if (encoding === 'hex') return toHex(data);
  throw new WalletConnectSignerError(`Unsupported encoding: ${encoding}`);
}

function decodeData(data: string, encoding: WalletConnectSignerConfig['encoding'] = 'base64') {
  if (encoding === 'base64') return fromBase64(data);
  if (encoding === 'hex') return fromHex(data);
  throw new WalletConnectSignerError(`Unsupported encoding: ${encoding}`);
}


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
