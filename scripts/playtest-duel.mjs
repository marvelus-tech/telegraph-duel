/**
 * Two-agent playtest against the match Worker.
 * Spectator must be connected before seats join (rooms do not replay).
 *
 *   npm run playtest
 *   API=http://localhost:8787 npm run playtest
 */
const API = (process.env.API || 'https://telegraph-duel-match-server.marvelus.workers.dev').replace(/\/$/, '');
const PAGES = process.env.PAGES || 'https://marvelus-tech.github.io/telegraph-duel';
const AGENT_A = 'visor-playtest';
const AGENT_B = 'shell-playtest';
const UA = { 'User-Agent': 'PlaytestBot/1.0', 'Content-Type': 'application/json' };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: UA, body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${path} ${res.status} ${text}`);
  return json;
}

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: UA });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return json;
}

function pickIntent(seat, round) {
  // Complementary stances so the match actually scores (double commit is a draw).
  if (seat === 'A') return { type: 'commit', delay: 340 };
  if (round % 2 === 1) return { type: 'feint', delay: 620 };
  return { type: 'windUp', delay: 800 };
}

const created = await post('/rooms', {
  config: { rounds: 5, windowMs: 3000, firstTo: 3, bestOf: 5 },
});
const roomId = created.roomId;
const spectator = `${PAGES}/?room=${encodeURIComponent(roomId)}&api=${encodeURIComponent(API)}`;
console.log('room', roomId);
console.log('spectate', spectator);
console.log('Connect that URL anytime. Replay lands on watch connect.');

await sleep(1500);

const wsUrl = API.replace(/^http/, 'ws') + `/rooms/${roomId}/watch`;
let matchEnd = null;
const scheduled = new Set();

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', () => reject(new Error('watch ws failed')));
});

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data));
  const t = msg.type;
  const p = msg.payload || {};

  if (t === 'match:start') console.log('match:start', p.seatA, 'vs', p.seatB);
  if (t === 'round:start') {
    console.log(`R${p.round} window`);
    for (const [seat, agentId] of [
      ['A', AGENT_A],
      ['B', AGENT_B],
    ]) {
      const key = `${p.round}-${seat}`;
      if (scheduled.has(key)) continue;
      scheduled.add(key);
      const { type, delay } = pickIntent(seat, p.round);
      console.log(`  ${agentId} ${type} in ${delay}ms`);
      setTimeout(() => {
        post(`/rooms/${roomId}/intent`, { agentId, type, round: p.round }).catch((err) =>
          console.error('intent', err.message),
        );
      }, delay);
    }
  }
  if (t === 'clash:resolve') {
    console.log(`  clash ${p.reason} winner=${p.winner ?? 'draw'}`);
  }
  if (t === 'match:end') {
    matchEnd = p;
    console.log('match:end', p);
  }
  if (t === 'score.settled') console.log('score.settled HUD', p.finalScoresA, p.finalScoresB);
});

await post(`/rooms/${roomId}/join`, { agentId: AGENT_A, seat: 'A' });
await post(`/rooms/${roomId}/join`, { agentId: AGENT_B, seat: 'B' });
console.log('seated', AGENT_A, 'vs', AGENT_B);

const deadline = Date.now() + 90_000;
while (!matchEnd && Date.now() < deadline) await sleep(200);
if (!matchEnd) throw new Error('match did not end in 90s');

const room = await get(`/rooms/${roomId}`);
const winnerSeat = room.scores.A === room.scores.B ? null : room.scores.A > room.scores.B ? 'A' : 'B';
const winnerAgentId = winnerSeat === 'A' ? AGENT_A : winnerSeat === 'B' ? AGENT_B : AGENT_A;

ws.close();

const replay = await new Promise((resolve, reject) => {
  const late = new WebSocket(wsUrl);
  const timer = setTimeout(() => {
    late.close();
    reject(new Error('replay timeout'));
  }, 5000);
  late.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.type !== 'room:snapshot') return;
    clearTimeout(timer);
    late.close();
    resolve(msg.payload);
  });
  late.addEventListener('error', () => {
    clearTimeout(timer);
    reject(new Error('replay ws failed'));
  });
});
console.log('replay', replay.status, replay.scoresA, replay.scoresB, 'history', (replay.history || []).length);

console.log('history', (room.history || []).map((h) => `R${h.round} ${h.reason}`).join(' | '));
console.log('final', room.scores, 'winner', winnerAgentId);
try {
  const board = await get('/scores');
  console.log('board', (board.rows || []).map((r) => `${r.agentId} ${r.wins}-${r.losses}`).join(' | ') || '(empty)');
} catch (e) {
  console.error('board', e.message);
}
console.log('spectate', spectator);
console.log('scores', `${PAGES.replace(/\/$/, '')}/leaderboard.html?api=${encodeURIComponent(API)}`);
