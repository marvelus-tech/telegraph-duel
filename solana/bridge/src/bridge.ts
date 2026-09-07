import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TelegraphDuelClient } from '../../sdk/src/client.js';
import { generateMatchId } from '../../sdk/src/utils.js';
import type {
  BridgeConfig,
  MatchServerRoomState,
  ScoreSettledEvent,
  SettlementResult,
} from './types.js';
import { normalizeScores, determineWinner } from './event-types.js';

/**
 * Match Server to Solana Bridge
 * 
 * Polls match-server for completed matches and settles scores on Solana.
 * Maps agentIds (seat A/B) to Solana wallets and triggers settleMatch instruction.
 */
export class MatchServerBridge {
  private connection: Connection;
  private client: TelegraphDuelClient;
  private config: Required<BridgeConfig>;
  private settledRooms: Set<string> = new Set();
  private eventListeners: Array<(event: ScoreSettledEvent) => void> = [];
  private pollingInterval?: NodeJS.Timeout;

  constructor(config: BridgeConfig) {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    this.client = new TelegraphDuelClient(this.connection);
    
    this.config = {
      ...config,
      pollIntervalMs: config.pollIntervalMs ?? 5000,
    };
  }

  /**
   * Register event listener for score.settled events
   */
  on(event: 'score.settled', listener: (event: ScoreSettledEvent) => void): void {
    if (event === 'score.settled') {
      this.eventListeners.push(listener);
    }
  }

