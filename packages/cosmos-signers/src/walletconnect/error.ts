import { TransactionResponse } from '@apophis-sdk/cosmos/types.sdk.js';

export class WalletConnectSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class WalletConnectSignerNotConnectedError extends WalletConnectSignerError {
  constructor() {
    super('Not connected');
  }
}

export class WalletConnectBroadcastError extends WalletConnectSignerError {
  constructor(public readonly txResponse: TransactionResponse) {
    super('Failed to broadcast transaction: ' + txResponse.raw_log);
  }
}
