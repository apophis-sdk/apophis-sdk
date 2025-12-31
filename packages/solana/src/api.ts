import type { Instruction } from '@solana/instructions';
import { createSolanaRpc, createSolanaSubscription } from './rpc.js';
import { SolanaTx } from './tx.js';

export namespace Solana {
  export function tx(instructions: Instruction[], recentBlockhash?: string) {
    return new SolanaTx(instructions, recentBlockhash);
  }

  export const rpc = createSolanaRpc;
  export const subscribe = createSolanaSubscription;
}
