import type { BoundSignerSnapshot, Signer, SolanaNetworkConfig, TxBase, TxStatus } from '@apophis-sdk/core';
import { toBase64 } from '@apophis-sdk/core/utils.js';
import { ReadonlyUint8Array } from '@solana/codecs-core';
import { AccountRole, type Instruction } from '@solana/instructions';
import { CompiledTransactionMessage, getCompiledTransactionMessageEncoder } from '@solana/transaction-messages';
import { Solana } from './api.js';
import type { SimulationResult } from './types.js';

type OrderedAccounts = CompiledTransactionMessage['staticAccounts'];
type MessageHeader = CompiledTransactionMessage['header'];
type CompiledInstructions = CompiledTransactionMessage['instructions'];

interface CollectAccountsResult {
  accounts: OrderedAccounts;
  header: MessageHeader;
}

export class SolanaTx implements TxBase {
  readonly ecosystem = 'solana';
  #status: TxStatus = 'unsigned';
  #signatures: Map<BoundSignerSnapshot<SolanaNetworkConfig, SolanaTx>, Uint8Array> = new Map();
  #hash: string | undefined;
  #error: string | undefined;

  constructor(
    /** The primary payload of the transaction: instructions designated for specific programs. */
    public instructions: Instruction[],
    /** A recent blockhash to act as nonce and prevent replay attacks. When
     * `undefined`, the transaction cannot be signed, but it can be `simulate()`d.
     * When `simulate` is called with an undefined blockhash, `simulate` will
     * automatically populate it with a valid recent blockhash.
     */
    public recentBlockhash: string | undefined,
  ) {}

  setSignature(signer: BoundSignerSnapshot<SolanaNetworkConfig, SolanaTx>, signature: Uint8Array): this {
    this.#status = 'signed';
    this.#signatures = new Map([[signer, signature]]);
    return this;
  }

  addSignature(signer: BoundSignerSnapshot<SolanaNetworkConfig, SolanaTx>, signature: Uint8Array): this {
    if (this.#signatures.size > 0 && this.#signatures.keys().next().value!.network !== signer.network)
      throw new Error('Network mismatch');
    this.#status = 'signed';
    this.#signatures.set(signer, signature);
    return this;
  }

  confirm(hash: string): void {
    this.#status = 'confirmed';
    this.#hash = hash;
  }

  reject(hash: string, error: string): void {
    this.#status = 'failed';
    this.#hash = hash;
    this.#error = error;
  }

  broadcast(): Promise<string> {
    if (!this.signer) throw new Error('Tx not signed');
    return this.signer.broadcast(this);
  }

  async simulate(signer: BoundSignerSnapshot<SolanaNetworkConfig, SolanaTx>): Promise<SimulationResult<'base64'>> {
    const response = await Solana.rpc(signer.network).simulateTransaction(
      toBase64(this.messageBytes(signer) as Uint8Array),
      {
        encoding: 'base64',
        replacementBlockhash: this.recentBlockhash === undefined,
      },
    );
    return response.value;
  }

  /** Compile the {@link CompiledTransactionMessage} from this transaction's `instructions`. */
  message(signer: BoundSignerSnapshot<SolanaNetworkConfig, SolanaTx>): CompiledTransactionMessage {
    const { accounts, header } = this.#collectAccounts(signer);

    return {
      version: 0,
      header,
      // Note: for some reaon the Solana Kit calls it `staticAccounts` even though
      // the Solana source code calls it `account_keys`. Solana wire format does
      // not use field names, so this naming divergence is of no consequence.
      staticAccounts: accounts,
      instructions: this.#instructions(accounts),
    };
  }

  #collectAccounts(signer: BoundSignerSnapshot<SolanaNetworkConfig, SolanaTx>): CollectAccountsResult {
    const map: Record<string, AccountRole> = {};

    map[signer.address] = AccountRole.WRITABLE_SIGNER;

    for (const inst of this.instructions) {
      map[inst.programAddress] = AccountRole.READONLY;
      for (const account of inst.accounts ?? []) {
        map[account.address] = Math.max(map[account.address] ?? 0, account.role);
      }
    }

    const accounts: string[] = [];
    let numReadonlyNonSignerAccounts = 0;
    let numReadonlySignerAccounts = 0;
    let numSignerAccounts = 0;
    for (const role of [AccountRole.WRITABLE_SIGNER, AccountRole.READONLY_SIGNER, AccountRole.WRITABLE, AccountRole.READONLY]) {
      for (const address of Object.keys(map)) {
        if (map[address] === role) {
          accounts.push(address);
          switch (role) {
            case AccountRole.WRITABLE_SIGNER:
              numSignerAccounts++;
              break;
            case AccountRole.READONLY_SIGNER:
              numSignerAccounts++;
              numReadonlySignerAccounts++;
              break;
            case AccountRole.READONLY:
              numReadonlyNonSignerAccounts++;
              break;
          }
        }
      }
    }

    return {
      accounts: accounts as any[], // `Address` is really just a `string` with `Brand`ed type information
      header: {
        numReadonlyNonSignerAccounts,
        numReadonlySignerAccounts,
        numSignerAccounts,
      },
    };
  }

  #instructions(accounts: OrderedAccounts): CompiledInstructions {
    const indexes = Object.fromEntries(accounts.map((account, index) => [account, index]));
    return this.instructions.map(({ programAddress, accounts, data }) => ({
      programAddressIndex: indexes[programAddress],
      ...(accounts?.length ? { accountIndices: accounts.map((account) => indexes[account.address]) } : {}),
      ...(data ? { data } : {}),
    }));
  }

  /** Compile the {@link SolanaMessage} from this transaction's `instructions`
   * into a `Uint8Array`. The message is the actual payload to be signed.
   */
  messageBytes(signer: BoundSignerSnapshot<SolanaNetworkConfig, SolanaTx>): ReadonlyUint8Array {
    return getCompiledTransactionMessageEncoder().encode(this.message(signer));
  }

  get status() { return this.#status }
  /** Gets the primary signer of the transaction. This signer is typically also the one to pay the transaction gas fees. */
  get signer() { return this.#signatures.keys().next().value }
  get signatures() { return this.#signatures }
  get network() { return this.#signatures.keys().next().value?.network }
  get hash() { return this.#hash }
  get error() { return this.#error as string | undefined }
}
