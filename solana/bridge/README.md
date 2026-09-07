# Match Server → Solana Bridge

Bridge from Telegraph Duel match-server `match:end` events to Solana score PDA settlement.

## Overview

This bridge connects the match-server (Cloudflare Workers Durable Object) to the Solana on-chain settlement program. When a match completes in the match-server, the bridge:

1. Polls the match-server API for completed rooms
2. Maps seat A/B `agentId`s to Solana wallet addresses
3. Calls `settleMatch` instruction to write score PDAs on-chain
4. Emits `score.settled` event with transaction signature and score PDA addresses

## Architecture

```
Match Server (Workers)         Bridge (Node.js)              Solana Program
     │                              │                              │
     │  GET /rooms/:id              │                              │
     │  (status: completed)         │                              │
     ├─────────────────────────────>│                              │
     │                              │                              │
     │  Room state (scores,         │                              │
     │  agentIds, lastClash)        │                              │
     │<─────────────────────────────┤                              │
     │                              │                              │
     │                              │  Map agentId → wallet        │
     │                              │  (via config/env)            │
     │                              │                              │
     │                              │  settleMatch(matchId,        │
     │                              │    player1Score,             │
     │                              │    player2Score)             │
     │                              ├─────────────────────────────>│
     │                              │                              │
     │                              │                              │ Update PDAs:
     │                              │                              │ - MatchAccount
     │                              │                              │ - PlayerScore A
     │                              │                              │ - PlayerScore B
     │                              │                              │
     │                              │  TX signature                │
     │                              │<─────────────────────────────┤
     │                              │                              │
     │                              │  Emit score.settled event    │
     │                              │  (matchId, scores, tx,       │
     │                              │   scorePDAs)                 │
```

## Installation

```bash
cd solana/bridge
npm install
```

## Configuration

### Option 1: Environment Variables (Production)

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

```env
# Solana RPC endpoint
SOLANA_RPC_URL=http://127.0.0.1:8899

# Match server URL
MATCH_SERVER_URL=https://telegraph-duel-match-server.marvelus.workers.dev

# Agent ID to wallet mapping (comma-separated)
# Format: agentId:walletPublicKeyBase58,agentId:walletPublicKeyBase58
AGENT_WALLET_MAP=alice:9xQeW...,bob:3K9Y...

# Fee payer wallet private key (base64-encoded)
# This wallet pays for settlement transactions
FEE_PAYER_PRIVATE_KEY=<base64-private-key>

# Program ID (match your deployed program)
PROGRAM_ID=HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM

# Polling interval in milliseconds
POLL_INTERVAL_MS=5000
```

**⚠️ Fee Payer Requirements:**
- Must have SOL for transaction fees (~0.005 SOL per settlement)
- For localnet: `solana airdrop 10 <FEE_PAYER_ADDRESS> --url http://127.0.0.1:8899`
- For devnet: Use Solana faucet or airdrop
- **Do NOT use mainnet** (v1 is stake-free localnet/devnet only)

### Option 2: Test Mode (Development)

Run the demo without `.env` file. The script will generate temporary keypairs:

```bash
npm run dev
```

## Usage

### Mode 1: Single Room Settlement

Settle a specific completed room:

```bash
# Interactive mode (prompts for room ID)
npm run dev

# Direct mode (specify room ID)
npm run dev -- --room=rm_abc123
```

**Example output:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Match Server → Solana Bridge Demo
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Demo] Generating test configuration...
Enter agent IDs (comma-separated, e.g., alice,bob): alice,bob

[Demo] Test wallets generated:
  Fee payer: 9xQeW...
  alice: 3K9Y...
  bob: 5J7X...

[Demo] Configuration:
  RPC: http://127.0.0.1:8899
  Match Server: https://telegraph-duel-match-server.marvelus.workers.dev
  Program ID: HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM
  Agent Wallets: 2 configured

[Demo] Fee payer balance: 10 SOL

Enter room ID to settle: rm_abc123

[Bridge] Found completed room: rm_abc123
[Bridge] Settling match for room rm_abc123
[Bridge]   Agent A: alice (wallet: 3K9Y...)
[Bridge]   Agent B: bob (wallet: 5J7X...)
[Bridge]   Scores: 3 - 2
[Bridge] Match settled: 4xT9...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 Score Settled Event
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Room ID: rm_abc123
Scores: alice (3) vs bob (2)
Last Clash: windUp_beats_feint
TX Signature: 4xT9...
Score PDAs:
  A: FsQ8...
  B: 2mK4...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Demo] Done!
