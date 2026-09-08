import { DurableObject } from 'cloudflare:workers';
import type { RoomState, IntentRequest, GameEvent, Seat, IntentType, RoomConfig, ClashResult } from './types';

const DEFAULT_ROUNDS = 5;
const DEFAULT_WINDOW_MS = 5000;
const DEFAULT_FIRST_TO = 3;
const DEFAULT_BEST_OF = 5;
const WIND_UP_DURATION = 800;
const FEINT_WINDOW = 400;

interface Env {
  BRIDGE_TOKEN?: string;
  SCORE_BOARD?: DurableObjectNamespace;
}

export class MatchRoom extends DurableObject {
  private state: RoomState | null = null;
  private roundTimer: number | null = null;
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
    
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
      if (!this.validateAgentHeaders(request)) {
        return new Response(JSON.stringify({ 
          error: 'Missing User-Agent or X-Agent-Token header. Agents must send User-Agent: YourBot/1.0 or X-Agent-Token header.' 
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return this.handleJoin(request);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/intent')) {
      if (!this.validateAgentHeaders(request)) {
        return new Response(JSON.stringify({ 
          error: 'Missing User-Agent or X-Agent-Token header. Agents must send User-Agent: YourBot/1.0 or X-Agent-Token header.' 
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return this.handleIntent(request);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/score-settled')) {
      return this.handleScoreSettled(request);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { 
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private validateAgentHeaders(request: Request): boolean {
    const userAgent = request.headers.get('User-Agent');
    const agentToken = request.headers.get('X-Agent-Token');
    return !!(userAgent && userAgent.trim().length > 0) || !!(agentToken && agentToken.trim().length > 0);
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
    this.replayTo(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /** Catch-up for late / reconnecting spectators. Rooms do not otherwise replay. */
  private replayTo(ws: WebSocket): void {
    if (!this.state) return;
    const s = this.state;
    const history = (s.history || []).map((h) => {
      const isDraw = h.reason.startsWith('draw');
      return {
        round: h.round,
        reason: h.reason,
        winner: isDraw ? null : s.seats[h.winner]?.agentId ?? null,
      };
    });
    const winnerSeat = s.scores.A === s.scores.B ? null : s.scores.A > s.scores.B ? 'A' : 'B';
    const event = {
      type: 'room:snapshot',
      payload: {
        roomId: s.roomId,
        status: s.status,
        seatA: s.seats.A?.agentId,
        seatB: s.seats.B?.agentId,
        scoresA: s.scores.A,
        scoresB: s.scores.B,
        currentRound: s.currentRound,
        history,
        matchWinner: winnerSeat && s.status === 'completed' ? s.seats[winnerSeat]?.agentId : null,
        lastSettlement: s.lastSettlement ?? null,
      },
      timestamp: Date.now(),
    };
    try {
      ws.send(JSON.stringify(event));
    } catch (e) {
      console.error('Replay send failed', e);
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string);
      if (data.action === 'submitIntent') {
        await this.handleIntentFromWS(data.payload);
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Cleanup if needed; hibernated sockets are managed by Cloudflare
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

  private async handleScoreSettled(request: Request): Promise<Response> {
    // Optional auth: require X-Bridge-Token if BRIDGE_TOKEN env is set
    if (this.env.BRIDGE_TOKEN) {
      const providedToken = request.headers.get('X-Bridge-Token');
      if (!providedToken || providedToken !== this.env.BRIDGE_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized: invalid or missing X-Bridge-Token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = await request.json() as Record<string, unknown>;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Bridge may POST a typed envelope; WS clients get a flat payload.
    if (
      payload.type === 'score.settled' &&
      payload.payload &&
      typeof payload.payload === 'object'
    ) {
      payload = payload.payload as Record<string, unknown>;
    }

    // Broadcast score.settled event to all WebSocket clients
    this.broadcast({
      type: 'score.settled',
      payload,
      timestamp: Date.now(),
    });

    if (this.state) {
      this.state.lastSettlement = {
        txSig: typeof payload.txSig === 'string' ? payload.txSig : undefined,
        finalScoresA: Number(payload.finalScoresA ?? this.state.scores.A),
        finalScoresB: Number(payload.finalScoresB ?? this.state.scores.B),
        walletA: typeof payload.walletA === 'string' ? payload.walletA : undefined,
        walletB: typeof payload.walletB === 'string' ? payload.walletB : undefined,
      };
      await this.saveState();
    }

    await this.recordBoard(payload);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async recordBoard(payload: Record<string, unknown>): Promise<void> {
    const ns = this.env.SCORE_BOARD;
    if (!ns) return;
    try {
      const stub = ns.get(ns.idFromName('arena'));
      await stub.fetch('https://board/bump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error('ScoreBoard bump failed', e);
    }
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

    if (
      this.state.intents.A &&
      this.state.intents.B &&
      this.state.clashResolvedForRound !== this.state.currentRound
    ) {
      if (this.roundTimer !== null) {
        clearTimeout(this.roundTimer);
        this.roundTimer = null;
      }
      this.resolveClash();
    }

    const response: Record<string, unknown> = {
      accepted: true,
      agentId: intent.agentId,
      type: intent.type,
      round: intent.round,
      timestamp: Date.now(),
    };

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

  async initialize(roomId: string, config: { rounds?: number; windowMs?: number; firstTo?: number; bestOf?: number } = {}): Promise<void> {
    this.state = {
      roomId,
      status: 'waiting',
      seats: {},
      currentRound: 0,
      scores: { A: 0, B: 0 },
      config: {
        rounds: config.rounds ?? DEFAULT_ROUNDS,
        windowMs: config.windowMs ?? DEFAULT_WINDOW_MS,
        firstTo: config.firstTo ?? DEFAULT_FIRST_TO,
        bestOf: config.bestOf ?? DEFAULT_BEST_OF,
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

    // Cap: don't start new round if already hit firstTo OR exceeded bestOf
    if (this.state.scores.A >= this.state.config.firstTo || 
        this.state.scores.B >= this.state.config.firstTo ||
        this.state.currentRound >= this.state.config.bestOf) {
      this.endMatch();
      return;
    }

    this.state.currentRound++;
    this.state.intents = {};
    this.state.roundExtended = false;
    this.state.roundStartTime = Date.now();

    this.saveState();

    const windowStartMs = this.state.roundStartTime;
    const windowEndMs = windowStartMs + this.state.config.windowMs;

    this.broadcast({
      type: 'round:start',
      payload: {
        round: this.state.currentRound,
        windowStartMs,
        windowEndMs,
        firstTo: this.state.config.firstTo,
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

    // Early exit if already resolved for this round
    if (this.state.clashResolvedForRound === this.state.currentRound) {
      return;
    }

    const intentA = this.state.intents.A;
    const intentB = this.state.intents.B;

    // Safety: if both intents exist and roundExtended, resolve immediately
    if (intentA && intentB && this.state.roundExtended) {
      this.finalizeClash(intentA, intentB);
      return;
    }

    // Check for missing intents
    if (!intentA && !intentB) {
      this.broadcastDraw('draw_both_missing');
      return;
    }

    if (!intentA || !intentB) {
      // One missing: extend once if not already extended, else draw
      if (!this.state.roundExtended) {
        this.extendRound();
        return;
      } else {
        this.broadcastDraw('draw_after_extend_miss');
        return;
      }
    }

    // Both have intents: resolve clash with timing-aware logic
    this.finalizeClash(intentA, intentB);
  }

  private getFinalStance(intentType: IntentType): IntentType {
    return intentType;
  }

  private finalizeClash(
    intentA: { type: IntentType; round: number; timestamp: number } | undefined,
    intentB: { type: IntentType; round: number; timestamp: number } | undefined
  ): void {
    if (!this.state) return;

    // NOW set the flag - only when actually finalizing
    this.state.clashResolvedForRound = this.state.currentRound;

    if (!intentA || !intentB) {
      // Should not happen here, but handle defensively
      this.broadcastDraw('draw_missing_intent_in_finalize');
      return;
    }

    const stanceA = this.getFinalStance(intentA.type);
    const stanceB = this.getFinalStance(intentB.type);

    let winner: Seat | null = null;
    let reason = '';

    if (stanceA === 'commit' && stanceB === 'commit') {
      // Double commit = draw
      this.broadcastDraw('draw_double_commit');
      return;
    } else if (stanceA === 'commit' && stanceB === 'feint') {
      // Timing-based: if feint AFTER commit, feint punishes; otherwise commit wins
      if (intentB.timestamp > intentA.timestamp) {
        winner = 'B';
        reason = 'feint_punish_early_commit';
      } else {
        winner = 'A';
        reason = 'commit_beats_feint';
      }
    } else if (stanceA === 'feint' && stanceB === 'commit') {
      // Timing-based: if feint AFTER commit, feint punishes; otherwise commit wins
      if (intentA.timestamp > intentB.timestamp) {
        winner = 'A';
        reason = 'feint_punish_early_commit';
      } else {
        winner = 'B';
        reason = 'commit_beats_feint';
      }
    } else if (stanceA === 'feint' && stanceB === 'windUp') {
      winner = 'A';
      reason = 'feint_beats_windUp';
    } else if (stanceA === 'windUp' && stanceB === 'feint') {
      winner = 'B';
      reason = 'feint_beats_windUp';
    } else if (stanceA === 'commit' && stanceB === 'windUp') {
      winner = 'A';
      reason = 'commit_beats_windUp';
    } else if (stanceA === 'windUp' && stanceB === 'commit') {
      winner = 'B';
      reason = 'commit_beats_windUp';
    } else if (stanceA === 'windUp' && stanceB === 'windUp') {
      // Double windUp = draw
      this.broadcastDraw('draw_double_windUp');
      return;
    } else if (stanceA === 'feint' && stanceB === 'feint') {
      // Double feint = draw
      this.broadcastDraw('draw_double_feint');
      return;
    } else {
      // Fallback: draw if we can't determine
      this.broadcastDraw('draw_unknown');
      return;
    }

    const loser: Seat = winner === 'A' ? 'B' : 'A';
    this.state.scores[winner]++;

    // Record clash result
    const clashResult: ClashResult = {
      round: this.state.currentRound,
      winner,
      loser,
      reason,
      stanceA: intentA.type,
      stanceB: intentB.type,
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
        damage: 1,
        winnerScore: this.state.scores[winner],
        loserScore: this.state.scores[loser],
        reason,
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

  private extendRound(): void {
    if (!this.state) return;

    // Allow the extended window to resolve by clearing the flag
    this.state.clashResolvedForRound = null;

    this.state.roundExtended = true;
    this.saveState();

    const windowStartMs = Date.now();
    const windowEndMs = windowStartMs + this.state.config.windowMs;

    this.broadcast({
      type: 'round:extend',
      payload: {
        round: this.state.currentRound,
        windowStartMs,
        windowEndMs,
      },
      timestamp: Date.now(),
    });

    // Clear existing timer before scheduling extend
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

  private broadcastDraw(reason: string): void {
    if (!this.state) return;

    // Record draw in history
    const clashResult: ClashResult = {
      round: this.state.currentRound,
      winner: 'A',  // Draws don't have winners, but we need valid types
      loser: 'B',
      reason,
      stanceA: this.state.intents.A?.type || null,
      stanceB: this.state.intents.B?.type || null,
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
        winner: null,
        loser: null,
        outcome: 'draw',
        damage: 0,
        winnerScore: this.state.scores.A,
        loserScore: this.state.scores.B,
        reason,
      },
      timestamp: Date.now(),
    });

    this.broadcast({
      type: 'round:end',
      payload: {
        round: this.state.currentRound,
        winner: null,
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

    const a = this.state.scores.A;
    const b = this.state.scores.B;
    const firstTo = this.state.config.firstTo;
    const winner: Seat | null = a > b ? 'A' : b > a ? 'B' : null;
    const reason =
      winner === null
        ? 'draw_best_of_complete'
        : a >= firstTo || b >= firstTo
          ? `first_to_${firstTo}_complete`
          : 'best_of_complete';

    this.broadcast({
      type: 'match:end',
      payload: {
        winner: winner ? this.state.seats[winner]?.agentId : null,
        finalScoresA: a,
        finalScoresB: b,
        reason,
      },
      timestamp: Date.now(),
    });

    this.state.status = 'completed';
    this.saveState();

    if (winner && this.state.seats.A && this.state.seats.B) {
      void this.recordBoard({
        roomId: this.state.roomId,
        winnerSeat: winner,
        agentIdA: this.state.seats.A.agentId,
        agentIdB: this.state.seats.B.agentId,
        finalScoresA: a,
        finalScoresB: b,
      });
    }
  }

  private broadcast(event: GameEvent): void {
    const message = JSON.stringify(event);
    const sockets = this.ctx.getWebSockets();
    sockets.forEach((ws) => {
      try {
        ws.send(message);
      } catch (e) {
        console.error('Broadcast error:', e);
      }
    });
  }
}
