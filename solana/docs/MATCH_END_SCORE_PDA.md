# Match End → Score PDA Settlement

**Integration guide for Sega game engine to trigger on-chain settlement**

This document describes the wire from `match:end` EventBus event to `settleMatch` on-chain instruction.

## Overview

When the Telegraph Duel game completes (one agent reaches 3 points in best-of-5), the game emits a `match:end` event. The Solana integration listens to this event and settles final scores on-chain.

```
Game Engine              EventBus               Solana Bridge              On-Chain
(src/game/)         (src/bus/EventBus.ts)    (solana/sdk/bridge.ts)   (solana/programs/)
     │                       │                        │                      │
     │ emit match:end        │                        │                      │
     ├──────────────────────>│                        │                      │
     │                       │ deliver event          │                      │
     │                       ├───────────────────────>│                      │
     │                       │                        │ settleMatch TX       │
     │                       │                        ├─────────────────────>│
     │                       │                        │                      │ Update PDAs
     │                       │                        │<─────────────────────┤
     │                       │                        │ Confirmed            │
     │                       │                        │                      │
```

## EventBus Contract

### Input: `match:end` Event

From `EVENTBUS.md`:

```typescript
{
  type: 'match:end',
  data: {
    winner: string,      // Winning agent name
    finalScore1: number, // Agent 1 final score (e.g., 3)
    finalScore2: number  // Agent 2 final score (e.g., 2)
  },
  timestamp: number      // Unix ms
}
```

**Example**:

```typescript
eventBus.emit('match:end', {
  winner: 'BlitzBot',
  finalScore1: 3,
  finalScore2: 2,
});
```

## Solana Settlement

### Instruction: `settleMatch`

**Program**: `telegraph_duel` (localnet: `HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM`)

**Parameters**:
- `match_id: [u8; 32]` - Match identifier
- `player1_score: u64` - Player 1 final score
- `player2_score: u64` - Player 2 final score

**Accounts**:
- `match_account` - Match PDA (must be in Locked state)
- `player1_score` - Player 1 score PDA (init if needed)
- `player2_score` - Player 2 score PDA (init if needed)
- `authority` - Signer (player1, player2, or session key)
- `system_program` - System program

**Effects**:
1. Validates match state is `Locked`
2. Verifies authority is player or valid session key
3. Updates `PlayerScore` PDAs:
   - Increments wins/losses/draws
   - Adds `player1_score` and `player2_score` to `total_score`
   - Increments `matches_played`
4. Sets match state to `Settled`

## Integration Steps

### 1. Subscribe to EventBus

In your game setup (e.g., `src/main.ts`):

```typescript
import { eventBus } from './src/bus/EventBus';
import { Connection, Keypair } from '@solana/web3.js';
import { SolanaEventBridge } from './solana/sdk';

// Set up Solana connection
const connection = new Connection('http://127.0.0.1:8899');

// Load player keypairs (or generate for testing)
const player1 = Keypair.generate();
const player2 = Keypair.generate();

// Create bridge with auto-settlement enabled
const bridge = new SolanaEventBridge(connection, player1, player2, {
  autoCreateMatch: true,
  autoLockMatch: true,
  autoSettle: true,  // ← Enable auto-settlement on match:end
});

// Subscribe to all game events
eventBus.on('*' as any, (event) => {
  bridge.handleGameEvent(event);
});
```

### 2. Emit `match:end` from Game

When the match completes in `DuelScene.ts`:

```typescript
// After determining winner
if (this.agent1Score >= 3 || this.agent2Score >= 3) {
  const winner = this.agent1Score >= 3 ? 'Agent 1' : 'Agent 2';
  
  // Emit match:end event
  eventBus.emit('match:end', {
    winner,
    finalScore1: this.agent1Score,
    finalScore2: this.agent2Score,
  });
  
  // Bridge will automatically call settleMatch on-chain
}
```

### 3. Bridge Handles Settlement

The `SolanaEventBridge` listens for `match:end` and automatically:

```typescript
private async onMatchEnd(event: GameEvent): Promise<void> {
  const finalScore1 = (event.data?.finalScore1 as number) || 0;
  const finalScore2 = (event.data?.finalScore2 as number) || 0;

  // Settle match on Solana
  const signature = await this.client.settleMatch(this.player1, {
    matchId: this.currentMatchId,
    player1Score: finalScore1,
    player2Score: finalScore2,
  });

  console.log('Match settled on-chain:', signature);
}
```

