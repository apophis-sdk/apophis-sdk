import { Event } from '@kiruse/typed-events';

/**
 * `PowerSocket` is a reconnecting & extensible wrapper around WebSockets using exponential backoff.
 * It emits various events to manage the connection lifecycle.
 *
 * A big departure from the underlying WebSockets usage pattern is that `PowerSocket` is designed to
 * provide a stable instance. It is designed to represent a single stateful connection to a remote
 * endpoint, not a single-use connection that must be re-created whenever the connection is lost.
 */
export class PowerSocket<
  Request,
  Response,
  Payload extends string | Uint8Array = string,
> {
  #ws: WebSocket | undefined;
  #connected = false;
  #reconnecting = false;
  #reconnectAttempt = 0;
  connectTimeout = 1500;

  /** Event emitted whenever a message has been received. */
  readonly onMessage = Event<Response>();
  /** Event emitted when the connection was successfully established. This event is emitted every time
   * the connection is established, including after a reconnection. It thus serves well as a general
   * entrypoint for connection configuration.
   */
  readonly onConnect = Event();
  /** Event emitted when the connection was dropped unexpectedly. The `PowerSocket` will attempt to re-establish the connection. */
  readonly onDisconnect = Event();
  /** Event emitter when the connection was previously dropped unexpectedly but has now been re-established.
   * This event is emitted independently of `onConnect`, but will not be emitted on the initial connection.
   */
  readonly onReconnect = Event();
  /** Event emitted when the connection was terminated normally, i.e. when `close` was called, or a close event was received where `shouldReconnect` returned false. */
  readonly onClose = Event<{ code: number, source: 'local' | 'remote' }>();
  /** Event emitted whenever an error is encountered, either from the underlying WebSocket or this library's extension. */
  readonly onError = Event<any>();

  constructor(
    public url: string | (() => string),
    public marshal: (data: Request) => Payload,
    public unmarshal: (data: Payload) => Response,
  ) {}

  /**
   * Attempt to connect to the remote server.
   * @returns
   * @throws {StateError} if already connected. The error is emitted as onError event.
   */
  connect() {
    if (this.#ws) {
      this.onError.emit(new PowerSocketStateError('Already connected/connecting'));
      return this;
    }

    try {
      this.#ws = new WebSocket(typeof this.url === 'function' ? this.url() : this.url);
      this.#ws.onopen = this.#onOpen;
      this.#ws.onclose = this.#onClose;
      this.#ws.onmessage = this.#onMessage;
      this.#ws.onerror = (err) => this.onError.emit(err);
    } catch (err) {
      this.onError.emit(err);
    }
    return this;
  }

  reconnect(closeCode = 1000) {
    const attempt = this.#reconnectAttempt++;
    this.#reconnecting = true;
    // cleanup before close prevents onClose callback from being called
    this.#cleanup();
    this.#ws?.close(closeCode);

    console.log(`Reconnecting in ${getBackoffTimeout(attempt)}ms`);
    const timeout = setTimeout(() => {
      this.connect();
      closer();
    }, getBackoffTimeout(attempt));
    const closer = this.onClose.once(() => clearTimeout(timeout));
  }

  close(closeCode = 1000, reason?: string) {
    this.#connected = false;
    this.#reconnecting = false;
    // cleanup before close prevents onClose callback from being called
    this.#cleanup();
    this.#ws?.close(closeCode, reason);
    this.onClose.emit({ code: closeCode, source: 'local' });
    return this;
  }

  send(data: Request) {
    if (!this.#ws || !this.#connected) throw new PowerSocketError('WebSocket not connected');
    this.#ws.send(this.marshal(data));
    return this;
  }

  #cleanup() {
    const ws = this.#ws;
    if (!ws) return;
    this.#ws = undefined;
    ws.onopen = null;
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
  }

  #onOpen = () => {
    this.#reconnectAttempt = 0;
    this.#connected = true;
    this.onConnect.emit();
    if (this.#reconnecting) {
      this.#reconnecting = false;
      this.onReconnect.emit();
    } else {
      this.#reconnecting = false;
    }
  }

  #onClose = (e: CloseEvent) => {
    this.onDisconnect.emit({ code: e.code });
    this.#connected = false;

    if (this.shouldReconnect(e.code)) {
      this.reconnect();
    } else {
      this.onClose.emit({ code: e.code, source: 'remote' });
      this.#cleanup();
    }
  }

  #onMessage = (e: MessageEvent) => {
    this.onMessage.emit(this.unmarshal(e.data));
  }

  /** Whether the socket should attempt to reconnect to the remote endpoint. The standard behavior
   * is to always attempt to reconnect unless the close code is 1000 (Normal Closure).
   */
  shouldReconnect(code: number) {
    return code !== 1000;
  }

  /** Return a Promise that resolves when the PowerSocket has connected and is ready to `.send`. */
  ready(timeout?: number): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      if (timeout) {
        timeoutHandle = setTimeout(() => {
          reject(Error('Connection attempt timed out'));
        }, timeout);
      }

      this.onConnect.once(() => {
        clearTimeout(timeoutHandle);
        resolve();
      });
    });
  }

  get connected() { return this.#connected }
  get reconnecting() { return this.#reconnecting }
}

export class PowerSocketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class PowerSocketTimeoutError extends PowerSocketError {
  constructor(attempt: number) {
    super(`Connection attempt timed out after ${attempt} attempts`);
  }
}

export class PowerSocketStateError extends PowerSocketError {
  constructor(message: string) {
    super(message);
  }
}

const getBackoffTimeout = (attempt: number, max = 12, base = 2) => base ** Math.min(attempt, max) * 1000;
