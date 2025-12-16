import { type SignClient } from '@walletconnect/sign-client';

export type SignClient = Awaited<ReturnType<typeof SignClient.init>>;

export interface PeerAccount {
  address: string;
  algo: string;
  /** Base64 encoded */
  pubkey: string;
  isNanoLedger: boolean;
}

export interface SignResponse {
  signature: {
    pub_key: {
      /** Typically something like "tendermint/PubKeySecp256k1" */
      type: string;
      /** Base64 encoded pubkey bytes */
      value: string;
    };
    /** Base64 encoded signature bytes */
    signature: string;
  };
  /** The document that was actually signed. May differ from the originally provided document. */
  signed: {
    chainId: string;
    /** BigInt string */
    accountNumber: string;
    /** Base64 encoded */
    authInfoBytes: string;
    /** Base64 encoded */
    bodyBytes: string;
  };
}
