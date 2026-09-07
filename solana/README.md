# Telegraph Duel - Solana Integration

**On-chain settlement for Telegraph Duel matches**

This directory contains the Solana plumbing for Telegraph Duel, bridging the Phaser game (in `../src/`) to on-chain match settlement.

## Architecture

```
Game (src/)                    Solana (solana/)
    │                               │
    ├─ EventBus                     ├─ Anchor Program
    │  (EVENTBUS.md contract)       │  - Match PDA
    │                               │  - Score PDA
    │  Events:                      │  - Session keys
    │  - match:start   ─────────►   │
    │  - match:end     ─────────►   │  Instructions:
    │  - round:*       (off-chain)  │  - create_match
    │  - agent:*       (off-chain)  │  - join_match
    │  - clash:*       (off-chain)  │  - lock_match
    │                               │  - settle_match
    └─────────────────────────────► │
                                    │
                                    └─ TypeScript SDK
                                       - SolanaEventBridge
                                       - TelegraphDuelClient
```

## Integration with EVENTBUS.md

This implementation **aligns with** the existing `EVENTBUS.md` contract at the repository root:

### Game Events → Solana Actions

| Game Event      | Solana Action                  | Notes                        |
|-----------------|--------------------------------|------------------------------|
| `match:start`   | `createMatch` + `lockMatch`    | Creates match PDA on-chain   |
| `match:end`     | `settleMatch`                  | Writes final scores to PDAs  |
| `round:start`   | (off-chain)                    | No L1 transaction            |
| `round:end`     | (off-chain)                    | No L1 transaction            |
| `agent:windUp`  | (off-chain)                    | No L1 transaction            |
| `agent:feint`   | (off-chain)                    | No L1 transaction            |
| `agent:commit`  | (off-chain)                    | No L1 transaction            |
| `agent:panic`   | (off-chain)                    | No L1 transaction            |
| `clash:resolve` | (off-chain)                    | No L1 transaction            |

**Design Principle**: Only match start/end touch L1. All per-round/per-tick events stay off-chain for performance.

## Directory Structure

```
solana/
├── Anchor.toml               # Anchor workspace config
├── Cargo.toml                # Rust workspace
├── programs/
│   └── telegraph-duel/       # Anchor program
│       ├── src/
│       │   ├── lib.rs        # Program entry point
│       │   ├── instructions/ # create_match, join_match, lock_match, settle_match
│       │   ├── state/        # MatchAccount, PlayerScore PDAs
│       │   └── errors.rs     # Error definitions
│       └── Cargo.toml
├── sdk/
│   └── src/
│       ├── client.ts         # TelegraphDuelClient (Solana operations)
│       ├── bridge.ts         # SolanaEventBridge (game → Solana)
│       ├── types.ts          # TypeScript types (aligned with EVENTBUS.md)
│       └── utils.ts          # Helper functions
├── scripts/
│   ├── start-validator.sh    # Start local Solana validator
│   ├── deploy-local.sh       # Deploy to localnet
│   └── setup-devnet.sh       # Deploy to devnet
└── README.md                 # This file
```

## On-Chain State

### MatchAccount PDA

Seeds: `["match", match_id]`

```rust
pub struct MatchAccount {
    pub match_id: [u8; 32],
    pub player1: Pubkey,
    pub player2: Option<Pubkey>,
    pub player1_session: Option<Pubkey>,
    pub player2_session: Option<Pubkey>,
    pub session_expiry: Option<i64>,
    pub state: MatchState,  // WaitingForPlayer | Locked | Settled
    pub created_at: i64,
    pub locked_at: Option<i64>,
    pub settled_at: Option<i64>,
    pub bump: u8,
}
```

### PlayerScore PDA

Seeds: `["score", wallet]`

```rust
pub struct PlayerScore {
    pub player: Pubkey,
    pub wins: u64,
    pub losses: u64,
    pub draws: u64,
    pub total_score: u64,
    pub matches_played: u64,
    pub bump: u8,
}
```

## Testing Gate: Two Distinct Identities Required

⚠️ **IMPORTANT**: All testing and demos **must use two distinct wallet/session keypairs**.

This implementation requires:
- ✅ **Two separate player wallets** (player1, player2)
- ✅ **Two separate session keys** (one per player)
- ✅ **Both players join one match** before settlement

**Why**: This validates the core match flow (create → join → lock → settle) and ensures session-scoped authorization works correctly for both participants.

**Demo requirement**: Any demo script must:
1. Generate two distinct keypairs (player1, player2)
2. Create match with player1
3. Join match with player2
4. Lock match (either player)
5. Settle with final scores (either player or session key)

