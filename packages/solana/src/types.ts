import Event from "@kiruse/typed-events";

export type Commitment = 'processed' | 'confirmed' | 'finalized';

export type BinaryEncodings = 'base58' | 'base64' | 'base64+zstd';
export type BlockEncoding = 'base58' | 'base64' | 'json' | 'jsonParsed';

export interface ResponseContext {
  apiVersion?: string;
  slot: number;
}

export interface AccountInfoResponse<Data> {
  context: ResponseContext;
  value: AccountInfo<Data> | null;
}

export interface AccountInfo<Data> {
  data: Data;
  lamports: number;
  executable: boolean;
  owner: string;
  rentEpoch: number;
  space: number;
}

export type ProgramAccountResponse<WithContext extends boolean, Data> =
  WithContext extends true
  ? {
      context: ResponseContext;
      value: AccountInfo<Data>[];
    }
  : AccountInfo<Data>[];

export interface ProgramAccountFilter {
  /** Filter accounts that match a specific data size. */
  dataSize?: number;
  /** Compare a specific byte range */
  memcmp?: {
    offset: number;
    /** Binary data as encoded string. Max 128 decoded bytes. */
    bytes: string;
    encoding?: 'base58' | 'base64';
  };
}

export type Block<
  Encoding extends BlockEncoding = 'json',
  TxDetails extends TransactionDetails = 'full',
  Rewards extends boolean = true,
> = {
  blockHeight: number | null;
  blockTime: number | null;
  blockhash: string;
  parentSlot: number;
  previousBlockhash: string;
  transactions: {
    transaction: Transaction<Encoding, TxDetails>;
    meta: TransactionMetaData<Rewards>;
  }[];
};

//#region Transactions
export type TransactionDetails = 'full' | 'accounts' | 'signatures' | 'none';

export type Transaction<
  Encoding extends BlockEncoding = 'json',
  TxDetails extends TransactionDetails = 'full',
> = Encoding extends BinaryEncodings
  ? [string, Encoding]
  : TransactionDecoded<TxDetails>;

export interface TransactionDecoded<TxDetails extends TransactionDetails> {
  message: TransactionMessage<TxDetails>;
  /** List of base58 encoded signatures corresponding to the `accountKeys` in the `message`. */
  signatures: string[];
}

// TODO: Figure out how exactly details affects the shape of the transaction object
export type TransactionMessage<TxDetails extends TransactionDetails> = TransactionMessageBase;

export interface TransactionMessageBase {
  /** List of addresses (base58 encoded public keys) of accounts used in the transaction. The
   * first element is the transaction's sender & fee payer.
   */
  accountKeys: string[];
  /** Details the account types and signatures required by the transaction. */
  header: TransactionHeader;
  /** A base-58 encoded hash of a recent block in the ledger used to prevent transaction duplication
   * and to give transactions lifetimes. Note that unlike other blockchains, Solana does not require
   * that the blockhash is from the most recent block.
   */
  recentBlockhash: string;
  /** List of program instructions that will be executed in sequence and committed in one atomic transaction if all succeed. */
  instructions: Instruction[];
  /** List of address table lookups used by a transaction to dynamically load addresses from on-chain address lookup tables. */
  addressTableLookups: AddressTableLookup[];
}

export interface TransactionHeader {
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
  numRequiredSignatures: number;
}

export type TransactionMetaData<Rewards extends boolean = true> = Rewards extends true
  ? TransactionMetaDataWithRewards
  : TransactionMetaDataBase;

export interface TransactionMetaDataBase {
  err?: unknown;
  fee: number;
  preBalances: number[];
  postBalances: number[];
  innerInstructions?: InnerInstruction[];
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
  logMessages?: string[];
  loadedAddresses?: {
    writable: boolean;
    readonly: string;
  }[];
  returnData?: {
    programId: string;
    data: [string, string];
  };
  computeUnitsConsumed?: number;
  version?: 'legacy' | number;
  signatures?: string[];
}

