import Phaser from 'phaser';
import { Agent } from '../ai/Agent';
import { eventBus } from '../bus/EventBus';

const WIND_UP_DURATION = 800; // Time for wind-up phase
const MAX_ROUND_TIME = 2000; // Max time for a round

export class DuelScene extends Phaser.Scene {
  private agent1!: Agent;
  private agent2!: Agent;
  private sprite1!: Phaser.GameObjects.Graphics;
  private sprite2!: Phaser.GameObjects.Graphics;
  private cooldownRing1!: Phaser.GameObjects.Arc;
  private cooldownRing2!: Phaser.GameObjects.Arc;
  private chargeBar1!: Phaser.GameObjects.Graphics;
  private chargeBar2!: Phaser.GameObjects.Graphics;
  private stanceLabel1!: Phaser.GameObjects.Text;
  private stanceLabel2!: Phaser.GameObjects.Text;
  private stanceRing1!: Phaser.GameObjects.Arc;
  private stanceRing2!: Phaser.GameObjects.Arc;

  private roundActive = false;
  private roundStartTime = 0;
  private agent1CommitTime = 0;
  private agent2CommitTime = 0;
  private currentRound = 0;
  private matchActive = false;
  private spectatorMode = false;

  constructor() {
    super({ key: 'DuelScene' });
  }

  create(): void {
    // Detect spectator mode by reading URL params directly
    // This is more reliable than reading from game.config custom fields
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    this.spectatorMode = !!roomParam;

    // Light arena background
    this.cameras.main.setBackgroundColor('#e8f4f8');

    // Initialize agents with placeholder names in spectator mode
    const agent1Name = this.spectatorMode ? 'Agent A' : 'BlitzBot';
    const agent2Name = this.spectatorMode ? 'Agent B' : 'ShieldWall';
    
    this.agent1 = new Agent(agent1Name, 'aggressive', 0x2196f3); // Blue
    this.agent2 = new Agent(agent2Name, 'turtle', 0xff9800); // Orange

    this.createVisuals();

    if (this.spectatorMode) {
      console.log('[DuelScene] Spectator mode enabled (room=' + roomParam + '): listening for remote events only, NOT starting local AI');
      this.setupSpectatorListeners();
    } else {
      console.log('[DuelScene] Local mode: starting auto-play match');
      this.startMatch();
    }
  }

  private createVisuals(): void {
    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;

    // Agent 1 (left) - blue circle
    this.sprite1 = this.add.graphics();
    this.drawAgentSprite(this.sprite1, centerX - 200, centerY, this.agent1.state.color, 'idle');

    // Agent 2 (right) - orange circle
    this.sprite2 = this.add.graphics();
    this.drawAgentSprite(this.sprite2, centerX + 200, centerY, this.agent2.state.color, 'idle');

    // Cooldown rings
    this.cooldownRing1 = this.add.circle(centerX - 200, centerY, 55, 0x666666, 0);
    this.cooldownRing1.setStrokeStyle(4, 0x666666, 0.3);

    this.cooldownRing2 = this.add.circle(centerX + 200, centerY, 55, 0x666666, 0);
    this.cooldownRing2.setStrokeStyle(4, 0x666666, 0.3);

    // Stance rings - larger, colored rings that appear during actions
    this.stanceRing1 = this.add.circle(centerX - 200, centerY, 70, 0x000000, 0);
    this.stanceRing1.setStrokeStyle(6, 0x000000, 0);

    this.stanceRing2 = this.add.circle(centerX + 200, centerY, 70, 0x000000, 0);
    this.stanceRing2.setStrokeStyle(6, 0x000000, 0);

    // Stance labels
    this.stanceLabel1 = this.add.text(centerX - 200, centerY + 80, '', {
      fontSize: '16px',
      fontFamily: 'Arial, sans-serif',
      color: '#333',
      fontStyle: 'bold',
      align: 'center',
      backgroundColor: 'rgba(255, 255, 255, 0.9)',
      padding: { x: 8, y: 4 }
    });
    this.stanceLabel1.setOrigin(0.5, 0.5);
    this.stanceLabel1.setVisible(false);

    this.stanceLabel2 = this.add.text(centerX + 200, centerY + 80, '', {
      fontSize: '16px',
      fontFamily: 'Arial, sans-serif',
      color: '#333',
      fontStyle: 'bold',
      align: 'center',
      backgroundColor: 'rgba(255, 255, 255, 0.9)',
      padding: { x: 8, y: 4 }
    });
    this.stanceLabel2.setOrigin(0.5, 0.5);
    this.stanceLabel2.setVisible(false);

    // Charge bars
    this.chargeBar1 = this.add.graphics();
    this.chargeBar2 = this.add.graphics();
  }

