import { DefaultMiddlewares } from '@apophis-sdk/core';
import type { CosmosEndpoint, CosmosNetworkConfig, ExternalAccount, FullAccountData, NetworkConfig } from '@apophis-sdk/core';
import type { MiddlewareImpl } from '@apophis-sdk/core/middleware.js';
import { CosmosPubkeyMiddleware } from './crypto/pubkey.js';
import { AminoMiddleware } from './encoding/amino.js';
import { Cosmos } from './api.js';

type Endpoints = Record<CosmosEndpoint, string[]>;

const store = new Map<CosmosNetworkConfig, Endpoints>();

export function setEndpoints(network: CosmosNetworkConfig, endpoints: Endpoints) {
  store.set(network, endpoints);
}

export function setEndpoint(network: CosmosNetworkConfig, which: CosmosEndpoint, value: string) {
  const endpoints = store.get(network) ?? {} as Endpoints;
  if (!endpoints[which]) endpoints[which] = [];
  endpoints[which].push(value);
  store.set(network, endpoints);
}

export const CosmosMiddleware: MiddlewareImpl = {
  accounts: { update: updateAccount },
  endpoints: { get: getEndpoint, list: listEndpoints },
};

export const DefaultCosmosMiddlewares = [
  ...DefaultMiddlewares,
  CosmosMiddleware,
  CosmosPubkeyMiddleware,
  AminoMiddleware,
];

async function updateAccount(account: ExternalAccount, network: NetworkConfig) {
  if (network.ecosystem !== 'cosmos') return;
  const signData = account.getSignData(network);
  const curr = signData.peek();
  try {
    const info = await Cosmos.getAccountInfo(network, curr.address);
    const { sequence: currSequence = 0n } = curr as FullAccountData;
    signData.value = {
      ...curr,
      accountNumber: info.accountNumber,
      sequence: info.sequence > currSequence ? info.sequence : currSequence,
    };
  } catch {
    console.warn(`Failed to update account info for ${curr.address} on ${network.chainId}`);
  }
}

function getEndpoint(network: CosmosNetworkConfig, which: CosmosEndpoint): string | undefined {
  return listEndpoints(network, which)?.[0];
}

function listEndpoints(network: CosmosNetworkConfig, which: CosmosEndpoint): string[] | undefined {
  if (network.ecosystem !== 'cosmos') return undefined;

  const stored = store.get(network)?.[which];
  if (stored?.length) return stored;

  if (network.endpoints?.[which]?.length) return network.endpoints[which];

  switch (which) {
    case 'rest': return [`https://rest.cosmos.directory/${network.name}`];
    case 'rpc': return [`https://rpc.cosmos.directory/${network.name}`];
    // ws is not supported through the directory
  }
}
