import { PublicKey } from '@solana/web3.js';

/**
 * Solana types for Telegraph Duel
 * Aligns with game's EVENTBUS.md contract
 */

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

/**
 * Game event types from EVENTBUS.md
 * These are emitted by src/bus/EventBus.ts
 */
export type GameEventType =
  | 'match:start'
  | 'match:end'
  | 'round:start'
  | 'round:end'
  | 'agent:windUp'
  | 'agent:feint'
  | 'agent:commit'
  | 'agent:panic'
  | 'clash:resolve';

export interface GameEvent {
  type: GameEventType;
  data?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Bridge configuration for game→Solana integration
 */
export interface BridgeConfig {
  /** Auto-create match on match:start */
  autoCreateMatch?: boolean;
  
  /** Auto-lock match when game starts */
  autoLockMatch?: boolean;
  
  /** Auto-settle on match:end */
  autoSettle?: boolean;
  
  /** Session key expiry (seconds) */
  sessionExpirySeconds?: number;
}
