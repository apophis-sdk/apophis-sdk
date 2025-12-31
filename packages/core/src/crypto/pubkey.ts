import type { Bytes } from '@apophis-sdk/core/types.js';

export class PublicKey<T extends string = 'secp256k1' | 'ed25519'> {
  constructor(
    public readonly type: T,
    public readonly bytes: Bytes,
  ) {}
}

/** Interface defining `pubkey` functions. Augment to add new pubkey types. */
export interface PublicKeyFactories {
  secp256k1(bytes: Bytes): PublicKey<'secp256k1'>;
  ed25519(bytes: Bytes): PublicKey<'ed25519'>;
}

export type Pubkeys = PublicKeyFactories;

export const pubkey: Pubkeys = {
  secp256k1: (bytes: Bytes) => new PublicKey('secp256k1', bytes),
  ed25519: (bytes: Bytes) => new PublicKey('ed25519', bytes),
}
