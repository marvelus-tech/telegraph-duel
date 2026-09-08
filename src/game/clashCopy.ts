/**
 * Human clash titles for canvas + HUD.
 * Worker still emits snake_case `reason`; spectators never see it raw.
 */
const REASON_COPY: Record<string, string> = {
  feint_punish_early_commit: 'Feint punish',
  commit_beats_feint: 'Commit reads the feint',
  commit_beats_windUp: 'Commit through charge',
  feint_beats_windUp: 'Feint baits the charge',
  draw_both_missing: 'Both miss',
  draw_double_windUp: 'Both miss',
  draw_double_commit: 'Double commit',
  draw_double_feint: 'Both feint',
  draw_missing_intent_in_finalize: 'Both miss',
  draw_unknown: 'Draw',
};

export function clashReasonCopy(reason: string | undefined | null): string {
  if (!reason) return 'Clash';
  return REASON_COPY[reason] ?? 'Clash';
}

export function matchStartNames(payload: Record<string, unknown> | undefined): {
  agent1: string;
  agent2: string;
} {
  const seatA = (payload?.seatA ?? payload?.agent1) as string | undefined;
  const seatB = (payload?.seatB ?? payload?.agent2) as string | undefined;
  return {
    agent1: seatA || 'Seat A',
    agent2: seatB || 'Seat B',
  };
}

const LOCAL_DEMO_NAMES = new Set(['BlitzBot', 'ShieldWall']);

function clampDemoName(name: string, seat: 'A' | 'B'): string {
  if (!name || LOCAL_DEMO_NAMES.has(name)) return seat === 'A' ? 'Seat A' : 'Seat B';
  return name;
}

/** Spectator HUD only. Local demo still uses matchStartNames (BlitzBot / ShieldWall). */
export function spectatorDisplayNames(payload: Record<string, unknown> | undefined): {
  agent1: string;
  agent2: string;
} {
  const names = matchStartNames(payload);
  return {
    agent1: clampDemoName(names.agent1, 'A'),
    agent2: clampDemoName(names.agent2, 'B'),
  };
}

export function waitingOverlayCopy(ended: boolean, roomId: string | null): { title: string; detail: string } {
  return {
    title: ended ? 'Match over - waiting' : 'Waiting for agents',
    detail: roomId ? `room ${roomId}` : '',
  };
}

export function settledBannerCopy(
  a: number,
  b: number,
  txSig?: string | null,
): { score: string; tx: string; log: string } {
  const score = `${a}-${b}`;
  const short = txSig?.slice(0, 8) ?? '';
  const tx = short ? `tx ${short}` : '';
  return {
    score,
    tx,
    log: tx ? `SETTLED ${score} · ${short}` : `SETTLED ${score}`,
  };
}
