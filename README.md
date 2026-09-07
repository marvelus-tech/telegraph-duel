# Telegraph Duel

**Stake-free Solana match settlement with session keys**

Telegraph Duel is a thin-slice plumbing implementation for on-chain match settlement on Solana. This v1 focuses on the identity → match → session auth → score settlement flow, ready for integration with game engines and event-driven architectures.

## 🎯 Overview

This repository provides:

- **Anchor Program**: Match creation/joining, session keys (spend-guard pattern), and score PDAs
- **TypeScript SDK**: Client library using `@solana/web3.js` (Kit-compatible patterns)
- **EventBus**: Simple event emission (EventEmitter stub, ready for WebSocket upgrade)
- **Scripts**: Local validator setup and demo flow

### Key Features

- ✅ **Stake-free v1**: No token staking required
- ✅ **Session keys**: Spend-guard pattern for match-scoped authorization
- ✅ **Score PDAs**: Persistent player statistics (seeds: `["score", wallet]`)
- ✅ **End-of-match settlement**: No per-tick L1 overhead
- ✅ **Event-driven**: Ready for Sega/game engine integration via EventBus

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Game Engine (Sega)                  │
│                 (Telegraph Duel 2D Phaser)              │
└────────────────────┬────────────────────────────────────┘
                     │ Subscribe to events
                     ▼
┌─────────────────────────────────────────────────────────┐
│                      EventBus                           │
│   match.created, match.joined, intent, clash,           │
│   match.locked, score.settled                           │
└────────────────────┬────────────────────────────────────┘
                     │ Emit events
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  TypeScript SDK                         │
│   - TelegraphDuelClient                                 │
│   - Session key management                              │
│   - PDA derivation utilities                            │
└────────────────────┬────────────────────────────────────┘
                     │ Program instructions
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Telegraph Duel Anchor Program              │
│                                                         │
│  Instructions:                                          │
│  - create_match(match_id, session_pubkey, expiry)      │
│  - join_match(session_pubkey, expiry)                  │
│  - lock_match()                                        │
│  - settle_match(player1_score, player2_score)          │
│  - verify_session_signature(message, signature)        │
│                                                         │
│  Accounts:                                             │
│  - MatchAccount: PDA seeds ["match", match_id]         │
│  - PlayerScore: PDA seeds ["score", wallet]            │
└─────────────────────────────────────────────────────────┘
```

### Match Flow

1. **Identity**: Player wallets (or session keys) used for identity
2. **Create Match**: Player 1 creates a match with optional session key
3. **Join Match**: Player 2 joins and optionally sets their session key
4. **Lock Match**: Either player locks the match (game starts)
5. **Off-chain Game**: Intents/actions happen off-chain (or stubbed on EventBus)
6. **Settle**: One player (or session key) settles final scores on-chain
7. **Score PDAs**: Wins/losses/draws/total scores persisted per wallet

### Session Keys (Spend-Guard Pattern)

Session keys provide:
- **Match-scoped authorization**: Keys are tied to a specific match
- **Expiry**: Time-limited validity
- **Reduced main wallet exposure**: Hot keys for game actions
- **Future intent signing**: Ready for off-chain intent verification

The session key can be used to settle matches without exposing the main wallet's private key.

## 📁 Repository Structure

```
telegraph-duel/
├── programs/
│   └── telegraph-duel/         # Anchor program
│       ├── src/
│       │   ├── lib.rs           # Program entry point
│       │   ├── instructions/    # Instruction handlers
│       │   ├── state/           # Account structures
│       │   └── errors.rs        # Error definitions
│       └── Cargo.toml
├── sdk/
│   └── src/
│       ├── client.ts            # Main SDK client
│       ├── eventbus.ts          # EventBus implementation
│       ├── types.ts             # TypeScript types
│       └── utils.ts             # Helper functions
├── scripts/
│   ├── start-validator.sh       # Start local validator
│   ├── deploy-local.sh          # Deploy to localnet
│   ├── setup-devnet.sh          # Deploy to devnet
│   └── demo.js                  # Complete demo flow
├── Anchor.toml                  # Anchor configuration
└── README.md                    # This file
```

## 🚀 Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) 1.18+
- [Anchor](https://www.anchor-lang.com/docs/installation) 0.30+
- [Node.js](https://nodejs.org/) 18+
- [Yarn](https://yarnpkg.com/) or npm

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd telegraph-duel

# Install dependencies
yarn install
cd sdk && yarn install && cd ..

# Build the Anchor program
anchor build

# Build the SDK
yarn sdk:build
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

#### 3. Run Demo

```bash
yarn demo
```

The demo script:
- Creates two player keypairs
- Generates session keys for both players
- Creates a match
- Joins the match
- Locks the match
- Simulates off-chain gameplay
- Settles scores on-chain
- Displays final PDA states

#### Expected Output

```
🎮 Telegraph Duel Demo

