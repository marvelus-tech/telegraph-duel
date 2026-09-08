import Phaser from 'phaser';
import { Agent } from '../ai/Agent';
import { eventBus, type AgentPose } from '../bus/EventBus';
import { matchStartNames } from './clashCopy';

const POSE_FRAME: Record<AgentPose, number> = {
  idle: 0,
  windUp: 1,
  feint: 2,
  commit: 3,
  clash: 4,
  panic: 5,
  win: 6,
};

const SAND = 0xf3e4c1;
const TAWARA = 0x4a3424;
const HASH = 0x5c4033;

/**
 * King of the Ring spike. Same EventBus verbs as the duel:
 * windUp = brace, feint = sidestep, commit = shove.
 *
 * Local (no ?room=): auto-play first-to-2 with shrinking ring.
 * Spectator (?room=): Match Worker is telegraph-duel — listen only,
 * map poses + a shove on commit so the ring is not a frozen lobby.
 */
export class SumoScene extends Phaser.Scene {
  private agent1!: Agent;
  private agent2!: Agent;
  private fighter1!: Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc;
  private fighter2!: Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc;
  private useSprites = false;
  private tawara!: Phaser.GameObjects.Arc;
  private ring!: Phaser.GameObjects.Arc;
  private hash!: Phaser.GameObjects.Graphics;
  private ringRadius = 220;
  private pos1 = { x: 0, y: 0 };
  private pos2 = { x: 0, y: 0 };
  private vel1 = 0;
  private vel2 = 0;
  private roundActive = false;
  private currentRound = 0;
  private shrinking = false;
  private spectatorMode = false;

  constructor() {
    super({ key: 'SumoScene' });
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

    // Room spectators must not show BlitzBot/ShieldWall before match:start.
    const agent1Name = this.spectatorMode ? 'Seat A' : 'BlitzBot';
    const agent2Name = this.spectatorMode ? 'Seat B' : 'ShieldWall';
    this.agent1 = new Agent(agent1Name, 'aggressive', 0x2196f3);
    this.agent2 = new Agent(agent2Name, 'turtle', 0xff9800);

    this.createDohyo();
    this.createFighters();

    const cx = this.cameras.main.width / 2;
    this.add
      .text(cx, 28, 'KING OF THE RING', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#333',
      })
      .setOrigin(0.5);

