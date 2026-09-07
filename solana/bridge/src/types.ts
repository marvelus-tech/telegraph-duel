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
  publishSettlementEvents?: boolean; // Enable POST to match-server after settlement
}

/**
 * Flat score.settled event emitted after successful settlement
 * 
 * Aligned with Sega EventBus + HUD consumer contract
 */
export interface ScoreSettledEvent {
  type: 'score.settled';
  payload: {
    roomId: string;
    matchId: string;
    winnerAgentId: string;
    winnerSeat: 'A' | 'B';
    finalScoresA: number;
    finalScoresB: number;
    agentIdA: string;
    agentIdB: string;
    walletA: string;          // base58
    walletB: string;          // base58
    scorePdaA: string;        // base58
    scorePdaB: string;        // base58
    txSig: string;
    lastClashReason?: string;
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
