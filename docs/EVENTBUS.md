# EventBus Specification

## Overview

The EventBus provides a **publish-subscribe interface** for Telegraph Duel events. This allows game engines (like Sega) to subscribe to match lifecycle events, intents, and score settlements.

## Event Schema

All events include a `timestamp` field (Unix milliseconds).

### 1. `match.created`

**Trigger**: When a player creates a new match via `create_match` instruction.

**Payload**:

```typescript
{
  eventType: 'match.created',
  data: {
    matchId: string;        // Hex-encoded match ID
    player1: string;        // Base58 player 1 pubkey
    matchPDA: string;       // Base58 match PDA
    signature: string;      // Transaction signature
    timestamp: number;      // Unix ms
  }
}
```

**Example**:

```json
{
  "eventType": "match.created",
  "data": {
    "matchId": "a3f9c8b2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
    "player1": "5Q7pXm9kABcDeFgHiJkLmNoPqRsTuVwXyZ",
    "matchPDA": "Du3LCxxx1111111111111111111111111111111111",
    "signature": "5x8k9m2n3p4q5r6s7t8u9v0w1x2y3z4a5b6c7d8e9f0",
    "timestamp": 1725676422000
  }
}
```

### 2. `match.joined`

**Trigger**: When player 2 joins a match via `join_match` instruction.

**Payload**:

```typescript
{
  eventType: 'match.joined',
  data: {
    matchId: string;
    player2: string;
    matchPDA: string;
    signature: string;
    timestamp: number;
  }
}
```

### 3. `match.locked`

**Trigger**: When the match is locked via `lock_match` instruction (game starts).

**Payload**:

```typescript
{
  eventType: 'match.locked',
  data: {
    matchId: string;
    matchPDA: string;
    signature: string;
    timestamp: number;
  }
}
```

### 4. `intent`

**Trigger**: When a player submits an intent (off-chain or via future `submit_intent` instruction).

**Payload**:

```typescript
{
  eventType: 'intent',
  data: {
    matchId: string;
    player: string;         // Base58 pubkey (or session key)
    intent: string;         // e.g., "ATTACK", "DEFEND", "SPECIAL"
    tick: number;           // Game tick number
    sessionSignature?: string; // Optional: Signature from session key
    timestamp: number;
  }
}
```

**Example**:

```json
{
  "eventType": "intent",
  "data": {
    "matchId": "a3f9c8b2d1e4f5...",
    "player": "5Q7pXm9kABcDeFgHiJkLmNoPqRsTuVwXyZ",
    "intent": "ATTACK",
    "tick": 42,
    "timestamp": 1725676430000
  }
}
```

### 5. `clash`

**Trigger**: When intents clash (game logic determines winner).

**Payload**:

```typescript
{
  eventType: 'clash',
  data: {
    matchId: string;
    tick: number;
    player1Intent: string;
    player2Intent: string;
    winner?: string;        // Base58 pubkey of winner (or null for draw)
    timestamp: number;
  }
}
```

**Example**:

```json
{
  "eventType": "clash",
  "data": {
    "matchId": "a3f9c8b2d1e4f5...",
    "tick": 42,
    "player1Intent": "ATTACK",
    "player2Intent": "DEFEND",
    "winner": "8Bm3Ry4jWxYzAb",
    "timestamp": 1725676431000
  }
}
```

### 6. `score.settled`

**Trigger**: When the match is settled via `settle_match` instruction.

**Payload**:

```typescript
{
  eventType: 'score.settled',
  data: {
    matchId: string;
    player1Score: number;
    player2Score: number;
    matchPDA: string;
    signature: string;
    timestamp: number;
  }
}
```

## Usage

### Subscribing to Events

```typescript
import { TelegraphDuelClient } from '@telegraph-duel/sdk';
import { Connection } from '@solana/web3.js';

const connection = new Connection('http://127.0.0.1:8899');
const client = new TelegraphDuelClient(connection);

// Subscribe to all events
client.eventBus.on('*', (event) => {
  console.log(`Event: ${event.eventType}`, event.data);
});

// Subscribe to specific event
client.eventBus.on('match.created', (data) => {
  console.log('New match created:', data.matchId);
  // Start matchmaking UI, etc.
});

client.eventBus.on('match.locked', (data) => {
  console.log('Game starting:', data.matchId);
  // Launch Phaser scene
});

client.eventBus.on('score.settled', (data) => {
  console.log('Game over:', data.player1Score, data.player2Score);
  // Show end screen
});
```

### Emitting Custom Events

The EventBus can also be used for off-chain events:

```typescript
// Emit intent (off-chain)
client.eventBus.emit('intent', {
  matchId: '...',
  player: playerPubkey.toBase58(),
  intent: 'ATTACK',
  tick: 42,
  timestamp: Date.now(),
});

// Emit clash (off-chain game logic)
client.eventBus.emit('clash', {
  matchId: '...',
  tick: 42,
  player1Intent: 'ATTACK',
  player2Intent: 'DEFEND',
  winner: player2Pubkey.toBase58(),
  timestamp: Date.now(),
});
```

## Implementation

### Current: EventEmitter (In-Process)

The EventBus currently uses Node's `EventEmitter` for **in-process pub/sub**.

**Limitations**:
- Events are local to the process
- No persistence
- No cross-process/network communication