export interface TransactionMetaDataWithRewards extends TransactionMetaDataBase {
  rewards: {
    pubkey: string;
    lamports: number;
    postBalance: number;
    rewardType?: 'fee' | 'rent' | 'voting' | 'staking';
    commission?: number;
  }[];
}

export interface AddressTableLookup {
  /** Base58 encoded public key for an address lookup table account. */
  accountKey: string;
  writableIndexes: number[];
  readonlyIndexes: number[];
}

export interface Instruction {
  /** Index into the `accountKeys` array of the `TransactionMessage` that corresponds to the program ID. */
  programIdIndex: number;
  /** List of ordered indices into the `accountKeys` array of the `TransactionMessage`. */
  accounts: number[];
  /** Base58 encoded program input */
  data: string;
}

export interface InnerInstruction {
  index: number;
  instructions: ({
    programIdIndex: number;
    accounts: number[];
    data: string;
    stackHeight: number;
  } | {
    program: string;
    programId: string;
    parsed: {
      type: string;
      info: unknown;
    };
    stackHeight: number;
  })[];
}

export interface TokenBalance {
  accountIndex: number;
  /** Pubkey of the token's mint account */
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmountString: string;
  };
}

export interface SimulationResult<AccountEncoding extends 'base58' | 'base64' | 'jsonParsed' | 'json'> {
  err?: string | object;
  accounts: (AccountInfo<AccountEncoding extends 'json' | 'jsonParsed' ? Record<string, any> : [string, AccountEncoding]> | null)[];
  innerInstructions?: InnerInstruction[];
  loadedAccountsDataSize?: number;
  logs?: any[];
  /** Replacement blockhash if requested */
  replacementBlockhash?: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
  returnData?: {
    programId: string;
    data: [string, string];
  };
  unitsConsumed?: number;
}
//#endregion Transactions

export interface ClusterNodeInfo {
  featureSet?: number;
  /** Endpoint for the gossip network */
  gossip?: string;
  pubkey: string;
  /** PubSub WebSocket endpoint */
  pubsub?: string;
  /** RPC HTTP endpoint */
  rpc?: string;
  /** Endpoint for the serve repair service */
  serveRepair?: string;
  shredVersion?: number;
  tpu?: string;
  tpuForwards?: string;
  tpuForwardsQuic?: string;
  tpuQuic?: string;
  tpuVote?: string;
  tvu?: string;
  version?: string;
}

export interface EpochInfo {
  absoluteSlot: number;
  blockHeight: number;
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
  transactionCount?: number;
}

export interface EpochSchedule {
  firstNormalEpoch: number;
  firstNormalSlot: number;
  leaderScheduleSlotOffset: number;
  slotsPerEpoch: number;
  warmup: boolean;
}

export interface Events {
  account<Encoding extends 'base58' | 'base64' | 'base64+zstd' | 'jsonParsed' = 'base58'>(
    address: string,
    options?: {
      commitment?: Commitment,
      encoding?: Encoding,
    }
  ): Event<AccountInfo<Encoding extends 'jsonParsed' ? Record<string, any> : [string, Encoding]>>;

  /** UNSTABLE: The validator must be configured to enable this subscription!
   * Subscribe to new `finalized` or `confirmed` blocks.
   */
  block<Encoding extends BlockEncoding = 'json', TxDetails extends TransactionDetails = 'full', Rewards extends boolean = true>(
    filter: 'all' | {
      mentionsAccountOrProgram: string;
    },
    options?: {
      commitment?: Commitment,
      encoding?: Encoding,
      transactionDetails?: TxDetails,
      maxSupportedTransactionVersion?: number,
      showRewards?: Rewards,
    }
  ): Event<{
    context: ResponseContext;
    err?: unknown;
    value?: Block<Encoding, TxDetails, Rewards>;
  }>;
}

export type EventType = keyof Events;
