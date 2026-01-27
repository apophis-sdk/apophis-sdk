import { BytesMarshalUnit } from '@apophis-sdk/core/marshal.js';
import { type CosmosNetworkConfig } from '@apophis-sdk/core/networks.js';
import { type BoundSignerSnapshot, type Signer } from '@apophis-sdk/core/signer.js';
import type { Coin, TransactionResponse } from '@apophis-sdk/cosmos/types.sdk.js';
import { fromBase64, fromHex, fromUtf8, toBase64, toUtf8 } from '@apophis-sdk/core/utils.js';
import { Cosmos, CosmosTx } from '@apophis-sdk/cosmos';
import { extendDefaultMarshaller, ToJsonMarshalUnit } from '@kiruse/marshal';
import { Contract } from './msg/contracts.js';

export interface InstantiateOptions {
  signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>;
  codeId: bigint;
  label: string;
  msg: Uint8Array;
  admin?: string;
  funds?: Coin[];
}

export interface StateItem {
  /** The key path of the value. Standard CosmWasm smart contracts generate predictable key paths.
   * In that case, `keypath` is an array of decoded strings. Otherwise, it is a raw binary encoding.
   */
  keypath: string[] | Uint8Array;
  /** Raw binary value of the state item. Its meaning depends entirely on the contract. */
  value: Uint8Array;
}

export interface Cw2ContractInfo {
  contract: string;
  version: string;
}

export const baseCosmWasmMarshaller = extendDefaultMarshaller([
  BytesMarshalUnit,
  ToJsonMarshalUnit,
]);

export class CosmWasmApi {
  constructor(
    public readonly marshaller = baseCosmWasmMarshaller,
  ) {}

  /** Convenience function to store the given contract code on-chain. Waits for block inclusion & returns the new code's ID. */
  async store(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, code: Uint8Array) {
    const tx = Cosmos.tx([
      new Contract.StoreCode({ sender: signer.address, wasmByteCode: code }),
    ]);

    const { gasLimit } = await tx.estimateGas(signer);
    tx.computeGas(signer.network, gasLimit + 50000n, true);

    await signer.sign(tx);
    await Cosmos.ws(signer.network).ready(10000);
    const resultPromise = Cosmos.ws(signer.network).expectTx(tx);
    await tx.broadcast();
  }

  /** Convenience function to instantiate a contract from a previously stored code. Waits for block inclusion & returns the new contract's address. */
  async instantiate({ signer, codeId, label, admin, msg, funds = [] }: InstantiateOptions): Promise<string> {
    const tx = Cosmos.tx([
      new Contract.Instantiate({
        admin: admin ?? signer.address,
        sender: signer.address,
        codeId,
        label,
        msg,
        funds,
      }),
    ]);

    const { gasLimit } = await tx.estimateGas(signer);
    tx.computeGas(signer.network, gasLimit + 50000n, true);

    await signer.sign(tx);
    await Cosmos.ws(signer.network).ready(10000);
    const resultPromise = Cosmos.ws(signer.network).expectTx(tx);
    await tx.broadcast();

    const result = await resultPromise;

    const contractAddress = Cosmos.getEventValues(result.events, 'instantiate', '_contract_address');
    if (contractAddress.length === 0)
      throw new Error('Failed to instantiate contract: no contract address found in transaction logs');
    if (contractAddress.length > 1)
      console.warn('Unexpected number of contract addresses in transaction logs, returning first:', contractAddress);
    return contractAddress[0];
  }

  /** Convenience function to migrate a contract to a new code. Waits for block inclusion & returns the transaction response. */
  async migrate(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, contractAddress: string, codeId: bigint, msg: any): Promise<TransactionResponse> {
    const tx = Cosmos.tx([
      new Contract.Migrate({
        sender: signer.address,
        contract: contractAddress,
        codeId,
        msg,
      }),
    ]);

    const { gasLimit } = await tx.estimateGas(signer);
    tx.computeGas(signer.network, gasLimit + 50000n, true);

    await signer.sign(tx);
    await Cosmos.ws(signer.network).ready(10000);
    const resultPromise = Cosmos.ws(signer.network).expectTx(tx);
    await tx.broadcast();

    await resultPromise;
    return await Cosmos.ws(signer.network).getTx(tx.hash);
  }

  /** Convenience function to invoke a contract execution. Waits for block inclusion & returns the transaction response. */
  async execute(signer: BoundSignerSnapshot<CosmosNetworkConfig, CosmosTx>, contractAddress: string, msg: any, funds: Coin[] = []): Promise<TransactionResponse> {
    const tx = Cosmos.tx([
      new Contract.Execute({
        sender: signer.address,
        contract: contractAddress,
        msg,
        funds,
      }),
    ]);

    const { gasLimit } = await tx.estimateGas(signer);
    tx.computeGas(signer.network, gasLimit + 50000n, true);

    await signer.sign(tx);
    await Cosmos.ws(signer.network).ready(10000);
    const resultPromise = Cosmos.ws(signer.network).expectTx(tx);
    await tx.broadcast();

    await resultPromise;
    return await Cosmos.ws(signer.network).getTx(tx.hash);
  }

