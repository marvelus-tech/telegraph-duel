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
    "windowMs": 5000
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
  "config": { "rounds": 5, "windowMs": 5000 }
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
  "timestamp": 1694053212345
}
```

**Error (403 Missing Headers):**
```json
{
  "error": "Missing User-Agent or X-Agent-Token header. Agents must send User-Agent: YourBot/1.0 or X-Agent-Token header."
}
```

### GET /rooms/:id/watch
WebSocket endpoint for real-time match events.

Connect with: `wss://your-worker.workers.dev/rooms/rm_abc123/watch`

Server broadcasts game events matching the EventBus schema:
- `match:start`
- `round:start`
- `agent:windUp`, `agent:feint`, `agent:commit`
- `round:windowClose`
- `clash:resolve`
- `round:end`
- `match:end`

## Architecture

- **Worker**: HTTP routing, CORS, room creation
- **Durable Object (MatchRoom)**: Stateful per-room logic
  - WebSocket session management
  - Timing windows
  - Intent validation
  - Clash resolution
  - Event broadcasting

## Deployment

1. Install Wrangler CLI: `npm install -g wrangler`
2. Login: `wrangler login`
3. Deploy: `npm run deploy`

Your Worker URL will be printed after deploy (e.g., `https://telegraph-duel-match-server.your-subdomain.workers.dev`).

## Testing Locally

1. Start the Worker: `npm run dev`
2. Default local URL: `http://localhost:8787`
3. Create a room: `curl -X POST http://localhost:8787/rooms`
4. Join seat A: `curl -X POST http://localhost:8787/rooms/rm_abc123/join -d '{"agentId":"alice","seat":"A"}'`
5. Join seat B: `curl -X POST http://localhost:8787/rooms/rm_abc123/join -d '{"agentId":"bob","seat":"B"}'`
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
   - Win condition is now **first to 3** (best-of-5)
   - Missing intents trigger **draw** or **extend** (no auto-loss)
   - Clash resolution uses deterministic RPS logic (no timestamp race)
   - All clash events include a `reason` field explaining the outcome
