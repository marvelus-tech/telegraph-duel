/**
 * Demo clash table. Keep in sync with MatchRoom.finalizeClash.
 * Not imported by the Worker this pass (package boundary).
 */
export type ClashStance = 'windUp' | 'feint' | 'commit';
export type ClashSeat = 'A' | 'B';

export interface SeatIntent {
  type: ClashStance;
  timestamp: number;
}

export interface ClashOutcome {
  winner: ClashSeat | null;
  reason: string;
}

export function stanceFromFlags(flags: {
  hasCommitted: boolean;
  commitTime: number;
  didFeint: boolean;
  feintTime: number;
}): SeatIntent {
  if (flags.hasCommitted) return { type: 'commit', timestamp: flags.commitTime };
  if (flags.didFeint) return { type: 'feint', timestamp: flags.feintTime };
  return { type: 'windUp', timestamp: 0 };
}

export function resolveClash(intentA: SeatIntent, intentB: SeatIntent): ClashOutcome {
  const stanceA = intentA.type;
  const stanceB = intentB.type;

  if (stanceA === 'commit' && stanceB === 'commit') {
    return { winner: null, reason: 'draw_double_commit' };
  }
  if (stanceA === 'commit' && stanceB === 'feint') {
    if (intentB.timestamp > intentA.timestamp) {
      return { winner: 'B', reason: 'feint_punish_early_commit' };
    }
    return { winner: 'A', reason: 'commit_beats_feint' };
  }
  if (stanceA === 'feint' && stanceB === 'commit') {
    if (intentA.timestamp > intentB.timestamp) {
      return { winner: 'A', reason: 'feint_punish_early_commit' };
    }
    return { winner: 'B', reason: 'commit_beats_feint' };
  }
  if (stanceA === 'feint' && stanceB === 'windUp') {
    return { winner: 'A', reason: 'feint_beats_windUp' };
  }
  if (stanceA === 'windUp' && stanceB === 'feint') {
    return { winner: 'B', reason: 'feint_beats_windUp' };
  }
  if (stanceA === 'commit' && stanceB === 'windUp') {
    return { winner: 'A', reason: 'commit_beats_windUp' };
  }
  if (stanceA === 'windUp' && stanceB === 'commit') {
    return { winner: 'B', reason: 'commit_beats_windUp' };
  }
  if (stanceA === 'windUp' && stanceB === 'windUp') {
    return { winner: null, reason: 'draw_double_windUp' };
  }
  if (stanceA === 'feint' && stanceB === 'feint') {
    return { winner: null, reason: 'draw_double_feint' };
  }
  return { winner: null, reason: 'draw_unknown' };
}
