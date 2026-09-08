import Phaser from 'phaser';
import { Agent } from '../ai/Agent';
import { eventBus, type AgentPose } from '../bus/EventBus';
import { matchStartNames } from './clashCopy';
import { resolveClash, stanceFromFlags } from './clashResolve';

const WIND_UP_DURATION = 800;
const MAX_ROUND_TIME = 2000;
const POSE_FRAME: Record<AgentPose, number> = {
  idle: 0,
  windUp: 1,
  feint: 2,
  commit: 3,
  clash: 4,
  panic: 5,
  win: 6,
};

export class DuelScene extends Phaser.Scene {
  private agent1!: Agent;
  private agent2!: Agent;
  private gfx1!: Phaser.GameObjects.Graphics;
  private gfx2!: Phaser.GameObjects.Graphics;
  private fighter1: Phaser.GameObjects.Sprite | null = null;
  private fighter2: Phaser.GameObjects.Sprite | null = null;
  private useSprites = false;
  private cooldownRing1!: Phaser.GameObjects.Arc;
  private cooldownRing2!: Phaser.GameObjects.Arc;
  private chargeBar1!: Phaser.GameObjects.Graphics;
  private chargeBar2!: Phaser.GameObjects.Graphics;
  private windowLabel1!: Phaser.GameObjects.Text;
  private windowLabel2!: Phaser.GameObjects.Text;
  private arena!: Phaser.GameObjects.Graphics;

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

  preload(): void {
    const base = import.meta.env.BASE_URL;
    this.load.spritesheet('fighter-a', `${base}assets/fighter-a.png`, {
      frameWidth: 64,
      frameHeight: 64,
    });
    this.load.spritesheet('fighter-b', `${base}assets/fighter-b.png`, {
      frameWidth: 64,
      frameHeight: 64,
    });
  }

  create(): void {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    this.spectatorMode = !!roomParam;

    this.cameras.main.setBackgroundColor('#e8f4f8');

    const agent1Name = this.spectatorMode ? 'Seat A' : 'BlitzBot';
    const agent2Name = this.spectatorMode ? 'Seat B' : 'ShieldWall';

    this.agent1 = new Agent(agent1Name, 'aggressive', 0x2196f3);
    this.agent2 = new Agent(agent2Name, 'turtle', 0xff9800);

    this.createVisuals();

    if (this.spectatorMode) {
      console.log('[DuelScene] Spectator mode enabled (room=' + roomParam + ')');
      this.setupSpectatorListeners();
    } else {
      console.log('[DuelScene] Local mode: starting auto-play match');
      this.startMatch();
    }
  }

  private seatX(seat: 1 | 2): number {
    const centerX = this.cameras.main.width / 2;
    return seat === 1 ? centerX - 200 : centerX + 200;
  }

  private seatY(): number {
    return this.cameras.main.height / 2;
  }