See "Usage Examples" below for implementation.

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) 1.18+
- [Anchor](https://www.anchor-lang.com/docs/installation) 0.30+
- [Node.js](https://nodejs.org/) 18+

### Installation

```bash
cd solana

# Install Anchor dependencies (auto-downloads on first build)
anchor build

# Build TypeScript SDK
cd sdk && npm install && npm run build
```

### Local Testing

#### 1. Start Local Validator

```bash
./scripts/start-validator.sh
```

This starts `solana-test-validator` on port 8899.

#### 2. Deploy Program

```bash
./scripts/deploy-local.sh
```

#### 3. Integrate with Game

```typescript
// In your game setup (e.g., src/main.ts)
import { eventBus } from './src/bus/EventBus';
import { Connection, Keypair } from '@solana/web3.js';
import { SolanaEventBridge } from './solana/sdk';

// Set up Solana connection
const connection = new Connection('http://127.0.0.1:8899');

// Create or load player keypairs
const player1 = Keypair.generate();
const player2 = Keypair.generate();

// Airdrop SOL for testing (localnet only)
await connection.requestAirdrop(player1.publicKey, 1e9);
await connection.requestAirdrop(player2.publicKey, 1e9);

// Create bridge
const bridge = new SolanaEventBridge(connection, player1, player2, {
  autoCreateMatch: true,
  autoLockMatch: true,
  autoSettle: true,
});

// Subscribe to all game events
eventBus.on('*' as any, (event) => {
  bridge.handleGameEvent(event);
});

// Now when the game runs:
// - match:start will create + lock match on Solana
// - match:end will settle scores on Solana
```

## Usage Examples

### Manual SDK Usage (Two-Player Flow)

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { TelegraphDuelClient, generateMatchId } from './solana/sdk';

const connection = new Connection('http://127.0.0.1:8899');
const client = new TelegraphDuelClient(connection);

// REQUIRED: Two distinct keypairs for testing gate
const player1 = Keypair.generate();
const player2 = Keypair.generate();

// Airdrop SOL (localnet only)
await connection.requestAirdrop(player1.publicKey, 1e9);
await connection.requestAirdrop(player2.publicKey, 1e9);

// Generate match ID
const matchId = generateMatchId('match-001');

// Create session keys (spend-guard pattern)
const session1 = client.createSessionKey(3600); // 1 hour expiry
const session2 = client.createSessionKey(3600);

// Create match
await client.createMatch(player1, {
  matchId,
  sessionPubkey: session1.publicKey,
  sessionExpiry: session1.expiry,
});

// Join match
await client.joinMatch(player2, {
  matchId,
  sessionPubkey: session2.publicKey,
  sessionExpiry: session2.expiry,
});

// Lock match (game starts)
await client.lockMatch(player1, matchId);

// ... game plays out ...

// Settle match
await client.settleMatch(player1, {
  matchId,
  player1Score: 3,  // Best-of-5, player1 wins 3-2
  player2Score: 2,
});

// Fetch final state
const matchAccount = await client.getMatchAccount(matchId);
const player1Score = await client.getPlayerScore(player1.publicKey);
const player2Score = await client.getPlayerScore(player2.publicKey);

console.log('Match state:', matchAccount.state); // 'Settled'
console.log('Player 1:', player1Score); // { wins: 1, losses: 0, ... }
console.log('Player 2:', player2Score); // { wins: 0, losses: 1, ... }
```

### Automatic Event Bridge (Two-Player Flow)

```typescript
import { eventBus } from '../src/bus/EventBus';
import { SolanaEventBridge } from './solana/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('http://127.0.0.1:8899');

// REQUIRED: Two distinct keypairs for testing gate
const player1 = Keypair.generate();
const player2 = Keypair.generate();

// Airdrop SOL (localnet only)
await connection.requestAirdrop(player1.publicKey, 1e9);
await connection.requestAirdrop(player2.publicKey, 1e9);

// Create bridge with both players
const bridge = new SolanaEventBridge(connection, player1, player2);

// Subscribe to game events
eventBus.on('*' as any, bridge.handleGameEvent.bind(bridge));

// Now the game will automatically:
// - Create match on-chain when match:start fires (player1)
// - Auto-join with player2
// - Lock match
// - Settle scores on-chain when match:end fires
```

## Testing on Devnet

```bash
./scripts/setup-devnet.sh
```

This will:
1. Switch Solana CLI to devnet
2. Airdrop SOL if needed
3. Build and deploy the program
4. Provide Solana Explorer link

Update your game connection to devnet:

```typescript
const connection = new Connection('https://api.devnet.solana.com');
```

## Program Instructions

| Instruction                  | Description                              | Signer      |
|------------------------------|------------------------------------------|-------------|
| `create_match`               | Create new match PDA                     | Player 1    |
| `join_match`                 | Player 2 joins match                     | Player 2    |
| `lock_match`                 | Lock match (game starts)                 | Either      |
| `settle_match`               | Settle final scores, update score PDAs   | Either/Session |
| `verify_session_signature`   | Verify session key signature (helper)    | Session     |

## Session Keys (Spend-Guard Pattern)

Session keys provide:

- **Match-scoped authorization**: Keys tied to specific match
- **Time-limited**: Expires after N seconds
- **Hot wallet pattern**: Reduces main wallet exposure
- **Auto-settlement**: Can settle without user prompt

Session keys can be used to:
- Settle matches (within expiry)
- Sign off-chain intents (future)

## Alignment with EVENTBUS.md

This implementation **does not invent new event types**. It:

1. **Subscribes** to existing game events from `src/bus/EventBus.ts`
2. **Respects** the `EVENTBUS.md` contract exactly as specified
3. **Bridges** only `match:start` and `match:end` to L1
4. **Keeps** all other events (round/agent/clash) off-chain

The TypeScript types in `sdk/src/types.ts` include `GameEventType` which mirrors the exact types from EVENTBUS.md.

## Test Checklist

Before considering this implementation complete, verify:

- [ ] **Two distinct player keypairs** are generated
- [ ] **Player 1 creates match** with session key
- [ ] **Player 2 joins match** with session key
- [ ] **Match is locked** (either player can lock)
- [ ] **Match is settled** with player1Score and player2Score
- [ ] **Both PlayerScore PDAs** are created/updated
- [ ] **Session keys expire** after timeout
- [ ] **Authorization fails** if non-player tries to settle

**Testing gate**: All tests must use **two distinct wallets**, not a single wallet joining itself.

## Test Commands

### Build Program

```bash
cd solana
anchor build
```

### Build SDK

```bash
cd solana/sdk
npm install
npm run build
```

### Start Local Validator

```bash
cd solana
./scripts/start-validator.sh
```

### Deploy to Localnet

```bash
cd solana
./scripts/deploy-local.sh
```

### Deploy to Devnet

```bash
cd solana
./scripts/setup-devnet.sh
```

### Run with Game

```bash
# From repository root
npm install
npm run dev

# The game should auto-connect to Solana if bridge is set up in src/main.ts
```

## Security & Fee Payer

### Fee Payer Assumptions

- **Local/Devnet**: Uses player wallets as fee payers
- **Production**: Should use dedicated fee payer service

### Session Keys

- Hot keys stored client-side
- Minimal SOL balance (rent + fees)
- Short expiry (1 hour default)
- Match-scoped permissions

### Anti-Sybil

v1 is **stake-free** with no anti-sybil. Future versions could add:
- Token staking
- Reputation systems
- Rate limiting

## What's NOT Included

- ❌ Mainnet deployment
- ❌ Per-round on-chain settlement
- ❌ Anti-sybil measures
- ❌ Token economics

## File Paths Summary

**Program**:
- `solana/programs/telegraph-duel/src/lib.rs` - Entry point
- `solana/programs/telegraph-duel/src/instructions/` - Instruction handlers
- `solana/programs/telegraph-duel/src/state/` - PDA structures

**SDK**:
- `solana/sdk/src/client.ts` - TelegraphDuelClient
- `solana/sdk/src/bridge.ts` - SolanaEventBridge (game integration)
- `solana/sdk/src/types.ts` - Types (aligned with EVENTBUS.md)

**Scripts**:
- `solana/scripts/start-validator.sh` - Local validator
- `solana/scripts/deploy-local.sh` - Deploy localnet
- `solana/scripts/setup-devnet.sh` - Deploy devnet

**Documentation**:
- `solana/README.md` - This file (integration guide)
- `../EVENTBUS.md` - Game event contract (repository root)

## Status

✅ **Complete**: Thin-slice v1 ready for local/devnet testing

**Network Support**:
- Localnet: ✅
- Devnet: ✅  
- Mainnet: ❌ (not recommended for v1)

## Next Steps

1. Integrate `SolanaEventBridge` in `src/main.ts`
2. Test with local validator
3. Test on devnet
4. Consider WebSocket pub/sub for multiplayer
5. Add intent verification (optional)
6. Implement anti-sybil measures before mainnet
