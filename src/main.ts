import Phaser from 'phaser';
import { DuelScene } from './game/DuelScene';
import { HUDController } from './ui/HUDController';
import './style.css';

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

// Initialize game
const game = new Phaser.Game(config);

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
