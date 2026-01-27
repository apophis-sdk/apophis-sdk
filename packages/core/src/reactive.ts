import { computed, ref, shallowRef, shallowReadonly } from 'vue';
import { effect } from '@preact/signals-core';
import * as signals from './signals.js';
import type { Signer } from './signer.js';
import type { NetworkConfig } from './types.js';

/** Vue reactive wrapper for the logged-in signer, if any. Automatically updates when the Preact signal changes. */
const _signer = shallowRef<Signer>();
export const signer = shallowReadonly(_signer);

effect(() => {
  _signer.value = signals.signer.value;
});

/** Vue reactive wrapper for the currently selected network, if any. Automatically updates when the Preact signal changes. */
const _network = ref<NetworkConfig>();
export const network = shallowReadonly(_network);

effect(() => {
  _network.value = signals.network.value;
});

/** Vue reactive wrapper for the currently selected network's chain ID, if any. Automatically updates when the Preact signal changes. */
export const chainId = computed(() => network.value?.chainId);

/** Vue reactive wrapper for the first account of the current signer bound to the current network, if any. Automatically updates when the Preact signal changes. */
export const account = computed(() => _signer.value?.bind(_network.value));

/** Vue reactive wrapper for the public key of the current signer on the bound network, if any. Automatically updates when the Preact signal changes. */
export const publicKey = computed(() => account.value?.publicKey.value);

/** Vue reactive wrapper for the address of the current signer on the bound network, if any. Automatically updates when the Preact signal changes. */
export const address = computed(() => account.value?.address.value);

/** Vue reactive wrapper for the bech32 address prefix for the current network, if supported & configured. Automatically updates when the Preact signal changes. */
export const bech32Prefix = computed(() => network.value?.ecosystem === 'cosmos' ? network.value?.addressPrefix : undefined);
