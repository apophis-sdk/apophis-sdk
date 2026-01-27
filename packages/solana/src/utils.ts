import type { Bytes } from '@apophis-sdk/core';
import { pubkey } from '@apophis-sdk/core/crypto/pubkey.js';
import { bytes, fromBase58, fromUtf8, toBase58 } from '@apophis-sdk/core/utils.js';
import { Point } from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2';

const MAX_SEEDS = 16;
const MAX_SEED_LENGTH = 32;
const PDA_MARKER_BYTES = fromUtf8('ProgramDerivedAddress');

export function getProgramDerivedAddress(base: string, seeds: Bytes[]): string {
  if (seeds.length > MAX_SEEDS) throw new Error(`Too many seeds, expected at most ${MAX_SEEDS}`);

  const seedBytes = seeds.map(seed => bytes(seed)).reduce((acc, curr) => [...acc, ...curr], [] as number[]);
  if (seedBytes.length > MAX_SEED_LENGTH) throw new Error(`Too many seed bytes, expected at most ${MAX_SEED_LENGTH}`);

  for (let bump = 255; bump >= 0; bump--) {
    const addressBytes = sha256(new Uint8Array([...seedBytes, bump, ...fromBase58(base), ...PDA_MARKER_BYTES]));
    if (isOffCurve(addressBytes)) return toBase58(addressBytes);
  }

  throw new Error('Program derived address not found for given seeds');
}

export function isOffCurve(addressBytes: Uint8Array): boolean {
  if (addressBytes.length !== 32) throw new Error('Invalid address bytes length, expected 32');
  try {
    Point.fromBytes(addressBytes).assertValidity();
    return false;
  } catch {
    return true;
  }
}

export const getPublicKeyFromAddress = (address: string) => pubkey.ed25519(fromBase58(address));
