import { Decimal } from '@kiruse/decimal';
import { Marshaller } from '@kiruse/marshal';

/** Discriminated union of all supported network configurations - discriminated by `ecosystem`. */
export type NetworkConfig = CosmosNetworkConfig | SolanaNetworkConfig;

/** Specialized configuration for Cosmos chains. This is NOT the same as the Chain Registry. The
 * design philosophy for this configuration is to be as minimal as possible as to avoid requiring
 * additional dependencies just to specify a network to connect to.
 */
export interface CosmosNetworkConfig {
  ecosystem: 'cosmos';
  chainId: string;
  prettyName: string;
  /** The unique registry name. */
  name: string;
  /** Bech32 prefix for addresses. */
  addressPrefix: string;
  /** Optional slip44 coin type for HD wallets. This is only relevant for local signers, not for
   * third party signers like Metamask or Keplr. Local signers are typically used on backends or in
   * tools, but not in the frontend.
   *
   * **Note:** Often, we have heuristics to choose a good default. For example, most Cosmos chains
   * use 118. Some chains like Terra use 330. You may find the coin type in the official
   * [SLIP44 Registry](https://github.com/satoshilabs/slips/blob/master/slip-0044.md) or in the
   * [Cosmos Chain Registry](https://github.com/cosmos/chain-registry).
   * However, the exact coin type only matters when attempting to load the same mnemonic into a
   * different wallet. Thus, when used for local tooling, as long as you're consistent about the
   * coin type, it doesn't actually matter which value you use.
   */
  slip44?: number;
  assets: FungibleAsset[];
  /** The default gas price. */
  gas: CosmosGasConfig[];
  /** Gas multiplier for estimation. Defaults to 1.2. */
  gasFactor?: number | Decimal;
  /** Optional staking asset. While all Cosmos chains have a staking asset, ThorChain does not allow everybody to participate in it. */
  staking?: FungibleAsset;
  /** Endpoints to use for this network. If omitted, the default is to use the
   * [cosmos.directory](https://cosmos.directory) load balancer.
   *
   * Note that the `networkFromRegistry` function automatically populates these endpoints from the
   * [Cosmos Chain Registry](https://github.com/cosmos/chain-registry) which is the same data source
   * used by the *cosmos.directory* - however, the *cosmos.directory* does not support WebSockets
   * or testnets, so you will most likely want to populate these values.
   */
  endpoints?: {
    /** The REST endpoints to use. */
    rest?: string[];
    /** The RPC endpoints to use. */
    rpc?: string[];
    /** When omitted, alters the `rpc` endpoints by changing the protocol to `ws(s)` and appending `/websocket`. */
    ws?: string[];
  };
}

/** Asset configuration from the Chain Registry. */
export interface CosmosRegistryAsset {
  base: string;
  name: string;
  /** Identifier of a denom unit to use for display purposes. */
  display?: string;
  /** Symbol to use for display purposes. */
  symbol?: string;
  /** Number of decimals to use for display purposes. */
  exponent?: number;
  /** Type of asset. Typically something like `sdk.coin`. */
  type_asset?: string;
  description?: string;
  extended_description?: string;
  denom_units: {
    denom: string;
    exponent: number;
    aliases?: string[];
  }[];
  traces?: (IBCTrace)[];
  images?: CosmosRegistryAssetImage[];
  coingecko_id?: string;
}

/** Image configuration for a fungible asset from the Chain Registry. */
export interface CosmosRegistryAssetImage {
  /** If present, this image should be kept in sync with an asset from another chain. */
  image_sync?: {
    chain_name: string;
    base_denom: string;
  };
  png?: string;
  svg?: string;
  theme?: CosmosRegistryAssetImageTheme;
  logo_URIs?: CosmosRegistryAssetLogoURIs;
}

/** Theme configuration for a fungible asset from the Chain Registry. */
export interface CosmosRegistryAssetImageTheme {
  primary_color_hex: string;
}

/** Logo URIs for a fungible asset from the Chain Registry. */
export interface CosmosRegistryAssetLogoURIs {
  png?: string;
  svg?: string;
}

