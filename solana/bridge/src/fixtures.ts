import type { MatchServerRoomState } from './types.js';

/**
 * Test fixture: Completed match room
 * 
 * Represents a completed match where:
 * - Agent "alice" (seat A) scored 3 points
 * - Agent "bob" (seat B) scored 2 points
 * - Alice won with windUp beating feint in the last clash
 */
export const COMPLETED_ROOM_FIXTURE: MatchServerRoomState = {
  roomId: 'rm_test_fixture_001',
  status: 'completed',
  seats: {
    A: {
      agentId: 'alice',
      joinedAt: '2026-09-07T05:00:00.000Z',
    },
    B: {
      agentId: 'bob',
      joinedAt: '2026-09-07T05:00:05.000Z',
    },
  },
  currentRound: 5,
  scores: {
    A: 3,
    B: 2,
  },
  config: {
    rounds: 5,
    windowMs: 5000,
    firstTo: 3,
    bestOf: 5,
  },
  createdAt: '2026-09-07T05:00:00.000Z',
  lastClash: {
    round: 5,
    winner: 'A',
    loser: 'B',
    reason: 'windUp_beats_feint',
    stanceA: 'windUp',
    stanceB: 'feint',
  },
  history: [
    {
      round: 1,
      winner: 'A',
      loser: 'B',
      reason: 'windUp_beats_feint',
      stanceA: 'windUp',
      stanceB: 'feint',
    },
    {
      round: 2,
      winner: 'B',
      loser: 'A',
      reason: 'feint_beats_commit',
      stanceA: 'commit',
      stanceB: 'feint',
    },
    {
      round: 3,
      winner: 'A',
      loser: 'B',
      reason: 'commit_beats_windUp',
      stanceA: 'commit',
      stanceB: 'windUp',
    },
    {
      round: 4,
      winner: 'B',
      loser: 'A',
      reason: 'windUp_beats_feint',
      stanceA: 'feint',
      stanceB: 'windUp',
    },
    {
      round: 5,
      winner: 'A',
      loser: 'B',
      reason: 'windUp_beats_feint',
      stanceA: 'windUp',
      stanceB: 'feint',
    },
  ],
};

/**
 * Load fixture from JSON file or return default
 */
export function loadFixture(path?: string): MatchServerRoomState {
  if (path) {
    // In a real implementation, read from file
    // For now, return the default fixture
    console.log(`[Fixture] Loading from ${path} (not implemented, using default)`);
  }
  return COMPLETED_ROOM_FIXTURE;
}
