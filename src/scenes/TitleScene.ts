import Phaser from 'phaser';
import { Sfx } from '../game/Sfx';

/** 仮のタイトル（段階5で作り込む）。クリックで音声を有効化してゲームへ */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2 - 60, '相殺シューター（試作）', { fontFamily: 'sans-serif', fontSize: '44px', fontStyle: 'bold', color: '#ffe066' })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2, '被弾上等。撃ち続けて生き残れ', { fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff' })
      .setOrigin(0.5);
    const start = this.add
      .text(width / 2, height / 2 + 90, 'クリックでテスト部屋へ', { fontFamily: 'sans-serif', fontSize: '20px', color: '#9fe8ff' })
      .setOrigin(0.5);
    this.tweens.add({ targets: start, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });

    this.input.once('pointerdown', () => {
      Sfx.unlock();
      this.scene.start('Game');
    });
  }
}
