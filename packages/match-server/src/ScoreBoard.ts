import { DurableObject } from 'cloudflare:workers';

export interface ScoreRow {
  agentId: string;
  wallet?: string;
  wins: number;
  losses: number;
  matches: number;
  lastTx?: string;
  lastAt: number;
}

interface BoardState {
  rows: ScoreRow[];
  seenTx: string[];
}

function bump(rows: ScoreRow[], agentId: string, wallet: string | undefined, win: boolean, tx?: string): ScoreRow[] {
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
  if (tx) row.lastTx = tx;
  row.lastAt = Date.now();
  return next;
}

export class ScoreBoard extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const state = await this.load();
      return Response.json({ rows: state.rows });
    }
    if (request.method === 'POST') {
      return this.handleBump(request);
    }
    return new Response('Not found', { status: 404 });
  }

  private async load(): Promise<BoardState> {
    return (
      (await this.ctx.storage.get<BoardState>('board')) || { rows: [], seenTx: [] }
    );
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
    const tx = typeof payload.txSig === 'string' ? payload.txSig : '';
    if (tx && state.seenTx.includes(tx)) {
      return Response.json({ ok: true, deduped: true });
    }

    let rows = bump(state.rows, agentIdA, payload.walletA as string | undefined, seat === 'A', tx || undefined);
    rows = bump(rows, agentIdB, payload.walletB as string | undefined, seat === 'B', tx || undefined);
    rows.sort((a, b) => b.wins - a.wins || b.matches - a.matches);
    if (rows.length > 100) rows = rows.slice(0, 100);

    const seenTx = tx ? [...state.seenTx, tx].slice(-200) : state.seenTx;
    await this.ctx.storage.put('board', { rows, seenTx });
    return Response.json({ ok: true });
  }
}
