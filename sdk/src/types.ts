import { PublicKey } from '@solana/web3.js';

export type MatchState = 'WaitingForPlayer' | 'Locked' | 'Settled';

export interface MatchAccount {
  matchId: Buffer;
  player1: PublicKey;
  player2: PublicKey | null;
  player1Session: PublicKey | null;
  player2Session: PublicKey | null;
  sessionExpiry: number | null;
  state: MatchState;
  createdAt: number;
  lockedAt: number | null;
  settledAt: number | null;
  bump: number;
}

export interface PlayerScore {
  player: PublicKey;
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  matchesPlayed: number;
  bump: number;
}

export interface CreateMatchParams {
  matchId: Buffer;
  sessionPubkey?: PublicKey;
  sessionExpiry?: number;
}

export interface JoinMatchParams {
  matchId: Buffer;
  sessionPubkey?: PublicKey;
  sessionExpiry?: number;
}

export interface SettleMatchParams {
  matchId: Buffer;
  player1Score: number;
  player2Score: number;
}

export interface SessionKeyPair {
  publicKey: PublicKey;
  secretKey: Uint8Array;
  expiry: number;
}
