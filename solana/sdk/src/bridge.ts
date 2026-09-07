import { Connection, Keypair } from '@solana/web3.js';
import { TelegraphDuelClient } from './client.js';
import type { GameEvent, GameEventType, BridgeConfig } from './types.js';
import { generateMatchId } from './utils.js';

/**
 * EventBridge for Telegraph Duel
 * Subscribes to game events (from src/bus/EventBus.ts) and triggers Solana transactions
 * 
 * Aligns with EVENTBUS.md contract:
 * - match:start → createMatch + lockMatch on-chain
 * - match:end → settleMatch on-chain
 * - Other events (round:*, agent:*, clash:*) stay off-chain
 */
export class SolanaEventBridge {
  private client: TelegraphDuelClient;
  private config: Required<BridgeConfig>;
  private currentMatchId: Buffer | null = null;
  private player1?: Keypair;
  private player2?: Keypair;

  constructor(
    connection: Connection,
    player1?: Keypair,
    player2?: Keypair,
    config: BridgeConfig = {}
  ) {
    this.client = new TelegraphDuelClient(connection);
    this.player1 = player1;
    this.player2 = player2;
    
    // Default config
    this.config = {
      autoCreateMatch: config.autoCreateMatch ?? true,
      autoLockMatch: config.autoLockMatch ?? true,
      autoSettle: config.autoSettle ?? true,
      sessionExpirySeconds: config.sessionExpirySeconds ?? 3600,
    };
  }

  /**
   * Set player keypairs for auto-settlement
   */
  setPlayers(player1: Keypair, player2: Keypair): void {
    this.player1 = player1;
    this.player2 = player2;
  }

  /**
   * Create event handler for game EventBus
   * Subscribe this to the game's eventBus:
   * 
   * ```typescript
   * import { eventBus } from './src/bus/EventBus';
   * const bridge = new SolanaEventBridge(connection, player1, player2);
   * eventBus.on('*' as any, bridge.handleGameEvent.bind(bridge));
   * ```
   */
  async handleGameEvent(event: GameEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'match:start':
          await this.onMatchStart(event);
          break;
        
        case 'match:end':
          await this.onMatchEnd(event);
          break;
        
        // Other events are off-chain only (no L1 transaction)
        case 'round:start':
        case 'round:end':
        case 'agent:windUp':
        case 'agent:feint':
        case 'agent:commit':
        case 'agent:panic':
        case 'clash:resolve':
          // These events stay off-chain for performance
          // Could be logged or used for analytics
          console.log(`[Bridge] Off-chain event: ${event.type}`, event.data);
          break;
        
        default:
          console.warn(`[Bridge] Unknown event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`[Bridge] Error handling ${event.type}:`, error);
    }
  }

  /**
   * Handle match:start event
   * Creates match on-chain and optionally locks it
   */
  private async onMatchStart(event: GameEvent): Promise<void> {
    console.log('[Bridge] match:start event received', event.data);

    if (!this.config.autoCreateMatch || !this.player1) {
      console.log('[Bridge] Auto-create disabled or no player1 keypair');
      return;
    }

    // Generate deterministic match ID from agent names
    const agent1 = event.data?.agent1 as string;
    const agent2 = event.data?.agent2 as string;
    const matchSeed = `${agent1}-vs-${agent2}-${event.timestamp}`;
    this.currentMatchId = generateMatchId(matchSeed);

    console.log('[Bridge] Creating match on-chain...');
    
    // Create session keys for both players
    const player1Session = this.client.createSessionKey(this.config.sessionExpirySeconds);
    
    // Create match
    const createSig = await this.client.createMatch(this.player1, {
      matchId: this.currentMatchId,
      sessionPubkey: player1Session.publicKey,
      sessionExpiry: player1Session.expiry,
    });
    
    console.log(`[Bridge] Match created: ${createSig.slice(0, 16)}...`);

    // Auto-join if player2 is available
    if (this.player2) {
      const player2Session = this.client.createSessionKey(this.config.sessionExpirySeconds);
      
      const joinSig = await this.client.joinMatch(this.player2, {
        matchId: this.currentMatchId,
        sessionPubkey: player2Session.publicKey,
        sessionExpiry: player2Session.expiry,
      });
      
      console.log(`[Bridge] Player 2 joined: ${joinSig.slice(0, 16)}...`);
    }

    // Auto-lock if enabled
    if (this.config.autoLockMatch && this.player1) {
      const lockSig = await this.client.lockMatch(this.player1, this.currentMatchId);
      console.log(`[Bridge] Match locked: ${lockSig.slice(0, 16)}...`);
    }
  }

  /**
   * Handle match:end event
   * Settles final scores on-chain
   */
  private async onMatchEnd(event: GameEvent): Promise<void> {
    console.log('[Bridge] match:end event received', event.data);

    if (!this.config.autoSettle || !this.currentMatchId || !this.player1) {
      console.log('[Bridge] Auto-settle disabled or no match/player');
      return;
    }

    // Extract final scores from event
    const finalScore1 = (event.data?.finalScore1 as number) || 0;
    const finalScore2 = (event.data?.finalScore2 as number) || 0;

    console.log('[Bridge] Settling match on-chain...');
    console.log(`[Bridge] Scores: ${finalScore1} - ${finalScore2}`);

    // Settle match
    const settleSig = await this.client.settleMatch(this.player1, {
      matchId: this.currentMatchId,
      player1Score: finalScore1,
      player2Score: finalScore2,
    });

    console.log(`[Bridge] Match settled: ${settleSig.slice(0, 16)}...`);

    // Fetch and display final PDAs
    const matchAccount = await this.client.getMatchAccount(this.currentMatchId);
    if (matchAccount) {
      const player1Score = await this.client.getPlayerScore(matchAccount.player1);
      const player2Score = matchAccount.player2 
        ? await this.client.getPlayerScore(matchAccount.player2)
        : null;

      console.log('[Bridge] Final on-chain state:');
      console.log(`  Match state: ${matchAccount.state}`);
      if (player1Score) {
        console.log(`  Player 1: ${player1Score.wins}W ${player1Score.losses}L ${player1Score.draws}D`);
      }
      if (player2Score) {
        console.log(`  Player 2: ${player2Score.wins}W ${player2Score.losses}L ${player2Score.draws}D`);
      }
    }

    this.currentMatchId = null;
  }

  /**
   * Get the current match ID
   */
  getCurrentMatchId(): Buffer | null {
    return this.currentMatchId;
  }

  /**
   * Get the Solana client
   */
  getClient(): TelegraphDuelClient {
    return this.client;
  }
}

/**
 * Example usage with game EventBus:
 * 
 * ```typescript
 * import { eventBus } from './src/bus/EventBus';
 * import { Connection, Keypair } from '@solana/web3.js';
 * import { SolanaEventBridge } from './solana/sdk';
 * 
 * const connection = new Connection('http://127.0.0.1:8899');
 * const player1 = Keypair.generate();
 * const player2 = Keypair.generate();
 * 
 * const bridge = new SolanaEventBridge(connection, player1, player2, {
 *   autoCreateMatch: true,
 *   autoLockMatch: true,
 *   autoSettle: true,
 * });
 * 
 * // Subscribe to all game events
 * eventBus.on('*' as any, (event) => {
 *   bridge.handleGameEvent(event);
 * });
 * 
 * // Now when the game emits match:start and match:end,
 * // the bridge will automatically create/settle on Solana
 * ```
 */
