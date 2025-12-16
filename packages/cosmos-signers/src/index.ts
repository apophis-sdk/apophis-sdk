import { Signer } from '@apophis-sdk/core';
import { Keplr } from './keplr.js';
import { Leap } from './leap.js';
import { WalletConnectCosmosSigner } from './walletconnect/signer.js';

export * from './keplr.js';
export * from './leap.js';
export * from './walletconnect/index.js';

export function registerCosmosSigners(walletConnectProjectId?: string) {
  Signer.register(Keplr);
  Signer.register(Leap);
  if (walletConnectProjectId) {
    Signer.register(new WalletConnectCosmosSigner({ projectId: walletConnectProjectId }));
  }
}