```

### Mode 2: Continuous Polling

Monitor multiple rooms and settle as they complete:

```bash
npm run dev -- --poll=rm_abc123,rm_def456
```

The bridge will poll every 5 seconds (configurable via `POLL_INTERVAL_MS`) and settle any newly completed rooms.

Press `Ctrl+C` to stop.

### Mode 3: Environment-Based

Use `.env` configuration:

```bash
npm run dev -- --env
```

## Programmatic Usage

```typescript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { MatchServerBridge } from '@telegraph-duel/match-server-bridge';

// Set up configuration
const config = {
  solanaRpcUrl: 'http://127.0.0.1:8899',
  matchServerUrl: 'https://telegraph-duel-match-server.marvelus.workers.dev',
  agentWallets: new Map([
    ['alice', new PublicKey('3K9Y...')],
    ['bob', new PublicKey('5J7X...')],
  ]),
  feePayer: feePayerKeypair.publicKey,
  programId: new PublicKey('HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM'),
  pollIntervalMs: 5000,
};

// Create bridge
const bridge = new MatchServerBridge(config);

// Listen for settlement events
bridge.on('score.settled', (event) => {
  console.log('Match settled:', event.data.roomId);
  console.log('TX:', event.data.txSignature);
  console.log('Score PDAs:', event.data.scorePDAs);
});

// Process a single room
await bridge.processRoom('rm_abc123');

// Or start continuous polling
bridge.startPolling(['rm_abc123', 'rm_def456']);

// Stop polling later
bridge.stopPolling();
```

## E2E Testing (Localnet)

### Quick Start (Automated E2E Test)

The fastest way to test the full flow:

```bash
# 1. Start localnet validator in one terminal
cd solana
./scripts/start-validator.sh

# 2. Deploy program in another terminal
cd solana
anchor build --no-idl
anchor deploy

# 3. Run E2E test (uses fixture, no live API needed)
cd solana/bridge
npm install
npm run e2e
```

This will:
1. ✅ Generate test wallets (alice, bob, fee payer)
2. ✅ Airdrop SOL to fee payer
3. ✅ Initialize bridge
4. ✅ Load completed room fixture
5. ✅ Settle match on-chain
6. ✅ Emit `score.settled` event
7. ✅ Verify score PDAs exist

**Expected output:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  E2E Test: Match-Server → Solana Bridge
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Step 1: Generate test configuration
─────────────────────────────────────
✓ Generated test wallets:
  Fee payer: 9xQeW...
  Alice:     3K9Y...
  Bob:       5J7X...

💰 Step 2: Check fee payer balance
─────────────────────────────────────
Current balance: 0 SOL
⚠️  Balance too low, requesting airdrop...
✓ Airdrop successful! New balance: 1 SOL

🌉 Step 3: Initialize bridge
─────────────────────────────────────
✓ Bridge initialized

👂 Step 4: Register event listeners
─────────────────────────────────────
✓ Event listener registered

🎮 Step 5: Get completed room state
─────────────────────────────────────
Using test fixture (no live API call)
✓ Room state loaded:
  Room ID: rm_test_fixture_001
  Status:  completed
  Seats:   alice vs bob
  Scores:  3 - 2

🔨 Step 6: Settle match on-chain
─────────────────────────────────────
[Bridge] Settling match for room rm_test_fixture_001
[Bridge]   Agent A: alice (wallet: 3K9Y...)
[Bridge]   Agent B: bob (wallet: 5J7X...)
[Bridge]   Scores: 3 - 2
[Bridge] Match not found on-chain, creating and locking...
[Bridge] Match created, joined, and locked
[Bridge] Match settled: 4xT9...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 score.settled Event Received
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Match ID:    rm_test_fixture_001
Room ID:     rm_test_fixture_001
Scores:      alice (3) vs bob (2)
Last Clash:  windUp_beats_feint
TX:          4xT9...
Score PDAs:
  A: FsQ8...
  B: 2mK4...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Settlement successful!
  TX: 4xT9...

🔍 Step 7: Verify score PDAs on-chain
─────────────────────────────────────
✓ Score PDA A exists: FsQ8...
  Size: 64 bytes
✓ Score PDA B exists: 2mK4...
  Size: 64 bytes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  E2E Test Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Wallets generated (alice, bob, fee payer)
✓ Fee payer funded with SOL
✓ Bridge initialized
✓ Room state loaded (fixture)
✓ Match settled on-chain
✓ Score PDAs created
✓ score.settled event emitted
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 E2E Test PASSED
```

