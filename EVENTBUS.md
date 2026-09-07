# EventBus Contract

**Stable event API for Telegraph Duel game integration.**

The game emits typed events through `src/bus/EventBus.ts`. External systems (e.g., Solana plumbing) can subscribe to these events without coupling to game internals.

## Usage

```typescript
import { eventBus, GameEvent } from './src/bus/EventBus';

// Subscribe to specific event
eventBus.on('match:start', (event: GameEvent) => {
  console.log('Match started', event.data);
});

// Subscribe to all events (wildcard)
eventBus.on('*' as any, (event: GameEvent) => {
  console.log(event.type, event.data);
});
```

## Event Types

All events include `timestamp` (number, ms since epoch).

### Match Lifecycle

#### `match:start`
Emitted when a new match begins (best-of-5).

```typescript
{
  type: 'match:start',
  data: {
    agent1: string,  // Agent 1 name
    agent2: string   // Agent 2 name
  },
  timestamp: number
}
```

#### `match:end`
Emitted when match completes (one agent reaches 3 points).

```typescript
{
  type: 'match:end',
  data: {
    winner: string,      // Winning agent name
    finalScore1: number, // Agent 1 final score
    finalScore2: number  // Agent 2 final score
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
  data: {
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
  data: {
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
  data: {
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
  data: {
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
  data: {
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
  data: {
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
  data: {
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

## Notes for Solana Integration

- All agent names are placeholder strings (e.g., "BlitzBot", "ShieldWall")
- No wallet addresses or on-chain state in current spike
- Dex can map event data to Solana transactions/state as needed
- Event timing reflects client-side game simulation only
