/**
 * Typed EventBus for Telegraph Duel game events.
 * 
 * Stable contract for external integrations (e.g., Solana plumbing).
 * See EVENTBUS.md for complete documentation and payload shapes.
 */

/** Canvas / atlas pose names. Graphics fallback uses the same set. */
export type AgentPose =
  | 'idle'
  | 'windUp'
  | 'feint'
  | 'commit'
  | 'clash'
  | 'panic'
  | 'win';

export type SpectatorStatus = 'connecting' | 'live' | 'reconnecting' | 'lost';

export type GameEventType =
  | 'match:start'       // Match begins
  | 'round:start'       // Round begins
  | 'round:extend'      // Round window extended
  | 'agent:windUp'      // Both agents charging
  | 'agent:feint'       // Agent performs feint
  | 'agent:commit'      // Agent commits attack
  | 'agent:panic'       // Agent fails to commit (reserved)
  | 'clash:resolve'     // Round winner determined
  | 'round:end'         // Round completes
  | 'match:end'         // Match completes
  | 'score.settled'     // Dex score settlement on-chain
  | 'room:snapshot'     // Watch-connect catch-up (late spectators)
  | 'spectator:status'; // RoomClient WS connection truth

export interface GameEvent {
  type: GameEventType;
  payload?: Record<string, unknown>;
  timestamp: number;
}

type EventCallback = (event: GameEvent) => void;

export class EventBus {
  private listeners: Map<GameEventType, Set<EventCallback>> = new Map();

  on(type: GameEventType, callback: EventCallback): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);
  }

  off(type: GameEventType, callback: EventCallback): void {
    const callbacks = this.listeners.get(type);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  emit(type: GameEventType, payload?: unknown): void {
    const event: GameEvent = {
      type,
      payload: payload as Record<string, unknown> | undefined,
      timestamp: Date.now(),
    };

    const callbacks = this.listeners.get(type);
    if (callbacks) {
      callbacks.forEach((cb) => cb(event));
    }

    // Emit to wildcard listeners
    const allCallbacks = this.listeners.get('*' as GameEventType);
    if (allCallbacks) {
      allCallbacks.forEach((cb) => cb(event));
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const eventBus = new EventBus();
