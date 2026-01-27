import { Any, config, isFullAccountData, type BoundSignerSnapshot, type CosmosNetworkConfig, type FullAccountData, signals, TxBase, TxStatus, BoundSigner } from '@apophis-sdk/core';
import { mw } from '@apophis-sdk/core/middleware.js';
import type { Gas } from '@apophis-sdk/cosmos/types.sdk.js';
import { fromBase64, toHex } from '@apophis-sdk/core/utils.js';
import { Decimal } from '@kiruse/decimal';
import { extendDefaultMarshaller, IgnoreMarshalUnit } from '@kiruse/marshal';
import { sha256 } from '@noble/hashes/sha2';
import { computed, effect, ReadonlySignal, signal } from '@preact/signals-core';
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing.js';
import { AuthInfo, Tx as SdkTxDirect, SignDoc, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js';
import { Cosmos } from './api.js';
import { Amino } from './encoding/amino.js';

/** The format of a Cosmos transaction. Of the two formats, `protobuf` is the default, and `amino`
 * is deprecated. Not all messages support the `amino` format as it has painful limitations. When
 * possible, use `protobuf`. However, the Ledger hardware wallet only supports `amino`, which
 * unfortunately means that not all transactions can be signed with a Ledger device.
 */
export type CosmosTxEncoding = 'protobuf' | 'amino';

export interface DirectTxOptions extends Partial<Omit<TxBody, 'messages'>> {
  gas?: Gas;
}

export interface AminoTxOptions {
  gas?: Gas;
  memo?: string;
  timeoutHeight?: number | bigint;
}

export type CosmosTx = CosmosTxDirect | CosmosTxAmino;

export type EstimateResult = EstimateResult.Pending | EstimateResult.Success | EstimateResult.Error;

export namespace EstimateResult {
  export interface Pending {
    status: 'pending';
    gas?: undefined;
    error?: undefined;
  }

  export interface Success {
    status: 'success';
    gas: Gas;
    error?: undefined;
    timestamp: Date;
    refreshInterval: number;
  }

  export interface Error {
    status: 'error';
    gas?: undefined;
    error: any;
    timestamp: Date;
    refreshInterval: number;
  }
}

export const TxMarshaller = extendDefaultMarshaller([
  IgnoreMarshalUnit(Uint8Array),
]);

export abstract class CosmosTxBase<SdkTx> implements TxBase {
  readonly ecosystem = 'cosmos';
  #status: TxStatus = 'unsigned';
  #signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx> | undefined;
  #signature: Uint8Array | undefined;
  #hash: string | undefined;
  #error: string | undefined;
  gas: Gas | undefined;
  memo = '';

  abstract get encoding(): CosmosTxEncoding;

  setSignature(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, signature: Uint8Array) {
    this.#signer = signer;
    this.#signature = signature;
    return this;
  }

  addSignature(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, signature: Uint8Array): this {
    throw new Error('Not yet implemented');
  }

  setGas(gas: Gas): this {
    this.gas = gas;
    return this;
  }

  computeGas(network: CosmosNetworkConfig, size: bigint | number, populate?: boolean): Gas {
    const [cfg] = network.gas;
    const offset = Decimal.parse(cfg.flatGasOffset ?? 50_000);
    const multiplier = Decimal.parse(cfg.gasMultiplier ?? 1);

    const gas = Decimal.parse(size).add(offset).mul(multiplier);

    const amount = gas.mul(Decimal.parse(cfg.lowPrice ?? cfg.avgPrice)).rebase(0).valueOf() + 1n;
    const result = {
      amount: [{ denom: cfg.asset.denom, amount }],
      gasLimit: gas.valueOf(),
    } satisfies Gas;
    if (populate) this.gas = result;
    return result;
  }

  /** Non-interface method to simulate this transaction. `estimateGas` extracts the `gas_info` from this method's result. */
  simulate(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>) {
    return Cosmos.rest(signer.network).cosmos.tx.v1beta1.simulate('POST', {
      tx_bytes: this.sdkTxBytes(signer),
    });
  }

  /** Estimate gas consumption this TX would require, and optionally populate the `gas` field. */
  async estimateGas(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, populate?: boolean): Promise<Gas> {
    const { gas_info } = await this.simulate(signer);
    if (!gas_info) throw new Error('Failed to simulate transaction');
    const units = Decimal.parse(gas_info.gas_used).mul(Decimal.parse(signer.network.gasFactor ?? config.gasFactor)).rebase(0);
    return this.computeGas(signer.network, units.valueOf(), populate);
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
    if (!this.#signer) throw new Error('Signer not bound');
    return this.#signer.broadcast(this as any);
  }

  abstract signBytes(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>): Uint8Array;
  abstract sdkTx(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, signature?: Uint8Array): SdkTx;
  abstract sdkTxBytes(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, signature?: Uint8Array): Uint8Array;

  fullSdkTx() {
    if (!this.gas) throw new Error('Gas not set');
    if (!this.#signer || !this.#signature) throw new Error('Signature not bound');
    return this.sdkTx(this.#signer, this.#signature);
  }

  /** Get the full bytes of this transaction. Requires signature and gas. */
  abstract bytes(): Uint8Array;

  /** Computes the hash of a Cosmos transaction. A string is assumed to be a base64-encoded transaction.
   * A Uint8Array is assumed to be a protobuf-encoded transaction. All transactions must be an
   * SdkTxDirect. Amino transactions are supported by legacy amino sign mode of the new Tx type.
   */
  static computeHash(tx: CosmosTxBase<SdkTxDirect> | Uint8Array | string | SdkTxDirect): string {
    if (typeof tx === 'string') {
      tx = fromBase64(tx);
    }
    if (tx instanceof Uint8Array) {
      tx = SdkTxDirect.decode(tx);
    }
    if (tx instanceof CosmosTxBase) {
      tx = tx.fullSdkTx();
    }

    const bytes = SdkTxDirect.encode(tx).finish();
    const buffer = sha256(bytes);
    return toHex(new Uint8Array(buffer));
  }

  get status(): TxStatus { return this.#status }
  get signer(): BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx> | undefined { return this.#signer }
  get signatures(): Map<BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, Uint8Array> { return this.#signer ? new Map([[this.#signer, this.#signature!]]) : new Map() }
  get network(): CosmosNetworkConfig | undefined { return this.#signer?.network }
  get hash(): string { return this.#hash ?? CosmosTxBase.computeHash(this as any) }
  get error(): string | undefined { return this.#error }
}

/** A transaction builder which accumulates data throughout the various steps of the transaction life cycle. */
export class CosmosTxDirect extends CosmosTxBase<SdkTxDirect> {
  readonly encoding = 'protobuf';
  extensionOptions: Any[] = [];
  nonCriticalExtensionOptions: Any[] = [];
  /** Typically, timeout height of 0 is synonymous with "no timeout". */
  timeoutHeight = 0n;

  constructor(public messages: any[] = [], opts?: DirectTxOptions) {
    super();
    this.gas = opts?.gas;
    this.extensionOptions = opts?.extensionOptions ?? [];
    this.nonCriticalExtensionOptions = opts?.nonCriticalExtensionOptions ?? [];
    this.memo = opts?.memo ?? '';
    this.timeoutHeight = opts?.timeoutHeight ?? 0n;
  }

  /** The SignDoc is the 2nd step in the transaction process:
   *
   * 1. `.estimateGas` (optional)
   * 2. `.signDoc` to request a signature from the user
   * 3. `.setSignature` to finalize the transaction document
   * 4. `.broadcast` to send the transaction to the network
   */
  signDoc(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>): SignDoc {
    if (!this.gas) throw new Error('Gas not set');
    const sdktx = this.sdkTx(signer);

    const account = signer.account;
    if (!isFullAccountData(account)) throw new Error('Account data incomplete');

    return SignDoc.fromPartial({
      bodyBytes: TxBody.encode(sdktx.body!).finish(),
      authInfoBytes: AuthInfo.encode(sdktx.authInfo!).finish(),
      chainId: signer.network.chainId,
      accountNumber: account.accountNumber,
    });
  }

  /** Get the bytes to sign by the given signer. */
  signBytes(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>): Uint8Array {
    return sha256(SignDoc.encode(this.signDoc(signer)).finish());
  }

  /** Get a partial Cosmos SDK Tx object. This does not require gas or signature, in which case it can be used for simulation (including gas estimation). */
  sdkTx(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, signature: Uint8Array = new Uint8Array()): SdkTxDirect {
    if (!this.messages.length) throw new Error('No messages provided');

    const account = signer.account;
    if (!isFullAccountData(account)) throw new Error('Account data incomplete');
    const { network, publicKey, sequence } = account;

    return SdkTxDirect.fromPartial(TxMarshaller.marshal({
      body: {
        messages: this.messages.map(msg => Any.encode(network, msg)),
        extensionOptions: this.extensionOptions,
        nonCriticalExtensionOptions: this.nonCriticalExtensionOptions,
        memo: this.memo,
        timeoutHeight: this.timeoutHeight,
      },
      authInfo: {
        signerInfos: [{
          modeInfo: {
            single: {
              mode: SignMode.SIGN_MODE_DIRECT,
            },
          },
          publicKey: Any.encode(network, publicKey),
          sequence,
        }],
        fee: this.gas ?? {},
      },
      signatures: [signature],
    }) as any);
  }

  sdkTxBytes(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, signature?: Uint8Array): Uint8Array {
    return SdkTxDirect.encode(this.sdkTx(signer, signature)).finish();
  }

  /** Get the full bytes of this transaction for transmission over the network.
   * Must include all signatures and gas configuration.
   */
  bytes(): Uint8Array {
    return SdkTxDirect.encode(this.fullSdkTx()).finish();
  }
}

// Note: With the introduction of protobuf, Amino is supported by the Direct Tx type by legacy amino sign mode.
export class CosmosTxAmino extends CosmosTxBase<SdkTxDirect> {
  readonly encoding = 'amino';
  timeoutHeight = 0n;

  constructor(public messages: any[] = [], opts?: AminoTxOptions) {
    super();
    this.memo = opts?.memo ?? '';
    this.gas = opts?.gas;
    this.timeoutHeight = opts?.timeoutHeight ? BigInt(opts.timeoutHeight) : 0n;
  }

  /** The SignDoc is the 2nd step in the transaction process:
   *
   * 1. `.estimateGas` (optional)
   * 2. `.signDoc` to request a signature from the user
   * 3. `.setSignature` to finalize the transaction document
   * 4. `.broadcast` to send the transaction to the network
   */
  signDoc(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>) {
    const account = signer.account;
    if (!isFullAccountData(account)) throw new Error('Account data incomplete');
    const { network, accountNumber, sequence } = account;
    const mwstack = mw('encoding', 'encode').inv();
    return Amino.normalize({
      chain_id: network.chainId,
      account_number: accountNumber,
      sequence: sequence,
      fee: this.gas ? {
        amount: this.gas.amount,
        gas: this.gas.gasLimit,
      } : {},
      memo: this.memo,
      msgs: this.messages.map(msg => mwstack.fifo(network, 'amino', msg)),
      ...(this.timeoutHeight && { timeout_height: this.timeoutHeight }),
    });
  }

  /** Get the bytes to sign by the given signer. */
  signBytes(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>): Uint8Array {
    return sha256(JSON.stringify(this.signDoc(signer)));
  }

  /** Get a partial Cosmos SDK Tx object. This does not require gas or signature, in which case it can be used for simulation (including gas estimation). */
  sdkTx(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, signature: Uint8Array = new Uint8Array()) {
    if (!this.messages.length) throw new Error('No messages provided');

    const account = signer.account;
    if (!isFullAccountData(account)) throw new Error('Account data incomplete');
    const { network, publicKey, sequence } = account;

    // NOTE: amino is deprecated. with the introduction of protobuf, the SDK also introduced the
    // SIGN_MODE_LEGACY_AMINO_JSON type. this type adds backwards compatibility to the new Tx type
    // for the old StdSignDoc of Amino.
    // ref: https://github.com/cosmos/cosmjs/blob/25d967ae5556d8bd172e6ead6f730830c1607984/packages/stargate/src/signingstargateclient.ts#L387
    return SdkTxDirect.fromPartial(TxMarshaller.marshal({
      body: {
        messages: this.messages.map(msg => Any.toTrueAny(Any.encode(network, msg))),
        memo: this.memo,
        timeoutHeight: this.timeoutHeight,
      },
      authInfo: {
        signerInfos: [{
          publicKey: Any.toTrueAny(Any.encode(network, publicKey)),
          sequence: sequence,
          modeInfo: {
            single: {
              mode: SignMode.SIGN_MODE_LEGACY_AMINO_JSON,
            },
          },
        }],
        fee: this.gas ?? {},
      },
      signatures: [signature],
    }) as any);
  }

  /** Get the bytes of this transaction for transmission over the network. Must include all signatures and gas configuration. */
  sdkTxBytes(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, signature?: Uint8Array): Uint8Array {
    return SdkTxDirect.encode(this.sdkTx(signer, signature)).finish();
  }

  /** Get the full bytes of this transaction for transmission over the network. Must include all signatures and gas configuration. */
  bytes(): Uint8Array {
    return SdkTxDirect.encode(this.fullSdkTx()).finish();
  }
}

export interface CosmosTxSignalOptions {
  encoding?: ReadonlySignal<CosmosTxEncoding>,
  signer?: ReadonlySignal<BoundSigner<CosmosNetworkConfig, CosmosTx>>;
  /** Interval at which to refresh the estimate. Defaults to 30 seconds. If set to 0, does not refresh. */
  refreshInterval?: number;
}

export class CosmosTxSignal {
  #estimate = signal<EstimateResult>({ status: 'pending' });
  #run = 0;
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  #refreshInterval: number;
  readonly signer: ReadonlySignal<BoundSigner<CosmosNetworkConfig, CosmosTx> | undefined>;
  readonly tx: ReadonlySignal<CosmosTx>;

  constructor(
    public readonly messages: ReadonlySignal<object[]>,
    options: CosmosTxSignalOptions = {},
  ) {
    this.signer = options.signer ?? signals.account as ReadonlySignal<BoundSigner<CosmosNetworkConfig, CosmosTx>>;
    this.#refreshInterval = options.refreshInterval ?? 30000;

    this.tx = computed(() => {
      const messages = this.messages.value;
      const encoding = options.encoding?.value ?? 'protobuf';
      if (encoding === 'protobuf') {
        return new CosmosTxDirect(messages);
      } else {
        return new CosmosTxAmino(messages);
      }
    });
  }

  /** Start side effects. Returns a corresponding cleanup function. */
  start() {
    const unsub = effect(this.refresh.bind(this));
    return () => {
      unsub();
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = undefined;
    }
  }

  /** Refresh the estimate. Calling this also resets the refresh interval. */
  refresh() {
    const runId = ++this.#run;
    this.#estimate.value = { status: 'pending' };
    clearTimeout(this.#refreshTimer);
    this.#refreshTimer = undefined;

    const signer = this.signer.value;
    const tx = this.tx.value;

    if (!signer) {
      this.#estimate.value = {
        status: 'error',
        error: new Error('Missing signer'),
        timestamp: new Date(),
        refreshInterval: this.#refreshInterval,
      };
      this.#scheduleRefresh();
      return;
    }

    if (tx.messages.length === 0) {
      this.#estimate.value = {
        status: 'error',
        error: new Error('Transactions require at least one message'),
        timestamp: new Date(),
        refreshInterval: this.#refreshInterval,
      };
      this.#scheduleRefresh();
      return;
    }

    this.#estimate.value = { status: 'pending' };

    const snapshot = signer.snapshot();
    if (!snapshot) throw new Error('Signer not bound');
    tx.estimateGas(snapshot)
      .then(gas => {
        if (runId !== this.#run) return;
        tx.setGas(gas);
        this.#estimate.value = {
          status: 'success',
          gas,
          timestamp: new Date(),
          refreshInterval: this.#refreshInterval,
        };
        this.#scheduleRefresh();
      })
      .catch(error => {
        if (runId !== this.#run) return;
        this.#estimate.value = {
          status: 'error',
          error,
          timestamp: new Date(),
          refreshInterval: this.#refreshInterval,
        };
        // do not schedule refresh
        // if the messages change, the estimate will automatically refresh
        // otherwise, the next estimate will most likely also just fail
      });
  }

  async sign() {
    const signer = this.signer.peek();
    if (!signer) throw new Error('Missing signer');
    await signer.sign(this.tx.peek());
  }

  async broadcast() {
    return await this.tx.peek().broadcast();
  }

  async signAndBroadcast() {
    await this.sign();
    return await this.broadcast();
  }

  #scheduleRefresh() {
    if (this.#refreshInterval === 0) return;
    this.#refreshTimer = setTimeout(this.refresh.bind(this), this.#refreshInterval);
  }

  get estimate(): ReadonlySignal<EstimateResult> {
    return this.#estimate;
  }
}
