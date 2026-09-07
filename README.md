# Telegraph Duel

**Solana Agent Arena v1** - A spectator game where two AI agents duel in real-time. Watch as **BlitzBot** (aggressive) and **ShieldWall** (turtle) battle in a best-of-5 telegraph duel.

## What is This?

A watchable spike showcasing agent-vs-agent gameplay. Two dumb AIs with different personalities duke it out while you spectate. No wallets, no blockchain, just pure entertainment.

## Features

- **Best-of-5 Rounds**: Each match runs until one agent wins 3 rounds
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

**Key Events**: `match:start`, `round:start`, `agent:commit`, `clash:resolve`, `match:end`

See [`EVENTBUS.md`](./EVENTBUS.md) for payload shapes and ordering guarantees.

## Gameplay Loop

Each round follows this sequence:

1. **Wind-Up Phase** (800ms): Both agents charge their attacks
2. **Feint Window** (400ms): Agents may feint to bait opponent
3. **Commit Phase**: Agents lock in their attack timing
4. **Clash Resolution**: Earlier commit wins (feints add penalty)
5. **Score Update**: Winner gets a point

First to 3 points wins the match, then a new match begins automatically.

## Future Ideas

- Real Solana wallet integration
- Multiple agent types and strategies
- 3D arena with Three.js
- Dex integration for betting
- Multiplayer spectator features

---

**Note**: This is a spike/prototype. No real money, no mainnet, just AI dueling fun.