**Suitable for**:
- Single-server architecture
- Development/testing
- MVP

### Future: WebSocket (Distributed)

For production, upgrade to WebSocket-based EventBus:

```typescript
import { WebSocketEventBus } from '@telegraph-duel/sdk';

const eventBus = new WebSocketEventBus('wss://api.telegraph-duel.com/events');
await eventBus.connect();

eventBus.on('match.created', (data) => {
  // Multiple clients (game servers, spectators) receive this
});
```

**Benefits**:
- Distributed pub/sub
- Multiple subscribers (game servers, spectators, analytics)
- Persistence/replay
- Horizontal scaling

**Implementation Options**:
- [Ably](https://ably.com/)
- [Pusher](https://pusher.com/)
- [Socket.io](https://socket.io/)
- [GraphQL Subscriptions](https://www.apollographql.com/docs/react/data/subscriptions/)
- Custom WebSocket server

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Game Clients                         │
│             (Sega Phaser, Spectators, ...)              │
└────────────────────┬────────────────────────────────────┘
                     │ WebSocket / SSE
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  EventBus Server                        │
│   - WebSocket server (Socket.io / ws)                   │
│   - Redis pub/sub for horizontal scaling                │
│   - Event persistence (PostgreSQL / DynamoDB)           │
└────────────────────┬────────────────────────────────────┘
                     │ Poll / WebSocket
                     ▼
┌─────────────────────────────────────────────────────────┐
│               Solana Transaction Listener               │
│   - Listen to Telegraph Duel program logs               │
│   - Parse events from transactions                      │
│   - Publish to EventBus                                 │
└─────────────────────────────────────────────────────────┘
```

## Event Sourcing Pattern

The EventBus can be extended to support **event sourcing**:

1. **Store all events**: Persist to a database
2. **Replay**: Reconstruct state from events
3. **Time travel**: Query state at any point in time
4. **Analytics**: Run queries on event stream

**Example**:

```sql
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  match_id VARCHAR(64),
  player VARCHAR(44),
  data JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  signature VARCHAR(88)
);

CREATE INDEX idx_events_match_id ON events(match_id);
CREATE INDEX idx_events_player ON events(player);
CREATE INDEX idx_events_timestamp ON events(timestamp);
```

Query:
```sql
-- Get all events for a match
SELECT * FROM events WHERE match_id = 'a3f9c8b2d1e4f5...' ORDER BY timestamp;

-- Get player stats
SELECT
  player,
  COUNT(*) FILTER (WHERE event_type = 'score.settled') AS matches,
  SUM((data->>'player1Score')::int) AS total_score
FROM events
WHERE event_type = 'score.settled'
GROUP BY player;
```

## Sega Integration Example

```typescript
import Phaser from 'phaser';
import { TelegraphDuelClient } from '@telegraph-duel/sdk';

class TelegraphDuelScene extends Phaser.Scene {
  private client: TelegraphDuelClient;
  private matchId: string;

  constructor() {
    super('TelegraphDuelScene');
    this.client = new TelegraphDuelClient(connection);
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.client.eventBus.on('match.locked', (data) => {
      this.matchId = data.matchId;
      this.startGame();
    });

    this.client.eventBus.on('intent', (data) => {
      if (data.matchId === this.matchId) {
        this.handleIntent(data);
      }
    });

    this.client.eventBus.on('score.settled', (data) => {
      if (data.matchId === this.matchId) {
        this.endGame(data.player1Score, data.player2Score);
      }
    });
  }

  startGame() {
    // Initialize game scene
    console.log('Game starting!');
  }

  handleIntent(data) {
    // Apply intent to game state
    if (data.intent === 'ATTACK') {
      // Trigger attack animation
    }
  }

  endGame(p1Score: number, p2Score: number) {
    // Show end screen
    console.log(`Game over! ${p1Score} - ${p2Score}`);
  }
}
```

## Testing

### Unit Test

```typescript
import { EventBus } from '@telegraph-duel/sdk';
import { expect } from 'chai';

describe('EventBus', () => {
  it('should emit and receive events', (done) => {
    const bus = new EventBus();

    bus.on('match.created', (data) => {
      expect(data.matchId).to.equal('test-123');
      done();
    });

    bus.emit('match.created', {
      matchId: 'test-123',
      player1: '5Q7p...',
      matchPDA: 'Du3L...',
      signature: '5x8k...',
      timestamp: Date.now(),
    });
  });
});
```

### Integration Test

```typescript
import { TelegraphDuelClient } from '@telegraph-duel/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('http://127.0.0.1:8899');
const client = new TelegraphDuelClient(connection);

const events: string[] = [];

client.eventBus.on('*', (event) => {
  events.push(event.eventType);
});

// Create match
await client.createMatch(player1, { matchId });
// Join match
await client.joinMatch(player2, { matchId });
// Lock match
await client.lockMatch(player1, matchId);
// Settle match
await client.settleMatch(player1, { matchId, player1Score: 100, player2Score: 85 });

// Assert event order
expect(events).to.deep.equal([
  'match.created',
  'match.joined',
  'match.locked',
  'score.settled',
]);
```

---

**Status**: ✅ EventEmitter stub complete, ready for WebSocket upgrade

**Next Steps**: Implement WebSocket server, event persistence, Sega subscription