interface IBCTrace {
  type: 'ibc';
  counterparty: {
    chain_name: string;
    base_denom: string;
    channel_id: string;
  };
  chain: {
    channel_id: string;
    path: string;
  };
}

/** Base configuration for fungible assets. Primarily used for gas computations or display purposes. */
export interface FungibleAsset {
  denom: string;
  /** Display name */
  name: string;
  /** Optional CoinGecko ID used by some wallets */
  cgid?: string;
  /** Optional CoinMarketCap ID used by some wallets */
  cmcid?: string;
  /** The number of decimals to use when formatting this asset. Defaults to 6. It is strongly advised to populate this value. */
  decimals?: number;
  /** Optional display configuration for UIs. */
  display?: FungibleAssetDisplay;
}

export interface FungibleAssetDisplay {
  /** Identifier of a deviating denom unit to use for display purposes.
   */
  denom: string;
  /** Deviating symbol to show in the UI. */
  symbol?: string;
  /** Deviating number of decimals for display purposes. E.g. in Cosmos, the canonical decimals are
   * 0, but typically displayed as 6.
   */
  decimals?: number;
  /** Alternative, prettier names for the asset. E.g. often an imported asset in Cosmos is a very
   * long hash-based name prefixed with `ibc/`, but often uses a shorter name in the UI like `uusdc`.
   */
  aliases?: string[];
}

/** Gas configuration specific to Cosmos chains. However, even within Cosmos, chains may deviate
 * from this norm. However, this reflects the current standard as documented in the Chain Registry.
 */
export interface CosmosGasConfig {
  asset: FungibleAsset;
  /** Minimum gas fee (note: not the gas price) */
  minFee?: Decimal | number;
  /** Lowest gas price for the cheapest fee. Defaults to `avgPrice`. */
  lowPrice?: Decimal | number;
  /** Average gas price for the average fee. */
  avgPrice: Decimal | number;
  /** Highest gas price for the highest fee. Defaults to `avgPrice`. */
  highPrice?: Decimal | number;
  /** Gas is a unit of measurement for compute cycles. Simulation costs less gas than the final
   * transation due to omission of certain operations like signature verification (since simulated
   * transactions aren't signed).
   *
   * To cope, other SDKs apply `gasMultiplier` between 1.1 and 1.5. You may also specify the
   * `flatGasOffset` instead. The default is to add 50,000 gas to the estimation with no multiplier.
   */
  flatGasOffset?: number | bigint;
  /** Gas is a unit of measurement for compute cycles. Simulation costs less gas than the final
   * transation due to omission of certain operations like signature verification (since simulated
   * transactions aren't signed).
   *
   * To cope, other SDKs apply a `gasMultiplier` between 1.1 and 1.5. You may also specify the
   * `flatGasOffset` instead. The default is to add 50,000 gas to the estimation with no multiplier.
   */
  gasMultiplier?: number | bigint;
}

/** Specialized configuration for Solana chains. Caveat: This is a work in progress. */
export interface SolanaNetworkConfig {
  ecosystem: 'solana';
  /** A unique name for the network. This is used to standardize across different ecosystems, where
   * the `chainId` may change after a chain upgrade. In solana, this matches the `chainId`, prefixed
   * by `solana:`.
   */
  name: string;
  /** Unique identifier for the SVM chain. Currently, there are only four options, though technically,
   * you could spin up your own chain with a new moniker.
   *
   * - `mainnet`
   * - `devnet`
   * - `testnet`
   * - `localnet`
   */
  chainId: string;
  endpoints?: {
    /** RPC endpoints to use. The 3 default Solana networks (mainnet, devnet, testnet) have default endpoints. */
    rpc: string[];
    /** Dedicated WebSocket PubSub endpoints to use. If omitted, derived from the `rpc` endpoints. */
    ws?: string[];
  };
  /** Optional custom SLIP44 to use for HD wallets. Solana defaults to 501. */
  slip44?: number;
  /** Optional custom marshaller to use for this network. If omitted, the default marshaller is used. */
  marshaller?: Marshaller;
}
