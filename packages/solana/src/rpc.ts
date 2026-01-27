import { defaultJsonRpcMarshal, defaultJsonRpcUnmarshal, endpoints, isJsonRpcRequest, jsonrpc, JsonRpcPayload, SolanaNetworkConfig } from "@apophis-sdk/core";
import { PowerSocket } from "@apophis-sdk/core/powersocket.js";
import { EventArgs, Unsub } from "@kiruse/typed-events";
import type * as Types from "./types.js";

export interface SolanaRpcApi {
  //#region Accounts
  /** @deprecated You should always specify the `encoding` option instead (with a value other than `'binary'`). */
  getAccountInfo(
    address: string,
    options?: {
      commitment?: Types.Commitment,
      encoding?: 'binary',
      minContextSlot?: number,
    }
  ): Promise<Types.AccountInfoResponse<string> | null>;
  getAccountInfo<Encoding extends 'base58' | 'base64' | 'base64+zstd'>(
    address: string,
    options: {
      commitment?: Types.Commitment,
      encoding: Encoding,
      dataSlice?: { length: number; offset: number },
      minContextSlot?: number,
    }
  ): Promise<Types.AccountInfoResponse<[string, Encoding]> | null>;
  getAccountInfo(
    address: string,
    options: {
      commitment?: Types.Commitment,
      encoding: 'jsonParsed',
      minContextSlot?: number,
    }
  ): Promise<Types.AccountInfoResponse<Record<string, any>>>;

  getMultipleAccounts<Encoding extends 'base58' | 'base64' | 'base64+zstd'>(
    addresses: string[],
    options?: {
      commitment?: Types.Commitment,
      encoding?: Encoding,
      /** Slice the account data to the given length and offset. Only available with binary encodings ("base58", "base64", etc). */
      dataSlice?: { length: number; offset: number },
      minContextSlot?: number,
    }
  ): Promise<(Types.AccountInfoResponse<[string, Encoding]> | null)[]>;
  getMultipleAccounts(
    addresses: string[],
    options: {
      commitment?: Types.Commitment,
      encoding: 'jsonParsed',
      minContextSlot?: number,
    }
  ): Promise<(Types.AccountInfoResponse<Record<string, any>> | null)[]>;

  /** Returns all accounts owned by the provided program ID.
   *
   * @deprecated You should always specify the `encoding` option instead (with a value other than `'binary'`).
   */
  getProgramAccounts<WithContext extends boolean = false>(
    address: string,
    options?: {
      commitment?: Types.Commitment,
      encoding?: 'binary',
      minContextSlot?: number,
      /** Wrap the response in an object with a `context` and `value` property (similar to other RPC methods). */
      withContext?: WithContext,
      /** Up to 4 program account filters */
      filters?: Types.ProgramAccountFilter[],
    }
  ): Promise<Types.ProgramAccountResponse<WithContext, string>>;
  getProgramAccounts<Encoding extends 'base58' | 'base64' | 'base64+zstd', WithContext extends boolean = false>(
    address: string,
    options: {
      commitment?: Types.Commitment,
      encoding: Encoding,
      dataSlice?: { length: number; offset: number },
      minContextSlot?: number,
      withContext?: WithContext,
    }
  ): Promise<Types.ProgramAccountResponse<WithContext, [string, Encoding]>>;
  getProgramAccounts<WithContext extends boolean = false>(
    address: string,
    options: {
      commitment?: Types.Commitment,
      encoding: 'jsonParsed',
      minContextSlot?: number,
      withContext?: WithContext,
      filters?: Types.ProgramAccountFilter[],
    }
  ): Promise<Types.ProgramAccountResponse<WithContext, Record<string, any>>>;
  //#endregion Accounts

  getBalance(
    address: string,
    options?: {
      commitment?: Types.Commitment,
      minContextSlot?: number,
    }
  ): Promise<{
    context: Types.ResponseContext;
    value: number;
  }>;

  //#region Blocks
  getBlock<Encoding extends Types.BlockEncoding = 'json', TxDetails extends Types.TransactionDetails = 'full', Rewards extends boolean = true>(
    slot: number,
    options?: {
      commitment?: Types.Commitment,
      encoding?: Encoding,
      transactionDetails?: TxDetails,
      maxSupportedTransactionVersion?: number,
      rewards?: Rewards,
    }
  ): Promise<Types.Block<Encoding, TxDetails, Rewards> | null>;

  getBlockCommitment(slot: number): Promise<{
    commitment: number[];
    totalStake: number;
  }>;

  getBlockHeight(options?: {
    commitment?: Types.Commitment,
    minContextSlot?: number,
  }): Promise<number>;