## Manual Settlement (Without Bridge)

If you want to settle manually without the bridge:

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { TelegraphDuelClient, generateMatchId } from './solana/sdk';

const connection = new Connection('http://127.0.0.1:8899');
const client = new TelegraphDuelClient(connection);

// After match:end event
eventBus.on('match:end', async (event) => {
  const matchId = generateMatchId('current-match-id');
  
  await client.settleMatch(player1, {
    matchId,
    player1Score: event.data.finalScore1,
    player2Score: event.data.finalScore2,
  });
  
  console.log('Scores settled on-chain');
});
```

## On-Chain Result

After settlement, two PDAs are updated:

### Player 1 Score PDA

Seeds: `["score", player1_pubkey]`

```rust
pub struct PlayerScore {
    pub player: Pubkey,
    pub wins: u64,           // Incremented if player1_score > player2_score
    pub losses: u64,         // Incremented if player1_score < player2_score
    pub draws: u64,          // Incremented if player1_score == player2_score
    pub total_score: u64,    // += player1_score
    pub matches_played: u64, // += 1
    pub bump: u8,
}
```

### Player 2 Score PDA

Seeds: `["score", player2_pubkey]`

```rust
pub struct PlayerScore {
    pub player: Pubkey,
    pub wins: u64,           // Incremented if player2_score > player1_score
    pub losses: u64,         // Incremented if player2_score < player1_score
    pub draws: u64,          // Incremented if player2_score == player1_score
    pub total_score: u64,    // += player2_score
    pub matches_played: u64, // += 1
    pub bump: u8,
}
```

## Fetching Scores

After settlement, fetch updated scores:

```typescript
const player1Score = await client.getPlayerScore(player1.publicKey);
console.log(`Player 1: ${player1Score.wins}W ${player1Score.losses}L ${player1Score.draws}D`);
console.log(`Total: ${player1Score.total_score} points in ${player1Score.matches_played} matches`);
```

## Error Handling

### Common Errors

1. **Match not locked**: Settlement requires match state = `Locked`
   - Solution: Ensure `lockMatch` was called before `settleMatch`

2. **Session expired**: Session key has passed expiry timestamp
   - Solution: Use main wallet or create new session key

3. **Unauthorized**: Authority is not a player or valid session key
   - Solution: Use player1, player2, or their session keys

4. **Already settled**: Match has already been settled
   - Solution: Each match can only be settled once

### Example Error Handling

```typescript
try {
  await client.settleMatch(player1, {
    matchId,
    player1Score: 3,
    player2Score: 2,
  });
} catch (error) {
  if (error.message.includes('MatchNotLocked')) {
    console.error('Match must be locked before settling');
  } else if (error.message.includes('SessionExpired')) {
    console.error('Session key expired, use main wallet');
  } else {
    console.error('Settlement failed:', error);
  }
}
```

## Testing

### Localnet Test

```bash
# Start validator
cd solana && ./scripts/start-validator.sh

# Deploy program
cd solana && anchor build --no-idl && anchor deploy

# Run two-player demo (shows full flow)
cd solana && node scripts/demo.js
```

### Expected Flow

1. Game emits `match:start` → `createMatch` + `lockMatch` on-chain
2. Game plays rounds (off-chain)
3. Game emits `match:end` → `settleMatch` on-chain
4. Both score PDAs updated with wins/losses/total_score

## Event Ordering

From `EVENTBUS.md`, the complete match lifecycle:

1. `match:start` → Solana: create + lock match
2. `round:start` → off-chain only
3. `agent:windUp` → off-chain only
4. `agent:commit` → off-chain only
5. `clash:resolve` → off-chain only
6. `round:end` → off-chain only
7. (repeat rounds 2-6 until winner)
8. `match:end` → **Solana: settle scores** ← This document

**Only match:start and match:end touch L1.**

## Summary

**For Sega integration**:

1. ✅ Subscribe `SolanaEventBridge` to game EventBus
2. ✅ Enable `autoSettle: true` in bridge config
3. ✅ Emit `match:end` event with `finalScore1`, `finalScore2`
4. ✅ Bridge automatically settles on-chain
5. ✅ Fetch updated score PDAs to display results

**Wire path**: `match:end` event → `SolanaEventBridge.handleGameEvent()` → `settleMatch` instruction → Score PDAs updated

See `solana/sdk/src/bridge.ts` for full implementation.
