import { eventBus, GameEvent } from '../bus/EventBus';
import { Agent } from '../ai/Agent';

export class HUDController {
  private hudElement: HTMLElement;
  private eventLog: string[] = [];
  private maxLogItems = 10;
  private windowEndMs: number | null = null;
  private countdownInterval: number | null = null;
  private connectionState: string = 'connecting';
  private isSpectatorMode: boolean = false;

  constructor(hudElement: HTMLElement) {
    this.hudElement = hudElement;
    this.isSpectatorMode = !!new URLSearchParams(window.location.search).get('room');
    this.setupEventListeners();
  }

  initialize(agent1: Agent, agent2: Agent): void {
    this.renderHUD(agent1, agent2);
  }

  private setupEventListeners(): void {
    // Listen to connection state changes
    eventBus.on('connection:state', (event: GameEvent) => {
      const payload = event.payload as { state: string };
      this.connectionState = payload.state;
      this.updateConnectionBadge();
    });

    // Listen to all events
    eventBus.on('*' as any, (event: GameEvent) => {
      this.logEvent(event);
    });
  }

  private renderHUD(agent1: Agent, agent2: Agent): void {
    this.hudElement.innerHTML = `
      <div class="hud-top">
        <div class="nameplate" id="nameplate-1">
          <div class="nameplate-name">${agent1.state.name}</div>
          <div class="nameplate-mood" id="mood-1">${agent1.state.mood}</div>
          <div class="score-container" id="score-1">
            ${this.renderScorePips(agent1.state.score)}
          </div>
        </div>

        <div class="nameplate" id="nameplate-2">
          <div class="nameplate-name">${agent2.state.name}</div>
          <div class="nameplate-mood" id="mood-2">${agent2.state.mood}</div>
          <div class="score-container" id="score-2">
            ${this.renderScorePips(agent2.state.score)}
          </div>
        </div>
      </div>

      <div class="center-hud">
        <div class="connection-badge" id="connection-badge">${this.getConnectionBadgeHTML()}</div>
        <div class="countdown-timer" id="countdown-timer" style="display: none; margin-top: 8px; font-size: 16px; font-weight: bold; color: #333;"></div>
      </div>

      <div class="event-log" id="event-log">
        ${this.renderEventLog()}
      </div>
    `;

    // Start update loop
    this.startUpdateLoop(agent1, agent2);
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

  private logEvent(event: GameEvent): void {
    const time = new Date(event.timestamp).toLocaleTimeString();
    let message = '';

    switch (event.type) {
      case 'match:start':
        message = `<span class="timestamp">${time}</span> Match started: <strong>${event.payload?.agent1}</strong> vs <strong>${event.payload?.agent2}</strong>`;
        break;
      case 'round:start':
        message = `<span class="timestamp">${time}</span> Round ${event.payload?.round} begins!`;
        // Start countdown timer if windowEndMs is present
        if (event.payload?.windowEndMs) {
          this.windowEndMs = event.payload.windowEndMs as number;
          this.startCountdown();
        }
        break;
      case 'round:extend':
        message = `<span class="timestamp">${time}</span> ⏱️ Round ${event.payload?.round} extended!`;
        // Restart countdown with new windowEndMs
        if (event.payload?.windowEndMs) {
          this.windowEndMs = event.payload.windowEndMs as number;
          this.startCountdown();
        }
        break;
      case 'agent:windUp':
        message = `<span class="timestamp">${time}</span> Both agents charging...`;
        break;
      case 'agent:feint':
        message = `<span class="timestamp">${time}</span> <strong>${event.payload?.agent}</strong> feints!`;
        break;
      case 'agent:commit':
        message = `<span class="timestamp">${time}</span> <strong>${event.payload?.agent}</strong> commits!`;
        break;
      case 'clash:resolve':
        const reason = this.formatReason(event.payload?.reason as string);
        if (event.payload?.winner) {
          message = `<span class="timestamp">${time}</span> 💥 <strong>${event.payload?.winner}</strong> wins! ${reason} (${event.payload?.winnerScore}-${event.payload?.loserScore})`;
        } else {
          message = `<span class="timestamp">${time}</span> 🤝 Draw! ${reason}`;
        }
        this.stopCountdown();
        break;
      case 'round:end':
        if (event.payload?.winner) {
          message = `<span class="timestamp">${time}</span> Round ${event.payload?.round} won by <strong>${event.payload?.winner}</strong>`;
        } else {
          message = `<span class="timestamp">${time}</span> Round ${event.payload?.round} ended in a draw`;
        }
        break;
      case 'match:end':
        message = `<span class="timestamp">${time}</span> 🏆 <strong>${event.payload?.winner}</strong> wins the match! (${event.payload?.finalScoresA}-${event.payload?.finalScoresB})`;
        break;
      case 'score.settled':
        const roomId = event.payload?.roomId as string || 'unknown';
        const winnerAgentId = event.payload?.winnerAgentId as string || 'unknown';
        const winnerSeat = event.payload?.winnerSeat as string || '?';
        const finalScoresA = event.payload?.finalScoresA || 0;
        const finalScoresB = event.payload?.finalScoresB || 0;
        const txShort = (event.payload?.txSig as string)?.slice(0, 8) || 'unknown';
        const pdaA = (event.payload?.scorePdaA as string)?.slice(0, 8) || 'unknown';
        const pdaB = (event.payload?.scorePdaB as string)?.slice(0, 8) || 'unknown';
        message = `<span class="timestamp">${time}</span> SETTLED room ${roomId} winner ${winnerAgentId} (${winnerSeat}) scores ${finalScoresA}-${finalScoresB} tx ${txShort}… PDAs ${pdaA}…/${pdaB}…`;
        break;
    }

    if (message) {
      this.eventLog.push(message);
      this.updateEventLog();
    }
  }

  private getConnectionBadgeHTML(): string {
    if (!this.isSpectatorMode) {
      return '<span class="connection-dot local"></span>LOCAL';
    }

    switch (this.connectionState) {
      case 'connected':
        return '<span class="connection-dot connected"></span>LIVE · connected';
      case 'connecting':
        return '<span class="connection-dot connecting"></span>Connecting...';
      case 'reconnecting':
        return '<span class="connection-dot reconnecting"></span>Reconnecting...';
      case 'disconnected':
        return '<span class="connection-dot disconnected"></span>Disconnected';
      default:
        return '<span class="connection-dot"></span>Unknown';
    }
  }

  private updateConnectionBadge(): void {
    const badge = document.getElementById('connection-badge');
    if (badge) {
      badge.innerHTML = this.getConnectionBadgeHTML();
    }
  }

  private formatReason(reason: string): string {
    if (!reason) return '';
    const formatted = reason
      .replace(/_/g, ' ')
      .replace(/commit beats feint/i, 'Commit beats Feint')
      .replace(/feint beats windUp/i, 'Feint beats WindUp')
      .replace(/commit beats windUp/i, 'Commit beats WindUp')
      .replace(/draw/i, 'Draw');
    return `[${formatted}]`;
  }

  private startCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    const timerElement = document.getElementById('countdown-timer');
    if (!timerElement) return;

    timerElement.style.display = 'block';

    const updateTimer = () => {
      if (!this.windowEndMs) {
        if (timerElement) timerElement.style.display = 'none';
        return;
      }

      const remaining = Math.max(0, this.windowEndMs - Date.now());
      const seconds = Math.ceil(remaining / 1000);

      if (timerElement) {
        timerElement.textContent = `Window: ${seconds}s`;
        if (seconds === 0) {
          timerElement.style.display = 'none';
        }
      }

      if (remaining <= 0) {
        this.stopCountdown();
      }
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
    if (timerElement) {
      timerElement.style.display = 'none';
    }
  }

  private updateEventLog(): void {
    const logElement = document.getElementById('event-log');
    if (logElement) {
      logElement.innerHTML = this.renderEventLog();
      logElement.scrollTop = logElement.scrollHeight;
    }
  }

  private startUpdateLoop(agent1: Agent, agent2: Agent): void {
    setInterval(() => {
      this.updateNameplates(agent1, agent2);
    }, 100);
  }

  private updateNameplates(agent1: Agent, agent2: Agent): void {
    const mood1 = document.getElementById('mood-1');
    const mood2 = document.getElementById('mood-2');
    const score1 = document.getElementById('score-1');
    const score2 = document.getElementById('score-2');

    if (mood1) mood1.textContent = agent1.state.mood;
    if (mood2) mood2.textContent = agent2.state.mood;

    if (score1) score1.innerHTML = this.renderScorePips(agent1.state.score);
    if (score2) score2.innerHTML = this.renderScorePips(agent2.state.score);
  }
}