  getBlockProduction(
    options?: {
      commitment?: Types.Commitment,
      identity?: string,
      range?: {
        firstSlot: number,
        lastSlot?: number,
      },
    }
  ): Promise<{
    byIdentity: Record<string, [number, number]>;
    range: {
      firstSlot: number;
      lastSlot: number;
    };
  }>;

  /** Get the list of confirmed block heights within a range. */
  getBlocks(
    startSlot: number,
    /** End slot, must be no more than 500,000 blocks higher than `startSlot`. */
    endSlot?: number,
    options?: {
      commitment?: Types.Commitment,
    }
  ): Promise<number[]>;

  /** Like `getBlocks`, but with a limit rather than an `endSlot`. */
  getBlocksWithLimit(
    startSlot: number,
    limit: number,
    options?: {
      commitment?: Types.Commitment,
    }
  ): Promise<number[]>;

  /** Get the estimated production time of a block within the current slot. */
  getBlockTime(blockNumber: number): Promise<number>;
  //#endregion Blocks

  getClusterNodes(): Promise<Types.ClusterNodeInfo[]>;
  getVersion(): Promise<{
    'solana-core': string;
    'feature-set': number;
  }>;

  getEpochInfo(options?: {
    commitment?: Types.Commitment,
    minContextSlot?: number,
  }): Promise<Types.EpochInfo>;

  getEpochSchedule(): Promise<Types.EpochSchedule>;

  /** Estimate the fee required for the given message. `value` will be `null` if the message is invalid or fails. */
  getFeeForMessage(
    /** Base64 encoded message data */
    msg: string,
    options?: {
      commitment?: Types.Commitment,
      minContextSlot?: number,
    }
  ): Promise<{
    context: Types.ResponseContext;
    value: number | null;
  }>;

  getHealth(): Promise<string>;

  getIdentity(): Promise<{ identity: string }>;

  getLatestBlockhash(options?: {
    commitment?: Types.Commitment,
    minContextSlot?: number,
  }): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>;

  getMinimumBalanceForRentExemption(
    dataLength: number,
    options?: {
      commitment?: Types.Commitment,
    }
  ): Promise<number>;

  getRecentPrioritizationFees(
    /** Up to 128 writable account addresses that must be included in a prospective transaction, if relevant. */
    addresses?: string[]
  ): Promise<{
    slot: number;
    prioritizationFee: number;
  }[]>;

  getSlot(options?: {
    commitment?: Types.Commitment,
    minContextSlot?: number,
  }): Promise<number>;

  getSlotLeader(options?: {
    commitment?: Types.Commitment,
    minContextSlot?: number,
  }): Promise<string>;

  getSlotLeaders(startSlot: number, limit: number): Promise<string[]>;

  getSupply(options?: {
    commitment?: Types.Commitment,
    excludeNonCirculatingAccountsList?: boolean,
  }): Promise<{
    context: Types.ResponseContext;
    value: {
      total: number;
      circulating: number;
      nonCirculating: number;
      /** List of account addresses that are excluded from the circulating supply. When
       * `excludeNonCirculatingAccountsList` is `true`, this will be present but empty.
       */
      nonCirculatingAccounts: string[];
    };
  }>;

  //#region Tokens
  getTokenAccountBalance(
    account: string,
    options?: {
      commitment?: Types.Commitment,
    }
  ): Promise<{
    context: Types.ResponseContext;
    value: Types.TokenBalance['uiTokenAmount'] | null;
  }>;

  getTokenAccountsByOwner(
    owner: string,
    options?: {
      commitment?: Types.Commitment,
      minContextSlot?: number,
      encoding?: 'binary',
    }
  ): Promise<{
    context: Types.ResponseContext;
    value: Types.AccountInfo<string>[];
  }>;
  getTokenAccountsByOwner<Encoding extends 'base58' | 'base64' | 'base64+zstd'>(
    owner: string,
    options: {
      commitment?: Types.Commitment,
      minContextSlot?: number,
      encoding: Encoding,
      dataSlice?: { length: number; offset: number },
    }
  ): Promise<{
    context: Types.ResponseContext;
    value: Types.AccountInfo<[string, Encoding]>[];
  }>;
  getTokenAccountsByOwner(
    owner: string,
    options: {
      commitment?: Types.Commitment,
      minContextSlot?: number,
      encoding: 'jsonParsed',
    }
  ): Promise<{
    context: Types.ResponseContext;
    value: Types.AccountInfo<Record<string, any>>[];
  }>;

  getTokenSupply(
    mint: string,
    options?: {
      commitment?: Types.Commitment,
    }
  ): Promise<{
    context: Types.ResponseContext;
    value: Types.TokenBalance['uiTokenAmount'];
  }>;
  //#endregion Tokens

  //#region Transactions
  isBlockhashValid(
    blockhash: string,
    options?: {
      commitment?: Types.Commitment,
      minContextSlot?: number,
    }
  ): Promise<boolean>;

