# Telegraph Duel: Seat Connection Design

## Goals

The seat-connection system enables **two separate agent processes** to play Telegraph Duel against each other over the network, while keeping the existing spectator Pages deployment fully watchable.

Key principles:

1. **Spectator compatibility** — The existing Phaser game client remains a passive viewer; all match-room events are broadcast in real-time for spectators to watch.
2. **Separate processes per seat** — Each agent (seat A and seat B) runs as an independent process or service, not embedded in the Phaser client.
3. **Server-authoritative timing & clash resolution** — The match server owns all timing windows, round transitions, and clash outcomes. Agents submit intents; the server validates, applies, and broadcasts results.
4. **EventBus as the client seam** — The Phaser client continues to listen on the EventBus; the match-room WebSocket pushes events that mirror the EventBus schema defined in `EVENTBUS.md`.

---

## HTTP Endpoints (Draft)

The match server exposes REST endpoints for room lifecycle and agent registration.

### `POST /rooms`
Create a new match room.

**Request body:**
```json
{
  "matchId": "optional-custom-id",
  "config": {
    "rounds": 3,
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

### `POST /rooms/:id/join`
Join a room and claim a seat.

**Request body:**
```json
{
  "agentId": "agent-alice",
  "seat": "A"
}
```

Valid seats: `"A"` or `"B"`.

**Response:**
```json
{
  "roomId": "rm_abc123",
  "agentId": "agent-alice",
  "seat": "A",
  "status": "ready"
}
```

**Errors:**
- `409 Conflict` — Seat already taken
- `404 Not Found` — Room does not exist

### `GET /rooms/:id`
Retrieve current room state.

**Response:**
```json
{
  "roomId": "rm_abc123",
  "status": "in_progress",
  "seats": {
    "A": { "agentId": "agent-alice", "joinedAt": "2026-09-07T03:00:00Z" },
    "B": { "agentId": "agent-bob", "joinedAt": "2026-09-07T03:00:05Z" }
  },
  "currentRound": 1,
  "config": {
    "rounds": 3,
    "windowMs": 5000
  }
}
```

---

## Intent API

Agents submit intents during their designated action window. The server validates timing and seat ownership, then broadcasts the result.

### `POST /rooms/:id/intent`

**Request body:**
```json
{
  "agentId": "agent-alice",
  "type": "windUp",
  "round": 1
}
```

**Intent types:**
- `"windUp"` — Commit to a full-power strike
- `"feint"` — Fake out to bait opponent's windUp
- `"commit"` — Confirm final action (may be required after windUp/feint in some rule variants)

**Validation:**
- Agent must own seat A or B in this room
- Intent must arrive during the valid action window for the specified round
- Round number must match server's current round

**Response (success):**
```json
{
  "accepted": true,
  "agentId": "agent-alice",
  "type": "windUp",
  "round": 1,
  "timestamp": "2026-09-07T03:00:12.345Z"
}
```

**Response (error):**
```json
{
  "accepted": false,
  "reason": "window_closed",
  "currentRound": 2
}
```

---

## WebSocket Protocol

Agents and spectators connect to `wss://server/rooms/:id/watch` to receive real-time events.

### Connection

**URL:** `wss://server/rooms/:id/watch?agentId=agent-alice`

The `agentId` query parameter is optional for spectators; required for agents submitting intents.

### Server → Client Events

All events are JSON payloads. The `type` field matches EventBus event names defined in `EVENTBUS.md`.

**Example event:**
```json
{
  "type": "round:start",
  "payload": {
    "round": 1,
    "windowStartMs": 1694053212345,
    "windowEndMs": 1694053217345
  }
}
```

**Event flow for a typical match:**

1. **`match:start`** — Both seats are filled; match begins.
2. **`round:start`** — New round begins; action window opens.
3. **`agent:windUp`**, **`agent:feint`**, **`agent:commit`** — Agents submit intents; server echoes accepted intents to all subscribers.
4. **`round:windowClose`** — Action window ends; no more intents accepted.
5. **`clash:resolve`** — Server computes and broadcasts clash outcome (hit/miss, damage, etc.).
6. **`round:end`** — Round concludes; scores updated.
7. **Repeat steps 2–6** for remaining rounds.
8. **`match:end`** — Final scores and winner declared.

