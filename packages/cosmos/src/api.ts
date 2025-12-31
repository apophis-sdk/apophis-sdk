import { Bytes, defaultJsonRpcMarshal, defaultJsonRpcUnmarshal, isJsonRpcResponse, JsonRpcPayload, mw, type CosmosRegistryAsset, type FungibleAsset } from '@apophis-sdk/core';
import { Any } from '@apophis-sdk/core/encoding/protobuf/any.js';
import { endpoints } from '@apophis-sdk/core/endpoints.js';
import { BytesMarshalUnit } from '@apophis-sdk/core/marshal.js';
import type { CosmosNetworkConfig, NetworkConfig } from '@apophis-sdk/core/networks.js';
import { PowerSocket } from '@apophis-sdk/core/powersocket.js';
import * as signals from '@apophis-sdk/core/signals.js';
import { bytes, fromBase64, fromHex, toBase64, toHex } from '@apophis-sdk/core/utils.js';
import {
  type BasicRestApi,
  type Block,
  type BlockEvent,
  type BlockEventRaw,
  BroadcastMode,
  Coin,
  type CosmosEvent,
  Gas,
  type TransactionEvent,
  type TransactionEventRaw,
  type TransactionResponse,
  type TransactionResult,
  type WS,
} from '@apophis-sdk/cosmos/types.sdk.js';
import { extendDefaultMarshaller, RecaseMarshalUnit } from '@kiruse/marshal';
import { restful } from '@kiruse/restful';
import { Event } from '@kiruse/typed-events';
import { recase } from '@kristiandupont/recase';
import { sha256 } from '@noble/hashes/sha256';
import { type ReadonlySignal } from '@preact/signals';
import { Tx as SdkTxDirect } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js';
import { BlockID } from 'cosmjs-types/tendermint/types/types.js';
import { ABCIQuery, isABCIQuery } from './abciquery.js';
import { TendermintQuery } from './tmquery.js';
import { AminoTxOptions, type CosmosTx, CosmosTxAmino, CosmosTxBase, CosmosTxDirect, CosmosTxEncoding, CosmosTxSignal, CosmosTxSignalOptions, DirectTxOptions } from './tx.js';

type Unsub = () => void;

export interface TxOptionsProtobuf extends DirectTxOptions {
  encoding?: 'protobuf';
}
export interface TxOptionsAmino extends AminoTxOptions {
  encoding: 'amino';
}

const { marshal, unmarshal } = extendDefaultMarshaller([
  RecaseMarshalUnit(
    key => recase('mixed', 'camel')(key),
    key => recase('mixed', 'snake')(key),
  ),
  BytesMarshalUnit,
]);

/** This is the basic Cosmos REST API that is commonly used when interfacing with the blockchain.
 * Note that it does not necessarily reflect the real REST API of the target chain as it is highly
 * dependent on the chain's SDK modules and can be overridden. The API endpoints here are most
 * commonly found & used in smart contract interactions.
 */