  getTransaction<Encoding extends 'json' | 'jsonParsed' | 'base58' | 'base64' = 'json'>(
    hash: string,
    options: {
      commitment?: Types.Commitment,
      maxSupportedTransactionVersion: number,
      encoding?: Encoding,
    }
  ): Promise<Types.Transaction<Encoding, 'full'>>;

  simulateTransaction<AccountEncoding extends 'base58' | 'base64' | 'jsonParsed' | 'json'>(
    bytes: string,
    options?: {
      commitment?: Types.Commitment,
      minContextSlot?: number,
      /** Encoding of the transaction bytes. Defaults to `'base58'` which is deprecated & slow. */
      encoding?: AccountEncoding,
      /** Whether to request replacing the recent blockhash with a valid one.
       * However, mutually exclusive with `sigVerify`.
       */
      replacementBlockhash?: boolean,
      /** Whether to verify the transaction's signatures. */
      sigVerify?: boolean,
      /** Whether to include inner instructions in the simulation result. */
      innerInstructions?: boolean,
      accounts?: {
        addresses: string[];
        encoding?: AccountEncoding;
      };
    }
  ): Promise<{
    context: Types.ResponseContext;
    value: Types.SimulationResult<AccountEncoding>;
  }>;

  sendTransaction(
    /** Fully signed transaction bytes, including all signatures. */
    bytes: string,
    options?: {
      commitment?: Types.Commitment,
      minContextSlot?: number,
      /** Encoding of the transaction bytes. Defaults to `'base58'` which is deprecated & slow. */
      encoding?: 'base58' | 'base64',
      /** Skip preflight checks. Defaults to `false`. */
      skipPreflight?: boolean,
      /** Commitment level to use for preflight checks. Defaults to `'finalized'`. */
      preflightCommitment?: Types.Commitment,
      /** Maximum number of retries that the node will attempt to resend the transaction to the
       * slot leader. When not specified, the node will resend indefinitely, or until the blockhash
       * expires.
       */
      maxRetries?: number,
    }
  ): Promise<{
    context: Types.ResponseContext;
    /** Base58 encoded transaction hash - which is the first signature in the transaction. */
    value: string;
  }>;
  //#endregion Transactions
};

const _rpcCache = new Map<SolanaNetworkConfig, SolanaRpcApi>();
export function createSolanaRpc(network: SolanaNetworkConfig) {
  if (_rpcCache.has(network)) return _rpcCache.get(network)!;
  const rpc = jsonrpc<SolanaRpcApi>(endpoints.get(network, 'rpc'));
  _rpcCache.set(network, rpc);
  return rpc;
}

const _wsCache = new Map<SolanaNetworkConfig, PowerSocket<JsonRpcPayload, JsonRpcPayload, string>>();
let _nextSubId = 1;

export function createSolanaSubscription<Ev extends Types.EventType>(
  network: SolanaNetworkConfig,
  event: Ev,
  params: Parameters<Types.Events[Ev]>,
  callback: (data: EventArgs<ReturnType<Types.Events[Ev]>>) => void,
): Unsub {
  const ws = getSocket(network);
  const id = _nextSubId++;
  let disposed = false;
  let subId: number | undefined;

  const sendSub = () => {
    ws.send({
      jsonrpc: '2.0',
      method: `${event}Subscribe`,
      id,
      params,
    });
    ws.onMessage.once((_, msg) => {
      if (msg.id !== id) return false;
      if (!('result' in msg)) {
        console.error('Invalid subscription response', msg);
        return sendUnsub();
      }
      if (disposed) return sendUnsub();
      subId = msg.result;
    });
  };

  const sendUnsub = () => {
    ws.send({
      jsonrpc: '2.0',
      method: `${event}Unsubscribe`,
      params: [subId],
    });
  };

  ws.ready().then(() => {
    if (disposed) return;
    sendSub();
  });

  const unsub1 = ws.onDisconnect(() => {
    subId = undefined;
  });

  const unsub2 = ws.onReconnect(() => {
    if (disposed) return;
    sendSub();
  });

  const unsub3 = ws.onMessage((_, msg) => {
    if (!isJsonRpcRequest(msg)) return;
    if (disposed || msg.id !== id || msg.method !== `${event}Notification` || msg.params?.subscription !== subId) return;
    callback(msg.params.result);
  });

  return () => {
    disposed = true;
    unsub1();
    unsub2();
    unsub3();

    if (subId) {
      sendUnsub();
      subId = undefined;
    }
  };
}

function getSocket(network: SolanaNetworkConfig) {
  if (_wsCache.has(network)) return _wsCache.get(network)!;
  const socket = new PowerSocket(() => endpoints.get(network, 'ws'), defaultJsonRpcMarshal, defaultJsonRpcUnmarshal);
  _wsCache.set(network, socket);
  return socket;
}
