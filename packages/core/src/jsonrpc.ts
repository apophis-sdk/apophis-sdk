import { defaultMarshaller } from '@kiruse/marshal';
import { PowerSocket } from './powersocket.js';

export const defaultJsonRpcMarshal = (data: JsonRpcPayload): string => JSON.stringify(defaultMarshaller.marshal(data));
export const defaultJsonRpcUnmarshal = (data: string): JsonRpcPayload => defaultMarshaller.unmarshal(JSON.parse(data)) as JsonRpcPayload;

export const isJsonRpcRequest = (data: JsonRpcPayload): data is JsonRpcRequest => 'method' in data;
export const isJsonRpcResponse = (data: JsonRpcPayload): data is JsonRpcResponse => 'result' in data || 'error' in data;

type ApiParams<T> = T extends (...args: infer Args) => any ? Args : never;
type ApiReturnType<T> = T extends (...args: any) => infer Return ? Return : never;

export type JsonRpcPayload = JsonRpcRequest | JsonRpcResponse;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

export class JsonRpcBase<Api> {
  #nextId = 1;
  #url: string;
  #ws: PowerSocket<JsonRpcPayload, JsonRpcPayload, string> | undefined;

  constructor(
    /** URL to connect to, including the protocol. Currently supports `ws(s)` and `http(s)`. */
    url: string,
    public readonly marshal = defaultJsonRpcMarshal,
    public readonly unmarshal = defaultJsonRpcUnmarshal,
  ) {
    if (url.match(/^wss?:\/\//)) {
      this.#ws = new PowerSocket(url, this.marshal, this.unmarshal);
    } else if (!url.match(/^https?:\/\//)) {
      throw new Error('Invalid URL');
    }
    this.#url = url;
  }

  async send<Method extends keyof Api & string>(
    method: Method,
    params: ApiParams<Api[Method]>,
    timeout = 30,
  ): Promise<ApiReturnType<Api[Method]>> {
    const ws = this.#ws;

    const payload = {
      jsonrpc: '2.0',
      id: this.#nextId++,
      method,
      params,
    } satisfies JsonRpcRequest;

    if (ws) {
      ws.send(payload);
      return new Promise((resolve, reject) => {
        const unsub = ws.onMessage.once((_, msg) => {
          if (msg.id !== payload.id) return false;
          if ('error' in msg) reject(msg.error);
          if (!('result' in msg)) return reject(new Error('Invalid response'));
          resolve(msg.result);
          clearTimeout(timer);
        });
        const timer = setTimeout(() => {
          unsub();
          reject(new Error('Timeout'));
        }, timeout);
      });
    } else {
      const response = await fetch(this.#url, {
        method: 'POST',
        body: this.marshal(payload),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) throw new Error('Status code ' + response.status);

      const result = this.unmarshal(await response.text()) as JsonRpcResponse;
      if (!result.result) throw result.error;
      if (result.id !== payload.id) throw new Error('Invalid response ID');
      return result.result;
    }
  }

  /** Close any open connections where applicable. Once called, the instance is in an undefined state
   * and should no longer be used.
   */
  dispose() {
    this.#ws?.close();
    this.#ws = undefined;
  }
}

export function jsonrpc<Api>(
  url: string,
  marshal: (data: JsonRpcPayload) => string = defaultJsonRpcMarshal,
  unmarshal: (data: string) => JsonRpcPayload = defaultJsonRpcUnmarshal,
) {
  const instance = new JsonRpcBase<Api>(url, marshal, unmarshal);
  return new Proxy(instance, {
    get(target, method) {
      // @ts-expect-error
      if (typeof method !== 'string') return target[method];
      return (...args: ApiParams<Api[keyof Api]>) => instance.send(method as keyof Api & string, args);
    },
  }) as unknown as Api;
}