  query = new class {
    constructor(public readonly api: CosmWasmApi) {}

    /** Query raw contract state using the `keypath`. Knowing the keypath requires deeper knowledge of the smart contract code. */
    async raw(network: CosmosNetworkConfig, contractAddress: string, keypath: string[] | Uint8Array) {
      if (!(keypath instanceof Uint8Array)) keypath = encodeKeypath(keypath);
      const key = keypath instanceof Uint8Array ? toBase64(keypath) : keypath;
      const { data } = await Cosmos.rest(network).cosmwasm.wasm.v1.contract[contractAddress].raw[key]('GET');
      if (data === null) return null;
      return fromBase64(data);
    }

    /** The smart query is the most common query type which defers to the smart contract.
     * Other types of queries exist but are currently not supported by *Apophis SDK*.
     *
     * You can get the binary representation of the query message using the `toBinary` method. The
     * data returned depends on the smart contract code but is typically a JSON object, for which
     * this method accepts a type parameter.
     */
    async smart<T = unknown>(network: CosmosNetworkConfig, contractAddress: string, queryMsg: any) {
      const result = await Cosmos.rest(network).cosmwasm.wasm.v1.contract[contractAddress].smart[CosmWasm.toBinary(queryMsg)]('GET');
      if ((result as any).code) {
        throw new Error('Failed to perform smart query');
      }
      return result.data as T;
    }

    /** State is a rarely used query type which can be used to iterate over all state items of a
     * contract, whether they are exposed through smart queries or not. However, they also require
     * deeper knowledge of the contract's state structure and the cosmwasm-std specification.
     *
     * The `nextKey` parameter is used to paginate through the state items and is generally returned
     * by the previous call to this method.
     */
    async state(network: CosmosNetworkConfig, contractAddress: string, nextKey: string = '') {
      const { models, pagination } = await Cosmos.rest(network).cosmwasm.wasm.v1.contract[contractAddress].state('GET', {
        query: {
          'pagination.key': nextKey,
          'pagination.offset': 0,
          'pagination.limit': 100,
        },
      });

      const hexify = (value: string | bigint) => {
        value = value.toString();
        if (value.length % 2 !== 0) value = '0' + value;
        return value;
      }

      return {
        pagination,
        items: models.map(model => ({
          keypath: decodeKeypathMaybe(fromHex(hexify(model.key))),
          value: fromBase64(model.value),
        })),
      };
    }

    /** Query the contract info from the CosmWasm module, as well as attempt to query the CW2
     * standard contract info.
     */
    async contractInfo(network: CosmosNetworkConfig, contractAddress: string) {
      const [
        contractInfo,
        cw2Raw,
      ] = await Promise.all([
        Cosmos.rest(network).cosmwasm.wasm.v1.contract[contractAddress]('GET'),
        this.raw(network, contractAddress, ['contract_info']),
      ]);

      const cw2 = cw2Raw !== null
        ? this.api.marshaller.unmarshal(JSON.parse(toUtf8(cw2Raw))) as Cw2ContractInfo
        : null;

      return {
        address: contractAddress,
        ...contractInfo.contract_info,
        ...cw2,
      };
    }
  }(this);

  toBinary(value: any): string {
    return toBase64(fromUtf8(JSON.stringify(this.marshaller.marshal(value))));
  }

  fromBinary(value: string): unknown {
    return this.marshaller.unmarshal(JSON.parse(toUtf8(fromBase64(value))));
  }

  encodeKeypath = encodeKeypath;
  decodeKeypath = decodeKeypath;
  decodeKeypathMaybe = decodeKeypathMaybe;
}

export const CosmWasm = new CosmWasmApi();

export function encodeKeypath(keypath: string[]): Uint8Array {
  if (keypath.length === 0)
    throw new Error('Keypath cannot be empty');
  // the -2 is to account for the fact that the last key is not preceded by a length
  const buffer = new ArrayBuffer(keypath.reduce((acc, key) => acc + key.length + 2, -2));
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;
  const last = keypath.pop()!;
  for (const key of keypath) {
    view.setUint16(offset, key.length, false);
    offset += 2;
    const keyBytes = fromUtf8(key);
    bytes.set(keyBytes, offset);
    offset += keyBytes.length;
  }
  bytes.set(fromUtf8(last), offset);
  return bytes;
}

export function decodeKeypath(keypath: Uint8Array): string[] {
  const view = new DataView(keypath.buffer);
  const result: string[] = [];
  let offset = 0;
  let isLast = false;
  while (offset < keypath.length) {
    if (offset + 2 > keypath.length) {
      isLast = true;
      break;
    }

    const keyLength = view.getUint16(offset, false);
    if (offset + 2 + keyLength > keypath.length) {
      isLast = true;
      break;
    }
    offset += 2; // doing this after the check is important to not skip 2 bytes of the last key

    result.push(toUtf8(keypath.subarray(offset, offset + keyLength)));
    offset += keyLength;
  }
  if (!isLast)
    throw new Error('Non-standard keypath encoding');
  result.push(toUtf8(keypath.subarray(offset)));
  return result;
}

export function decodeKeypathMaybe(keypath: Uint8Array): string[] | Uint8Array {
  try {
    return decodeKeypath(keypath);
  } catch {
    return keypath;
  }
}