export const Cosmos = new class {
  #apis = new Map<CosmosNetworkConfig, BasicRestApi>();
  #sockets = new Map<CosmosNetworkConfig, CosmosWebSocket>();

  /** Get a bound REST API. When undefined, gets the REST API for the current `defaultNetwork` signal
   * value. If that, too, is undefined, throws an error. Note that this associates the concrete
   * `CosmosNetworkConfig` instance with the REST API instance, so take care to pass around the correct
   * object instance.
   */
  rest(network?: NetworkConfig) {
    network ??= signals.network.value;
    if (!network) throw new Error('No network specified and no active network set');
    if (network.ecosystem !== 'cosmos') throw new Error('Network is not a Cosmos chain');
    if (!this.#apis.get(network)) {
      this.#apis.set(network, restful.default<BasicRestApi>({
        baseUrl() {
          const url = endpoints.get(network, 'rest');
          if (!url) throw new Error(`No REST API URL set for the network: ${network.name}`);
          return url;
        },
        marshal,
        unmarshal,
      }));
    }
    return this.#apis.get(network)!;
  }

  ws(network?: NetworkConfig) {
    network ??= signals.network.value;
    if (!network) throw new Error('No network specified and no active network set');
    if (network.ecosystem !== 'cosmos') throw new Error('Network is not a Cosmos chain');
    if (!this.#sockets.get(network)) {
      this.#sockets.set(network, new CosmosWebSocket(network).connect());
    }
    return this.#sockets.get(network)!;
  }

  async getAccountInfo(network: NetworkConfig, address: string) {
    if (network.ecosystem !== 'cosmos') throw new Error('Network is not a Cosmos chain');
    // TODO: this should handle 429s & retry automatically
    const { info } = await this.rest(network).cosmos.auth.v1beta1.account_info[address]('GET');
    return {
      accountNumber: info.account_number,
      address: info.address,
      publicKey: info.pub_key,
      sequence: info.sequence,
    };
  }

  /** Create a new transaction with the given messages. */
  tx(messages: object[], opts?: TxOptionsProtobuf): CosmosTxDirect;
  tx(messages: object[], opts: TxOptionsAmino): CosmosTxAmino;
  tx(messages: object[], { encoding, ...opts }: any = {}) {
    return encoding === 'amino'
      ? new CosmosTxAmino(messages, opts)
      : new CosmosTxDirect(messages, opts);
  }

  coin = (amount: bigint | number | string, denom: string): Coin => ({ denom, amount: BigInt(amount) });

  /** A wrapper for Transactions for frontends. Built on `computed`, when the messages returned by
   * `factory` change, the transaction is automatically updated and gas estimation is re-run.
   *
   * Usage:
   *
   * ```tsx
   * import { Cosmos } from '@apophis-sdk/cosmos';
   * import { useEffect } from 'react';
   *
   * function YourComponent() {
   *   const tx = Cosmos.signalTx(network, () => yourMessages);
   *
   *   // CosmosTxSignal uses an effect and a timer internally to automatically refresh the estimate
   *   // so we need to be sure to destroy it to avoid memory leaks
   *   useEffect(() => {
   *     return () => tx.destroy();
   *   }, []);
   *
   *   return (
   *     <div>
   *       <button onClick={() => tx.signAndBroadcast()}>Confirm</button>
   *       <cosmos-estimate estimate={tx.estimate} />
   *     </div>
   *   );
   * }
   * ```
   *
   * *Note:* The `cosmos-estimate` component is a custom element from the `@kiruse/cosmos-components`
   * package.
   */
  signalTx(messages: ReadonlySignal<object[]>, opts: CosmosTxSignalOptions = {}) {
    return new CosmosTxSignal(messages, opts);
  }

  /** Broadcast a transaction to the network. If `async` is true, will not wait for inclusion in a
   * block and return immediately, but it also will not throw upon rejection of the transaction.
   *
   * If a WebSocket connection has previously been opened (not yet necessarily established successfully)
   * it will be used for the broadcast. Otherwise, the REST API will be used. The WebSocket method
   * is generally preferable over the REST method as a connection to the RPC is already opened,
   * resulting in lower latency and truthfulness of the blockchain state (when responding to block or
   * transaction events).
   *
   * If you wish to force either a WebSocket or REST broadcast, you may do so with
   * `Cosmos.ws(network).broadcast(...)` or `Cosmos.rest(network).cosmos.tx.v1beta1.txs('POST', ...)`,
   * respectively.
   *
   * @returns the hash of the transaction, computed locally. The existence of the hash is no confirmation of the tx.
   */
  async broadcast(network: CosmosNetworkConfig, tx: CosmosTx, async = false): Promise<string> {
    // try to broadcast via ws if any has been opened yet. timeout 5s to avoid user waiting too long
    // ws is generally preferable due to lower latency as the connection is already open
    if (this.#sockets.get(network)?.connected) {
      const ws = this.ws(network);
      await ws.ready(5000);
      return ws.broadcast(tx, async);
    } else {
      const { tx_response: { txhash } } = await this.rest(network).cosmos.tx.v1beta1.txs('POST', {
        tx_bytes: tx.bytes(),
        mode: async ? BroadcastMode.BROADCAST_MODE_ASYNC : BroadcastMode.BROADCAST_MODE_SYNC,
      });
      return txhash;
    }
  }

  /** Attempts to find the last block before the given timestamp.
   *
   * @param network
   * @param timestamp
   * @param startHeight where to begin searching from. Defaults to current height.
   * @param blockSpeed is the average number of seconds between blocks. Although it is network-dependent,
   * it defaults to 3 seconds for many chains. The exact speed doesn't matter as it is just a
   * heuristic to estimate number of blocks between two timestamps.
   * @param connectionTimeout is used when first establishing a connection to the full node and defaults to 10s.
   */
  async findBlockAt(network: CosmosNetworkConfig, timestamp: Date, startHeight?: bigint, blockSpeed = 3, connectionTimeout = 10000) {
    if (this.#sockets.get(network)?.connected) {
      const ws = this.ws(network);
      await ws.ready(connectionTimeout);
      if (timestamp >= new Date()) return (await ws.getBlock()).block;

      let { block: lastBlock } = await ws.getBlock(startHeight);
      let { block } = await ws.getBlock(guessNextHeight(lastBlock, timestamp, blockSpeed));
      while (!findTargetBlock(block, lastBlock, timestamp)) {
        // blockSpeed has an anti-proportional effect on the step size, so we increase it with every
        // iteration to prevent overshooting
        blockSpeed *= 1.1;
        lastBlock = block;
        ({ block } = await ws.getBlock(guessNextHeight(block, timestamp, blockSpeed)));
      }
      return block.header.height < lastBlock.header.height ? block : lastBlock;
    } else {
      throw new Error('findBlockBefore by REST is not yet implemented');
    }
  }

  /** Helper function to decode the bytes of a Cosmos SDK transaction.
   *
   * **Note** that the resulting type is not the same as this `Tx` class of this library, but instead
   * from `cosmjs-types/cosmos/tx/v1beta1/tx` which is directly built from the Cosmos SDK protobuf
   * definitions.
   */
  decodeTx(tx: SdkTxDirect | string | Uint8Array) {
    if (typeof tx === 'string') tx = fromBase64(tx);
    if (tx instanceof Uint8Array) return SdkTxDirect.decode(tx);
    return tx;
  }

  /** Wrapper around `decodeTx` that attempts to decode the tx. If it fails, returns the original tx bytes. */
  tryDecodeTx(tx: SdkTxDirect | string | Uint8Array) {
    try {
      return this.decodeTx(tx);
    } catch {
      return typeof tx === 'string' ? tx : tx instanceof Uint8Array ? toBase64(tx) : tx;
    }
  }

  getTxHash(tx: CosmosTx | Uint8Array | string | SdkTxDirect) {
    return CosmosTxBase.computeHash(tx);
  }

  /** Search a list of `CosmosEvent`s for a particular event/attribute. The result is a list of all
   * matching values in the order of their occurrence.
   */
  getEventValues(events: CosmosEvent[], event: string, attribute: string) {
    return events
      .filter(e => e.type === event)
      .flatMap(e => e.attributes.filter(attr => attr.key === attribute).map(attr => attr.value));
  }

  async getNetworkFromRegistry(name: string): Promise<CosmosNetworkConfig> {
    const isTestnet = name.match(/testnet|devnet/);
    const baseurl = isTestnet
      ? `https://raw.githubusercontent.com/cosmos/chain-registry/master/testnets/${name}`
      : `https://raw.githubusercontent.com/cosmos/chain-registry/master/${name}`;
    const [chainData, assetlist] = await Promise.all([
      fetch(`${baseurl}/chain.json`).then(res => res.json()),
      fetch(`${baseurl}/assetlist.json`).then(res => res.json()),
    ]);

    const assets: FungibleAsset[] = assetlist.assets.map((asset: CosmosRegistryAsset): FungibleAsset => {
      const decimals = asset.denom_units.find(unit => unit.denom === asset.base)?.exponent ?? 6;

      const displayVariant = asset.display ? asset.denom_units.find(unit => unit.denom === asset.display) : undefined;

      return {
        denom: asset.base,
        name: asset.name,
        decimals,
        display: {
          denom: displayVariant?.denom ?? asset.base,
          aliases: displayVariant?.aliases,
          decimals: displayVariant?.exponent,
          symbol: asset.symbol,
        },
      };
    });

    const [feeData] = chainData.fees?.fee_tokens ?? [];
    if (!feeData) throw new Error(`No fee info found in Cosmos Chain Registry for ${name}`);

    const feeAsset = assets.find(asset => asset.denom === feeData.denom);
    if (!feeAsset) throw new Error(`Fee asset ${feeData.denom} not found in asset list for ${name}`);

    return {
      ecosystem: 'cosmos',
      name,
      chainId: chainData.chain_id,
      prettyName: chainData.pretty_name,
      addressPrefix: chainData.bech32_prefix,
      slip44: chainData.slip44,
      assets: assets,
      gas: [{
        asset: feeAsset,
        avgPrice: feeData.average_gas_price,
        lowPrice: feeData.low_gas_price ?? feeData.average_gas_price,
        highPrice: feeData.high_gas_price ?? feeData.average_gas_price,
        minFee: feeData.fixed_min_gas_price,
      }],
      endpoints: {
        rest: chainData.apis?.rest?.map(({ address }: any) => address),
        rpc: chainData.apis?.rpc?.map(({ address }: any) => address),
        ws: chainData.apis?.rpc?.map(({ address }: any) => address).map((ep: string) => ep.replace(/^http/, 'ws').replace(/\/$/, '') + '/websocket'),
      },
    };
  }
}

