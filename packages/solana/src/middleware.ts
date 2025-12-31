import { DefaultMiddlewares, type NetworkConfig } from '@apophis-sdk/core';
import type { PublicKey } from '@apophis-sdk/core/crypto/pubkey.js';
import { MiddlewareImpl } from '@apophis-sdk/core/middleware.js';
import { fromBase64, toBase58 } from '@apophis-sdk/core/utils.js';

export const SolanaMiddleware: MiddlewareImpl = {
  addresses: {
    // TODO: `resolve` middleware for .SOL names (https://sns.id/)
    compute(network: NetworkConfig, publicKey: PublicKey) {
      if (publicKey.type !== 'ed25519') throw new Error('Invalid pubkey type, expected ed25519');
      if (publicKey.bytes.length !== 32) throw new Error('Invalid pubkey length, expected 32');
      // Interestingly enough, Solana uses the full public key as the address, so you can actually
      // recover the public key from the address, but that is not a function in Apophis.
      return toBase58(typeof publicKey.bytes === 'string' ? fromBase64(publicKey.bytes) : publicKey.bytes);
    },
  },

  endpoints: {
    get(network: NetworkConfig, which: string) {
      if (network.ecosystem !== 'solana') return undefined;
      switch (which) {
        case 'rpc':
          return network.endpoints?.rpc?.[Math.floor(Math.random() * network.endpoints.rpc.length)];
        case 'ws':
          if (network.endpoints?.ws)
            return network.endpoints.ws[Math.floor(Math.random() * network.endpoints.ws.length)];

          const rpc = network.endpoints?.rpc?.[Math.floor(Math.random() * network.endpoints.rpc.length)];
          if (!rpc) return undefined;

          const url = new URL(rpc);
          url.protocol = 'wss:';
          url.port = '8900';
          return url.toString();
      }
    },
    list(network: NetworkConfig, which: string) {
      if (network.ecosystem !== 'solana' || which !== 'rpc') return undefined;
      return network.endpoints ?? [];
    },
  }
}

export const DefaultSolanaMiddlewares = [
  ...DefaultMiddlewares,
  SolanaMiddleware,
];
