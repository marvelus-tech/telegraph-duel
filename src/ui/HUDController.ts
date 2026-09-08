import { eventBus, GameEvent, SpectatorStatus } from '../bus/EventBus';
import { Agent } from '../ai/Agent';
import {
  clashReasonCopy,
  matchStartNames,
  settledBannerCopy,
  spectatorDisplayNames,
  waitingOverlayCopy,
} from '../game/clashCopy';

const STATUS_LABEL: Record<SpectatorStatus, string> = {
  connecting: 'CONNECTING',
  live: 'LIVE',
  reconnecting: 'RECONNECTING',
  lost: 'LOST',
};

export class HUDController {
  private hudElement: HTMLElement;
  private eventLog: string[] = [];
  private maxLogItems = 8;
  private windowEndMs: number | null = null;
  private countdownInterval: number | null = null;
  private roomId: string | null;
  private spectatorMode: boolean;
  private awaitingAgents = false;
  private hasMatchNames = false;
  private pick: 'A' | 'B' | null = null;
  private pickLocked = false;
  private lastCallResult = '';
  private agent1: Agent | null = null;
  private agent2: Agent | null = null;

  constructor(hudElement: HTMLElement) {
    this.hudElement = hudElement;
    const params = new URLSearchParams(window.location.search);
    this.roomId = params.get('room');
    this.spectatorMode = !!this.roomId;
    this.awaitingAgents = this.spectatorMode;
    this.setupEventListeners();
  }

  initialize(agent1: Agent, agent2: Agent): void {
    this.agent1 = agent1;
    this.agent2 = agent2;
    this.renderHUD(agent1, agent2);
  }

  applySpectatorStatus(status: SpectatorStatus, roomId: string): void {
    this.setBadge(status);
    const roomEl = document.getElementById('room-id');
    if (roomEl) roomEl.textContent = `room ${roomId}`;
  }

  private setupEventListeners(): void {
    eventBus.on('*' as any, (event: GameEvent) => {
      this.logEvent(event);
    });
  }

  private scoresHref(): string {
    return `${import.meta.env.BASE_URL}leaderboard.html${window.location.search}`;
  }

  private arenaHref(): string {
    const params = new URLSearchParams(window.location.search);
    const next = new URLSearchParams();
    const room = params.get('room');
    const api = params.get('api');
    if (room) next.set('room', room);
    if (api) next.set('api', api);
    const q = next.toString();
    return `${import.meta.env.BASE_URL}${q ? `?${q}` : ''}`;
  }

  private sumoHref(): string {
    return `${import.meta.env.BASE_URL}?mode=sumo`;
  }

  private renderHUD(agent1: Agent, agent2: Agent): void {
    const name1 = this.spectatorMode ? 'Seat A' : agent1.state.name;
    const name2 = this.spectatorMode ? 'Seat B' : agent2.state.name;
    const badgeClass = this.spectatorMode ? 'status-connecting' : 'status-live';
    const badgeText = this.spectatorMode ? 'CONNECTING' : 'DEMO';
    const callClass = this.spectatorMode ? 'call-chip is-hidden' : 'call-chip';

    this.hudElement.innerHTML = `
      <nav class="arena-nav" aria-label="Arena">
        <a class="nav-link" href="${this.arenaHref()}">Arena</a>
        <a class="nav-link" href="${this.scoresHref()}">Scores</a>
        <a class="nav-link" href="${this.sumoHref()}">Sumo</a>
      </nav>
      <div class="hud-top">
        <div class="nameplate nameplate-a" id="nameplate-1">
          <div class="nameplate-seat">A</div>
          <div class="nameplate-name" id="name-1">${name1}</div>
          <div class="nameplate-mood" id="mood-1">${agent1.state.mood}</div>
          <div class="score-container" id="score-1">${this.renderScorePips(agent1.state.score)}</div>
        </div>
        <div class="nameplate nameplate-b" id="nameplate-2">
          <div class="nameplate-seat">B</div>
          <div class="nameplate-name" id="name-2">${name2}</div>
          <div class="nameplate-mood" id="mood-2">${agent2.state.mood}</div>
          <div class="score-container" id="score-2">${this.renderScorePips(agent2.state.score)}</div>
        </div>
      </div>

      <div class="center-hud">
        <div class="live-badge ${badgeClass}" id="live-badge">${badgeText}</div>
        <div class="room-id" id="room-id">${this.roomId ? `room ${this.roomId}` : 'local demo'}</div>
        <div class="countdown-timer" id="countdown-timer"></div>
        <div class="clash-title" id="clash-title"></div>
        <div class="settled-banner" id="settled-banner" role="status">
          <span class="settled-kicker">SETTLED</span>
          <span class="settled-score" id="settled-score"></span>
          <span class="settled-tx" id="settled-tx"></span>
        </div>
        <div class="${callClass}" id="call-chip">
          <span class="call-label">Call it</span>
          <button type="button" data-pick="A">A</button>
          <button type="button" data-pick="B">B</button>
          <span class="call-result" id="call-result"></span>
        </div>
      </div>

      <div class="event-log is-empty" id="event-log">${this.renderEventLog()}</div>
      ${this.spectatorMode ? `
      <div class="waiting-overlay is-visible" id="waiting-overlay">
        <div class="waiting-card">
          <div class="waiting-title" id="waiting-title"></div>
          <div class="waiting-room" id="waiting-room"></div>
        </div>
      </div>` : ''}
    `;

    this.bindCallChip();
    if (this.spectatorMode) this.showWaiting(false);
    this.startUpdateLoop(agent1, agent2);
  }

