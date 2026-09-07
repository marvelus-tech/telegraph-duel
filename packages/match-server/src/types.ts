export type Seat = 'A' | 'B';
export type RoomStatus = 'waiting' | 'ready' | 'in_progress' | 'completed';
export type IntentType = 'windUp' | 'feint' | 'commit';

export interface RoomConfig {
  rounds: number;
  windowMs: number;
  firstTo: number;
  bestOf: number;
}

export interface SeatInfo {
  agentId: string;
  joinedAt: string;
}

export interface RoomState {
  roomId: string;
  status: RoomStatus;
  seats: {
    A?: SeatInfo;
    B?: SeatInfo;
  };
  currentRound: number;
  scores: {
    A: number;
    B: number;
  };
  config: RoomConfig;
  createdAt: string;
  roundStartTime?: number;
  roundExtended?: boolean;
  intents: {
    A?: { type: IntentType; round: number; timestamp: number };
    B?: { type: IntentType; round: number; timestamp: number };
  };
}

export interface CreateRoomRequest {
  matchId?: string;
  config?: Partial<RoomConfig>;
}

export interface JoinRoomRequest {
  agentId: string;
  seat: Seat;
}

export interface IntentRequest {
  agentId: string;
  type: IntentType;
  round: number;
}

export interface WSMessage {
  action: 'submitIntent';
  payload: IntentRequest;
}

export interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}
