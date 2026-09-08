import Phaser from 'phaser';
import { DuelScene } from './game/DuelScene';
import { SumoScene } from './game/SumoScene';
import { HUDController } from './ui/HUDController';
import { RoomClient } from './net/RoomClient';
import { ScoreSettledAdapter } from './net/ScoreSettledAdapter';
import type { ScoreSettledPayload } from './net/ScoreSettledAdapter';
import { listenForSettlements } from './scores/scoreStore';
import './style.css';

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const apiBase = urlParams.get('api') || 'http://localhost:8787';
const mode = urlParams.get('mode');
const view = urlParams.get('view');

// Registered route: ?view=scores -> leaderboard.html, keep other params
if (view === 'scores') {
  const next = new URLSearchParams(urlParams);
  next.delete('view');
  const q = next.toString();
  window.location.replace(`${import.meta.env.BASE_URL}leaderboard.html${q ? `?${q}` : ''}`);
} else {
  bootArena();
}

function bootArena(): void {
  listenForSettlements();

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 1200,
    height: 800,
    parent: 'game-container',
    backgroundColor: '#e8f4f8',
    scene: mode === 'sumo' ? [SumoScene] : [DuelScene],
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
  };

  (config as any).spectatorMode = !!roomId;

  const game = new Phaser.Game(config);

  ScoreSettledAdapter.listenForPostMessages();

  (window as any).__emitScoreSettled = (payload: ScoreSettledPayload) => {
    ScoreSettledAdapter.emitSettlement(payload);
  };

  const hudElement = document.getElementById('hud');
  if (!hudElement) return;

  const hudController = new HUDController(hudElement);

  game.events.once('ready', () => {
    const sceneKey = mode === 'sumo' ? 'SumoScene' : 'DuelScene';
    const scene = game.scene.getScene(sceneKey) as DuelScene | SumoScene;
    if (!scene) return;
    setTimeout(() => {
      const agent1 = scene.getAgent1();
      const agent2 = scene.getAgent2();
      if (!agent1 || !agent2) return;
      hudController.initialize(agent1, agent2);
      if (roomId) {
        const roomClient = new RoomClient({ apiBase, roomId });
        roomClient.connect();
        hudController.applySpectatorStatus(roomClient.lastStatus, roomId);
      }
    }, 100);
  });
}
