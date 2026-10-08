import Phaser from 'phaser';
import { VIEW } from './config/balance';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { Sfx } from './game/Sfx';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW.width,
  height: VIEW.height,
  backgroundColor: '#14141e',
  pixelArt: false,
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, TitleScene, GameScene],
});

// 開発時のみ、コンソールから状態を確認できるようにする
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

// iOS Safari は touchend の中でないと音声を有効化できないことがある
for (const ev of ['touchend', 'pointerup', 'keydown']) {
  window.addEventListener(ev, () => Sfx.unlock(), { passive: true });
}