  private updateStanceVisuals(
    agent: Agent,
    sprite: Phaser.GameObjects.Graphics,
    label: Phaser.GameObjects.Text,
    ring: Phaser.GameObjects.Arc,
    state: 'idle' | 'windUp' | 'commit' | 'feint' | 'triumph' | 'panic'
  ): void {
    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;
    const x = sprite === this.sprite1 ? centerX - 200 : centerX + 200;

    this.drawAgentSprite(sprite, x, centerY, agent.state.color, state);

    // Update stance label and ring
    switch (state) {
      case 'windUp':
        label.setText('WIND-UP');
        label.setVisible(true);
        ring.setStrokeStyle(6, 0x4caf50, 0.7);
        break;
      case 'feint':
        label.setText('FEINT');
        label.setVisible(true);
        ring.setStrokeStyle(6, 0xffeb3b, 0.9);
        break;
      case 'commit':
        label.setText('COMMIT');
        label.setVisible(true);
        ring.setStrokeStyle(6, 0xff5722, 0.9);
        break;
      case 'triumph':
        label.setText('WIN');
        label.setVisible(true);
        ring.setStrokeStyle(6, 0x4caf50, 0.8);
        break;
      case 'panic':
        label.setText('PANIC');
        label.setVisible(true);
        ring.setStrokeStyle(6, 0x9e9e9e, 0.6);
        break;
      default:
        label.setVisible(false);
        ring.setStrokeStyle(6, 0x000000, 0);
        break;
    }
  }

  private drawAgentSprite(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    color: number,
    state: 'idle' | 'windUp' | 'commit' | 'feint' | 'triumph' | 'panic'
  ): void {
    graphics.clear();

    // More pronounced scale changes
    const scale = state === 'windUp' ? 1.2 : state === 'commit' ? 0.85 : state === 'feint' ? 1.15 : 1.0;
    const radius = 40 * scale;
    // More pronounced alpha for feint
    const alpha = state === 'feint' ? 0.35 : 1.0;

    // Main body circle
    graphics.fillStyle(color, alpha);
    graphics.fillCircle(x, y, radius);

    // Eyes based on state
    graphics.fillStyle(0x000000, alpha);
    if (state === 'triumph') {
      // Happy eyes (^_^)
      graphics.fillCircle(x - 12, y - 8, 3);
      graphics.fillCircle(x + 12, y - 8, 3);
    } else if (state === 'panic') {
      // Wide eyes (O_O)
      graphics.fillCircle(x - 12, y - 8, 6);
      graphics.fillCircle(x + 12, y - 8, 6);
    } else {
      // Normal eyes
      graphics.fillCircle(x - 12, y - 8, 4);
      graphics.fillCircle(x + 12, y - 8, 4);
    }

    // Mouth
    if (state === 'triumph') {
      graphics.lineStyle(2, 0x000000, alpha);
      graphics.beginPath();
      graphics.arc(x, y + 5, 15, 0, Math.PI, false);
      graphics.strokePath();
    } else if (state === 'panic') {
      graphics.fillCircle(x, y + 10, 8);
    }
  }

  private startMatch(): void {
    this.matchActive = true;
    this.currentRound = 0;
    this.agent1.state.score = 0;
    this.agent2.state.score = 0;

    eventBus.emit('match:start', {
      agent1: this.agent1.state.name,
      agent2: this.agent2.state.name,
    });

    // Start first round after a short delay
    this.time.delayedCall(1000, () => this.startRound());
  }

