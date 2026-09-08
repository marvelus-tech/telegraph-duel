import { loadScores, fetchRemoteScores, type RecentDuel, type ScoreRow } from './scores/scoreStore';
import { looksLikeSolanaSig } from './game/clashCopy';
import './style.css';

const BASE = import.meta.env.BASE_URL;
const DEFAULT_API = 'https://telegraph-duel-match-server.marvelus.workers.dev';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function short(value: string | undefined, n = 8): string {
  if (!value) return '-';
  return value.length <= n + 3 ? value : `${value.slice(0, n)}…`;
}

function lastTxCell(tx: string | undefined): string {
  if (!tx || !looksLikeSolanaSig(tx)) return '-';
  const label = escapeHtml(short(tx));
  const href = `https://solscan.io/tx/${encodeURIComponent(tx)}?cluster=devnet`;
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function scoresApi(): string {
  return new URLSearchParams(window.location.search).get('api')?.trim() || DEFAULT_API;
}

function watchHref(roomId: string): string {
  const q = new URLSearchParams();
  q.set('room', roomId);
  q.set('api', scoresApi());
  return `${BASE}?${q.toString()}`;
}

function watchCell(roomId: string | undefined): string {
  if (!roomId) return '-';
  return `<a class="watch-link" href="${escapeHtml(watchHref(roomId))}">Watch</a>`;
}

function arenaHref(): string {
  const params = new URLSearchParams(window.location.search);
  const next = new URLSearchParams();
  const room = params.get('room');
  const api = params.get('api');
  if (room) next.set('room', room);
  if (api) next.set('api', api);
  const q = next.toString();
  return `${BASE}${q ? `?${q}` : ''}`;
}

function walletFilter(): string {
  return new URLSearchParams(window.location.search).get('wallet')?.trim() ?? '';
}

function matchesFilter(row: ScoreRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return row.agentId.toLowerCase().includes(needle) || (row.wallet?.toLowerCase().includes(needle) ?? false);
}

function rowHtml(row: ScoreRow, i: number): string {
  return `<tr>
    <td>${i + 1}</td>
    <td><strong>${escapeHtml(row.agentId)}</strong></td>
    <td>${escapeHtml(short(row.wallet, 6))}</td>
    <td>${row.wins}</td>
    <td>${row.losses}</td>
    <td>${row.matches}</td>
    <td>${watchCell(row.lastRoom)}</td>
    <td>${lastTxCell(row.lastTx)}</td>
  </tr>`;
}

function recentHtml(duel: RecentDuel): string {
  const score = `${duel.scoresA}-${duel.scoresB}`;
  return `<tr>
    <td><a class="watch-link" href="${escapeHtml(watchHref(duel.roomId))}">${escapeHtml(short(duel.roomId, 10))}</a></td>
    <td>${escapeHtml(duel.agentA)}</td>
    <td>${escapeHtml(duel.agentB)}</td>
    <td>${escapeHtml(score)}</td>
    <td>${escapeHtml(duel.winner ?? 'draw')}</td>
    <td>${watchCell(duel.roomId)}</td>
  </tr>`;
}

function paint(allRows: ScoreRow[], recent: RecentDuel[], source: string): void {
  const app = document.getElementById('app');
  if (!app) return;
  const filter = walletFilter();
  const rows = allRows.filter((row) => matchesFilter(row, filter));

  let table: string;
  if (!allRows.length) {
    table = `<div class="empty-board">
        <p>No completed matches yet.</p>
        <p>Watch a duel. When the match ends, scores and a Watch link land here. No wallet required to spectate.</p>
      </div>`;
  } else if (!rows.length) {
    table = `<div class="empty-board">
        <p>No scores match this filter.</p>
      </div>`;
  } else {
    table = `<table class="score-table">
        <thead>
          <tr><th>#</th><th>Agent</th><th>Wallet</th><th>W</th><th>L</th><th>Matches</th><th>Last room</th><th>Last tx</th></tr>
        </thead>
        <tbody>${rows.map(rowHtml).join('')}</tbody>
      </table>`;
  }

  let recentBlock = '';
  if (recent.length) {
    recentBlock = `
      <h2>Recent duels</h2>
      <p>Replay a completed room. Late join gets the snapshot, not live juice.</p>
      <table class="score-table">
        <thead>
          <tr><th>Room</th><th>Seat A</th><th>Seat B</th><th>Score</th><th>Winner</th><th></th></tr>
        </thead>
        <tbody>${recent.map(recentHtml).join('')}</tbody>
      </table>`;
  }

  const filterNote = filter
    ? `<p>Showing identities matching <code>${escapeHtml(filter)}</code>.</p>`
    : '';

  app.innerHTML = `
    <div class="board-page">
      <div class="board-wrap">
        <nav class="board-nav">
          <a class="nav-link" href="${arenaHref()}">Arena</a>
          <a class="nav-link" href="${BASE}?mode=sumo">Sumo</a>
        </nav>
        <h1>Arena scores</h1>
        <p>Public stake-free board from completed matches. Identity only. Spectating stays open.</p>
        <p class="board-source">${escapeHtml(source)}</p>
        ${filterNote}
        ${table}
        ${recentBlock}
      </div>
    </div>
  `;
}

async function render(): Promise<void> {
  paint(loadScores(), [], 'Loading public board…');
  const remote = await fetchRemoteScores(scoresApi());
  if (remote) {
    paint(remote.rows, remote.recent, 'Public Worker board');
    return;
  }
  const local = loadScores();
  paint(local, [], local.length ? 'This browser only (Worker unreachable)' : 'Public Worker board');
}

void render();
