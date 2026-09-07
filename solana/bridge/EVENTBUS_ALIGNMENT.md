# EVENTBUS.md Alignment

This document explains how the bridge's `score.settled` event relates to the game's `match:end` event defined in `EVENTBUS.md`.

## Event Sources

### 1. Game EventBus (`match:end`)

**Source:** `src/bus/EventBus.ts` (Phaser game)

**Schema:**
```typescript
{
  type: 'match:end',
  data: {
    winner: string,      // Winning agent name (e.g., "BlitzBot")
    finalScore1: number, // Agent 1 final score
    finalScore2: number  // Agent 2 final score
  },
  timestamp: number
}
```

**Usage:** Emitted by the local Phaser game when a match completes.

### 2. Match-Server Room State

**Source:** Match-server API (`GET /rooms/:id`)

**Schema:**
```typescript
{
  roomId: string,
  status: 'completed',
  seats: {
    A: { agentId: string },
    B: { agentId: string }
  },
  scores: {
    A: number,
    B: number
  },
  lastClash?: {
    reason: string,
    // ...
  }
}
```

**Usage:** Fetched by the bridge from Workers API when settling.

### 3. Bridge `score.settled` Event

**Source:** `solana/bridge/src/bridge.ts`

**Schema:**
```typescript
{
  type: 'score.settled',
  data: {
    matchId: string,
    roomId: string,
    scores: {
      A: number,
      B: number
    },
    agentIds: {
      A: string,
      B: string
    },
    lastClash?: {
      reason: string
    },
    txSignature: string,
    scorePDAs: {
      A: string,
      B: string
    }
  },
  timestamp: number
}
```

**Usage:** Emitted after successful on-chain settlement.

## Key Differences

### Agent Numbering vs. Seat Letters

- **EVENTBUS.md `match:end`**: Uses `finalScore1` / `finalScore2` (numbered agents)
- **Bridge `score.settled`**: Uses `scores.A` / `scores.B` (seat letters)

**Reason:** The bridge connects to the **match-server** (Cloudflare Workers), which uses seat letters (A/B) for its room model. This is different from the local Phaser game's EventBus.

### Winner Name vs. Scores

- **EVENTBUS.md `match:end`**: Includes `winner` (agent name)
- **Bridge `score.settled`**: Includes both scores (winner derivable)

**Reason:** The bridge focuses on score persistence. The winner can be derived from `scores.A` vs `scores.B`.

### Additional Fields

- **Bridge `score.settled`** includes:
  - `lastClash.reason` (from match-server)
  - `txSignature` (Solana transaction)
  - `scorePDAs` (on-chain addresses)

**Reason:** These are settlement-specific details not present in the game's `match:end` event.

## Integration Paths

### Path 1: Game EventBus → Solana (Local Game)

If integrating from the local Phaser game:

```typescript
import { eventBus } from './src/bus/EventBus';
import { SolanaEventBridge } from './solana/sdk';

// Use the existing SDK bridge
const bridge = new SolanaEventBridge(connection, player1, player2);
eventBus.on('*' as any, (event) => {
  bridge.handleGameEvent(event);
});
```

This uses `solana/sdk/src/bridge.ts` which subscribes to the game's EventBus.

### Path 2: Match-Server → Solana (Remote Matches)

If integrating from the match-server:

```typescript
import { MatchServerBridge } from './solana/bridge';

// Use the new match-server bridge
const bridge = new MatchServerBridge(config);
bridge.on('score.settled', (event) => {
  console.log('Settlement complete:', event);
});

// Poll completed rooms
bridge.startPolling(['rm_abc123']);
```

This uses `solana/bridge/src/bridge.ts` which polls the Workers API.

## Alignment Summary

✅ **Aligned:**
- Both represent match completion
- Both include final scores
- Both use timestamp

⚠️ **Different:**
- Event type name: `match:end` vs `score.settled`
- Agent identification: numbered (1/2) vs seated (A/B)
- Winner field: explicit vs derivable

🆕 **Extended:**
- `score.settled` adds Solana-specific fields (tx, PDAs)
- `score.settled` includes match-server-specific data (lastClash)

## Recommendation

The bridge's `score.settled` event is **compatible but distinct** from the game's `match:end` event:

- It serves a **different purpose**: Solana settlement notification
- It bridges a **different source**: Match-server API (not game EventBus)
- It provides **additional context**: On-chain transaction details

If you need to unify these events, consider:

1. **Subscribe to both**: Listen to `match:end` from game AND `score.settled` from bridge
2. **Transform events**: Map `score.settled` to `match:end` format if needed
3. **Use appropriate bridge**: Game → SDK bridge, Match-server → this bridge

## Notes for Sega Integration

If the match-server needs to emit additional fields for settlement (beyond what's in `GET /rooms/:id`), please specify:

- What fields are needed?
- Should they be added to the room state?
- Or emitted as separate events?

Current implementation uses only the standard room state fields documented in `SEATS.md`.
