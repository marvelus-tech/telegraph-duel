import { EventEmitter } from 'events';

/**
 * EventBus for Telegraph Duel
 * Emits events for match lifecycle, intents, clashes, and score settlements
 * 
 * Event Types:
 * - match.created: New match created
 * - match.joined: Player 2 joined
 * - match.locked: Match locked, game started
 * - intent: Player intent submitted (off-chain, can be mirrored here)
 * - clash: Intent clash detected
 * - score.settled: Final scores written to PDAs
 */
export type EventType =
  | 'match.created'
  | 'match.joined'
  | 'match.locked'
  | 'intent'
  | 'clash'
  | 'score.settled';

export interface MatchCreatedEvent {
  matchId: string;
  player1: string;
  matchPDA: string;
  signature: string;
  timestamp?: number;
}

export interface MatchJoinedEvent {
  matchId: string;
  player2: string;
  matchPDA: string;
  signature: string;
  timestamp?: number;
}

export interface MatchLockedEvent {
  matchId: string;
  matchPDA: string;
  signature: string;
  timestamp?: number;
}

export interface IntentEvent {
  matchId: string;
  player: string;
  intent: string;
  tick: number;
  sessionSignature?: string;
  timestamp?: number;
}

export interface ClashEvent {
  matchId: string;
  tick: number;
  player1Intent: string;
  player2Intent: string;
  winner?: string;
  timestamp?: number;
}

export interface ScoreSettledEvent {
  matchId: string;
  player1Score: number;
  player2Score: number;
  matchPDA: string;
  signature: string;
  timestamp?: number;
}

export type EventData =
  | MatchCreatedEvent
  | MatchJoinedEvent
  | MatchLockedEvent
  | IntentEvent
  | ClashEvent
  | ScoreSettledEvent;

/**
 * Simple EventBus implementation using Node's EventEmitter
 * For production, consider upgrading to WebSocket-based pub/sub
 */
export class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100); // Adjust based on expected subscribers
  }

  /**
   * Emit an event to all subscribers
   */
  emit(eventType: EventType, data: EventData): void {
    const eventWithTimestamp = {
      ...data,
      timestamp: data.timestamp || Date.now(),
    };

    this.emitter.emit(eventType, eventWithTimestamp);
    this.emitter.emit('*', { eventType, data: eventWithTimestamp });
  }

  /**
   * Subscribe to a specific event type
   */
  on(eventType: EventType | '*', callback: (data: any) => void): void {
    this.emitter.on(eventType, callback);
  }

  /**
   * Subscribe once to an event
   */
  once(eventType: EventType | '*', callback: (data: any) => void): void {
    this.emitter.once(eventType, callback);
  }

  /**
   * Unsubscribe from an event
   */
  off(eventType: EventType | '*', callback: (data: any) => void): void {
    this.emitter.off(eventType, callback);
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(eventType?: EventType | '*'): void {
    this.emitter.removeAllListeners(eventType);
  }

  /**
   * Get listener count for an event
   */
  listenerCount(eventType: EventType | '*'): number {
    return this.emitter.listenerCount(eventType);
  }
}

/**
 * Example WebSocket stub for future Sega integration
 * This would replace EventEmitter with a proper pub/sub system
 */
export class WebSocketEventBus extends EventBus {
  private wsUrl?: string;
  private ws?: WebSocket;

  constructor(wsUrl?: string) {
    super();
    this.wsUrl = wsUrl;
  }

  /**
   * Connect to WebSocket server
   * Stub implementation - to be completed when integrating with Sega
   */
  async connect(): Promise<void> {
    if (!this.wsUrl) {
      console.warn('WebSocket URL not provided, using local EventEmitter only');
      return;
    }

    // Future WebSocket connection logic
    console.log('WebSocket connection stub - not yet implemented');
    console.log('Would connect to:', this.wsUrl);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }
}
