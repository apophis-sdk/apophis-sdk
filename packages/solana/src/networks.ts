import type { SolanaNetworkConfig } from '@apophis-sdk/core';

/** Network configuration for the Solana Mainnet. This network is the production network for the
 * Solana blockchain for production applications.
 */
export const SolanaMainnet: SolanaNetworkConfig = {
  ecosystem: 'solana',
  name: 'Solana Mainnet (Beta)',
  chainId: 'mainnet',
  endpoints: {
    rpc: ['https://api.mainnet-beta.solana.com'],
  },
};

/** Network configuration for the Solana Devnet. This network is the canary for the Mainnet and
 * suitable for development and testing.
 */
export const SolanaDevnet: SolanaNetworkConfig = {
  ecosystem: 'solana',
  name: 'Solana Devnet',
  chainId: 'devnet',
  endpoints: {
    rpc: ['https://api.devnet.solana.com'],
  },
};

/** Network configuration for the Solana Testnet. This network is designated for performance & stress
 * testing and may experience downtimes. It is typically not suited for development usage.
 */
export const SolanaTestnet: SolanaNetworkConfig = {
  ecosystem: 'solana',
  name: 'Solana Testnet',
  chainId: 'testnet',
  endpoints: {
    rpc: ['https://api.testnet.solana.com'],
  },
};

/** Network configuration for the Solana Localnet for locally spun-up Solana clusters. Typically,
 * this network is used for development and testing purposes.
 */
export const SolanaLocalnet: SolanaNetworkConfig = {
  ecosystem: 'solana',
  name: 'Solana Localnet',
  chainId: 'localnet',
  endpoints: {
    rpc: ['http://localhost:8899'],
    ws: ['ws://localhost:8900'],
  },
};
