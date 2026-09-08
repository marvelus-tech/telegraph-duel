# Telegraph Duel

**Solana Agent Arena v1** - A spectator game where two AI agents duel in real-time. Watch as **BlitzBot** (aggressive) and **ShieldWall** (turtle) battle in a best-of-5 telegraph duel.

🎮 **[Play Live on GitHub Pages](https://marvelus-tech.github.io/telegraph-duel/)** 🎮

## What is This?

A watchable spike showcasing agent-vs-agent gameplay. Two dumb AIs with different personalities duke it out while you spectate. No wallets, no blockchain, just pure entertainment.

## Features

- **First to 3 (Best-of-5)**: Each match runs until one agent wins 3 rounds
- **Two AI Personalities**:
  - **BlitzBot** (Aggressive): Early commits, rare feints
  - **ShieldWall** (Turtle): Late commits, frequent feints
- **Telegraph Gameplay**: Wind-up → Feint Window → Commit → Clash
- **Live HUD**: Real-time nameplates, score pips, mood indicators, and event log
- **Visual Juice**: Hitstop effects, charge bars, cooldown rings, and sprite states

## Tech Stack

- **Vite** - Fast build tool
- **TypeScript** - Type safety
- **Phaser 3** - 2D game engine
- **DOM HUD** - Overlay UI for spectator info
- **EventBus** - Typed event system for game events

## Pages / routes

Register and click-test these. Vite `base` is `/telegraph-duel/`.

| Surface | URL |
|---------|-----|
| Arena (local demo) | `/telegraph-duel/` |
| Spectator | `/telegraph-duel/?room=<id>&api=<worker>` |
| Scores | `/telegraph-duel/leaderboard.html` (also `?view=scores`). Watch links replay the last room. |
| Sumo spike | `/telegraph-duel/?mode=sumo` |

Arena ↔ Scores keep `?room=` / `?api=` / `?mode=`. No wallet wall on spectate.

## How to Run

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

The game will auto-play continuously. Just open the browser and watch the duels unfold!

## Project Structure

```
src/                      # Game code (Phaser, AI, UI)
├── ai/
│   └── Agent.ts          # AI agent personalities & decision logic
├── bus/
│   └── EventBus.ts       # Typed event system (integration contract)
├── game/
│   └── DuelScene.ts      # Main Phaser game scene
├── ui/
│   └── HUDController.ts  # DOM HUD overlay controller
├── main.ts               # Entry point
└── style.css             # HUD styles

solana/                   # Reserved for Dex's Solana integration
└── README.md             # Placeholder

EVENTBUS.md               # Event contract documentation
```

## Integration Contract

The game emits typed events via `EventBus` (see [`EVENTBUS.md`](./EVENTBUS.md) for complete contract).

External systems can subscribe to game events without coupling to internals:

```typescript
import { eventBus } from './src/bus/EventBus';

eventBus.on('match:start', (event) => {
  console.log('Match started:', event.data);
});
```

**Key Events**: `match:start`, `round:start`, `agent:commit`, `clash:resolve`, `match:end`, `score.settled`

The `score.settled` event fires when Dex settles match scores on-chain (includes tx signature and PDAs).

See [`EVENTBUS.md`](./EVENTBUS.md) for payload shapes and ordering guarantees.

### Multi-Agent Match Rooms

**Status: Implemented (spike)** - See [`SEATS.md`](./SEATS.md) for design spec.

The match server enables two separate agent processes to play against each other over the network via HTTP + WebSocket.

#### Quick Start

1. **Start the match server** (local dev):
   ```bash
   cd packages/match-server
   npm install
   npm run dev
   # Server runs at http://localhost:8787
   ```

2. **Create a room**:
   ```bash
   curl -X POST http://localhost:8787/rooms
   # Returns: {"roomId":"rm_abc123","status":"waiting",...}
   ```

3. **Join seat A** (agent process 1):
   ```bash
   curl -X POST http://localhost:8787/rooms/rm_abc123/join \
     -H "Content-Type: application/json" \
     -d '{"agentId":"agent-alice","seat":"A"}'
   ```

4. **Join seat B** (agent process 2):
   ```bash
   curl -X POST http://localhost:8787/rooms/rm_abc123/join \
     -H "Content-Type: application/json" \
     -d '{"agentId":"agent-bob","seat":"B"}'
   ```

5. **Watch the match** (spectator client):
   ```
   http://localhost:5173/?room=rm_abc123&api=http://localhost:8787
   ```

When both seats join, the server starts the match automatically. Spectators connect via WebSocket and see all events in real-time.

#### Deployment

Deploy the match server to Cloudflare Workers:

```bash
cd packages/match-server
npm run deploy
# Your Worker URL: https://telegraph-duel-match-server.your-subdomain.workers.dev
```

Then spectate with:
```
https://marvelus-tech.github.io/telegraph-duel/?room=rm_abc123&api=https://your-worker.workers.dev
```

#### Architecture

- **Match Server**: `packages/match-server/` (Cloudflare Worker + Durable Object)
  - HTTP endpoints: create rooms, join seats, submit intents
  - WebSocket: real-time event broadcast to spectators
  - Authoritative timing and clash resolution

- **Client**: `src/net/RoomClient.ts` (WebSocket → EventBus adapter)
  - Spectator mode: `?room=<id>` disables local AI loop
  - Events from server are mirrored to EventBus
  - Phaser renders match state from EventBus events

See [`packages/match-server/README.md`](./packages/match-server/README.md) for full API documentation.

## Gameplay Loop

Each round follows this sequence:

1. **Wind-Up Phase** (800ms): Both agents charge their attacks
2. **Feint Window** (400ms): Agents may feint to bait opponent
3. **Commit Phase**: Agents lock in their attack timing
4. **Clash Resolution**: Deterministic RPS-style rules (commit beats feint, feint beats windUp, etc.)
5. **Score Update**: Winner gets a point (or draw if both miss/both commit)

**First to 3** points wins the match, then a new match begins automatically.

## Future Ideas

- Real Solana wallet integration
- Multiple agent types and strategies
- 3D arena with Three.js
- Dex integration for betting
- Multiplayer spectator features

---

**Note**: This is a spike/prototype. No real money, no mainnet, just AI dueling fun.
