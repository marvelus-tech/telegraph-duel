import { DurableObject } from 'cloudflare:workers';
import type { RoomState, IntentRequest, GameEvent, Seat, IntentType, RoomConfig, ClashResult } from './types';

const DEFAULT_ROUNDS = 5;
const DEFAULT_WINDOW_MS = 5000;
const WIND_UP_DURATION = 800;
const FEINT_WINDOW = 400;

interface Env {
  // Environment bindings (empty for now)
}

export class MatchRoom extends DurableObject {
  private state: RoomState | null = null;
  private sessions: Set<WebSocket> = new Set();
  private roundTimer: number | null = null;
  private clashResolvedForRound: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<RoomState>('state');
      if (stored) {
        this.state = stored;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname.endsWith('/init') && request.method === 'POST') {
      return this.handleInit(request);
    }
    
    if (url.pathname.endsWith('/watch')) {
      return this.handleWebSocket(request);
    }

    if (request.method === 'GET') {
      return this.handleGetRoom();
    }

    if (request.method === 'POST' && url.pathname.endsWith('/join')) {
      return this.handleJoin(request);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/intent')) {
      return this.handleIntent(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleInit(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { roomId: string; config?: Partial<RoomConfig> };
      
      if (!body.roomId) {
        return new Response(JSON.stringify({ error: 'Missing roomId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      await this.initialize(body.roomId, body.config || {});

      return new Response(JSON.stringify(this.state), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Initialization failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.sessions.add(server);

    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.action === 'submitIntent') {
          this.handleIntentFromWS(data.payload);
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    });

    server.addEventListener('close', () => {
      this.sessions.delete(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async handleGetRoom(): Promise<Response> {
    if (!this.state) {
      return new Response('Room not found', { status: 404 });
    }

    return new Response(JSON.stringify(this.state), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleJoin(request: Request): Promise<Response> {
    const body = await request.json() as { agentId: string; seat: Seat };

    if (!body.agentId || !body.seat) {
      return new Response('Missing agentId or seat', { status: 400 });
    }

    if (body.seat !== 'A' && body.seat !== 'B') {
      return new Response('Invalid seat (must be A or B)', { status: 400 });
    }

    if (!this.state) {
      return new Response('Room not found', { status: 404 });
    }

    if (this.state.seats[body.seat]) {
      return new Response('Seat already taken', { status: 409 });
    }

    this.state.seats[body.seat] = {
      agentId: body.agentId,
      joinedAt: new Date().toISOString(),
    };

    const bothSeated = this.state.seats.A && this.state.seats.B;
    if (bothSeated) {
      this.state.status = 'in_progress';
      this.startMatch();
    }

    await this.saveState();

    return new Response(JSON.stringify({
      roomId: this.state.roomId,
      agentId: body.agentId,
      seat: body.seat,
      status: this.state.status,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleIntent(request: Request): Promise<Response> {
    const body = await request.json() as IntentRequest;
    return this.processIntent(body);
  }

  private async handleIntentFromWS(intent: IntentRequest): Promise<void> {
    await this.processIntent(intent);
  }

  private async processIntent(intent: IntentRequest): Promise<Response> {
    if (!this.state) {
      return new Response(JSON.stringify({ accepted: false, reason: 'room_not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const seat = this.findSeatByAgentId(intent.agentId);
    if (!seat) {
      return new Response(JSON.stringify({ accepted: false, reason: 'not_in_room' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (intent.round !== this.state.currentRound) {
      return new Response(JSON.stringify({ 
        accepted: false, 
        reason: 'wrong_round',
        currentRound: this.state.currentRound 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    this.state.intents[seat] = {
      type: intent.type,
      round: intent.round,
      timestamp: Date.now(),
    };

    await this.saveState();

    this.broadcast({
      type: `agent:${intent.type}`,
      payload: {
        agent: intent.agentId,
        seat,
        round: intent.round,
      },
      timestamp: Date.now(),
    });

    const response: Record<string, unknown> = {
      accepted: true,
      agentId: intent.agentId,
      type: intent.type,
      round: intent.round,
      timestamp: Date.now(),
    };

    // Optionally include lastClash if one just happened
    if (this.state.lastClash) {
      response.lastClash = this.state.lastClash;
    }

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private findSeatByAgentId(agentId: string): Seat | null {
    if (this.state?.seats.A?.agentId === agentId) return 'A';
    if (this.state?.seats.B?.agentId === agentId) return 'B';
    return null;
  }

  async initialize(roomId: string, config: { rounds?: number; windowMs?: number } = {}): Promise<void> {
    this.state = {
      roomId,
      status: 'waiting',
      seats: {},
      currentRound: 0,
      scores: { A: 0, B: 0 },
      config: {
        rounds: config.rounds ?? DEFAULT_ROUNDS,
        windowMs: config.windowMs ?? DEFAULT_WINDOW_MS,
      },
      createdAt: new Date().toISOString(),
      intents: {},
      history: [],
    };
    await this.saveState();
  }

  private async saveState(): Promise<void> {
    if (this.state) {
      await this.ctx.storage.put('state', this.state);
    }
  }

  private startMatch(): void {
    if (!this.state) return;

    this.broadcast({
      type: 'match:start',
      payload: {
        roomId: this.state.roomId,
        seatA: this.state.seats.A!.agentId,
        seatB: this.state.seats.B!.agentId,
        config: this.state.config,
      },
      timestamp: Date.now(),
    });

    setTimeout(() => this.startRound(), 1000);
  }

  private startRound(): void {
    if (!this.state) return;

    const firstTo = Math.ceil(this.state.config.rounds / 2);
    
    // Cap: don't start new round if already hit firstTo OR exceeded bestOf
    if (this.state.currentRound >= this.state.config.rounds ||
        this.state.scores.A >= firstTo || 
        this.state.scores.B >= firstTo) {
      this.endMatch();
      return;
    }

    this.state.currentRound++;
    this.state.intents = {};
    this.state.roundStartTime = Date.now();
    this.clashResolvedForRound = null;

    this.saveState();

    const windowStartMs = this.state.roundStartTime;
    const windowEndMs = windowStartMs + this.state.config.windowMs;

    this.broadcast({
      type: 'round:start',
      payload: {
        round: this.state.currentRound,
        windowStartMs,
        windowEndMs,
      },
      timestamp: Date.now(),
    });

    setTimeout(() => {
      this.broadcast({
        type: 'agent:windUp',
        payload: {
          agent1: this.state?.seats.A?.agentId,
          agent2: this.state?.seats.B?.agentId,
        },
        timestamp: Date.now(),
      });
    }, 200);

    // Clear any existing timer before scheduling new one
    if (this.roundTimer !== null) {
      clearTimeout(this.roundTimer);
    }

    this.roundTimer = setTimeout(() => {
      this.broadcast({
        type: 'round:windowClose',
        payload: {
          round: this.state?.currentRound,
          closedAtMs: Date.now(),
        },
        timestamp: Date.now(),
      });
      this.resolveClash();
    }, this.state.config.windowMs) as unknown as number;
  }

  private resolveClash(): void {
    if (!this.state) return;

    // Prevent double resolve for same round
    if (this.clashResolvedForRound === this.state.currentRound) {
      return;
    }
    this.clashResolvedForRound = this.state.currentRound;

    const intentA = this.state.intents.A;
    const intentB = this.state.intents.B;

    let winner: Seat | null = null;
    let reason = 'unknown';

    if (!intentA && !intentB) {
      winner = Math.random() < 0.5 ? 'A' : 'B';
      reason = 'both_timeout';
    } else if (!intentA) {
      winner = 'B';
      reason = 'opponent_timeout';
    } else if (!intentB) {
      winner = 'A';
      reason = 'opponent_timeout';
    } else {
      // Both submitted intents - apply stance matrix with timing
      if (intentA.type === 'commit' && intentB.type === 'feint') {
        // Check if feint was submitted AFTER commit (baited early commit)
        if (intentB.timestamp > intentA.timestamp) {
          winner = 'B';
          reason = 'feint_punish_early_commit';
        } else {
          winner = 'A';
          reason = 'commit_beats_feint';
        }
      } else if (intentA.type === 'feint' && intentB.type === 'commit') {
        // Check if feint was submitted AFTER commit (baited early commit)
        if (intentA.timestamp > intentB.timestamp) {
          winner = 'A';
          reason = 'feint_punish_early_commit';
        } else {
          winner = 'B';
          reason = 'commit_beats_feint';
        }
      } else if (intentA.type === 'commit' && intentB.type === 'commit') {
        winner = intentA.timestamp < intentB.timestamp ? 'A' : 'B';
        reason = 'commit_vs_commit_first_wins';
      } else if (intentA.type === 'windUp' && intentB.type === 'commit') {
        winner = 'B';
        reason = 'commit_beats_windUp';
      } else if (intentA.type === 'commit' && intentB.type === 'windUp') {
        winner = 'A';
        reason = 'commit_beats_windUp';
      } else {
        // windUp vs windUp, feint vs feint, or other combos - random
        winner = Math.random() < 0.5 ? 'A' : 'B';
        reason = 'mirror_or_random';
      }
    }

    const loser: Seat = winner === 'A' ? 'B' : 'A';
    this.state.scores[winner]++;

    // Record clash result
    const clashResult: ClashResult = {
      round: this.state.currentRound,
      winner,
      loser,
      reason,
      stanceA: intentA?.type || null,
      stanceB: intentB?.type || null,
    };

    this.state.lastClash = clashResult;
    this.state.history.push(clashResult);

    this.saveState();

    this.broadcast({
      type: 'clash:resolve',
      payload: {
        round: this.state.currentRound,
        seatA: this.state.seats.A?.agentId,
        seatB: this.state.seats.B?.agentId,
        winner: this.state.seats[winner]?.agentId,
        loser: this.state.seats[loser]?.agentId,
        outcome: winner,
        reason,
        damage: 1,
        winnerScore: this.state.scores[winner],
        loserScore: this.state.scores[loser],
      },
      timestamp: Date.now(),
    });

    this.broadcast({
      type: 'round:end',
      payload: {
        round: this.state.currentRound,
        winner: this.state.seats[winner]?.agentId,
        scoresA: this.state.scores.A,
        scoresB: this.state.scores.B,
      },
      timestamp: Date.now(),
    });

    setTimeout(() => this.startRound(), 2000);
  }

  private endMatch(): void {
    if (!this.state) return;

    // Clear any pending timers
    if (this.roundTimer !== null) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }

    const firstTo = Math.ceil(this.state.config.rounds / 2);
    const winner = this.state.scores.A >= firstTo ? 'A' : 'B';
    const loser = winner === 'A' ? 'B' : 'A';

    this.broadcast({
      type: 'match:end',
      payload: {
        winner: this.state.seats[winner]?.agentId,
        finalScoresA: this.state.scores.A,
        finalScoresB: this.state.scores.B,
        reason: `best_of_${this.state.config.rounds}_complete`,
      },
      timestamp: Date.now(),
    });

    this.state.status = 'completed';
    this.saveState();
  }

  private broadcast(event: GameEvent): void {
    const message = JSON.stringify(event);
    this.sessions.forEach((ws) => {
      try {
        ws.send(message);
      } catch (e) {
        console.error('Broadcast error:', e);
      }
    });
  }
}
