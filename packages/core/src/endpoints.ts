import { NetworkConfig } from './types.js';
import { mw } from './middleware.js';
import { CosmosNetworkConfig, SolanaNetworkConfig } from './networks.js';

export type CosmosEndpoint = 'rest' | 'rpc' | 'ws';
export type SolanaEndpoint = 'rpc' | 'ws';

export const endpoints = new class {
  /** Get the endpoint to use for a given network & endpoint type. */
  get(network: SolanaNetworkConfig, which: SolanaEndpoint): string;
  get(network: CosmosNetworkConfig, which: CosmosEndpoint): string;
  get(network: NetworkConfig, which: string): string {
    return mw('endpoints', 'get').inv().fifo(network, which);
  }

  /** Get all endpoints for a given network & endpoint type. */
  list(network: SolanaNetworkConfig, which: SolanaEndpoint): string[];
  list(network: CosmosNetworkConfig, which: CosmosEndpoint): string[];
  list(network: NetworkConfig, which: string): string[] {
    return mw('endpoints', 'list').inv().fifo(network, which);
  }
}