### Manual Testing Against Live Workers API

To test with a real completed room from the match-server:

```bash
# Run E2E test with live room ID
npm run e2e -- --room=rm_abc123
```

This requires:
- Match-server running (Cloudflare Workers)
- A completed room with status `completed`
- Agent IDs match those in your wallet mapping

### Exact E2E Test Steps (Manual)

#### Step 1: Start Localnet Validator

```bash
cd solana
./scripts/start-validator.sh
```

**Expected:** Validator runs on `http://127.0.0.1:8899`

#### Step 2: Deploy Program

```bash
cd solana
anchor build --no-idl
anchor deploy
```

**Expected:** Program deployed, ID printed (e.g., `HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM`)

#### Step 3: Generate Test Wallets

```bash
cd solana/bridge
npm install

# Option A: Use E2E script (generates wallets automatically)
npm run e2e

# Option B: Generate manually
solana-keygen new --outfile alice.json
solana-keygen new --outfile bob.json
solana-keygen new --outfile fee-payer.json
```

**Expected:** Three keypairs generated

#### Step 4: Map Agent IDs to Wallets

Create `.env` file:

```bash
cd solana/bridge
cat > .env << EOF
SOLANA_RPC_URL=http://127.0.0.1:8899
MATCH_SERVER_URL=https://telegraph-duel-match-server.marvelus.workers.dev
AGENT_WALLET_MAP=alice:<alice-pubkey>,bob:<bob-pubkey>
FEE_PAYER_PRIVATE_KEY=<fee-payer-base64-secret>
PROGRAM_ID=HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM
EOF
```

**Or use the E2E test which generates wallets automatically.**

#### Step 5: Airdrop SOL to Fee Payer

```bash
# If using E2E script, this is automatic
npm run e2e

# If manual:
solana airdrop 1 <FEE_PAYER_ADDRESS> --url http://127.0.0.1:8899
```

**Expected:** Fee payer has >= 0.1 SOL

#### Step 6: Run Bridge Settlement

```bash
# Option A: E2E test (uses fixture)
npm run e2e

# Option B: Manual with fixture (no live API)
npm run dev
# (Enter agent IDs when prompted: alice,bob)
# (Enter room ID: rm_test_fixture_001)

# Option C: Live room from Workers API
npm run dev -- --room=rm_abc123
```

**Expected:**
- Bridge creates/joins/locks match if not on-chain
- Calls `settleMatch` with scores
- Emits `score.settled` event
- Prints transaction signature

#### Step 7: Verify Score PDAs

```bash
# Get score PDA addresses from event output, then:
solana account <SCORE_PDA_A> --url http://127.0.0.1:8899
solana account <SCORE_PDA_B> --url http://127.0.0.1:8899
```

**Expected:** PDAs exist with data (64 bytes each)

### E2E Checklist

Before considering E2E complete, verify:

- [ ] Localnet validator running
- [ ] Program deployed to localnet
- [ ] Two distinct agent wallets generated (alice, bob)
- [ ] Fee payer wallet funded with >= 0.1 SOL
- [ ] Bridge runs without errors
- [ ] Match created/joined/locked on-chain (if not existing)
- [ ] `settleMatch` instruction succeeds
- [ ] `score.settled` event emitted with:
  - [ ] `matchId` / `roomId`
  - [ ] `scores.A` and `scores.B`
  - [ ] `agentIds.A` and `agentIds.B`
  - [ ] `lastClash.reason` (if available)
  - [ ] `txSignature`
  - [ ] `scorePDAs.A` and `scorePDAs.B`
- [ ] Score PDAs exist on-chain
- [ ] Transaction signature is valid

### Fixture vs. Live API

**Fixture mode** (default for E2E test):
- Uses `COMPLETED_ROOM_FIXTURE` from `src/fixtures.ts`
- No live Workers API required
- Faster, deterministic
- Recommended for CI/CD

**Live API mode**:
- Fetches real room from match-server
- Requires completed room on Workers
- Tests full API integration
- Use for integration testing

## Event Schema

### `score.settled`

Emitted after successful settlement:

```typescript
{
  type: 'score.settled',
  data: {
    matchId: string,           // Room ID
    roomId: string,            // Same as matchId
    scores: {
      A: number,               // Seat A final score
      B: number                // Seat B final score
    },
    agentIds: {
      A: string,               // Seat A agent ID
      B: string                // Seat B agent ID
    },
    lastClash?: {
      reason: string           // Last clash reason (e.g., "windUp_beats_feint")
    },
    txSignature: string,       // Solana transaction signature
    scorePDAs: {
      A: string,               // Seat A score PDA address
      B: string                // Seat B score PDA address
    }
  },
  timestamp: number            // Unix ms
}
```

## Agent ID → Wallet Mapping

The bridge requires a mapping from match-server `agentId` (e.g., `"alice"`, `"bot-123"`) to Solana wallet addresses.

**v1 approach (config/env):**
- Define mapping in `AGENT_WALLET_MAP` environment variable
- Format: `agentId:publicKey,agentId:publicKey`
- Example: `alice:9xQeW...,bob:3K9Y...`

**Future approaches:**
- On-chain registry (agentId → wallet PDA)
- Signed authentication (agent proves ownership of wallet)
- OAuth/JWT-based identity mapping

## Fee Payer Model

**Draft-Then-Approve Pattern:**

The bridge uses a designated **fee payer** wallet to pay for settlement transactions. This is a **draft-then-approve** model:

1. **Draft**: Bridge operator runs the bridge with a funded wallet (draft settlement)
2. **Approve**: Users review and approve settlements before or after they happen (out of scope for v1)

**Important notes:**
- Fee payer pays ~0.005 SOL per settlement (account creation + transaction)
- Fee payer does **not** need to be a match participant
- v1 is **stake-free**: no tokens are transferred, only scores are recorded
- Future versions may require participants to sign or co-pay fees

**Recommended setup:**
- Use a dedicated keypair for fee payer
- Fund it with SOL for localnet/devnet testing
- **Do not use mainnet** (v1 not audited)

## Constraints & Limitations

✅ **Supported:**
- Localnet and devnet only
- Stake-free settlement (no token transfers)
- Polling-based architecture (no push notifications)
- Environment-based agentId → wallet mapping

❌ **Not Supported:**
- Mainnet deployment (v1 not production-ready)
- Per-round on-chain settlement (only match:end)
- Anti-sybil measures (no stake or proof-of-work)
- Automatic agent authentication (manual wallet mapping)
- Real-time event streaming (polling only)

## Troubleshooting

### Error: "Missing wallet mapping for agents"

**Solution:** Add agent IDs to `AGENT_WALLET_MAP` in `.env`:

```env
AGENT_WALLET_MAP=alice:9xQeW...,bob:3K9Y...
```

### Error: "Room is not completed"

**Solution:** Wait for the match to finish, or verify room status:

```bash
curl https://telegraph-duel-match-server.marvelus.workers.dev/rooms/rm_abc123
```

### Error: "Insufficient funds for transaction"

**Solution:** Airdrop SOL to fee payer:

```bash
solana airdrop 10 <FEE_PAYER_ADDRESS> --url http://127.0.0.1:8899
```

### Error: "Match not found on-chain"

The bridge will automatically create, join, and lock the match if it doesn't exist. If this fails:

1. Check program ID matches deployed program
2. Verify fee payer has enough SOL
3. Check localnet validator is running

### Error: "Session expired"

The bridge creates session keys with 1-hour expiry. If settlement happens after expiry, the transaction will fail. Future versions will use the main wallet instead.

## Project Structure

```
solana/bridge/
├── README.md              # This file
├── package.json
├── tsconfig.json
├── .env.example           # Environment template
│
└── src/
    ├── index.ts           # Main exports
    ├── types.ts           # TypeScript types
    ├── bridge.ts          # MatchServerBridge class
    ├── config.ts          # Configuration loader
    └── demo.ts            # Demo script
```

## Next Steps

1. **Production webhook support**: Replace polling with match-server webhook push
2. **On-chain agent registry**: Map agentId → wallet on-chain
3. **Multi-sig fee payer**: Require participant approval for settlements
4. **Real-time event streaming**: Use WebSocket instead of polling
5. **Devnet testing**: Deploy and test on Solana devnet

## Related Documentation

- [MATCH_END_SCORE_PDA.md](../docs/MATCH_END_SCORE_PDA.md) - Score PDA settlement spec
- [EVENTBUS.md](../../EVENTBUS.md) - Game event contract
- [SEATS.md](../../SEATS.md) - Match-server seat design
- [packages/match-server/README.md](../../packages/match-server/README.md) - Match-server API

## License

Same as parent project (see root LICENSE).