  private startRound(): void {
    if (this.agent1.state.score >= 3 || this.agent2.state.score >= 3) {
      this.endMatch();
      return;
    }

    this.currentRound++;
    this.roundActive = true;
    this.roundStartTime = Date.now();

    this.agent1.resetForRound();
    this.agent2.resetForRound();

    eventBus.emit('round:start', { round: this.currentRound });

    // Both agents decide their commit timings
    this.agent1CommitTime = this.agent1.decideCommitTiming(this.roundStartTime);
    this.agent2CommitTime = this.agent2.decideCommitTiming(this.roundStartTime);

    // Start wind-up phase
    this.time.delayedCall(200, () => {
      this.agent1.state.isWindingUp = true;
      this.agent2.state.isWindingUp = true;
      this.agent1.updateMood('Charging...');
      this.agent2.updateMood('Charging...');
      this.updateStanceVisuals(this.agent1, this.sprite1, this.stanceLabel1, this.stanceRing1, 'windUp');
      this.updateStanceVisuals(this.agent2, this.sprite2, this.stanceLabel2, this.stanceRing2, 'windUp');
      eventBus.emit('agent:windUp', {
        agent1: this.agent1.state.name,
        agent2: this.agent2.state.name,
      });
    });

    // Check for feints during feint window
    this.time.delayedCall(WIND_UP_DURATION / 2, () => {
      if (this.agent1.shouldFeint()) {
        this.performFeint(this.agent1, this.sprite1);
      }
      if (this.agent2.shouldFeint()) {
        this.performFeint(this.agent2, this.sprite2);
      }
    });

    // Schedule commits
    this.time.delayedCall(this.agent1CommitTime, () => {
      if (this.roundActive && !this.agent1.state.hasCommitted) {
        this.performCommit(this.agent1, this.sprite1);
      }
    });

    this.time.delayedCall(this.agent2CommitTime, () => {
      if (this.roundActive && !this.agent2.state.hasCommitted) {
        this.performCommit(this.agent2, this.sprite2);
      }
    });

    // Check for clash
    this.time.delayedCall(MAX_ROUND_TIME, () => {
      if (this.roundActive) {
        this.resolveClash();
      }
    });
  }

  private performFeint(agent: Agent, sprite: Phaser.GameObjects.Graphics): void {
    agent.state.didFeint = true;
    agent.updateMood('Feinting!');

    const label = sprite === this.sprite1 ? this.stanceLabel1 : this.stanceLabel2;
    const ring = sprite === this.sprite1 ? this.stanceRing1 : this.stanceRing2;
    this.updateStanceVisuals(agent, sprite, label, ring, 'feint');

    eventBus.emit('agent:feint', { agent: agent.state.name });

    // Reset to wind-up after feint
    this.time.delayedCall(200, () => {
      this.updateStanceVisuals(agent, sprite, label, ring, 'windUp');
      agent.updateMood('Charging...');
    });
  }

  private performCommit(agent: Agent, sprite: Phaser.GameObjects.Graphics): void {
    agent.state.hasCommitted = true;
    agent.state.commitTime = Date.now();
    agent.updateMood('Committed!');

    const label = sprite === this.sprite1 ? this.stanceLabel1 : this.stanceLabel2;
    const ring = sprite === this.sprite1 ? this.stanceRing1 : this.stanceRing2;
    this.updateStanceVisuals(agent, sprite, label, ring, 'commit');

    eventBus.emit('agent:commit', { agent: agent.state.name });

    // Check if both committed
    if (this.agent1.state.hasCommitted && this.agent2.state.hasCommitted) {
      this.time.delayedCall(300, () => this.resolveClash());
    }
  }

