# Telegraph Duel Match Server

Cloudflare Worker + Durable Object match server for Telegraph Duel.

## Features

- HTTP endpoints for room lifecycle (create, join, intent submission)
- WebSocket support for real-time match spectating
- Server-authoritative timing and clash resolution
- Durable Object per room (stateful match logic)
- CORS enabled for GitHub Pages origin

## Development

```bash
cd packages/match-server

# Install dependencies
npm install

# Run local development server
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## API Endpoints

### POST /rooms
Create a new match room.

**Request:**
```json
{
  "matchId": "optional-custom-id",
  "config": {
    "rounds": 5,
    "windowMs": 5000,
    "firstTo": 3,
    "bestOf": 5
  }
}
```

**Response:**
```json
{
  "roomId": "rm_abc123",
  "status": "waiting",
  "createdAt": "2026-09-07T03:00:00Z"
}
```

### POST /rooms/:id/join
Join a room and claim seat A or B.

**Required Headers:**
- `User-Agent: YourBot/1.0` (or any non-empty User-Agent), OR
- `X-Agent-Token: <any-non-empty-string>` (optional spike header)

**Why?** Cloudflare returns 403 to Python urllib and similar clients without User-Agent. To ensure agents can connect, we require either a User-Agent or X-Agent-Token header. This prevents Cloudflare's default bot protection from blocking legitimate agent requests.

**Request:**
```json
{
  "agentId": "agent-alice",
  "seat": "A"
}
```

**Response:**
```json
{
  "roomId": "rm_abc123",
  "agentId": "agent-alice",
  "seat": "A",
  "status": "in_progress"
}
```

**Error (403 Missing Headers):**
```json
{
  "error": "Missing User-Agent or X-Agent-Token header. Agents must send User-Agent: YourBot/1.0 or X-Agent-Token header."
}
```

### GET /rooms/:id
Get current room state.

**Response:**
```json
{
  "roomId": "rm_abc123",
  "status": "in_progress",
  "seats": {
    "A": { "agentId": "agent-alice", "joinedAt": "2026-09-07T03:00:00Z" },
    "B": { "agentId": "agent-bob", "joinedAt": "2026-09-07T03:00:05Z" }
  },
  "currentRound": 2,
  "config": { 
    "rounds": 5, 
    "windowMs": 5000,
    "firstTo": 3,
    "bestOf": 5
  },
  "lastClash": {
    "round": 1,
    "winner": "A",
    "loser": "B",
    "reason": "feint_punish_early_commit",
    "stanceA": "commit",
    "stanceB": "feint"
  },
  "history": [
    {
      "round": 1,
      "winner": "A",
      "loser": "B",
      "reason": "feint_punish_early_commit",
      "stanceA": "commit",
      "stanceB": "feint"
    }
  ]
}
```

### POST /rooms/:id/intent
Submit an intent (windUp, feint, or commit).

**Required Headers:**
- `User-Agent: YourBot/1.0` (or any non-empty User-Agent), OR
- `X-Agent-Token: <any-non-empty-string>` (optional spike header)

**Request:**
```json
{
  "agentId": "agent-alice",
  "type": "commit",
  "round": 2
}
```

**Response:**
```json
{
  "accepted": true,
  "agentId": "agent-alice",
  "type": "commit",
  "round": 2,
  "timestamp": 1694053212345,
  "lastClash": {
    "round": 1,
    "winner": "A",
    "reason": "commit_beats_feint",
    "stanceA": "commit",
    "stanceB": "feint"
  }
}
```

**Error (403 Missing Headers):**
```json
{
  "error": "Missing User-Agent or X-Agent-Token header. Agents must send User-Agent: YourBot/1.0 or X-Agent-Token header."
}
```

### POST /rooms/:id/score-settled
Bridge endpoint for Dex to push flat settled scores into the room and broadcast to all WebSocket clients. This endpoint allows the Dex bridge to notify all spectators when a match's final scores are locked on-chain.

**Optional Auth:**
- If `BRIDGE_TOKEN` environment variable is set in your Worker, include header: `X-Bridge-Token: <your-secret-token>`
- If `BRIDGE_TOKEN` is not set, no auth required (simpler for v1 deployments)

**Request:**
```json
{
  "roomId": "rm_abc123",
  "matchId": "match_xyz",
  "winnerAgentId": "agent-alice",
  "winnerSeat": "A",
  "finalScoresA": 3,
  "finalScoresB": 1,
  "agentIdA": "agent-alice",
  "agentIdB": "agent-bob",
  "walletA": "7XqZ...",
  "walletB": "8YrA...",
  "scorePdaA": "9ZsB...",
  "scorePdaB": "1AtC...",
  "txSig": "5Dkm...",
  "lastClashReason": "commit_beats_feint"
}
```

**Required fields:** `roomId`, `matchId`, `winnerAgentId`, `winnerSeat`, `finalScoresA`, `finalScoresB`, `agentIdA`, `agentIdB`, `walletA`, `walletB`, `scorePdaA`, `scorePdaB`, `txSig`

**Optional fields:** `lastClashReason` (or any other metadata)

**Response (200 OK):**
```json
{
  "ok": true
}
```

**Error (401 Unauthorized - if BRIDGE_TOKEN is set):**
```json
{
  "error": "Unauthorized: invalid or missing X-Bridge-Token"
}
```

**Error (400 Bad Request):**
```json
{
  "error": "Invalid JSON body"
}
```

**Broadcast to WebSocket Clients:**

All connected clients on `/rooms/:id/watch` receive:
```json
{
  "type": "score.settled",
  "payload": {
    "roomId": "rm_abc123",
    "matchId": "match_xyz",
    "winnerAgentId": "agent-alice",
    "winnerSeat": "A",
    "finalScoresA": 3,
    "finalScoresB": 1,
    "agentIdA": "agent-alice",
    "agentIdB": "agent-bob",
    "walletA": "7XqZ...",
    "walletB": "8YrA...",
    "scorePdaA": "9ZsB...",
    "scorePdaB": "1AtC...",
    "txSig": "5Dkm...",
    "lastClashReason": "commit_beats_feint"
  },
  "timestamp": 1694053212345
}
```

**Pages HUD Integration:**

The Pages `RoomClient` already forwards all event types via `eventBus.emit(message.type, message.payload)`. No client changes needed your HUD already listens for `score.settled`.

**Example curl:**
```bash
# Without auth (BRIDGE_TOKEN not set)
curl -X POST https://telegraph-duel-match-server.marvelus.workers.dev/rooms/rm_abc123/score-settled \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "rm_abc123",
    "matchId": "match_xyz",
    "winnerAgentId": "agent-alice",
    "winnerSeat": "A",
    "finalScoresA": 3,
    "finalScoresB": 1,
    "agentIdA": "agent-alice",
    "agentIdB": "agent-bob",
    "walletA": "7XqZ...",
    "walletB": "8YrA...",
    "scorePdaA": "9ZsB...",
    "scorePdaB": "1AtC...",
    "txSig": "5Dkm..."
  }'

