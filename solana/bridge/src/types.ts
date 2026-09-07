import type { PublicKey } from '@solana/web3.js';

export interface ClashResult {
  round: number;
  winner: 'A' | 'B';
  loser: 'A' | 'B';
  reason: string;
  stanceA: string | null;
  stanceB: string | null;
}

export interface MatchServerRoomState {
  roomId: string;
  status: 'waiting' | 'ready' | 'in_progress' | 'completed';
  seats: {
    A?: { agentId: string; joinedAt: string };
    B?: { agentId: string; joinedAt: string };
  };
  currentRound: number;
  scores: {
    A: number;
    B: number;
  };
  config: {
    rounds: number;
    windowMs: number;
    firstTo: number;
    bestOf: number;
  };
  createdAt: string;
  lastClash?: ClashResult;
  history: ClashResult[];
}

export interface WalletMapping {
  agentId: string;
  wallet: PublicKey;
}

export interface BridgeConfig {
  solanaRpcUrl: string;
  matchServerUrl: string;
  agentWallets: Map<string, PublicKey>;
  feePayerKeypair: any; // Keypair from @solana/web3.js
  programId: PublicKey;
  pollIntervalMs?: number;
}

export interface ScoreSettledEvent {
  type: 'score.settled';
  data: {
    matchId: string;
    roomId: string;
    scores: {
      A: number;
      B: number;
    };
    agentIds: {
      A: string;
      B: string;
    };
    lastClash?: {
      reason: string;
    };
    txSignature: string;
    scorePDAs: {
      A: string;
      B: string;
    };
  };
  timestamp: number;
}

export interface SettlementResult {
  success: boolean;
  txSignature?: string;
  scorePDAs?: {
    A: string;
    B: string;
  };
  error?: string;
}
