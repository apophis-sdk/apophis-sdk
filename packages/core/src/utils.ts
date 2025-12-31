import { Signal } from '@preact/signals-core';
import { base58, base64 } from '@scure/base';
import { PubKey as SdkEd25519PublicKey } from 'cosmjs-types/cosmos/crypto/ed25519/keys.js';
import { PubKey as SdkSecp256k1PublicKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys.js';
import { pubkey, PublicKey } from './crypto/pubkey.js';
import type { Any } from './encoding/protobuf/any.js';
import type { Bytes } from './types.js';

export function fromBase64(data: string): Uint8Array {
  return base64.decode(data);
}

export function toBase64(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

export function fromBase58(data: string): Uint8Array {
  return base58.decode(data);
}

export function toBase58(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

export function fromHex(hex: string): Uint8Array {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  if (!hex.match(/^[0-9a-fA-F]+$/)) throw new Error('Invalid hex string');
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string length');
  return new Uint8Array(hex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
}

export function toHex(bytes: Uint8Array): string {
  return bytes.reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '');
}

export function fromUtf8(utf8: string): Uint8Array {
  return new TextEncoder().encode(utf8);
}

export function toUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export const bytes = (bytes: Bytes): Uint8Array => typeof bytes === 'string' ? fromBase64(bytes) : bytes;

export const getFirstSignal = <T>(signals: (Signal<T | undefined | null> | undefined | null)[]): T | undefined =>
  signals.find(signal => signal?.value)?.value ?? undefined;

export function fromSdkPublicKey(publicKey: Any): PublicKey {
  let { typeUrl, value } = publicKey;
  if (typeof value === 'string') value = fromBase64(value);

  switch (typeUrl) {
    case SdkEd25519PublicKey.typeUrl: {
      const key = SdkEd25519PublicKey.decode(value);
      return pubkey.ed25519(key.key);
    }
    case SdkSecp256k1PublicKey.typeUrl: {
      const key = SdkSecp256k1PublicKey.decode(value);
      return pubkey.secp256k1(key.key);
    }
    default:
      throw new Error('Unsupported pubkey type');
  }
}

export const getRandomItem = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