  private createVisuals(): void {
    this.useSprites = this.textures.exists('fighter-a') && this.textures.exists('fighter-b');

    this.drawArena();

    this.gfx1 = this.add.graphics();
    this.gfx2 = this.add.graphics();

    if (this.useSprites) {
      this.fighter1 = this.add.sprite(this.seatX(1), this.seatY(), 'fighter-a', 0);
      this.fighter2 = this.add.sprite(this.seatX(2), this.seatY(), 'fighter-b', 0);
      this.fighter1.setScale(2.4);
      this.fighter2.setScale(2.4);
      this.gfx1.setVisible(false);
      this.gfx2.setVisible(false);
      this.startIdleBob(this.fighter1);
      this.startIdleBob(this.fighter2);
    } else {
      this.drawFallback(this.gfx1, this.seatX(1), this.seatY(), this.agent1.state.color, 'idle');
      this.drawFallback(this.gfx2, this.seatX(2), this.seatY(), this.agent2.state.color, 'idle');
    }

    this.cooldownRing1 = this.add.circle(this.seatX(1), this.seatY(), 70, 0x666666, 0);
    this.cooldownRing1.setStrokeStyle(4, 0x666666, 0.3);
    this.cooldownRing2 = this.add.circle(this.seatX(2), this.seatY(), 70, 0x666666, 0);
    this.cooldownRing2.setStrokeStyle(4, 0x666666, 0.3);

    this.chargeBar1 = this.add.graphics();
    this.chargeBar2 = this.add.graphics();
    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#546e7a',
    };
    this.windowLabel1 = this.add.text(this.seatX(1), this.seatY() - 102, 'window', labelStyle).setOrigin(0.5);
    this.windowLabel2 = this.add.text(this.seatX(2), this.seatY() - 102, 'window', labelStyle).setOrigin(0.5);
    this.windowLabel1.setVisible(false);
    this.windowLabel2.setVisible(false);
  }

  private drawArena(): void {
    this.arena = this.add.graphics();
    const cx = this.cameras.main.width / 2;
    const cy = this.seatY();

    this.arena.fillStyle(0xd2e8ef, 1);
    this.arena.fillEllipse(cx, cy + 48, 640, 168);
    this.arena.lineStyle(3, 0xb7d0d8, 0.9);
    this.arena.strokeEllipse(cx, cy + 48, 640, 168);

    this.arena.lineStyle(2, 0x90a4ae, 0.45);
    this.arena.lineBetween(cx, cy - 36, cx, cy + 108);

    this.arena.fillStyle(0x2196f3, 0.28);
    this.arena.fillEllipse(this.seatX(1), cy + 56, 88, 20);
    this.arena.fillStyle(0xff9800, 0.28);
    this.arena.fillEllipse(this.seatX(2), cy + 56, 88, 20);

    this.arena.fillStyle(0x2196f3, 0.7);
    this.arena.fillTriangle(this.seatX(1) - 10, cy + 70, this.seatX(1) + 10, cy + 70, this.seatX(1), cy + 82);
    this.arena.fillStyle(0xff9800, 0.7);
    this.arena.fillTriangle(this.seatX(2) - 10, cy + 70, this.seatX(2) + 10, cy + 70, this.seatX(2), cy + 82);
  }

  private startIdleBob(spr: Phaser.GameObjects.Sprite): void {
    this.tweens.killTweensOf(spr);
    this.tweens.add({
      targets: spr,
      y: this.seatY() - 5,
      duration: 680,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private dashCommit(spr: Phaser.GameObjects.Sprite, seat: 1 | 2): void {
    const x = this.seatX(seat);
    const y = this.seatY();
    spr.setPosition(x, y);
    this.tweens.add({
      targets: spr,
      x: x + (seat === 1 ? 24 : -24),
      duration: 110,
      ease: 'Cubic.easeOut',
    });
  }

  private setPose(seat: 1 | 2, pose: AgentPose): void {
    const agent = seat === 1 ? this.agent1 : this.agent2;
    const gfx = seat === 1 ? this.gfx1 : this.gfx2;
    const spr = seat === 1 ? this.fighter1 : this.fighter2;
    const x = this.seatX(seat);
    const y = this.seatY();

    if (this.useSprites && spr) {
      this.tweens.killTweensOf(spr);
      spr.setFrame(POSE_FRAME[pose]);
      spr.setAlpha(pose === 'feint' ? 0.55 : 1);
      spr.setPosition(x, y);
      if (pose === 'idle') this.startIdleBob(spr);
      else if (pose === 'commit') this.dashCommit(spr, seat);
    } else {
      this.drawFallback(gfx, x, y, agent.state.color, pose);
    }
  }

  private flashSeat(seat: 1 | 2): void {
    const spr = seat === 1 ? this.fighter1 : this.fighter2;
    if (this.useSprites && spr) {
      spr.setTint(0xffffff);
      this.time.delayedCall(80, () => spr.clearTint());
      return;
    }
    const gfx = seat === 1 ? this.gfx1 : this.gfx2;
    this.drawFallback(gfx, this.seatX(seat), this.seatY(), 0xffffff, 'clash');
    this.time.delayedCall(80, () => {
      this.setPose(seat, 'clash');
    });
  }

  /** Distinct silhouettes if the PNG strip fails to load. */
  private drawFallback(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    color: number,
    pose: AgentPose
  ): void {
    graphics.clear();
    const scale = pose === 'windUp' ? 1.15 : pose === 'commit' ? 0.9 : pose === 'panic' ? 0.85 : 1;
    const radius = 40 * scale;
    const alpha = pose === 'feint' ? 0.45 : 1;
    const lean = pose === 'windUp' ? -12 : pose === 'commit' || pose === 'clash' ? 14 : 0;
    const dir = x < this.cameras.main.width / 2 ? 1 : -1;
    const cx = x + lean * dir;

    graphics.fillStyle(0x000000, 0.12);
    graphics.fillEllipse(x, y + 48, 36, 10);

    graphics.fillStyle(color, alpha);
    graphics.fillCircle(cx, y, radius);
    if (pose === 'commit' || pose === 'clash') {
      graphics.fillRect(cx + 10 * dir - 8, y - 8, 28, 10);
    }
    if (pose === 'windUp') {
      graphics.fillRect(cx - 22 * dir - 6, y - 22, 12, 18);
    }
    if (pose === 'win') {
      graphics.fillRect(cx - 22, y - 36, 8, 20);
      graphics.fillRect(cx + 14, y - 36, 8, 20);
    }
    if (pose === 'clash') {
      graphics.fillStyle(0xffffff, 0.9);
      graphics.fillCircle(cx + 20 * dir, y - 6, 8);
    }

    graphics.fillStyle(0x000000, alpha);
    const eye = pose === 'panic' ? 6 : pose === 'win' ? 2 : 4;
    graphics.fillCircle(cx - 12, y - 8, eye);
    graphics.fillCircle(cx + 12, y - 8, eye);
    if (pose === 'win') {
      graphics.lineStyle(2, 0x000000, alpha);
      graphics.beginPath();
      graphics.arc(cx, y + 6, 12, 0, Math.PI, false);
      graphics.strokePath();
    } else if (pose === 'panic') {
      graphics.fillCircle(cx, y + 10, 7);
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
      seatA: this.agent1.state.name,
      seatB: this.agent2.state.name,
    });

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
    this.setPose(1, 'idle');
    this.setPose(2, 'idle');

    eventBus.emit('round:start', { round: this.currentRound });

    this.agent1CommitTime = this.agent1.decideCommitTiming(this.roundStartTime);
    this.agent2CommitTime = this.agent2.decideCommitTiming(this.roundStartTime);
    const feint1 = this.agent1.shouldFeint();
    const feint2 = this.agent2.shouldFeint();

    this.time.delayedCall(200, () => {
      this.agent1.state.isWindingUp = true;
      this.agent2.state.isWindingUp = true;
      this.agent1.updateMood('Charging...');
      this.agent2.updateMood('Charging...');
      this.setPose(1, 'windUp');
      this.setPose(2, 'windUp');
      eventBus.emit('agent:windUp', {
        agent1: this.agent1.state.name,
        agent2: this.agent2.state.name,
      });
    });

    // Feint holds. A feint that still auto-commits becomes double-commit every round.
    if (feint1) {
      this.time.delayedCall(WIND_UP_DURATION / 2, () => {
        if (this.roundActive) this.performFeint(this.agent1, 1);
      });
    } else {
      this.time.delayedCall(this.agent1CommitTime, () => {
        if (this.roundActive && !this.agent1.state.hasCommitted) this.performCommit(this.agent1, 1);
      });
    }
    if (feint2) {
      this.time.delayedCall(WIND_UP_DURATION / 2, () => {
        if (this.roundActive) this.performFeint(this.agent2, 2);
      });
    } else {
      this.time.delayedCall(this.agent2CommitTime, () => {
        if (this.roundActive && !this.agent2.state.hasCommitted) this.performCommit(this.agent2, 2);
      });
    }

    this.time.delayedCall(MAX_ROUND_TIME, () => {
      if (this.roundActive) this.resolveClash();
    });
  }

  private performFeint(agent: Agent, seat: 1 | 2): void {
    agent.state.didFeint = true;
    agent.state.feintTime = Date.now();
    agent.updateMood('Feinting!');
    this.setPose(seat, 'feint');
    eventBus.emit('agent:feint', { agent: agent.state.name, seat: seat === 1 ? 'A' : 'B' });
  }

  private performCommit(agent: Agent, seat: 1 | 2): void {
    agent.state.hasCommitted = true;
    agent.state.commitTime = Date.now();
    agent.updateMood('Committed!');
    this.setPose(seat, 'commit');
    eventBus.emit('agent:commit', { agent: agent.state.name, seat: seat === 1 ? 'A' : 'B' });

    if (this.agent1.state.hasCommitted && this.agent2.state.hasCommitted) {
      this.time.delayedCall(300, () => this.resolveClash());
    }
  }

  private resolveClash(): void {
    if (!this.roundActive) return;
    this.roundActive = false;
    this.clearWindowMeters();

    const outcome = resolveClash(
      stanceFromFlags(this.agent1.state),
      stanceFromFlags(this.agent2.state)
    );

    this.cameras.main.shake(100, 0.002);
    this.setPose(1, 'clash');
    this.setPose(2, 'clash');
    this.flashSeat(1);
    this.flashSeat(2);

    const isDraw = outcome.winner === null;
    if (isDraw) {
      this.agent1.updateMood('Draw');
      this.agent2.updateMood('Draw');
      this.time.delayedCall(160, () => {
        this.setPose(1, 'panic');
        this.setPose(2, 'panic');
      });
      eventBus.emit('clash:resolve', {
        winner: null,
        loser: null,
        reason: outcome.reason,
        outcome: 'draw',
      });
      eventBus.emit('round:end', { round: this.currentRound, winner: null });
    } else {
      const winner = outcome.winner === 'A' ? this.agent1 : this.agent2;
      const loser = winner === this.agent1 ? this.agent2 : this.agent1;
      winner.incrementScore();
      winner.updateMood('Victory!');
      loser.updateMood('Defeated...');
      this.time.delayedCall(160, () => {
        this.setPose(winner === this.agent1 ? 1 : 2, 'win');
        this.setPose(loser === this.agent1 ? 1 : 2, 'panic');
      });
      eventBus.emit('clash:resolve', {
        winner: winner.state.name,
        loser: loser.state.name,
        winnerScore: winner.state.score,
        loserScore: loser.state.score,
        reason: outcome.reason,
        outcome: outcome.winner,
      });
      eventBus.emit('round:end', {
        round: this.currentRound,
        winner: winner.state.name,
      });
    }

    this.time.delayedCall(2000, () => {
      this.setPose(1, 'idle');
      this.setPose(2, 'idle');
      this.startRound();
    });
  }

  private endMatch(): void {
    this.matchActive = false;
    this.clearWindowMeters();
    const winner = this.agent1.state.score >= 3 ? this.agent1 : this.agent2;
    const loser = winner === this.agent1 ? this.agent2 : this.agent1;
    this.setPose(winner === this.agent1 ? 1 : 2, 'win');
    this.setPose(loser === this.agent1 ? 1 : 2, 'panic');

    eventBus.emit('match:end', {
      winner: winner.state.name,
      finalScoresA: this.agent1.state.score,
      finalScoresB: this.agent2.state.score,
      reason: 'best_of_5_complete',
    });

    this.time.delayedCall(2500, () => this.startMatch());
  }

  private clearWindowMeters(): void {
    this.chargeBar1.clear();
    this.chargeBar2.clear();
    this.windowLabel1.setVisible(false);
    this.windowLabel2.setVisible(false);
    this.cooldownRing1.setStrokeStyle(4, 0x666666, 0.3);
    this.cooldownRing2.setStrokeStyle(4, 0x666666, 0.3);
  }

  update(): void {
    if (!this.roundActive || !this.agent1.state.isWindingUp) return;

    const elapsed = Date.now() - this.roundStartTime;
    const progress = Math.min(elapsed / MAX_ROUND_TIME, 1);
    const y = this.seatY();
    const color1 = this.agent1.state.hasCommitted ? this.agent1.state.color : 0x4caf50;
    const color2 = this.agent2.state.hasCommitted ? this.agent2.state.color : 0x4caf50;

    this.windowLabel1.setVisible(true);
    this.windowLabel2.setVisible(true);

    this.chargeBar1.clear();
    this.chargeBar1.fillStyle(color1, 0.8);
    this.chargeBar1.fillRect(this.seatX(1) - 50, y - 90, progress * 100, 8);

    this.chargeBar2.clear();
    this.chargeBar2.fillStyle(color2, 0.8);
    this.chargeBar2.fillRect(this.seatX(2) - 50, y - 90, progress * 100, 8);

    this.cooldownRing1.setStrokeStyle(4, color1, 0.55);
    this.cooldownRing2.setStrokeStyle(4, color2, 0.55);
  }

  getAgent1(): Agent {
    return this.agent1;
  }

  getAgent2(): Agent {
    return this.agent2;
  }

  private seatFromPayload(payload: { agent?: string; seat?: string }): 1 | 2 {
    if (payload.seat === 'A') return 1;
    if (payload.seat === 'B') return 2;
    if (payload.agent === this.agent1.state.name) return 1;
    return 2;
  }

  private setupSpectatorListeners(): void {
    eventBus.on('match:start', (event) => {
      const names = matchStartNames(event.payload);
      this.agent1.state.name = names.agent1;
      this.agent2.state.name = names.agent2;
      this.agent1.state.score = 0;
      this.agent2.state.score = 0;
      this.matchActive = true;
      this.setPose(1, 'idle');
      this.setPose(2, 'idle');
    });

    eventBus.on('room:snapshot', (event) => {
      const payload = event.payload as {
        seatA?: string;
        seatB?: string;
        scoresA?: number;
        scoresB?: number;
        status?: string;
        matchWinner?: string | null;
      };
      const names = matchStartNames({ seatA: payload.seatA, seatB: payload.seatB });
      this.agent1.state.name = names.agent1;
      this.agent2.state.name = names.agent2;
      this.agent1.state.score = Number(payload.scoresA ?? 0);
      this.agent2.state.score = Number(payload.scoresB ?? 0);
      this.matchActive = payload.status === 'in_progress';
      this.roundActive = payload.status === 'in_progress';
      if (payload.matchWinner) {
        const winSeat: 1 | 2 = payload.matchWinner === this.agent1.state.name ? 1 : 2;
        this.setPose(winSeat, 'win');
        this.setPose(winSeat === 1 ? 2 : 1, 'panic');
        this.agent1.updateMood(winSeat === 1 ? 'Victory!' : 'Defeated...');
        this.agent2.updateMood(winSeat === 2 ? 'Victory!' : 'Defeated...');
      } else {
        this.setPose(1, 'idle');
        this.setPose(2, 'idle');
      }
    });

    eventBus.on('round:start', (event) => {
      const payload = event.payload as { round: number };
      this.currentRound = payload.round;
      this.roundActive = true;
      this.roundStartTime = Date.now();
      this.agent1.resetForRound();
      this.agent2.resetForRound();
      this.setPose(1, 'idle');
      this.setPose(2, 'idle');
    });

    eventBus.on('agent:windUp', () => {
      this.agent1.state.isWindingUp = true;
      this.agent2.state.isWindingUp = true;
      this.agent1.updateMood('Charging...');
      this.agent2.updateMood('Charging...');
      this.setPose(1, 'windUp');
      this.setPose(2, 'windUp');
    });

    eventBus.on('agent:feint', (event) => {
      const payload = event.payload as { agent: string; seat?: string };
      const seat = this.seatFromPayload(payload);
      const agent = seat === 1 ? this.agent1 : this.agent2;
      agent.state.didFeint = true;
      agent.updateMood('Feinting!');
      this.setPose(seat, 'feint');
    });

    eventBus.on('agent:commit', (event) => {
      const payload = event.payload as { agent: string; seat?: string };
      const seat = this.seatFromPayload(payload);
      const agent = seat === 1 ? this.agent1 : this.agent2;
      agent.state.hasCommitted = true;
      agent.state.commitTime = Date.now();
      agent.updateMood('Committed!');
      this.setPose(seat, 'commit');
    });

    eventBus.on('clash:resolve', (event) => {
      const payload = event.payload as {
        winner?: string | null;
        loser?: string | null;
        winnerScore?: number;
        loserScore?: number;
        reason?: string;
        outcome?: string;
        seatA?: string;
        seatB?: string;
      };

      if (payload.seatA) this.agent1.state.name = payload.seatA;
      if (payload.seatB) this.agent2.state.name = payload.seatB;

      this.cameras.main.shake(100, 0.002);
      this.setPose(1, 'clash');
      this.setPose(2, 'clash');
      this.flashSeat(1);
      this.flashSeat(2);

      const isDraw = !payload.winner || payload.outcome === 'draw';
      if (isDraw) {
        this.agent1.updateMood('Draw');
        this.agent2.updateMood('Draw');
        this.time.delayedCall(160, () => {
          this.setPose(1, 'panic');
          this.setPose(2, 'panic');
        });
        return;
      }

      const winnerSeat: 1 | 2 =
        payload.winner === this.agent1.state.name || payload.outcome === 'A' ? 1 : 2;
      const loserSeat: 1 | 2 = winnerSeat === 1 ? 2 : 1;
      const winner = winnerSeat === 1 ? this.agent1 : this.agent2;
      const loser = loserSeat === 1 ? this.agent1 : this.agent2;

      if (typeof payload.winnerScore === 'number') winner.state.score = payload.winnerScore;
      if (typeof payload.loserScore === 'number') loser.state.score = payload.loserScore;
      winner.updateMood('Victory!');
      loser.updateMood('Defeated...');

      this.time.delayedCall(160, () => {
        this.setPose(winnerSeat, 'win');
        this.setPose(loserSeat, 'panic');
      });
    });

    eventBus.on('round:end', () => {
      this.roundActive = false;
      this.time.delayedCall(2000, () => {
        this.setPose(1, 'idle');
        this.setPose(2, 'idle');
      });
    });

    eventBus.on('match:end', () => {
      this.matchActive = false;
    });
  }
}