  /**
   * Emit score.settled event to all listeners
   */
  private emit(event: ScoreSettledEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[Bridge] Error in event listener:', error);
      }
    });
  }

  /**
   * Fetch room state from match-server
   */
  async fetchRoomState(roomId: string): Promise<MatchServerRoomState | null> {
    try {
      const url = `${this.config.matchServerUrl}/rooms/${roomId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      return data as MatchServerRoomState;
    } catch (error) {
      console.error(`[Bridge] Error fetching room ${roomId}:`, error);
      return null;
    }
  }

  /**
   * Settle a completed match on Solana
   */
  async settleMatch(roomState: MatchServerRoomState): Promise<SettlementResult> {
    const { roomId, seats, scores } = roomState;

    if (roomState.status !== 'completed') {
      return {
        success: false,
        error: 'Room is not completed',
      };
    }

    if (!seats.A || !seats.B) {
      return {
        success: false,
        error: 'Missing seat assignments',
      };
    }

    const agentIdA = seats.A.agentId;
    const agentIdB = seats.B.agentId;

    // Map agentIds to wallets
    const walletA = this.config.agentWallets.get(agentIdA);
    const walletB = this.config.agentWallets.get(agentIdB);

    if (!walletA || !walletB) {
      return {
        success: false,
        error: `Missing wallet mapping for agents: ${!walletA ? agentIdA : ''} ${!walletB ? agentIdB : ''}`.trim(),
      };
    }

    try {
      // Generate match ID from room ID
      const matchId = generateMatchId(roomId);

      console.log(`[Bridge] Settling match for room ${roomId}`);
      console.log(`[Bridge]   Agent A: ${agentIdA} (wallet: ${walletA.toBase58().slice(0, 8)}...)`);
      console.log(`[Bridge]   Agent B: ${agentIdB} (wallet: ${walletB.toBase58().slice(0, 8)}...)`);
      console.log(`[Bridge]   Scores: ${scores.A} - ${scores.B}`);

      // Use fee payer keypair from config
      const feePayerKeypair = this.config.feePayerKeypair;

      // Check if match exists on-chain, if not create it
      const existingMatch = await this.client.getMatchAccount(matchId);
      
      if (!existingMatch) {
        console.log('[Bridge] Match not found on-chain, creating and locking...');
        
        // Create session keys
        const sessionA = this.client.createSessionKey(3600);
        const sessionB = this.client.createSessionKey(3600);

        // Create match (player1 = walletA)
        await this.client.createMatch(feePayerKeypair, {
          matchId,
          sessionPubkey: sessionA.publicKey,
          sessionExpiry: sessionA.expiry,
        });

        // Join match (player2 = walletB)
        await this.client.joinMatch(feePayerKeypair, {
          matchId,
          sessionPubkey: sessionB.publicKey,
          sessionExpiry: sessionB.expiry,
        });

        // Lock match
        await this.client.lockMatch(feePayerKeypair, matchId);
        
        console.log('[Bridge] Match created, joined, and locked');
      }

      // Settle match with scores
      const txSignature = await this.client.settleMatch(feePayerKeypair, {
        matchId,
        player1Score: scores.A,
        player2Score: scores.B,
      });

      console.log(`[Bridge] Match settled: ${txSignature}`);

      // Derive score PDAs
      const scorePdaA = PublicKey.findProgramAddressSync(
        [Buffer.from('score'), walletA.toBuffer()],
        this.config.programId
      )[0];

      const scorePdaB = PublicKey.findProgramAddressSync(
        [Buffer.from('score'), walletB.toBuffer()],
        this.config.programId
      )[0];

      // Determine winner
      const winner = determineWinner(scores, { A: agentIdA, B: agentIdB });

      // Emit score.settled event (flat structure per Sega contract)
      const event: ScoreSettledEvent = {
        type: 'score.settled',
        payload: {
          roomId,
          matchId: roomId,
          winnerAgentId: winner.agentId,
          winnerSeat: winner.seat,
          finalScoresA: scores.A,
          finalScoresB: scores.B,
          agentIdA,
          agentIdB,
          walletA: walletA.toBase58(),
          walletB: walletB.toBase58(),
          scorePdaA: scorePdaA.toBase58(),
          scorePdaB: scorePdaB.toBase58(),
          txSig: txSignature,
          lastClashReason: roomState.lastClash?.reason,
        },
        timestamp: Date.now(),
      };

      this.emit(event);

      return {
        success: true,
        txSignature,
        scorePDAs: {
          A: scorePdaA.toBase58(),
          B: scorePdaB.toBase58(),
        },
      };

    } catch (error) {
      console.error('[Bridge] Error settling match:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Process a single room (fetch and settle if completed)
   */
  async processRoom(roomId: string): Promise<void> {
    // Skip if already settled
    if (this.settledRooms.has(roomId)) {
      return;
    }

    const roomState = await this.fetchRoomState(roomId);
    
    if (!roomState) {
      console.log(`[Bridge] Room ${roomId} not found`);
      return;
    }

    if (roomState.status !== 'completed') {
      console.log(`[Bridge] Room ${roomId} not completed yet (status: ${roomState.status})`);
      return;
    }

    console.log(`[Bridge] Found completed room: ${roomId}`);
    
    const result = await this.settleMatch(roomState);
    
    if (result.success) {
      this.settledRooms.add(roomId);
      console.log(`[Bridge] ✓ Settled room ${roomId} - tx: ${result.txSignature}`);
    } else {
      console.error(`[Bridge] ✗ Failed to settle room ${roomId}: ${result.error}`);
    }
  }

  /**
   * Start polling for completed rooms
   * @param roomIds - Optional list of specific room IDs to monitor
   */
  startPolling(roomIds?: string[]): void {
    if (this.pollingInterval) {
      console.warn('[Bridge] Polling already started');
      return;
    }

    console.log(`[Bridge] Starting polling (interval: ${this.config.pollIntervalMs}ms)`);
    
    if (roomIds) {
      console.log(`[Bridge] Monitoring specific rooms: ${roomIds.join(', ')}`);
    }

    const poll = async () => {
      if (roomIds) {
        for (const roomId of roomIds) {
          await this.processRoom(roomId);
        }
      } else {
        console.warn('[Bridge] No room IDs specified for polling');
      }
    };

    // Initial poll
    poll();

    // Set up recurring poll
    this.pollingInterval = setInterval(poll, this.config.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
      console.log('[Bridge] Polling stopped');
    }
  }

  /**
   * Get list of settled room IDs
   */
  getSettledRooms(): string[] {
    return Array.from(this.settledRooms);
  }
}
