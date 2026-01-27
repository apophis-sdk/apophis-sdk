import { computed, signal } from '@preact/signals-core';
import type { Signer } from './signer.js';
import type { NetworkConfig } from './types.js';

/** Logged-in signer, if any. */
export const signer = signal<Signer>();

/** Currently selected network, if any. */
export const network = signal<NetworkConfig>();

/** Currently active account on the current network, if any. The active account
 * can be changed by calling `signer.value.activateAccount`.
 */
export const account = computed(() => network.value ? signer.value?.bind(network.value) : undefined);

/** Currently selected network's chain ID, if any. */
export const chainId = computed(() => network.value?.chainId);

/** Bech32 address prefix for the current network, if supported & configured. */
export const bech32Prefix = computed(() => network.value?.ecosystem === 'cosmos' ? network.value?.addressPrefix : undefined);