  private resolveClash(): void {
    if (!this.roundActive) return;
    this.roundActive = false;

    // Determine winner based on commit times and feints
    let winner: Agent;
    let loser: Agent;
    let winnerSprite: Phaser.GameObjects.Graphics;
    let loserSprite: Phaser.GameObjects.Graphics;

    if (!this.agent1.state.hasCommitted && !this.agent2.state.hasCommitted) {
      // Both panicked - random winner
      winner = Math.random() < 0.5 ? this.agent1 : this.agent2;
      loser = winner === this.agent1 ? this.agent2 : this.agent1;
    } else if (!this.agent1.state.hasCommitted) {
      winner = this.agent2;
      loser = this.agent1;
    } else if (!this.agent2.state.hasCommitted) {
      winner = this.agent1;
      loser = this.agent2;
    } else {
      // Both committed - earlier commit wins (with feint penalty)
      const agent1Time = this.agent1.state.commitTime + (this.agent1.state.didFeint ? 100 : 0);
      const agent2Time = this.agent2.state.commitTime + (this.agent2.state.didFeint ? 100 : 0);

      if (agent1Time < agent2Time) {
        winner = this.agent1;
        loser = this.agent2;
      } else {
        winner = this.agent2;
        loser = this.agent1;
      }
    }

    winnerSprite = winner === this.agent1 ? this.sprite1 : this.sprite2;
    loserSprite = winner === this.agent1 ? this.sprite2 : this.sprite1;

    // Hitstop effect
    this.cameras.main.shake(100, 0.002);

    winner.incrementScore();
    winner.updateMood('Victory!');
    loser.updateMood('Defeated...');

    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;
    const x1 = centerX - 200;
    const x2 = centerX + 200;

    const winnerLabel = winner === this.agent1 ? this.stanceLabel1 : this.stanceLabel2;
    const winnerRing = winner === this.agent1 ? this.stanceRing1 : this.stanceRing2;
    const loserLabel = loser === this.agent1 ? this.stanceLabel1 : this.stanceLabel2;
    const loserRing = loser === this.agent1 ? this.stanceRing1 : this.stanceRing2;

    this.updateStanceVisuals(winner, winnerSprite, winnerLabel, winnerRing, 'triumph');
    this.updateStanceVisuals(loser, loserSprite, loserLabel, loserRing, 'panic');

    eventBus.emit('clash:resolve', {
      winner: winner.state.name,
      loser: loser.state.name,
      winnerScore: winner.state.score,
      loserScore: loser.state.score,
    });

    eventBus.emit('round:end', {
      round: this.currentRound,
      winner: winner.state.name,
    });

    // Start next round
    this.time.delayedCall(2000, () => {
      this.updateStanceVisuals(this.agent1, this.sprite1, this.stanceLabel1, this.stanceRing1, 'idle');
      this.updateStanceVisuals(this.agent2, this.sprite2, this.stanceLabel2, this.stanceRing2, 'idle');
      this.startRound();
    });
  }

  private endMatch(): void {
    this.matchActive = false;
    const winner = this.agent1.state.score >= 3 ? this.agent1 : this.agent2;

    eventBus.emit('match:end', {
      winner: winner.state.name,
      finalScoresA: this.agent1.state.score,
      finalScoresB: this.agent2.state.score,
      reason: 'best_of_5_complete',
    });

    // Restart match after delay
    this.time.delayedCall(5000, () => this.startMatch());
  }

  update(): void {
    if (!this.roundActive || !this.agent1.state.isWindingUp) return;

    // Update charge bars
    const elapsed = Date.now() - this.roundStartTime;
    const progress = Math.min(elapsed / MAX_ROUND_TIME, 1);

    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;

    // Agent 1 charge bar
    this.chargeBar1.clear();
    this.chargeBar1.fillStyle(this.agent1.state.hasCommitted ? 0xff5722 : 0x4caf50, 0.8);
    this.chargeBar1.fillRect(centerX - 250, centerY - 80, progress * 100, 10);

    // Agent 2 charge bar
    this.chargeBar2.clear();
    this.chargeBar2.fillStyle(this.agent2.state.hasCommitted ? 0xff5722 : 0x4caf50, 0.8);
    this.chargeBar2.fillRect(centerX + 150, centerY - 80, progress * 100, 10);

    // Update cooldown rings
    const ring1Color = this.agent1.state.hasCommitted ? 0xff5722 : 0x4caf50;
    const ring2Color = this.agent2.state.hasCommitted ? 0xff5722 : 0x4caf50;

    this.cooldownRing1.setStrokeStyle(4, ring1Color, 0.6);
    this.cooldownRing2.setStrokeStyle(4, ring2Color, 0.6);
  }

  getAgent1(): Agent {
    return this.agent1;
  }

  getAgent2(): Agent {
    return this.agent2;
  }

