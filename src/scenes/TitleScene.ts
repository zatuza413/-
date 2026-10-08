import Phaser from 'phaser';
import { Sfx } from '../game/Sfx';

/** 仮のタイトル（段階5で作り込む） */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2 - 110, '相殺シューター（試作）', { fontFamily: 'sans-serif', fontSize: '44px', fontStyle: 'bold', color: '#ffe066' })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 - 50, '被弾上等。撃ち続けて生き残れ', { fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff' })
      .setOrigin(0.5);

    const button = (y: number, label: string, scene: string) => {
      const bg = this.add.rectangle(width / 2, y, 300, 56, 0xffffff, 0.08).setStrokeStyle(2, 0x9fe8ff, 0.8);
      this.add.text(width / 2, y, label, { fontFamily: 'sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#9fe8ff' }).setOrigin(0.5);
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        Sfx.unlock();
        this.scene.start(scene, {});
      });
    };
    button(height / 2 + 50, 'はじめる', 'Floor');
    button(height / 2 + 125, 'テスト部屋', 'TestRoom');
  }
}
