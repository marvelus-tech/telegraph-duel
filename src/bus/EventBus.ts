/**
 * Typed EventBus for Telegraph Duel game events.
 * 
 * Stable contract for external integrations (e.g., Solana plumbing).
 * See EVENTBUS.md for complete documentation and payload shapes.
 */

export type GameEventType =
  | 'match:start'    // Match begins
  | 'round:start'    // Round begins
  | 'round:extend'   // Round window extended
  | 'agent:windUp'   // Both agents charging
  | 'agent:feint'    // Agent performs feint
  | 'agent:commit'   // Agent commits attack
  | 'agent:panic'    // Agent fails to commit (reserved)
  | 'clash:resolve'  // Round winner determined
  | 'round:end'      // Round completes
  | 'match:end'      // Match completes
  | 'score.settled'; // Dex score settlement on-chain

export interface GameEvent {
  type: GameEventType;
  data?: Record<string, unknown>;
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

  emit(type: GameEventType, data?: Record<string, unknown>): void {
    const event: GameEvent = {
      type,
      data,
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