  private setupSpectatorListeners(): void {
    eventBus.on('match:start', (event) => {
      console.log('[DuelScene] Remote match:start', event.payload);
      const payload = event.payload as { seatA: string; seatB: string };
      if (payload.seatA) this.agent1.state.name = payload.seatA;
      if (payload.seatB) this.agent2.state.name = payload.seatB;
      this.agent1.state.score = 0;
      this.agent2.state.score = 0;
      this.matchActive = true;
    });

    eventBus.on('round:start', (event) => {
      console.log('[DuelScene] Remote round:start', event.payload);
      const payload = event.payload as { round: number };
      this.currentRound = payload.round;
      this.roundActive = true;
      this.roundStartTime = Date.now();
      this.agent1.resetForRound();
      this.agent2.resetForRound();
    });

    eventBus.on('agent:windUp', (event) => {
      console.log('[DuelScene] Remote agent:windUp', event.payload);
      this.agent1.state.isWindingUp = true;
      this.agent2.state.isWindingUp = true;
      this.agent1.updateMood('Charging...');
      this.agent2.updateMood('Charging...');
      
      this.updateStanceVisuals(this.agent1, this.sprite1, this.stanceLabel1, this.stanceRing1, 'windUp');
      this.updateStanceVisuals(this.agent2, this.sprite2, this.stanceLabel2, this.stanceRing2, 'windUp');
    });

    eventBus.on('agent:feint', (event) => {
      console.log('[DuelScene] Remote agent:feint', event.payload);
      const payload = event.payload as { agent: string; seat?: string };
      const agent = payload.seat === 'A' || payload.agent === this.agent1.state.name ? this.agent1 : this.agent2;
      const sprite = agent === this.agent1 ? this.sprite1 : this.sprite2;
      const label = agent === this.agent1 ? this.stanceLabel1 : this.stanceLabel2;
      const ring = agent === this.agent1 ? this.stanceRing1 : this.stanceRing2;
      
      agent.state.didFeint = true;
      agent.updateMood('Feinting!');
      
      this.updateStanceVisuals(agent, sprite, label, ring, 'feint');
      
      this.time.delayedCall(200, () => {
        this.updateStanceVisuals(agent, sprite, label, ring, 'windUp');
        agent.updateMood('Charging...');
      });
    });

    eventBus.on('agent:commit', (event) => {
      console.log('[DuelScene] Remote agent:commit', event.payload);
      const payload = event.payload as { agent: string; seat?: string };
      const agent = payload.seat === 'A' || payload.agent === this.agent1.state.name ? this.agent1 : this.agent2;
      const sprite = agent === this.agent1 ? this.sprite1 : this.sprite2;
      const label = agent === this.agent1 ? this.stanceLabel1 : this.stanceLabel2;
      const ring = agent === this.agent1 ? this.stanceRing1 : this.stanceRing2;
      
      agent.state.hasCommitted = true;
      agent.state.commitTime = Date.now();
      agent.updateMood('Committed!');
      
      this.updateStanceVisuals(agent, sprite, label, ring, 'commit');
    });

    eventBus.on('clash:resolve', (event) => {
      console.log('[DuelScene] Remote clash:resolve', event.payload);
      const payload = event.payload as { winner: string; loser: string; winnerScore: number; loserScore: number };
      
      const winner = payload.winner === this.agent1.state.name ? this.agent1 : this.agent2;
      const loser = winner === this.agent1 ? this.agent2 : this.agent1;
      const winnerSprite = winner === this.agent1 ? this.sprite1 : this.sprite2;
      const loserSprite = winner === this.agent1 ? this.sprite2 : this.sprite1;
      const winnerLabel = winner === this.agent1 ? this.stanceLabel1 : this.stanceLabel2;
      const winnerRing = winner === this.agent1 ? this.stanceRing1 : this.stanceRing2;
      const loserLabel = loser === this.agent1 ? this.stanceLabel1 : this.stanceLabel2;
      const loserRing = loser === this.agent1 ? this.stanceRing1 : this.stanceRing2;
      
      this.cameras.main.shake(100, 0.002);
      
      winner.state.score = payload.winnerScore;
      loser.state.score = payload.loserScore;
      winner.updateMood('Victory!');
      loser.updateMood('Defeated...');
      
      this.updateStanceVisuals(winner, winnerSprite, winnerLabel, winnerRing, 'triumph');
      this.updateStanceVisuals(loser, loserSprite, loserLabel, loserRing, 'panic');
    });

    eventBus.on('round:end', (event) => {
      console.log('[DuelScene] Remote round:end', event.payload);
      this.roundActive = false;
      
      this.time.delayedCall(2000, () => {
        this.updateStanceVisuals(this.agent1, this.sprite1, this.stanceLabel1, this.stanceRing1, 'idle');
        this.updateStanceVisuals(this.agent2, this.sprite2, this.stanceLabel2, this.stanceRing2, 'idle');
      });
    });

    eventBus.on('match:end', (event) => {
      console.log('[DuelScene] Remote match:end', event.payload);
      this.matchActive = false;
    });
  }
}
