# Telegraph Duel Architecture

## Overview

Telegraph Duel implements a **thin-slice on-chain match settlement system** for Solana, focusing on identity management, session-based authorization, and score persistence.

## Design Principles

1. **Stake-free v1**: No token requirements for participation
2. **Minimal on-chain footprint**: Only essential state on L1
3. **Session key spend guards**: Match-scoped authorization
4. **End-of-match settlement**: No per-tick L1 overhead
5. **Event-driven**: Ready for game engine integration

## Program Architecture

### Account Structure

#### MatchAccount

PDA seeds: `["match", match_id]`

```rust
pub struct MatchAccount {
    pub match_id: [u8; 32],           // Unique identifier
    pub player1: Pubkey,               // Player 1 wallet
    pub player2: Option<Pubkey>,       // Player 2 wallet
    pub player1_session: Option<Pubkey>, // Player 1 session key
    pub player2_session: Option<Pubkey>, // Player 2 session key
    pub session_expiry: Option<i64>,   // Unix timestamp
    pub state: MatchState,             // WaitingForPlayer | Locked | Settled
    pub created_at: i64,
    pub locked_at: Option<i64>,
    pub settled_at: Option<i64>,
    pub bump: u8,
}
```

**State Transitions**:
- `WaitingForPlayer` → `Locked` (when player 2 joins and either player locks)
- `Locked` → `Settled` (when scores are settled)

#### PlayerScore

PDA seeds: `["score", wallet]`

```rust
pub struct PlayerScore {
    pub player: Pubkey,         // Player wallet
    pub wins: u64,              // Total wins
    pub losses: u64,            // Total losses
    pub draws: u64,             // Total draws
    pub total_score: u64,       // Cumulative score points
    pub matches_played: u64,    // Total matches
    pub bump: u8,
}
```

This account is **created on first settlement** (init_if_needed pattern).

### Instruction Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. create_match                                         │
│    - Player 1 creates match PDA                         │
│    - Optional: Attach session key + expiry              │
│    - State: WaitingForPlayer                            │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 2. join_match                                           │
│    - Player 2 joins                                     │
│    - Optional: Attach session key + expiry              │
│    - State: Still WaitingForPlayer                      │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 3. lock_match                                           │
│    - Either player can lock                             │
│    - State: Locked                                      │
│    - Game starts (off-chain)                            │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 4. [Off-chain gameplay]                                 │
│    - Intents submitted (off-chain or via EventBus)      │
│    - Clashes resolved                                   │
│    - Final scores calculated                            │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 5. settle_match                                         │
│    - Authority: Player or session key                   │
│    - Validates session expiry                           │
│    - Updates PlayerScore PDAs (init if needed)          │
│    - State: Settled                                     │
└─────────────────────────────────────────────────────────┘
```

## Session Key System

### Spend-Guard Pattern

Session keys implement a **match-scoped spend guard**:

1. **Creation**: Client generates an ephemeral keypair
2. **Registration**: Main wallet registers session key on `create_match` or `join_match`
3. **Authorization**: Session key can:
   - Settle the match (within expiry)
   - Sign off-chain intents (future)
4. **Constraints**:
   - Match-scoped (can only act on registered match)
   - Time-limited (expires after `session_expiry`)
   - Minimal balance (just rent + fees)

### Why Session Keys?

- **Hot key pattern**: Keep main wallet cold
- **Reduced friction**: Game can auto-settle without user signature per action
- **Intent signing**: Future off-chain intent verification
- **Revocability**: Expires automatically

### Security Considerations

- Session keys are **not cryptographically bound** to main wallet in this v1
- Trust model: Client software generates and manages session keys
- Future: Add on-chain session delegation (e.g., via signature verification)

## Off-Chain vs On-Chain

### On-Chain

- Match creation/joining/locking
- Final score settlement
- Player statistics (wins/losses/total score)

### Off-Chain (or Stubbed)

- Per-tick intents (e.g., "ATTACK", "DEFEND")
- Clash resolution logic
- Real-time game state
- Intent signature verification (can be done on-chain, but kept off-chain for efficiency)

### EventBus Bridge

The EventBus acts as a **bridge** between on-chain settlement and off-chain gameplay:

```
On-Chain (Solana)  <──>  EventBus  <──>  Game Engine (Sega)
     │                       │                   │
     │ TX: create_match      │                   │
     ├──────────────────────>│                   │
     │                       │ Emit: match.created
     │                       ├──────────────────>│
     │                       │                   │ (Start game)
     │                       │<──────────────────┤
     │                       │ Emit: intent      │
     │                       │                   │
     │                       │ Emit: clash       │
     │                       │                   │
     │                       │<──────────────────┤
     │ TX: settle_match      │                   │ (Game over)
     │<──────────────────────┤                   │
     │                       │ Emit: score.settled
     │                       ├──────────────────>│