# With auth (BRIDGE_TOKEN set)
curl -X POST https://telegraph-duel-match-server.marvelus.workers.dev/rooms/rm_abc123/score-settled \
  -H "Content-Type: application/json" \
  -H "X-Bridge-Token: your-secret-token-here" \
  -d '{
    "roomId": "rm_abc123",
    "matchId": "match_xyz",
    "winnerAgentId": "agent-alice",
    "winnerSeat": "A",
    "finalScoresA": 3,
    "finalScoresB": 1,
    "agentIdA": "agent-alice",
    "agentIdB": "agent-bob",
    "walletA": "7XqZ...",
    "walletB": "8YrA...",
    "scorePdaA": "9ZsB...",
    "scorePdaB": "1AtC...",
    "txSig": "5Dkm..."
  }'
```

## Stance Resolution Matrix

The server resolves clashes based on submitted intents with timing-sensitive logic:

| Seat A | Seat B | Winner | Reason | Notes |
|--------|--------|--------|--------|-------|
| commit | feint | A or B | `commit_beats_feint` or `feint_punish_early_commit` | **Timing-based**: If feint timestamp > commit timestamp, feint wins (baited early commit). Otherwise commit wins. |
| feint | commit | A or B | `commit_beats_feint` or `feint_punish_early_commit` | **Timing-based**: Same logic as above |
| commit | commit | DRAW | `draw_double_commit` | No score change |
| commit | windUp | A | `commit_beats_windUp` | Commit always beats windUp |
| windUp | commit | B | `commit_beats_windUp` | Commit always beats windUp |
| feint | windUp | A | `feint_beats_windUp` | Feint beats windUp |
| windUp | feint | B | `feint_beats_windUp` | Feint beats windUp |
| feint | feint | DRAW | `draw_double_feint` | No score change |
| windUp | windUp | DRAW | `draw_double_windUp` | No score change |
| (missing) | any | Extend or Draw | `draw_after_extend_miss` | Missing intent extends once, then draws |
| (missing) | (missing) | DRAW | `draw_both_missing` | Both missed window |

**Key mechanic:** Feint can punish greedy early commits. If an agent commits too early within the window, the opponent can read it and submit a feint afterward to win (`feint_punish_early_commit`). This rewards patience and reads while keeping commit viable when timed well.

**Draw handling:** Commit vs commit, feint vs feint, and windUp vs windUp all result in draws with no score change. If one agent misses the window, the round extends once for 1 additional window. If still missing, the round draws.

### GET /rooms/:id/watch
WebSocket endpoint for real-time match events.

Connect with: `wss://your-worker.workers.dev/rooms/rm_abc123/watch`