📡 Connected to: http://127.0.0.1:8899

👤 Player 1: 5Q7p...Xm9k
👤 Player 2: 8Bm3...Ry4j

🎯 Match ID: a3f9c8b2d1e4f5...

🔑 Creating session keys...
   Player 1 session: 3Nh8...Kx2p
   Player 2 session: 7Qw5...Tz9m
   Expiry: 2026-09-07T04:03:42.000Z

📝 Creating match...
   🔔 Event: match.created
   ✅ Created: 5x8k9m2n3p4q...

🤝 Player 2 joining match...
   🔔 Event: match.joined
   ✅ Joined: 7y2w3x4c5v6b...

🔒 Locking match...
   🔔 Event: match.locked
   ✅ Locked: 9k3m5n7p8q2r...

⚔️  Simulating game...
   (Off-chain intents: tick 1, tick 2, tick 3...)
   Player 1 score: 100
   Player 2 score: 85

📊 Settling match...
   🔔 Event: score.settled
   ✅ Settled: 4b6c8d2e3f5g...

📖 Final state:

   Match PDA: Du3L...1111
   State: Settled
   Created: 2026-09-07T03:03:42.000Z
   Settled: 2026-09-07T03:03:52.000Z

   Player 1 Score PDA: 8Hx9...Pq3r
   Wins: 1 | Losses: 0 | Draws: 0
   Total Score: 100 | Matches: 1

   Player 2 Score PDA: 3Ky7...Zm4n
   Wins: 0 | Losses: 1 | Draws: 0
   Total Score: 85 | Matches: 1

✅ Demo complete!
```

### Devnet Testing

```bash
./scripts/setup-devnet.sh
```

This script:
- Switches to devnet
- Airdrops SOL if needed
- Deploys the program
- Provides Explorer link

## 📡 EventBus API

### Event Types

The EventBus emits the following events:

#### `match.created`

Emitted when a new match is created.

```typescript
{
  matchId: string;        // Hex string
  player1: string;        // Base58 pubkey
  matchPDA: string;       // Base58 PDA
  signature: string;      // Transaction signature
  timestamp: number;      // Unix ms
}
```

#### `match.joined`

Emitted when player 2 joins.

```typescript
{
  matchId: string;
  player2: string;
  matchPDA: string;
  signature: string;
  timestamp: number;
}
```

#### `match.locked`

Emitted when the match is locked (game starts).

```typescript
{
  matchId: string;
  matchPDA: string;
  signature: string;
  timestamp: number;
}
```

#### `intent`

Emitted for player intents (off-chain, can be mirrored here).

```typescript
{
  matchId: string;
  player: string;
  intent: string;         // e.g., "ATTACK", "DEFEND"
  tick: number;
  sessionSignature?: string;
  timestamp: number;
}
```

#### `clash`

Emitted when intents clash (game logic).

```typescript
{
  matchId: string;
  tick: number;
  player1Intent: string;
  player2Intent: string;
  winner?: string;
  timestamp: number;
}
```

#### `score.settled`

Emitted when final scores are settled on-chain.

```typescript
{
  matchId: string;
  player1Score: number;
  player2Score: number;
  matchPDA: string;
  signature: string;
  timestamp: number;
}
```

### Usage

```typescript
import { TelegraphDuelClient } from '@telegraph-duel/sdk';

const client = new TelegraphDuelClient(connection);

// Listen to all events
client.eventBus.on('*', (event) => {
  console.log(event.eventType, event.data);
});

// Listen to specific event
client.eventBus.on('match.created', (data) => {
  console.log('New match:', data.matchId);
});
```

### Future: WebSocket EventBus

The current EventBus uses `EventEmitter` for in-process events. For production:

```typescript
import { WebSocketEventBus } from '@telegraph-duel/sdk';

const eventBus = new WebSocketEventBus('wss://api.telegraph-duel.com/events');
await eventBus.connect();

