// AI agent personality types
export type AgentPersonality = 'aggressive' | 'turtle';

export interface AgentState {
  name: string;
  personality: AgentPersonality;
  color: number;
  mood: string;
  score: number;
  isWindingUp: boolean;
  hasCommitted: boolean;
  commitTime: number;
  didFeint: boolean;
}

export class Agent {
  state: AgentState;

  constructor(name: string, personality: AgentPersonality, color: number) {
    this.state = {
      name,
      personality,
      color,
      mood: 'Ready',
      score: 0,
      isWindingUp: false,
      hasCommitted: false,
      commitTime: 0,
      didFeint: false,
    };
  }

  // Decide when to commit based on personality
  // Returns time in ms (0-1000) when agent will commit
  decideCommitTiming(_roundStartTime: number): number {
    if (this.state.personality === 'aggressive') {
      // Commits early (300-500ms)
      return 300 + Math.random() * 200;
    } else {
      // Turtle: waits longer (600-900ms)
      return 600 + Math.random() * 300;
    }
  }

  // Decide whether to feint
  shouldFeint(): boolean {
    if (this.state.personality === 'aggressive') {
      // Aggressive rarely feints (10%)
      return Math.random() < 0.1;
    } else {
      // Turtle feints more often (40%)
      return Math.random() < 0.4;
    }
  }

  resetForRound(): void {
    this.state.isWindingUp = false;
    this.state.hasCommitted = false;
    this.state.commitTime = 0;
    this.state.didFeint = false;
    this.state.mood = 'Ready';
  }

  updateMood(mood: string): void {
    this.state.mood = mood;
  }

  incrementScore(): void {
    this.state.score++;
  }
}
