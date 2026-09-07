import { eventBus } from '../bus/EventBus';

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

  constructor(config: RoomConfig) {
    this.config = config;
  }

  connect(): void {
    const wsUrl = this.config.apiBase.replace(/^http/, 'ws') + `/rooms/${this.config.roomId}/watch`;
    
    console.log('[RoomClient] Connecting to', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[RoomClient] Connected');
        this.reconnectAttempts = 0;
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
        this.attemptReconnect();
      };
    } catch (e) {
      console.error('[RoomClient] Failed to create WebSocket:', e);
      this.attemptReconnect();
    }
  }

  private handleServerEvent(message: { type: string; payload: Record<string, unknown>; timestamp: number }): void {
    console.log('[RoomClient] Event:', message.type, message.payload);
    
    eventBus.emit(message.type as any, message.payload);
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[RoomClient] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`[RoomClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => this.connect(), delay);
  }

  disconnect(): void {
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

    const message = {
      action: 'submitIntent',
      payload: { agentId, type, round },
    };

    this.ws.send(JSON.stringify(message));
  }
}
