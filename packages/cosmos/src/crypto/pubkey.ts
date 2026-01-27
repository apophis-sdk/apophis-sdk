import { Any, NetworkConfig } from '@apophis-sdk/core';
import { MiddlewareImpl, mw } from '@apophis-sdk/core/middleware.js';
import { PublicKey } from '@apophis-sdk/core/crypto/pubkey.js';
import { bytes, toBase64 } from '@apophis-sdk/core/utils.js';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import { bech32 } from '@scure/base';
import { PubKey as Secp256k1PublicKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys.js';
import { PubKey as Ed25519PublicKey } from 'cosmjs-types/cosmos/crypto/ed25519/keys.js';
import { type AminoPubkey, Amino } from '../encoding/amino.js';

export const CosmosSecp256k1TypeUrl = '/cosmos.crypto.secp256k1.PubKey';
export const CosmosSecp256k1AminoType = 'tendermint/PubKeySecp256k1';
export const CosmosEd25519TypeUrl = '/cosmos.crypto.ed25519.PubKey';
export const CosmosEd25519AminoType = 'tendermint/PubKeyEd25519';

// TODO: protobuf wire format for pubkeys is really simple, but not yet implemented in core:
// field 0: varint (length), 1: bytes
const encodings: Record<string, Record<string, (value: PublicKey) => unknown>> = {
  protobuf: {
    secp256k1: (value: PublicKey) => Any(
      CosmosSecp256k1TypeUrl,
      Secp256k1PublicKey.encode(Secp256k1PublicKey.fromPartial({ key: bytes(value.bytes) })).finish()
    ),
    ed25519: (value: PublicKey) => Any(
      CosmosEd25519TypeUrl,
      Ed25519PublicKey.encode(Ed25519PublicKey.fromPartial({ key: bytes(value.bytes) })).finish()
    ),
  },
  amino: {
    secp256k1: (value: PublicKey): AminoPubkey => ({
      type: CosmosSecp256k1AminoType,
      value: typeof value.bytes === 'string' ? value.bytes : toBase64(value.bytes),
    }),
    ed25519: (value: PublicKey): AminoPubkey => ({
      type: CosmosEd25519AminoType,
      value: typeof value.bytes === 'string' ? value.bytes : toBase64(value.bytes),
    }),
  },
};

export const CosmosPubkeyMiddleware: MiddlewareImpl = {
  addresses: {
    compute(network: NetworkConfig, value: PublicKey) {
      if (network.ecosystem !== 'cosmos') return;
      if (value.type !== 'secp256k1') return;
      if (value.bytes.length !== 33) throw new Error('Invalid pubkey length, expected 33');
      const prefix = network.addressPrefix;
      return bech32.encode(prefix, bech32.toWords(ripemd160(sha256(value.bytes))));
    }
  },
  encoding: {
    encode(network: NetworkConfig, encoding: string, value: unknown) {
      if (network.ecosystem !== 'cosmos') return;
      if (value instanceof PublicKey) {
        return encodings[encoding]?.[value.type]?.(value);
      }
    },
    decode(network: NetworkConfig, encoding: string, value: unknown) {
      if (network.ecosystem !== 'cosmos') return;
      switch (encoding) {
        case 'protobuf': {
          if (!Any.isAny(value)) return;
          const type = getPubkeyType(value.typeUrl);
          switch (type) {
            case 'secp256k1': {
              const key = Secp256k1PublicKey.decode(bytes(value.value));
              return new PublicKey(type, key.key);
            }
            case 'ed25519': {
              const key = Ed25519PublicKey.decode(bytes(value.value));
              return new PublicKey(type, key.key);
            }
          }
        }
        case 'amino': {
          if (!Amino.isAmino(value)) return;
          const type = getPubkeyType(value.type);
          if (!type) return;
          return new PublicKey(type, value.value);
        }
      }
    }
  },
};

function getPubkeyType(typeUrl: string) {
  switch (typeUrl) {
    case CosmosSecp256k1TypeUrl:
    case CosmosSecp256k1AminoType:
      return 'secp256k1';
    case CosmosEd25519TypeUrl:
    case CosmosEd25519AminoType:
      return 'ed25519';
  }
}