eventBus.on('match.created', (data) => {
  // Sega game engine subscribes here
});
```

This stub is ready for integration with a WebSocket server or pub/sub system.

## 🧪 Testing

### Run Anchor Tests

```bash
anchor test
```

(Note: Tests are currently stubs. Expand with actual test cases.)

### SDK Integration Test

The `scripts/demo.js` serves as an integration test. Run it after deploying:

```bash
yarn demo
```

## 🔐 Security Considerations

### Fee Payer Assumptions

- **Local/Devnet**: Demo script uses player wallets as fee payers
- **Production**: Consider:
  - Dedicated fee payer service
  - Session keys funded with minimal SOL
  - Fee delegation patterns
  - Rate limiting and anti-abuse measures

### Session Key Management

- Session keys are **hot keys** stored client-side
- Main wallet signs once to authorize session key
- Session keys should have:
  - Short expiry (1 hour default)
  - Minimal SOL balance (rent + fees)
  - Match-scoped permissions

### Anti-Sybil (Future)

This v1 is **stake-free** and has no built-in anti-sybil measures. Future versions could add:
- Token staking requirements
- Reputation systems
- Rate limiting per wallet
- Identity verification (e.g., Civic, Dialect)

## 📝 Deployment Considerations

### Localnet

- Use for development and testing
- Start validator: `./scripts/start-validator.sh`
- Deploy: `./scripts/deploy-local.sh`

### Devnet

- Use for integration testing
- Deploy: `./scripts/setup-devnet.sh`
- Airdrops available for testing

### Mainnet (NOT RECOMMENDED FOR V1)

⚠️ **This is a v1 thin-slice and NOT ready for mainnet.**

Before considering mainnet:
- [ ] Complete security audit
- [ ] Implement anti-sybil measures
- [ ] Production-grade fee payer infrastructure
- [ ] Monitoring and alerting
- [ ] Rate limiting
- [ ] Bug bounty program
- [ ] Extensive testing on devnet
- [ ] Economic model validation

## 🛠️ SDK API Reference

### TelegraphDuelClient

```typescript
import { TelegraphDuelClient } from '@telegraph-duel/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('http://127.0.0.1:8899');
const client = new TelegraphDuelClient(connection);
```

#### Methods

##### `createSessionKey(expirySeconds: number): SessionKeyPair`

Creates a new session keypair with expiry.

##### `getMatchPDA(matchId: Buffer): [PublicKey, number]`

Derives the match PDA for a given match ID.

##### `getPlayerScorePDA(playerPubkey: PublicKey): [PublicKey, number]`

Derives the player score PDA for a given wallet.

##### `createMatch(player1: Keypair, params: CreateMatchParams): Promise<string>`

Creates a new match. Returns transaction signature.

##### `joinMatch(player2: Keypair, params: JoinMatchParams): Promise<string>`

Joins an existing match. Returns transaction signature.

##### `lockMatch(authority: Keypair, matchId: Buffer): Promise<string>`

Locks the match (starts game). Returns transaction signature.

##### `settleMatch(authority: Keypair, params: SettleMatchParams): Promise<string>`

Settles match scores on-chain. Returns transaction signature.

##### `getMatchAccount(matchId: Buffer): Promise<MatchAccount | null>`

Fetches match account data.

##### `getPlayerScore(playerPubkey: PublicKey): Promise<PlayerScore | null>`

Fetches player score account data.

### Utilities

```typescript
import {
  generateMatchId,
  generateMatchIdFromSeed,
  parseMatchId,
  formatMatchId,
  shortenPubkey,
  isSessionExpired,
} from '@telegraph-duel/sdk';

// Generate random match ID
const matchId = generateMatchId();

// Generate deterministic match ID
const matchId = generateMatchIdFromSeed('duel-2026-09-07-001');

// Format for display
const hex = formatMatchId(matchId); // "a3f9c8b2d1e4f5..."

// Shorten pubkey
shortenPubkey(pubkey, 4); // "5Q7p...Xm9k"

// Check session expiry
if (isSessionExpired(session.expiry)) {
  console.log('Session expired');
}
```

## 🔮 Future Work

### Out of Scope for This PR

- ❌ Origin setup / new repos
- ❌ Sega sprite game integration
- ❌ MagicBlock / x402 / pots integration
- ❌ Perfect anti-sybil measures
- ❌ Mainnet deployment

### Potential Enhancements

- [ ] WebSocket-based EventBus (replace EventEmitter)
- [ ] Intent verification helpers (off-chain or on-chain)
- [ ] Replay protection for session signatures
- [ ] Match timeout/expiry logic
- [ ] ELO rating system
- [ ] Tournament brackets
- [ ] Token staking mechanics
- [ ] Integration with MagicBlock for ephemeral rollups
- [ ] Sprite-based client rendering
- [ ] Matchmaking service

## 📄 License

MIT

## 🙏 Acknowledgments

Built with:
- [Anchor Framework](https://www.anchor-lang.com/)
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)
- TypeScript

---

**Status**: ✅ Thin-slice v1 complete. Ready for Sega integration and EventBus subscription.

**Network Support**: Localnet ✅ | Devnet ✅ | Mainnet ❌
