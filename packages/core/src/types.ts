import type { NetworkConfig } from './networks.js';
import type { Signer } from './signer.js';

export { NetworkConfig };

/** The SDK generally marshals Bytes to base64 strings, but due to loss of information, it cannot
 * unmarshal them back to their original Uint8Array form, hence this type describes both.
 */
export type Bytes = Uint8Array | string;

export interface ApophisConfig {
  /** Multiplier for the gas fee estimate to avoid under-estimation. Should generally be held low
   * to avoid overspending as, unlike Ethereum chains, Cosmos chains do not refund unused gas.
   */
  gasFactor: number;
}

export type Loading<T> = ({ loading: true } & Partial<T>) | ({ loading: false } & T);

/** The ecosystem a transaction, wallet, or API belongs to. The possible values are the currently only supported ecosystems. */
export type Ecosystem = NetworkConfig['ecosystem'];
export type TxStatus = 'unsigned' | 'signed' | 'confirmed' | 'failed';

export interface TxBase {
  get ecosystem(): Ecosystem;
  get status(): TxStatus;
  /** Primary signer of the transaction. Typically the one to pay the gas fees &
   * broadcast the transaction onchain. If undefined, the transaction is unsigned.
   */
  get signer(): Signer<any> | undefined;
  get signatures(): Map<Signer<any>, Uint8Array>;
  get network(): NetworkConfig | undefined;
  get hash(): string | undefined;
  get error(): string | undefined;

  /** Set the transaction signature. Any existing signatures will be replaced. */
  setSignature(network: NetworkConfig, signer: Signer<any>, signature: Uint8Array): this;
  /** Add a signature of the given signer to the transaction. */
  addSignature(network: NetworkConfig, signer: Signer<any>, signature: Uint8Array): this;
  /** Update internal state to indicate that the transaction was confirmed. */
  confirm(hash: string): void;
  /** Update internal state to indicate that the transaction failed. */
  reject(hash: string, error: string): void;

  /** Broadcast this transaction to the network. */
  broadcast(): Promise<string>;
}