```

## Data Flow

### Create + Join Flow

```
Player 1                    Telegraph Duel Program              Player 2
   │                                 │                              │
   │ create_match(match_id, session) │                              │
   ├────────────────────────────────>│                              │
   │                                 │ Init MatchAccount PDA        │
   │                                 │ Set player1, session, state  │
   │<────────────────────────────────┤                              │
   │ TX signature                    │                              │
   │                                 │                              │
   │                                 │   join_match(session)        │
   │                                 │<─────────────────────────────┤
   │                                 │ Set player2, session         │
   │                                 ├─────────────────────────────>│
   │                                 │ TX signature                 │
```

### Settlement Flow

```
Authority                   Telegraph Duel Program
(Player or Session)                │
   │                               │
   │ settle_match(p1_score, p2_score)
   ├──────────────────────────────>│
   │                               │ Verify: state == Locked
   │                               │ Verify: authority is player or session
   │                               │ Verify: session not expired
   │                               │
   │                               │ Init PlayerScore PDAs (if needed)
   │                               │ Update player1_score stats
   │                               │ Update player2_score stats
   │                               │ Set state = Settled
   │<──────────────────────────────┤
   │ TX signature                  │
```

## PDA Derivation

### Match PDA

```typescript
const [matchPDA, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from('match'), matchId], // matchId: 32 bytes
  programId
);
```

### Player Score PDA

```typescript
const [scorePDA, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from('score'), playerPubkey.toBuffer()],
  programId
);
```

## Error Handling

Program errors defined in `errors.rs`:

| Error                    | Code | Description                          |
|--------------------------|------|--------------------------------------|
| `MatchFull`              | 6000 | Player 2 already joined              |
| `MatchLocked`            | 6001 | Match already locked                 |
| `MatchNotLocked`         | 6002 | Match must be locked before settle   |
| `MatchAlreadySettled`    | 6003 | Match already settled                |
| `SessionExpired`         | 6004 | Session key expiry passed            |
| `InvalidSessionSignature`| 6005 | Session signature verification failed|
| `PlayerNotInMatch`       | 6006 | Authority not a player in match      |
| `Unauthorized`           | 6007 | Authority cannot perform action      |

## Performance Considerations

### Transaction Costs

- **create_match**: ~0.001 SOL (rent + fees)
- **join_match**: ~0.0005 SOL (fees)
- **lock_match**: ~0.0005 SOL (fees)
- **settle_match**: ~0.002 SOL (rent for score PDAs + fees)

### Scalability

- **No per-tick L1**: Only start and end of match touch Solana
- **Off-chain intents**: Game logic can run at 60+ FPS off-chain
- **Parallel matches**: Unlimited concurrent matches (no global state)

### Storage

- **MatchAccount**: ~200 bytes
- **PlayerScore**: ~90 bytes
- **Total per match**: ~290 bytes (+ 2x PlayerScore if new players)

## Future Enhancements

### Intent Verification On-Chain

Add a `submit_intent` instruction:

```rust
pub fn submit_intent(
    ctx: Context<SubmitIntent>,
    intent: Intent,
    session_signature: [u8; 64],
) -> Result<()> {
    // Verify session signature
    // Store intent commitment (hash)
    // Emit event
}
```

### Replay Protection

Add nonce or sequence number to intents:

```rust
pub struct MatchAccount {
    // ...
    pub player1_nonce: u64,
    pub player2_nonce: u64,
}
```

### Match Expiry

Add timeout logic:

```rust
pub struct MatchAccount {
    // ...
    pub expiry: Option<i64>,
}

// In settle_match:
if let Some(expiry) = match_account.expiry {
    require!(clock.unix_timestamp < expiry, TelegraphDuelError::MatchExpired);
}
```

### Token Staking

Add stake accounts:

```rust
pub struct MatchAccount {
    // ...
    pub player1_stake: u64,
    pub player2_stake: u64,
    pub winner_takes_all: bool,
}
```

## Integration Points

### Sega Game Engine

The game engine should:

1. **Subscribe** to EventBus events (`match.created`, `match.joined`, `match.locked`)
2. **Emit** intent events during gameplay
3. **Trigger** `settle_match` when game ends

```typescript
import { TelegraphDuelClient } from '@telegraph-duel/sdk';

const client = new TelegraphDuelClient(connection);

client.eventBus.on('match.locked', async (data) => {
  // Start Phaser game scene
  await startGame(data.matchId, data.matchPDA);
});

client.eventBus.on('score.settled', async (data) => {
  // Show end screen
  showEndScreen(data.player1Score, data.player2Score);
});
```

### MagicBlock Integration (Future)

For ephemeral rollups:

1. Create match on L1
2. Lock match
3. **Delegate state to MagicBlock ephemeral rollup**
4. Run game at 1000+ TPS on rollup
5. Settle final state back to L1

### X402 / Pots (Future)

For composability with other game primitives.

---

**Design Status**: ✅ Complete for thin-slice v1

**Next Steps**: Sega integration, EventBus → WebSocket upgrade, intent verification