// TODO: rewrite this to use the new JsonRpc abstraction
export class CosmosWebSocket {
  config = {
    getTx: {
      /** Whether the `hash` parameter of `getTx` is base64 encoded instead of hex. */
      hashIsBase64: true,
    },
  };
  socket: PowerSocket<JsonRpcPayload, JsonRpcPayload, string>;
  #subs: Record<number, TxSubscriptionMetadata> = {};
  #nextSubId = 2; // 1 is reserved for block subscription
  #onBlock = Event<BlockEvent>();
  #heartbeat: ReturnType<typeof setTimeout> | undefined;

  constructor(public readonly network: CosmosNetworkConfig) {
    this.socket = new PowerSocket<JsonRpcPayload, JsonRpcPayload, string>(
      () => endpoints.get(network, 'ws'),
      defaultJsonRpcMarshal,
      defaultJsonRpcUnmarshal,
    );
  }

  connect() {
    this.socket.connect();
    this.socket.onConnect(() => {
      this.socket.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: ['tm.event = \'NewBlock\''],
        id: 1,
      });
      this.socket.onMessage(async (_, msg) => {
        if (!isJsonRpcResponse(msg)) return;

        try {
          if (msg.error) {
            console.warn('RPC error:', this.network, msg.error);
            return;
          }

          // ignore ACK messages (for now)
          if (!msg.result || !Object.entries(msg.result).length) return;
          if (msg.id === 1) {
            const { data: { value: { block, result_finalize_block } } } = (msg.result as BlockEventRaw);
            this.#onBlock.emit({
              header: block.header,
              lastCommit: block.last_commit,
              events: result_finalize_block?.events ?? [],
              txs: block.data?.txs.map(Cosmos.tryDecodeTx) ?? [],
              evidence: block.evidence.evidence,
              txResults: result_finalize_block?.tx_results ?? [],
            });
          } else if (msg.id in this.#subs) {
            // TODO: should handle multiple subscriptions for the same tx + query
            const { data: { value: { tx_result: tx } } } = msg.result as TransactionEventRaw;
            if ('code' in tx.result) {
              this.#subs[msg.id]?.callback({
                height: tx.height,
                error: tx.result,
                txBytes: tx.tx,
                index: tx.index,
              });
            } else {
              this.#subs[msg.id]?.callback({
                height: tx.height,
                txhash: CosmosTxDirect.computeHash(tx.tx),
                index: tx.index,
                result: tx.result,
                tx: Cosmos.decodeTx(tx.tx),
              });
            }
          }
        } catch (e) {
          console.error(
            Object.assign(Error('Invalid JSON message received'), {
              message: msg,
              context: this,
              cause: e,
            })
          );
        }
      });
      this.#heartbeat = setTimeout(this.#sendHeartbeat, 35000);
    });
    this.socket.onDisconnect(() => {
      clearTimeout(this.#heartbeat!);
      this.#heartbeat = undefined;
    });

    const clearHeartbeat = () => {
      clearInterval(this.#heartbeat!);
      this.#heartbeat = undefined;
    }
    this.socket.onDisconnect(clearHeartbeat);
    this.socket.onClose(clearHeartbeat);
    return this;
  }

  reconnect() {
    this.socket.reconnect();
    return this;
  }

  close() {
    this.socket.close();
    return this;
  }

  /** Broadcast a transaction to the network. If `async` is true, will not wait for inclusion in a
   * block and return immediately, but it also will not throw upon rejection of the transaction.
   *
   * @returns the hash of the transaction, computed locally. The existence of the hash is no confirmation of the tx.
   */
  async broadcast(tx: CosmosTx, async = false): Promise<string> {
    const method = async ? 'broadcast_tx_async' : 'broadcast_tx_sync';
    const result = await this.send<TransactionResult>(method, [tx.bytes()]);
    if (result.code)
      throw new Error(`Failed to broadcast transaction: ${result.code} (${result.codespace}): ${result.log}`);
    return tx.hash;
  }

  /** Low-level method to query the chain with a protobuf message.
   *
   * @param msg Protobuf message object to query with.
   * @param height Height of the block to query at. Defaults to 0 (latest height). Beware that nodes may individually prune blocks at different intervals.
   * @param prove Whether to request a merkle tree proof of the query result.
   */
  async query<T extends string, Req, Res>(query: ABCIQuery<T, Req, Res>, data: Req, height = 0n, prove = false): Promise<Res> {
    const payload = query.request.encode(data).toShrunk();

    const { response } = await this.send<{
      response: {
        code: number;
        codespace?: string;
        log?: string;
        info?: string;
        index: bigint;
        key?: unknown;
        value: Bytes;
        proof_ops?: unknown;
        height: bigint;
      };
    }>('abci_query', {
      path: query.path,
      data: payload.toHex(),
      height,
      prove,
    });

    if (response.code)
      throw new Error(`Failed to query ${query.path}: ${response.code} (${response.codespace}): ${response.log}`);
    return query.response.decode(bytes(response.value));
  }

  onBlock(callback: (block: BlockEvent) => void) {
    return this.#onBlock(({ args: block }) => callback(block));
  }

  /** Listen for new transactions, optionally filtered by a query.
   *
   * **Beware** that many public nodes do not expose a WebSocket endpoint at all, and that these
   * subscriptions may even be limited. If you need to monitor various different types of
   * transactions, you should consider using a single subscription and filtering the transactions
   * on the client-side.
   */
  onTx(query: TendermintQuery | null, callback: (tx: TransactionEvent) => void): Unsub {
    query ??= new TendermintQuery();
    query.exact('tm.event', 'Tx');
    const q = query.toString();

    const id = this.#nextSubId++;
    this.#subs[id] = { type: 'tx', id, query: query ?? undefined, callback };
    const subscribe = () => {
      this.socket.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: [q],
        id,
      });
    };
    this.socket.onConnect(subscribe);
    if (this.socket.connected) subscribe();
    return () => {
      delete this.#subs[id];
      this.socket.send({
        jsonrpc: '2.0',
        method: 'unsubscribe',
        params: [q],
        id: -1,
      });
    }
  }

  /** Expect the given TX to appear on-chain within the given timeframe. */
  expectTx(tx: CosmosTx, timeout = 30000) {
    return new Promise<Required<TransactionEvent>['result']>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        unsub();
        reject(new Error(`Transaction ${tx.hash} not found on-chain within ${timeout}ms`));
      }, timeout);

      const unsub = this.onTx(
        new TendermintQuery().exact('tx.hash', tx.hash.toUpperCase()),
        (ev) => {
          unsub();
          clearTimeout(timeoutHandle);
          if (ev.error?.code) {
            reject(ev.error);
          } else {
            if (!ev.result) {
              reject(new Error(`Transaction ${tx.hash} found but was returned without results`));
            } else {
              resolve(ev.result);
            }
          }
        }
      );
    });
  }

  /** Get a block by height. If height is not specified, the latest block is returned. */
  getBlock(height?: bigint) {
    return this.send<{ block: Block, block_id: BlockID }>('block', { height });
  }

  /** Get a transaction by hash. Optionally, you may request a merkle tree proof of the transaction's inclusion in the block (default: true). */
  getTx(hash: string, prove = true) {
    const id = this.#nextSubId++;
    if (this.config.getTx.hashIsBase64) hash = toBase64(fromHex(hash));
    this.socket.send({
      jsonrpc: '2.0',
      method: 'tx',
      params: { hash, prove },
      id,
    });
    return new Promise<TransactionResponse>((resolve, reject) => {
      this.socket.onMessage.once((_, msg) => {
        if (!isJsonRpcResponse(msg)) return false;
        if (msg.id === id) {
          if (msg.result) {
            resolve(msg.result);
          } else {
            reject(msg.error);
          }
        }
      });
    });
  }

  /** Method corresponding to the `tx_search` JSONRPC method. It returns an async-iterable cursor for convenience. */
  searchTxs(query: TendermintQuery, { pageSize = 100, page: pageOffset = 1, order = 'asc', prove = true }: WS.SearchTxsParams = {}) {
    const q = query.toString();
    const pageIndex = (page: number) => BigInt(page - 1) * BigInt(pageSize);
    const currentIndex = () => pageIndex(page) + BigInt(cursor);
    const fetch = async () => {
      const response = await this.send<WS.SearchTxsResponse>('tx_search', [q, prove, page.toString(), pageSize.toString(), order]);
      total = BigInt(response.total_count);
      return response.txs;
    };
    const fetchNext = () => pageIndex(page + 1) < total && (page++, promise = fetch(), true);

    let page = pageOffset, cursor = 0, total: bigint, promise = fetch();

    return new class {
      ready = () => promise.then(()=>{});

      async *[Symbol.asyncIterator]() {
        page = pageOffset;
        do {
          let response = await promise;
          cursor = 0;
          while (cursor < response.length) {
            yield response[cursor++];
          }
        } while (fetchNext());
      }

      async all() {
        const result: WS.SearchTxsResponse['txs'] = [];
        for await (const tx of this) result.push(tx);
        return result;
      }

      /** Generator that yields all pages of transactions. */
      async *pages() {
        if (typeof total === 'undefined') await this.ready();
        if (currentIndex() >= total) return;
        do {
          yield await promise;
        } while (fetchNext());
      }

      async currentPage() {
        return await promise;
      }

      get total() { return total }
      get page() { return page }
      set page(value) { page = value }
      get index() { return currentIndex() }
    }
  }

  /** Send is a low level method to directly invoke an RPC method on the remote endpoint. It wraps
   * around the underlying jsonrpc protocol and returns a promise that resolves with the result of
   * the request after unmarshalling it.
   */
  send<T = unknown>(method: string, params?: any) {
    params = params && marshal(params);
    return new Promise<T>((resolve, reject) => {
      const id = this.#nextSubId++;
      this.socket.send({
        jsonrpc: '2.0',
        method,
        params,
        id,
      });

      this.socket.onMessage.once((_, msg) => {
        if (!isJsonRpcResponse(msg)) return false;
        if (msg.id === id) {
          if (msg.result) {
            resolve(msg.result);
          } else {
            reject(msg.error);
          }
        }
      });
    });
  }

  #sendHeartbeat = () => {
    this.#heartbeat = undefined;
    if (!this.connected) return;
    const timeout = setTimeout(() => {
      if (!this.connected) return;
      console.warn('Heartbeat timed out, reconnecting...');
      this.reconnect();
    }, 30000);
    this.send('health').then(() => {
      clearTimeout(timeout);
      this.#heartbeat = setTimeout(this.#sendHeartbeat, 35000);
    }).catch(err => {
      if (!this.connected) return;
      console.error('Heartbeat error:', err);
      this.reconnect();
    });
  }

  ready(timeout?: number) {
    return this.socket.ready(timeout);
  }

  get connected() { return this.socket.connected }
}