### Client → Server Messages

Agents may send intent submissions over WebSocket as an alternative to the HTTP POST endpoint:

```json
{
  "action": "submitIntent",
  "payload": {
    "agentId": "agent-alice",
    "type": "windUp",
    "round": 1
  }
}
```

The server responds with an acknowledgment or error message.

---

## EventBus Mapping Table

The Phaser client listens on the EventBus for game events. The match-room WebSocket server pushes events that **mirror** these EventBus events, enabling both remote agents and local spectators to observe the same match state.

| WebSocket `type`       | EventBus Event Name    | Payload Shape                                           | Description                                      |
|------------------------|------------------------|---------------------------------------------------------|--------------------------------------------------|
| `match:start`          | `match:start`          | `{ roomId, seatA, seatB, config }`                      | Match begins; both seats are filled.             |
| `round:start`          | `round:start`          | `{ round, windowStartMs, windowEndMs }`                 | New round starts; action window opens.           |
| `agent:windUp`         | `agent:windUp`         | `{ agentId, seat, round }`                              | Agent commits to windUp intent.                  |
| `agent:feint`          | `agent:feint`          | `{ agentId, seat, round }`                              | Agent commits to feint intent.                   |
| `agent:commit`         | `agent:commit`         | `{ agentId, seat, round, finalType }`                   | Agent confirms final action (if required).       |
| `round:windowClose`    | `round:windowClose`    | `{ round, closedAtMs }`                                 | Action window closes; no more intents accepted.  |
| `clash:resolve`        | `clash:resolve`        | `{ round, seatA, seatB, outcome, damage }`              | Server computes clash; broadcasts result.        |
| `round:end`            | `round:end`            | `{ round, scoresA, scoresB }`                           | Round concludes; scores updated.                 |
| `match:end`            | `match:end`            | `{ winner, finalScoresA, finalScoresB, reason }`        | Match concludes; winner declared.                |

**Note:** The Phaser client's EventBus remains unchanged. A thin WebSocket adapter layer listens to the room socket and emits corresponding events onto the local EventBus, allowing the existing Phaser game loop to render match state without modification.

---

## Authentication Stubs

For this design phase, agent identity is handled via a simple **`agentId` string** (e.g., `"agent-alice"`). No signatures or wallet proofs are required yet.

### Future: Dex Wallet Integration

Once Solana integration is implemented (see `solana/` directory), agents will authenticate via:

- **Wallet public key** — The agent's Solana address (e.g., `"9xQeW..."`).
- **Signed challenge** — The server issues a nonce; the agent signs it with their private key; the server verifies the signature before allowing seat claims or intent submissions.

This prevents impersonation and enables on-chain match results (e.g., recording wins/losses, distributing prizes).

**Stub behavior for now:**
- No signature verification.
- `agentId` is any non-empty string; the server trusts it.
- Seats are claimed first-come, first-served by `agentId`.

---

## Out of Scope

This document describes the **seat-connection design** only. The following are explicitly **not covered here** and will be addressed in future work:

1. **Server implementation** — The actual HTTP/WebSocket server code (Node.js, Rust, Python, etc.) is not part of this spec.
2. **Gameplay rewrite** — The Phaser game loop, EventBus types (see `EVENTBUS.md`), and clash resolution logic remain unchanged.
3. **Solana transactions** — On-chain match recording, prize distribution, and wallet authentication are deferred to the `solana/` directory.
4. **Two-agent playtest harness** — A testing framework that spawns two agent processes and runs them against each other is not yet built.
5. **Spectator UI enhancements** — The existing Phaser spectator client is assumed to work as-is; no UI changes for multi-agent matches are designed here.

---

## Next Steps

1. **Implement the match server** — Build HTTP + WebSocket server with room lifecycle, seat claims, and intent validation.
2. **WebSocket → EventBus adapter** — Write a thin client-side layer that subscribes to a room socket and emits events onto the Phaser EventBus.
3. **Agent SDK** — Provide a simple library (TypeScript, Python) for agents to join rooms, submit intents, and listen for match events.
4. **Playtest harness** — Build a test runner that spawns two agent processes, creates a room, and verifies correct match flow.
5. **Solana integration** — Add wallet-based authentication and on-chain match result recording.

---

**For questions or feedback, see the main [README](./README.md).**
