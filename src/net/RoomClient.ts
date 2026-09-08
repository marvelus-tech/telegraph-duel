import { eventBus, type SpectatorStatus } from '../bus/EventBus';

export interface RoomConfig {
  apiBase: string;
  roomId: string;
}

export class RoomClient {
  private ws: WebSocket | null = null;
  private config: RoomConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private manualClose = false;
  lastStatus: SpectatorStatus = 'connecting';

  constructor(config: RoomConfig) {
    this.config = config;
  }

  connect(): void {
    this.manualClose = false;
    // First dial is CONNECTING; later dials keep RECONNECTING (do not flash CONNECTING).
    this.emitStatus(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');
    const wsUrl = this.config.apiBase.replace(/^http/, 'ws') + `/rooms/${this.config.roomId}/watch`;

    console.log('[RoomClient] Connecting to', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[RoomClient] Connected');
        this.reconnectAttempts = 0;
        this.emitStatus('live');
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleServerEvent(message);
        } catch (e) {
          console.error('[RoomClient] Failed to parse message:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[RoomClient] WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('[RoomClient] Disconnected');
        if (this.manualClose) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.emitStatus('lost');
          return;
        }
        this.emitStatus('reconnecting');
        this.attemptReconnect();
      };
    } catch (e) {
      console.error('[RoomClient] Failed to create WebSocket:', e);
      this.emitStatus('reconnecting');
      this.attemptReconnect();
    }
  }

  private emitStatus(status: SpectatorStatus): void {
    this.lastStatus = status;
    eventBus.emit('spectator:status', { status, roomId: this.config.roomId });
  }

  private handleServerEvent(message: { type: string; payload: Record<string, unknown>; timestamp: number }): void {
    let payload = message.payload;
    // PR #21: bridge may POST an envelope; unwrap so HUD sees flat score.settled fields
    if (
      message.type === 'score.settled' &&
      payload &&
      typeof payload.payload === 'object' &&
      payload.payload !== null &&
      'finalScoresA' in (payload.payload as object)
    ) {
      payload = payload.payload as Record<string, unknown>;
    }
    console.log('[RoomClient] Event:', message.type, payload);
    eventBus.emit(message.type as any, payload);
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[RoomClient] Max reconnection attempts reached');
      this.emitStatus('lost');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[RoomClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  submitIntent(agentId: string, type: 'windUp' | 'feint' | 'commit', round: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[RoomClient] Cannot submit intent: not connected');
      return;
    }

    this.ws.send(JSON.stringify({
      action: 'submitIntent',
      payload: { agentId, type, round },
    }));
  }
}
