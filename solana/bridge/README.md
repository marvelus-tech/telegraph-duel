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
MATCH_SERVER_URL=https://telegraph-duel-match.marvelus-tech.workers.dev

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
  Match Server: https://telegraph-duel-match.marvelus-tech.workers.dev
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
  matchServerUrl: 'https://telegraph-duel-match.marvelus-tech.workers.dev',
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

## Testing Against a Completed Room

### Prerequisites

1. **Local Solana validator running:**

```bash
cd solana
./scripts/start-validator.sh
```

2. **Program deployed:**

```bash
cd solana
anchor build --no-idl
anchor deploy
```

3. **Match-server room completed:**

Create and complete a match on the match-server (see `packages/match-server/README.md`), or use an existing completed room ID.

### Test Flow

```bash
# 1. Airdrop SOL to fee payer
solana airdrop 10 <FEE_PAYER_ADDRESS> --url http://127.0.0.1:8899

# 2. Run bridge against completed room
cd solana/bridge
npm install
npm run dev -- --room=rm_abc123

# 3. Verify settlement on-chain
solana account <SCORE_PDA_A> --url http://127.0.0.1:8899
solana account <SCORE_PDA_B> --url http://127.0.0.1:8899
```

**Expected result:**
- Bridge fetches room state from match-server
- Maps agentIds to wallets
- Calls `settleMatch` instruction
- Emits `score.settled` event with transaction signature
- Score PDAs are updated with wins/losses/total_score

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
curl https://telegraph-duel-match.marvelus-tech.workers.dev/rooms/rm_abc123
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