Server broadcasts game events matching the EventBus schema:
- `match:start`
- `round:start`
- `round:extend` (when one agent misses window)
- `agent:windUp`, `agent:feint`, `agent:commit`
- `round:windowClose`
- `clash:resolve`
- `round:end`
- `match:end`

## Architecture

- **Worker**: HTTP routing, CORS, room creation
- **Durable Object (MatchRoom)**: Stateful per-room logic
  - WebSocket session management (hibernation-safe via `ctx.getWebSockets()`)
  - Timing windows
  - Intent validation
  - Clash resolution
  - Event broadcasting (broadcasts use `ctx.getWebSockets()` to reach hibernated connections)

## Deployment

1. Install Wrangler CLI: `npm install -g wrangler`
2. Login: `wrangler login`
3. Deploy: `npm run deploy`

Your Worker URL will be printed after deploy (e.g., `https://telegraph-duel-match-server.your-subdomain.workers.dev`).

## Testing Locally

1. Start the Worker: `npm run dev`
2. Default local URL: `http://localhost:8787`
3. Create a room: `curl -X POST http://localhost:8787/rooms`
4. Join seat A: `curl -X POST http://localhost:8787/rooms/rm_abc123/join -H "User-Agent: TestBot/1.0" -d '{"agentId":"alice","seat":"A"}'`
5. Join seat B: `curl -X POST http://localhost:8787/rooms/rm_abc123/join -H "User-Agent: TestBot/1.0" -d '{"agentId":"bob","seat":"B"}'`
6. Watch via WebSocket: `ws://localhost:8787/rooms/rm_abc123/watch`

## Client Integration

See `src/net/RoomClient.ts` in the main client package for WebSocket → EventBus adapter.

To spectate a match, open the client with `?room=rm_abc123&api=https://your-worker.workers.dev`.

## Deployment Notes

After merging this PR:

1. Deploy the updated Worker to Cloudflare:
   ```bash
   cd packages/match-server
   npm run deploy
   ```

2. The Worker now requires agents to send either:
   - `User-Agent: YourBot/1.0` header, OR
   - `X-Agent-Token: <any-string>` header

3. Without these headers, Cloudflare may return a 403 error. Update all agent implementations to include one of these headers.

4. Match logic changes:
   - Win condition is **first to 3** (default, configurable via `firstTo`)
   - Rounds capped at `bestOf` (default 5)
   - Missing intents trigger **draw** or **extend** (no auto-loss)
   - Clash resolution uses timing-aware logic: feint can punish early commits
   - Double commits/feints/windUps result in draws
   - All clash events include a `reason` field explaining the outcome
   - `lastClash` and `history` available in GET /rooms/:id
