import { DurableObject } from 'cloudflare:workers';

export interface ScoreRow {
  agentId: string;
  wallet?: string;
  wins: number;
  losses: number;
  matches: number;
  lastTx?: string;
  lastRoom?: string;
  lastAt: number;
}

export interface RecentDuel {
  roomId: string;
  agentA: string;
  agentB: string;
  scoresA: number;
  scoresB: number;
  winner: string | null;
  at: number;
}

function looksLikeSolanaSig(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(value);
}

interface BoardState {
  rows: ScoreRow[];
  seenTx: string[];
  recent: RecentDuel[];
}

function bump(
  rows: ScoreRow[],
  agentId: string,
  wallet: string | undefined,
  win: boolean,
  extra: { tx?: string; room?: string },
): ScoreRow[] {
  const next = [...rows];
  let row = next.find((r) => r.agentId === agentId);
  if (!row) {
    row = { agentId, wallet, wins: 0, losses: 0, matches: 0, lastAt: Date.now() };
    next.push(row);
  }
  row.matches += 1;
  if (win) row.wins += 1;
  else row.losses += 1;
  if (wallet) row.wallet = wallet;
  if (extra.tx) row.lastTx = extra.tx;
  if (extra.room) row.lastRoom = extra.room;
  row.lastAt = Date.now();
  return next;
}

export class ScoreBoard extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const state = await this.load();
      return Response.json({ rows: state.rows, recent: state.recent || [] });
    }
    if (request.method === 'POST') {
      return this.handleBump(request);
    }
    return new Response('Not found', { status: 404 });
  }

  private async load(): Promise<BoardState> {
    const stored = await this.ctx.storage.get<BoardState>('board');
    if (!stored) return { rows: [], seenTx: [], recent: [] };
    return { rows: stored.rows || [], seenTx: stored.seenTx || [], recent: stored.recent || [] };
  }

  private async handleBump(request: Request): Promise<Response> {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const seat = payload.winnerSeat;
    const agentIdA = payload.agentIdA;
    const agentIdB = payload.agentIdB;
    if (seat !== 'A' && seat !== 'B') {
      return Response.json({ error: 'winnerSeat required' }, { status: 400 });
    }
    if (typeof agentIdA !== 'string' || typeof agentIdB !== 'string') {
      return Response.json({ error: 'agent ids required' }, { status: 400 });
    }

    const state = await this.load();
    const txRaw = typeof payload.txSig === 'string' ? payload.txSig : '';
    const tx = looksLikeSolanaSig(txRaw) ? txRaw : '';
    const roomKey = typeof payload.roomId === 'string' && payload.roomId ? `room:${payload.roomId}` : '';

    if (tx && state.seenTx.includes(tx)) {
      return Response.json({ ok: true, deduped: true });
    }

    // match:end already counted this room; Dex POST only attaches lastTx
    if (roomKey && state.seenTx.includes(roomKey)) {
      const room = typeof payload.roomId === 'string' ? payload.roomId : '';
      for (const id of [agentIdA, agentIdB]) {
        const row = state.rows.find((r) => r.agentId === id);
        if (!row) continue;
        if (tx) row.lastTx = tx;
        if (room && !row.lastRoom) row.lastRoom = room;
      }
      if (tx) state.seenTx = [...state.seenTx, tx].slice(-200);
      if (!state.recent) state.recent = [];
      await this.ctx.storage.put('board', state);
      return Response.json({ ok: true, attachedTx: !!tx });
    }

    let rows = bump(state.rows, agentIdA, payload.walletA as string | undefined, seat === 'A', {
      tx: tx || undefined,
      room: payload.roomId as string | undefined,
    });
    rows = bump(rows, agentIdB, payload.walletB as string | undefined, seat === 'B', {
      tx: tx || undefined,
      room: payload.roomId as string | undefined,
    });
    rows.sort((a, b) => b.wins - a.wins || b.matches - a.matches);
    if (rows.length > 100) rows = rows.slice(0, 100);

    const recent = [...(state.recent || [])];
    if (typeof payload.roomId === 'string' && payload.roomId) {
      recent.unshift({
        roomId: payload.roomId,
        agentA: agentIdA,
        agentB: agentIdB,
        scoresA: Number(payload.finalScoresA ?? 0),
        scoresB: Number(payload.finalScoresB ?? 0),
        winner: seat === 'A' ? agentIdA : agentIdB,
        at: Date.now(),
      });
    }

    const seenTx = [...state.seenTx];
    if (roomKey) seenTx.push(roomKey);
    if (tx) seenTx.push(tx);
    await this.ctx.storage.put('board', {
      rows,
      seenTx: seenTx.slice(-200),
      recent: recent.slice(0, 20),
    });
    return Response.json({ ok: true });
  }
}