export namespace IBC {
  /** Compute the has of an IBC transfer path. Formatted as `ibc/{hash}`, this is the canonical
   * native denom of the token on the local chain.
   */
  export const hash = (path: string) => toHex(sha256(path)).toUpperCase();
}

interface TxSubscriptionMetadata {
  type: 'block' | 'tx';
  id: number;
  query?: TendermintQuery;
  callback: (data: TransactionEvent) => void;
}

type RPCResult<T = unknown> = RPCSuccess<T> | RPCError;
interface RPCSuccess<T> {
  jsonrpc: '2.0';
  id: number;
  result: T;
  error?: undefined;
}
interface RPCError {
  jsonrpc: '2.0';
  id: number;
  error: {
    code: number;
    message: string;
    data: string;
  };
  result?: undefined;
}

/** Guess the next block height based on the given block and the target timestamp. This method is
 * intended to be used to search for a specific block at the given `timestamp` with a divide-and-conquer
 * approach.
 *
 * @param lastBlock used for the reference time & height.
 * @param timestamp is the target timestamp we'd like to find the closest block for.
 * @param blockSpeed is the average number of seconds between blocks. The exact speed doesn't matter as it is just a heuristic.
 * @returns the height of the next block.
 */
function guessNextHeight(lastBlock: Block, timestamp: Date, blockSpeed: number): bigint {
  const deltaTime = timestamp.getTime() - lastBlock.header.time.getTime();
  const blocksToAdd = Math.floor(deltaTime / (blockSpeed * 1000));
  return lastBlock.header.height + BigInt(blocksToAdd);
}

function findTargetBlock(blockA: Block, blockB: Block, timestamp: Date) {
  return (blockA.header.time < timestamp && timestamp < blockB.header.time) &&
    ((blockA.header.height + 1n) === blockB.header.height);
}
