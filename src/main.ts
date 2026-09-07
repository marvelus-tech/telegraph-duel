import Phaser from 'phaser';
import { DuelScene } from './game/DuelScene';
import { HUDController } from './ui/HUDController';
import { RoomClient } from './net/RoomClient';
import { ScoreSettledAdapter } from './net/ScoreSettledAdapter';
import type { ScoreSettledPayload } from './net/ScoreSettledAdapter';
import './style.css';

// Parse URL parameters for room spectator mode
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const apiBase = urlParams.get('api') || 'http://localhost:8787';

let roomClient: RoomClient | null = null;

// Spectator mode: connect to match room via WebSocket
if (roomId) {
  console.log(`[Main] Spectator mode: room=${roomId}, api=${apiBase}`);
  roomClient = new RoomClient({ apiBase, roomId });
  roomClient.connect();
}

// Phaser game config
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1200,
  height: 800,
  parent: 'game-container',
  backgroundColor: '#e8f4f8',
  scene: [DuelScene],
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
};

// Pass spectator mode flag to game
(config as any).spectatorMode = !!roomId;

// Initialize game
const game = new Phaser.Game(config);

// Initialize ScoreSettledAdapter to listen for postMessages from Dex bridge
ScoreSettledAdapter.listenForPostMessages();

// Expose fixture helper for E2E / console testing
(window as any).__emitScoreSettled = (payload: ScoreSettledPayload) => {
  ScoreSettledAdapter.emitSettlement(payload);
};

// Initialize HUD
const hudElement = document.getElementById('hud');
if (hudElement) {
  const hudController = new HUDController(hudElement);

  // Wait for game to be ready
  game.events.once('ready', () => {
    const scene = game.scene.getScene('DuelScene') as DuelScene;
    if (scene) {
      // Need to wait for scene.create to finish
      setTimeout(() => {
        const agent1 = scene.getAgent1();
        const agent2 = scene.getAgent2();
        if (agent1 && agent2) {
          hudController.initialize(agent1, agent2);
        }
      }, 100);
    }
  });
}
