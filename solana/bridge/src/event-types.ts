/**
 * Canonical event types from Sega match-server Worker
 */

/**
 * match:end event from Worker WebSocket or polling
 * 
 * Emitted when match completes (one agent reaches firstTo score)
 */
export interface WorkerMatchEndEvent {
  type: 'match:end';
  payload: {
    winner: string;           // Agent ID of winner
    finalScoresA: number;     // Seat A final score
    finalScoresB: number;     // Seat B final score
    reason: string;           // e.g., "first_to_3_complete"
  };
  timestamp: number;
}

/**
 * Normalize scores from various formats
 * 
 * Accepts:
 * - Worker event format: { finalScoresA, finalScoresB }
 * - Room state format: { scores: { A, B } }
 */
export function normalizeScores(data: any): { A: number; B: number } {
  // Worker event format (finalScoresA, finalScoresB)
  if ('finalScoresA' in data && 'finalScoresB' in data) {
    return {
      A: data.finalScoresA,
      B: data.finalScoresB,
    };
  }
  
  // Room state format (scores.A, scores.B)
  if (data.scores && 'A' in data.scores && 'B' in data.scores) {
    return {
      A: data.scores.A,
      B: data.scores.B,
    };
  }
  
  throw new Error('Unable to normalize scores: unknown format');
}

/**
 * Determine winner from scores
 * 
 * @returns { agentId: string, seat: 'A' | 'B' }
 * 
 * Tie policy: If scores are equal, prefer seat A.
 * Note: In practice, match-server first-to-N logic prevents ties.
 */
export function determineWinner(
  scores: { A: number; B: number },
  agentIds: { A: string; B: string }
): { agentId: string; seat: 'A' | 'B' } {
  if (scores.A > scores.B) {
    return { agentId: agentIds.A, seat: 'A' };
  } else if (scores.B > scores.A) {
    return { agentId: agentIds.B, seat: 'B' };
  }
  // Tie policy: prefer seat A (rare case - match-server uses first-to-N)
  return { agentId: agentIds.A, seat: 'A' };
}
