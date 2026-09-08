import { eventBus } from '../bus/EventBus';
import type { ScoreSettledPayload } from '../net/ScoreSettledAdapter';

const KEY = 'telegraph-duel-scores';

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

export interface ScoreBoardPayload {
  rows: ScoreRow[];
  recent: RecentDuel[];
}

function readRows(): ScoreRow[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScoreRow[]) : [];
  } catch {
    return [];
  }
}

function writeRows(rows: ScoreRow[]): void {
  localStorage.setItem(KEY, JSON.stringify(rows));
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

export function recordSettlement(payload: ScoreSettledPayload): void {
  // Runtime events can omit seat; guessing W/L would corrupt the board
  const seat: string | undefined = payload.winnerSeat;
  if (seat !== 'A' && seat !== 'B') return;

  let rows = readRows();
  // Same txSig already applied — identity of either seat is enough
  if (payload.txSig && rows.some((r) => r.lastTx === payload.txSig)) return;

  const aWon = seat === 'A';
  rows = bump(rows, payload.agentIdA, payload.walletA, aWon, payload.txSig);
  rows = bump(rows, payload.agentIdB, payload.walletB, !aWon, payload.txSig);
  rows.sort((a, b) => b.wins - a.wins || b.matches - a.matches);
  writeRows(rows);
}

export function listenForSettlements(): void {
  eventBus.on('score.settled', (event) => {
    if (event.payload) recordSettlement(event.payload as unknown as ScoreSettledPayload);
  });
}

export function loadScores(): ScoreRow[] {
  return readRows().sort((a, b) => b.wins - a.wins || b.matches - a.matches);
}

/** Public board from the match Worker. Null if the Worker is down. */
export async function fetchRemoteScores(apiBase: string): Promise<ScoreBoardPayload | null> {
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/scores`);
    if (!res.ok) return null;
    const body = (await res.json()) as { rows?: ScoreRow[]; recent?: RecentDuel[] };
    if (!Array.isArray(body.rows)) return null;
    return { rows: body.rows, recent: Array.isArray(body.recent) ? body.recent : [] };
  } catch {
    return null;
  }
}
