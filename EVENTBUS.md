# EventBus Contract

**Stable event API for Telegraph Duel game integration.**

The game emits typed events through `src/bus/EventBus.ts`. External systems (e.g., Solana plumbing) can subscribe to these events without coupling to game internals.

## Usage

```typescript
import { eventBus, GameEvent } from './src/bus/EventBus';

// Subscribe to specific event
eventBus.on('match:start', (event: GameEvent) => {
  console.log('Match started', event.payload);
});

// Subscribe to all events (wildcard)
eventBus.on('*' as any, (event: GameEvent) => {
  console.log(event.type, event.payload);
});
```

## Event Types

All events include `timestamp` (number, ms since epoch).

**Note**: Events use `payload` field (matching Worker WebSocket contract), not `data`.

### Match Lifecycle

#### `match:start`
Emitted when a new match begins (best-of-5).

```typescript
{
  type: 'match:start',
  payload: {
    agent1: string,  // Agent 1 name
    agent2: string   // Agent 2 name
  },
  timestamp: number
}
```

#### `match:end`
Emitted when match completes (one agent reaches 3 points). Uses Worker canonical field names.

```typescript
{
  type: 'match:end',
  payload: {
    winner: string,        // Winning agentId
    finalScoresA: number,  // Seat A final score
    finalScoresB: number,  // Seat B final score
    reason: string         // e.g., 'best_of_5_complete'
  },
  timestamp: number
}
```

### Round Lifecycle

#### `round:start`
Emitted at the beginning of each round.

```typescript
{
  type: 'round:start',
  payload: {
    round: number  // Current round number (1-5)
  },
  timestamp: number
}
```

#### `round:end`
Emitted after clash resolution.

```typescript
{
  type: 'round:end',
  payload: {
    round: number,  // Completed round number
    winner: string  // Round winner name
  },
  timestamp: number
}
```

### Round Actions

#### `agent:windUp`
Emitted when both agents enter wind-up phase (charge phase).

```typescript
{
  type: 'agent:windUp',
  payload: {
    agent1: string,  // Agent 1 name
    agent2: string   // Agent 2 name
  },
  timestamp: number
}
```

#### `agent:feint`
Emitted when an agent performs a feint (fake commit during feint window).

```typescript
{
  type: 'agent:feint',
  payload: {
    agent: string  // Agent name who feinted
  },
  timestamp: number
}
```

#### `agent:commit`
Emitted when an agent commits their attack.

```typescript
{
  type: 'agent:commit',
  payload: {
    agent: string  // Agent name who committed
  },
  timestamp: number
}
```

#### `agent:panic`
Reserved for future use (agent fails to commit in time).

```typescript
{
  type: 'agent:panic',
  payload: {
    agent: string  // Agent name who panicked
  },
  timestamp: number
}
```

### Clash Resolution

#### `clash:resolve`
Emitted when round clash is resolved and winner determined.

```typescript
{
  type: 'clash:resolve',
  payload: {
    winner: string,      // Winning agent name
    loser: string,       // Losing agent name
    winnerScore: number, // Winner's new total score
    loserScore: number   // Loser's total score
  },
  timestamp: number
}
```

## Agent Mood States

Agent mood is updated on the agent state object (not emitted as separate events):

- `"Ready"` - Idle between rounds
- `"Charging..."` - Wind-up phase
- `"Feinting!"` - Performing feint
- `"Committed!"` - Attack committed
- `"Victory!"` - Won the round
- `"Defeated..."` - Lost the round

Access via `agent.state.mood` after retrieving agent reference from the scene.

## Event Ordering Guarantees

Within a single round:

1. `round:start`
2. `agent:windUp`
3. Zero or more `agent:feint` events
4. One or more `agent:commit` events
5. `clash:resolve`
6. `round:end`

Match lifecycle:

1. `match:start`
2. Multiple round sequences (up to 5)
3. `match:end`

## Adding New Events

When extending the game, add new event types to `GameEventType` union in `src/bus/EventBus.ts` and document here with:
- Event name
- When it fires
- Payload shape
- Example

### Settlement

#### `score.settled`
Emitted by Dex bridge after on-chain settlement (following `match:end`). Includes Solana transaction details and score PDAs.

**Source**: Solana bridge (not emitted by Phaser local demo or match-server Worker).

```typescript
{
  type: 'score.settled',
  payload: {
    roomId: string,           // Room identifier
    matchId: string,          // Match identifier (same as roomId in v1)
    winnerAgentId: string,    // Winning agent ID
    winnerSeat: 'A' | 'B',    // Winning seat
    finalScoresA: number,     // Seat A final score
    finalScoresB: number,     // Seat B final score
    agentIdA: string,         // Agent ID in seat A
    agentIdB: string,         // Agent ID in seat B
    walletA: string,          // Wallet pubkey for seat A (base58)
    walletB: string,          // Wallet pubkey for seat B (base58)
    scorePdaA: string,        // Score PDA for seat A (base58)
    scorePdaB: string,        // Score PDA for seat B (base58)
    txSig: string,            // Solana transaction signature
    lastClashReason?: string  // Optional final clash reason
  },
  timestamp: number
}
```

**Field alignment**:
- `match:end` uses `finalScoresA`/`finalScoresB` (Worker canonical names)
- `score.settled` also uses `finalScoresA`/`finalScoresB` (aligned with Worker)

## Solana Settlement Flow

The Dex bridge polls completed rooms from the match-server and settles scores on-chain:

1. **Match completes**: Worker emits `match:end` with `finalScoresA`/`finalScoresB`
2. **Bridge polls**: Dex bridge fetches completed room state via `GET /rooms/:id`
3. **Settlement**: Bridge calls `settleMatch` instruction on Solana program
4. **Event emission**: Bridge emits `score.settled` with transaction signature and PDAs

**Key points**:
- Bridge maps `agentId` → wallet pubkey via environment configuration
- Spectator clients can listen for `score.settled` to display on-chain confirmation
- HUD can show settlement status with room ID, winner, scores, tx signature, and PDAs
- Settlement is asynchronous (may occur seconds after `match:end`)

See [solana/bridge/README.md](./solana/bridge/README.md) for bridge implementation details.

## Notes for Solana Integration

- All agent names are placeholder strings (e.g., "BlitzBot", "ShieldWall")
- Wallets are NOT included in Worker events (only in `score.settled` from bridge)
- Dex bridge maps `agentId` → wallet via config/env
- Event timing reflects client-side game simulation only
- Settlement happens asynchronously after match completion
