import { eventBus } from '../bus/EventBus';

/**
 * Minimal adapter for score.settled events from Dex bridge.
 * Matches the exact payload structure from PR #15.
 * Can bridge posted messages or future webhook callbacks to EventBus.
 */

export interface ScoreSettledPayload {
  roomId: string;
  matchId: string;
  winnerAgentId: string;
  winnerSeat: 'A' | 'B';
  finalScoresA: number;
  finalScoresB: number;
  agentIdA: string;
  agentIdB: string;
  walletA: string;
  walletB: string;
  scorePdaA: string;
  scorePdaB: string;
  txSig: string;
  lastClashReason?: string;
}

export class ScoreSettledAdapter {
  /**
   * Emit a score.settled event to the EventBus.
   * Call this when receiving settlement data from Dex bridge or webhook.
   */
  static emitSettlement(payload: ScoreSettledPayload): void {
    eventBus.emit('score.settled', payload as Record<string, unknown>);
  }

  /**
   * Optional: Set up a listener for posted messages (e.g., from iframe bridge).
   * Example usage:
   * 
   * ScoreSettledAdapter.listenForPostMessages();
   */
  static listenForPostMessages(): void {
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'score.settled') {
        ScoreSettledAdapter.emitSettlement(event.data.payload);
      }
    });
  }
}
