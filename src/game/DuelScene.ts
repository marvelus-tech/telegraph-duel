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

  private roundActive = false;
  private roundStartTime = 0;
  private agent1CommitTime = 0;
  private agent2CommitTime = 0;
  private currentRound = 0;
  private matchActive = false;

  constructor() {
    super({ key: 'DuelScene' });
  }

  create(): void {
    // Light arena background
    this.cameras.main.setBackgroundColor('#e8f4f8');

    // Initialize agents
    this.agent1 = new Agent('BlitzBot', 'aggressive', 0x2196f3); // Blue
    this.agent2 = new Agent('ShieldWall', 'turtle', 0xff9800); // Orange

    this.createVisuals();
    this.startMatch();
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

    // Charge bars
    this.chargeBar1 = this.add.graphics();
    this.chargeBar2 = this.add.graphics();
  }

  private drawAgentSprite(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    color: number,
    state: 'idle' | 'windUp' | 'commit' | 'feint' | 'triumph' | 'panic'
  ): void {
    graphics.clear();

    const scale = state === 'windUp' ? 1.1 : state === 'commit' ? 0.9 : 1.0;
    const radius = 40 * scale;
    const alpha = state === 'feint' ? 0.5 : 1.0;

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

    const x = sprite === this.sprite1 ? this.cameras.main.width / 2 - 200 : this.cameras.main.width / 2 + 200;
    const y = this.cameras.main.height / 2;
    this.drawAgentSprite(sprite, x, y, agent.state.color, 'feint');

    eventBus.emit('agent:feint', { agent: agent.state.name });

    // Reset to wind-up after feint
    this.time.delayedCall(200, () => {
      this.drawAgentSprite(sprite, x, y, agent.state.color, 'windUp');
      agent.updateMood('Charging...');
    });
  }

  private performCommit(agent: Agent, sprite: Phaser.GameObjects.Graphics): void {
    agent.state.hasCommitted = true;
    agent.state.commitTime = Date.now();
    agent.updateMood('Committed!');

    const x = sprite === this.sprite1 ? this.cameras.main.width / 2 - 200 : this.cameras.main.width / 2 + 200;
    const y = this.cameras.main.height / 2;
    this.drawAgentSprite(sprite, x, y, agent.state.color, 'commit');

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

    this.drawAgentSprite(winnerSprite, winner === this.agent1 ? x1 : x2, centerY, winner.state.color, 'triumph');
    this.drawAgentSprite(loserSprite, loser === this.agent1 ? x1 : x2, centerY, loser.state.color, 'panic');

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
      const x1 = centerX - 200;
      const x2 = centerX + 200;
      this.drawAgentSprite(this.sprite1, x1, centerY, this.agent1.state.color, 'idle');
      this.drawAgentSprite(this.sprite2, x2, centerY, this.agent2.state.color, 'idle');
      this.startRound();
    });
  }

  private endMatch(): void {
    this.matchActive = false;
    const winner = this.agent1.state.score >= 3 ? this.agent1 : this.agent2;

    eventBus.emit('match:end', {
      winner: winner.state.name,
      finalScore1: this.agent1.state.score,
      finalScore2: this.agent2.state.score,
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
}