    if (this.spectatorMode) {
      this.setupSpectatorListeners();
    } else {
      this.time.delayedCall(400, () => this.startMatch());
    }
  }

  getAgent1(): Agent {
    return this.agent1;
  }

  getAgent2(): Agent {
    return this.agent2;
  }

  private createDohyo(): void {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;
    // Dark tawara ring behind light sand; inner stroke is the dohyo line.
    this.tawara = this.add.circle(cx, cy, this.ringRadius + 12, TAWARA, 1);
    this.ring = this.add.circle(cx, cy, this.ringRadius, SAND, 1);
    this.ring.setStrokeStyle(3, 0x2c1810, 0.85);
    this.hash = this.add.graphics();
    this.drawHash(cx, cy);
  }

  private drawHash(cx: number, cy: number): void {
    this.hash.clear();
    this.hash.lineStyle(4, HASH, 0.95);
    this.hash.beginPath();
    this.hash.moveTo(cx - 10, cy - 22);
    this.hash.lineTo(cx - 10, cy + 22);
    this.hash.moveTo(cx + 10, cy - 22);
    this.hash.lineTo(cx + 10, cy + 22);
    this.hash.strokePath();
  }

  private createFighters(): void {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;
    this.useSprites = this.textures.exists('fighter-a') && this.textures.exists('fighter-b');
    this.pos1 = { x: cx - 80, y: cy };
    this.pos2 = { x: cx + 80, y: cy };

    if (this.useSprites) {
      this.fighter1 = this.add.sprite(this.pos1.x, this.pos1.y, 'fighter-a', 0).setScale(2);
      this.fighter2 = this.add.sprite(this.pos2.x, this.pos2.y, 'fighter-b', 0).setScale(2);
    } else {
      this.fighter1 = this.add.circle(this.pos1.x, this.pos1.y, 28, 0x2196f3);
      this.fighter2 = this.add.circle(this.pos2.x, this.pos2.y, 28, 0xff9800);
    }
  }

  private setPose(fighter: Phaser.GameObjects.GameObject, pose: AgentPose): void {
    if (this.useSprites && fighter instanceof Phaser.GameObjects.Sprite) {
      fighter.setFrame(POSE_FRAME[pose]);
      fighter.setAlpha(pose === 'feint' ? 0.55 : 1);
      return;
    }
    if (fighter instanceof Phaser.GameObjects.Arc) {
      fighter.setAlpha(pose === 'feint' ? 0.55 : 1);
      fighter.setScale(pose === 'commit' ? 1.15 : pose === 'windUp' ? 1.08 : 1);
    }
  }

  private startMatch(): void {
    this.agent1.state.score = 0;
    this.agent2.state.score = 0;
    this.currentRound = 0;
    eventBus.emit('match:start', {
      agent1: this.agent1.state.name,
      agent2: this.agent2.state.name,
      seatA: this.agent1.state.name,
      seatB: this.agent2.state.name,
    });
    this.time.delayedCall(600, () => this.startRound());
  }

  private resetRing(): void {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;
    this.ringRadius = 220;
    this.ring.setRadius(this.ringRadius);
    this.tawara.setRadius(this.ringRadius + 12);
    this.pos1 = { x: cx - 80, y: cy };
    this.pos2 = { x: cx + 80, y: cy };
    this.vel1 = 0;
    this.vel2 = 0;
    this.fighter1.setPosition(this.pos1.x, this.pos1.y);
    this.fighter2.setPosition(this.pos2.x, this.pos2.y);
    this.setPose(this.fighter1, 'idle');
    this.setPose(this.fighter2, 'idle');
  }

  private startRound(): void {
    if (this.agent1.state.score >= 2 || this.agent2.state.score >= 2) {
      this.endMatch();
      return;
    }

    this.currentRound++;
    this.roundActive = true;
    this.shrinking = true;
    this.resetRing();
    this.agent1.resetForRound();
    this.agent2.resetForRound();

    eventBus.emit('round:start', { round: this.currentRound });

    this.time.delayedCall(200, () => {
      this.agent1.updateMood('Charging...');
      this.agent2.updateMood('Charging...');
      this.setPose(this.fighter1, 'windUp');
      this.setPose(this.fighter2, 'windUp');
      eventBus.emit('agent:windUp', {
        agent1: this.agent1.state.name,
        agent2: this.agent2.state.name,
      });
    });

    this.time.delayedCall(500, () => {
      if (this.agent1.shouldFeint()) this.doFeint(this.agent1, 1);
      if (this.agent2.shouldFeint()) this.doFeint(this.agent2, 2);
    });

    this.time.delayedCall(this.agent1.decideCommitTiming(Date.now()), () => this.doCommit(this.agent1, 1));
    this.time.delayedCall(this.agent2.decideCommitTiming(Date.now()), () => this.doCommit(this.agent2, 2));
  }

  private doFeint(agent: Agent, seat: 1 | 2): void {
    if (!this.roundActive) return;
    agent.state.didFeint = true;
    agent.updateMood('Sidestep!');
    this.applySidestep(seat);
    eventBus.emit('agent:feint', { agent: agent.state.name, seat: seat === 1 ? 'A' : 'B' });
  }

  private doCommit(agent: Agent, seat: 1 | 2): void {
    if (!this.roundActive || agent.state.hasCommitted) return;
    agent.state.hasCommitted = true;
    agent.updateMood('Shove!');
    this.applyShove(seat);
    eventBus.emit('agent:commit', { agent: agent.state.name, seat: seat === 1 ? 'A' : 'B' });
  }

  private applySidestep(seat: 1 | 2): void {
    const pos = seat === 1 ? this.pos1 : this.pos2;
    pos.y += seat === 1 ? -36 : 36;
    this.setPose(seat === 1 ? this.fighter1 : this.fighter2, 'feint');
  }

  private applyShove(seat: 1 | 2, force = 3.4 + Math.random() * 1.2): void {
    if (seat === 1) this.vel1 = force;
    else this.vel2 = -force;
    this.setPose(seat === 1 ? this.fighter1 : this.fighter2, 'commit');
  }

  private finishRound(winner: Agent | null, reason: string): void {
    if (!this.roundActive) return;
    this.roundActive = false;
    this.shrinking = false;
    this.cameras.main.shake(80, 0.002);

    if (winner) {
      const loser = winner === this.agent1 ? this.agent2 : this.agent1;
      winner.incrementScore();
      winner.updateMood('Victory!');
      loser.updateMood('Ring out');
      this.setPose(winner === this.agent1 ? this.fighter1 : this.fighter2, 'win');
      this.setPose(loser === this.agent1 ? this.fighter1 : this.fighter2, 'panic');
      eventBus.emit('clash:resolve', {
        winner: winner.state.name,
        loser: loser.state.name,
        winnerScore: winner.state.score,
        loserScore: loser.state.score,
        reason,
      });
      eventBus.emit('round:end', { round: this.currentRound, winner: winner.state.name });
    } else {
      this.agent1.updateMood('Draw');
      this.agent2.updateMood('Draw');
      eventBus.emit('clash:resolve', { winner: null, reason });
      eventBus.emit('round:end', { round: this.currentRound, winner: null });
    }

    this.time.delayedCall(1800, () => this.startRound());
  }

  private endMatch(): void {
    const winner = this.agent1.state.score >= 2 ? this.agent1 : this.agent2;
    eventBus.emit('match:end', {
      winner: winner.state.name,
      finalScoresA: this.agent1.state.score,
      finalScoresB: this.agent2.state.score,
      reason: 'king_of_the_ring',
    });
    this.time.delayedCall(4000, () => this.startMatch());
  }

  private seatFromPayload(payload: { agent?: string; seat?: string }): 1 | 2 {
    if (payload.seat === 'A') return 1;
    if (payload.seat === 'B') return 2;
    if (payload.agent === this.agent1.state.name) return 1;
    return 2;
  }

  /** Room events only. Never emit — Worker owns the match. */
  private setupSpectatorListeners(): void {
    eventBus.on('match:start', (event) => {
      const names = matchStartNames(event.payload);
      this.agent1.state.name = names.agent1;
      this.agent2.state.name = names.agent2;
      this.agent1.state.score = 0;
      this.agent2.state.score = 0;
      this.resetRing();
    });

    eventBus.on('round:start', (event) => {
      const payload = event.payload as { round: number };
      this.currentRound = payload.round;
      this.roundActive = true;
      this.shrinking = false;
      this.resetRing();
      this.agent1.resetForRound();
      this.agent2.resetForRound();
    });

    eventBus.on('agent:windUp', () => {
      this.agent1.state.isWindingUp = true;
      this.agent2.state.isWindingUp = true;
      this.agent1.updateMood('Charging...');
      this.agent2.updateMood('Charging...');
      this.setPose(this.fighter1, 'windUp');
      this.setPose(this.fighter2, 'windUp');
    });

    eventBus.on('agent:feint', (event) => {
      const payload = event.payload as { agent: string; seat?: string };
      const seat = this.seatFromPayload(payload);
      const agent = seat === 1 ? this.agent1 : this.agent2;
      agent.state.didFeint = true;
      agent.updateMood('Sidestep!');
      this.applySidestep(seat);
    });

    eventBus.on('agent:commit', (event) => {
      const payload = event.payload as { agent: string; seat?: string };
      const seat = this.seatFromPayload(payload);
      const agent = seat === 1 ? this.agent1 : this.agent2;
      if (agent.state.hasCommitted) return;
      agent.state.hasCommitted = true;
      agent.state.commitTime = Date.now();
      agent.updateMood('Shove!');
      this.roundActive = true;
      this.applyShove(seat);
    });

    eventBus.on('clash:resolve', (event) => {
      const payload = event.payload as {
        winner?: string | null;
        loser?: string | null;
        winnerScore?: number;
        loserScore?: number;
        outcome?: string;
      };

      this.cameras.main.shake(80, 0.002);
      this.setPose(this.fighter1, 'clash');
      this.setPose(this.fighter2, 'clash');

      const isDraw = !payload.winner || payload.outcome === 'draw';
      if (isDraw) {
        this.agent1.updateMood('Draw');
        this.agent2.updateMood('Draw');
        this.vel1 = -4;
        this.vel2 = 4;
        this.time.delayedCall(160, () => {
          this.setPose(this.fighter1, 'panic');
          this.setPose(this.fighter2, 'panic');
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
      loser.updateMood('Ring out');

      // Knock the loser off the dohyo even if the worker never shoved.
      if (loserSeat === 1) this.vel1 = -8;
      else this.vel2 = 8;

      this.time.delayedCall(160, () => {
        this.setPose(winnerSeat === 1 ? this.fighter1 : this.fighter2, 'win');
        this.setPose(loserSeat === 1 ? this.fighter1 : this.fighter2, 'panic');
      });
    });

    eventBus.on('round:end', () => {
      this.roundActive = false;
    });

    eventBus.on('match:end', () => {
      this.roundActive = false;
      this.shrinking = false;
    });
  }

  update(_t: number, delta: number): void {
    if (!this.roundActive) return;
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    // Shrinking ring is local King of the Ring only.
    if (!this.spectatorMode && this.shrinking) {
      this.ringRadius = Math.max(90, this.ringRadius - delta * 0.012);
      this.ring.setRadius(this.ringRadius);
      this.tawara.setRadius(this.ringRadius + 12);
    }

    this.pos1.x += this.vel1;
    this.pos2.x += this.vel2;
    this.vel1 *= 0.94;
    this.vel2 *= 0.94;

    // Body contact: transfer shove
    if (Math.abs(this.pos1.x - this.pos2.x) < 56) {
      const mid = (this.pos1.x + this.pos2.x) / 2;
      this.pos1.x = mid - 28;
      this.pos2.x = mid + 28;
      const bump = (this.vel1 - this.vel2) * 0.35;
      this.vel1 -= bump;
      this.vel2 += bump;
      this.setPose(this.fighter1, 'clash');
      this.setPose(this.fighter2, 'clash');
    }

    this.pos1.y += (cy - this.pos1.y) * 0.04;
    this.pos2.y += (cy - this.pos2.y) * 0.04;
    this.fighter1.setPosition(this.pos1.x, this.pos1.y);
    this.fighter2.setPosition(this.pos2.x, this.pos2.y);

    if (this.spectatorMode) return;

    const out1 = Phaser.Math.Distance.Between(this.pos1.x, this.pos1.y, cx, cy) > this.ringRadius + 8;
    const out2 = Phaser.Math.Distance.Between(this.pos2.x, this.pos2.y, cx, cy) > this.ringRadius + 8;

    if (out1 && out2) this.finishRound(null, 'draw_double_commit');
    else if (out1) this.finishRound(this.agent2, 'commit_beats_windUp');
    else if (out2) this.finishRound(this.agent1, 'commit_beats_windUp');
  }
}