  private bindCallChip(): void {
    const chip = document.getElementById('call-chip');
    if (!chip) return;
    chip.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('button[data-pick]');
      if (!btn || this.pickLocked) return;
      this.pick = (btn as HTMLButtonElement).dataset.pick as 'A' | 'B';
      this.pickLocked = true;
      chip.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('picked', b === btn);
      });
    });
  }

  private resetCallChip(): void {
    this.pick = null;
    this.pickLocked = false;
    this.lastCallResult = '';
    const chip = document.getElementById('call-chip');
    chip?.querySelectorAll('button').forEach((b) => b.classList.remove('picked'));
    const result = document.getElementById('call-result');
    if (result) result.textContent = '';
  }

  private resolveCall(winnerName: string | undefined, agent1: Agent, agent2: Agent): void {
    const resultEl = document.getElementById('call-result');
    if (!resultEl) return;
    if (!this.pick) {
      resultEl.textContent = '';
      return;
    }
    if (!winnerName) {
      this.lastCallResult = 'Draw';
    } else {
      const winnerSeat = winnerName === agent1.state.name ? 'A' : winnerName === agent2.state.name ? 'B' : null;
      this.lastCallResult = winnerSeat === this.pick ? 'You called it' : 'Wrong';
    }
    resultEl.textContent = this.lastCallResult;
  }

  private renderScorePips(score: number): string {
    let html = '';
    for (let i = 0; i < 3; i++) {
      html += `<div class="score-pip ${i < score ? 'filled' : ''}"></div>`;
    }
    return html;
  }

  private renderEventLog(): string {
    return this.eventLog
      .slice(-this.maxLogItems)
      .map((log) => `<div class="event-log-item">${log}</div>`)
      .join('');
  }

  private setBadge(status: SpectatorStatus): void {
    const badge = document.getElementById('live-badge');
    if (!badge) return;
    badge.textContent = STATUS_LABEL[status];
    badge.className = `live-badge status-${status}`;
  }

  private setClashTitle(copy: string, holdMs = 1400): void {
    const el = document.getElementById('clash-title');
    if (!el) return;
    el.textContent = copy;
    el.classList.add('show');
    window.setTimeout(() => el.classList.remove('show'), holdMs);
  }

  private showWaiting(ended: boolean): void {
    if (!this.spectatorMode) return;
    const overlay = document.getElementById('waiting-overlay');
    const title = document.getElementById('waiting-title');
    const detail = document.getElementById('waiting-room');
    const copy = waitingOverlayCopy(ended, this.roomId);
    if (title) title.textContent = copy.title;
    if (detail) detail.textContent = copy.detail;
    overlay?.classList.add('is-visible');
    document.getElementById('call-chip')?.classList.add('is-hidden');
  }

  private hideWaiting(): void {
    document.getElementById('waiting-overlay')?.classList.remove('is-visible');
    document.getElementById('call-chip')?.classList.remove('is-hidden');
  }

  private showSettled(a: number, b: number, txSig?: string | null): void {
    const copy = settledBannerCopy(a, b, txSig);
    const banner = document.getElementById('settled-banner');
    const scoreEl = document.getElementById('settled-score');
    const txEl = document.getElementById('settled-tx');
    if (scoreEl) scoreEl.textContent = copy.score;
    if (txEl) txEl.textContent = copy.tx;
    banner?.classList.add('is-visible');
  }

  private hideSettled(): void {
    document.getElementById('settled-banner')?.classList.remove('is-visible');
  }

  private noteMatchActivity(): void {
    if (!this.spectatorMode) return;
    this.awaitingAgents = false;
    this.hideWaiting();
  }

  private forceSpectatorSeats(): void {
    if (!this.spectatorMode || this.hasMatchNames) return;
    const n1 = document.getElementById('name-1');
    const n2 = document.getElementById('name-2');
    if (n1) n1.textContent = 'Seat A';
    if (n2) n2.textContent = 'Seat B';
  }

  private logEvent(event: GameEvent): void {
    const time = new Date(event.timestamp).toLocaleTimeString();
    let message = '';

    switch (event.type) {
      case 'spectator:status': {
        const status = event.payload?.status as SpectatorStatus;
        if (status) this.setBadge(status);
        const roomId = event.payload?.roomId as string | undefined;
        const roomEl = document.getElementById('room-id');
        if (roomEl && roomId) roomEl.textContent = `room ${roomId}`;
        return;
      }
      case 'room:snapshot': {
        const names = spectatorDisplayNames(event.payload);
        const n1 = document.getElementById('name-1');
        const n2 = document.getElementById('name-2');
        if (event.payload?.seatA) {
          if (n1) n1.textContent = names.agent1;
          if (n2) n2.textContent = names.agent2;
          this.hasMatchNames = true;
        }
        const scoresA = Number(event.payload?.scoresA ?? 0);
        const scoresB = Number(event.payload?.scoresB ?? 0);
        if (this.agent1) this.agent1.state.score = scoresA;
        if (this.agent2) this.agent2.state.score = scoresB;
        const score1 = document.getElementById('score-1');
        const score2 = document.getElementById('score-2');
        if (score1) score1.innerHTML = this.renderScorePips(scoresA);
        if (score2) score2.innerHTML = this.renderScorePips(scoresB);
        const mood1 = document.getElementById('mood-1');
        const mood2 = document.getElementById('mood-2');
        const winner = event.payload?.matchWinner as string | undefined;
        if (winner && mood1 && mood2) {
          mood1.textContent = winner === names.agent1 ? 'Victory!' : 'Defeated...';
          mood2.textContent = winner === names.agent2 ? 'Victory!' : 'Defeated...';
        }
        const status = event.payload?.status as string | undefined;
        if (status === 'waiting' || !event.payload?.seatA) {
          this.awaitingAgents = true;
          this.showWaiting(false);
        } else {
          this.awaitingAgents = status === 'completed';
          this.hideWaiting();
          if (status === 'completed') this.showWaiting(true);
        }
        const history = (event.payload?.history as { round?: number; winner?: string | null; reason?: string }[]) || [];
        for (const h of history) {
          const reason = clashReasonCopy(h.reason);
          const line = h.winner ? `<strong>${h.winner}</strong> - ${reason}` : reason;
          this.eventLog.push(`<span class="timestamp">${time}</span> R${h.round} ${line}`);
        }
        if (status === 'completed') {
          const winner = event.payload?.matchWinner as string | undefined;
          this.setClashTitle(`${winner || 'Draw'} takes it ${scoresA}-${scoresB}`, 2500);
        }
        this.updateEventLog();
        return;
      }
      case 'match:start': {
        const names = this.spectatorMode
          ? spectatorDisplayNames(event.payload)
          : matchStartNames(event.payload);
        const n1 = document.getElementById('name-1');
        const n2 = document.getElementById('name-2');
        if (n1) n1.textContent = names.agent1;
        if (n2) n2.textContent = names.agent2;
        message = `<span class="timestamp">${time}</span> ${names.agent1} vs ${names.agent2}`;
        this.hasMatchNames = true;
        this.awaitingAgents = false;
        this.hideWaiting();
        this.hideSettled();
        this.resetCallChip();
        document.getElementById('call-chip')?.classList.remove('is-hidden');
        break;
      }
      case 'round:start':
        this.noteMatchActivity();
        message = `<span class="timestamp">${time}</span> Round ${event.payload?.round}`;
        this.resetCallChip();
        if (event.payload?.windowEndMs) {
          this.windowEndMs = event.payload.windowEndMs as number;
          this.startCountdown();
        }
        break;
      case 'round:extend':
        this.noteMatchActivity();
        message = `<span class="timestamp">${time}</span> Window extended`;
        if (event.payload?.windowEndMs) {
          this.windowEndMs = event.payload.windowEndMs as number;
          this.startCountdown();
        }
        break;
      case 'agent:feint':
        this.noteMatchActivity();
        message = `<span class="timestamp">${time}</span> <strong>${event.payload?.agent}</strong> feints`;
        break;
      case 'agent:commit':
        this.noteMatchActivity();
        message = `<span class="timestamp">${time}</span> <strong>${event.payload?.agent}</strong> commits`;
        break;
      case 'clash:resolve': {
        this.noteMatchActivity();
        if (this.spectatorMode && event.payload?.seatA) {
          const names = spectatorDisplayNames(event.payload);
          const n1 = document.getElementById('name-1');
          const n2 = document.getElementById('name-2');
          if (n1) n1.textContent = names.agent1;
          if (n2) n2.textContent = names.agent2;
          this.hasMatchNames = true;
        }
        const reason = clashReasonCopy(event.payload?.reason as string);
        this.setClashTitle(reason, 1400);
        if (this.agent1 && this.agent2) {
          this.resolveCall(event.payload?.winner as string | undefined, this.agent1, this.agent2);
        }
        if (event.payload?.winner) {
          message = `<span class="timestamp">${time}</span> <strong>${event.payload.winner}</strong> - ${reason}`;
        } else {
          message = `<span class="timestamp">${time}</span> ${reason}`;
        }
        this.stopCountdown();
        break;
      }
      case 'match:end': {
        const a = event.payload?.finalScoresA ?? 0;
        const b = event.payload?.finalScoresB ?? 0;
        const winner = event.payload?.winner as string | undefined;
        this.setClashTitle(`${winner} takes it ${a}-${b}`, 2500);
        document.getElementById('call-chip')?.classList.add('is-hidden');
        message = `<span class="timestamp">${time}</span> Match: <strong>${winner}</strong> ${a}-${b}`;
        if (this.spectatorMode) {
          this.awaitingAgents = true;
          this.showWaiting(true);
        }
        break;
      }
      case 'score.settled': {
        const a = event.payload?.finalScoresA ?? 0;
        const b = event.payload?.finalScoresB ?? 0;
        const txSig = event.payload?.txSig as string | undefined;
        const copy = settledBannerCopy(a as number, b as number, txSig);
        this.showSettled(a as number, b as number, txSig);
        if (this.spectatorMode && this.awaitingAgents) this.showWaiting(true);
        message = `<span class="timestamp">${time}</span> ${copy.log}`;
        break;
      }
      default:
        return;
    }

    if (message) {
      this.eventLog.push(message);
      this.updateEventLog();
    }
  }

  private startCountdown(): void {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    const timerElement = document.getElementById('countdown-timer');
    if (!timerElement) return;
    timerElement.style.display = 'block';

    const updateTimer = () => {
      if (!this.windowEndMs) {
        timerElement.style.display = 'none';
        return;
      }
      const remaining = Math.max(0, this.windowEndMs - Date.now());
      timerElement.textContent = `Window: ${Math.ceil(remaining / 1000)}s`;
      if (remaining <= 0) this.stopCountdown();
    };

    updateTimer();
    this.countdownInterval = window.setInterval(updateTimer, 100);
  }

  private stopCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.windowEndMs = null;
    const timerElement = document.getElementById('countdown-timer');
    if (timerElement) timerElement.style.display = 'none';
  }

  private updateEventLog(): void {
    const logElement = document.getElementById('event-log');
    if (!logElement) return;
    logElement.innerHTML = this.renderEventLog();
    logElement.scrollTop = logElement.scrollHeight;
    logElement.classList.toggle('is-empty', this.eventLog.length === 0);
  }

  private startUpdateLoop(agent1: Agent, agent2: Agent): void {
    setInterval(() => {
      this.forceSpectatorSeats();
      if (this.spectatorMode && this.awaitingAgents) return;

      const mood1 = document.getElementById('mood-1');
      const mood2 = document.getElementById('mood-2');
      const score1 = document.getElementById('score-1');
      const score2 = document.getElementById('score-2');
      if (mood1) mood1.textContent = agent1.state.mood;
      if (mood2) mood2.textContent = agent2.state.mood;
      if (score1) score1.innerHTML = this.renderScorePips(agent1.state.score);
      if (score2) score2.innerHTML = this.renderScorePips(agent2.state.score);
    }, 100);
  }
}
