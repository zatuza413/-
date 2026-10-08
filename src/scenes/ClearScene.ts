import Phaser from 'phaser';
import type { DamageQueueStats } from '../core/DamageQueue';

/** 仮のクリア画面（段階5で作り込む） */
export class ClearScene extends Phaser.Scene {
  constructor() {
    super('Clear');
  }

  create(data: { stats: DamageQueueStats; hp: number }): void {
    const { width, height } = this.scale;
    const s = data.stats;
    this.add
      .text(width / 2, height / 2 - 120, '脱出成功', { fontFamily: 'sans-serif', fontSize: '48px', fontStyle: 'bold', color: '#ffe066' })
      .setOrigin(0.5);
    this.add
      .text(
        width / 2,
        height / 2 + 10,
        [
          `被弾 ${s.hits}   相殺 ${s.cancels}   連鎖 ${s.chains}（最大 ×${s.bestChain}）`,
          `確定  時間切れ ${s.confirms.timeout} / 上限超過 ${s.confirms.overflow} / 即時 ${s.confirms.instant}`,
          `部屋クリアで消えた予告 ${s.roomClearWipes}`,
        ].join('\n'),
        { fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff', align: 'center', lineSpacing: 8 },
      )
      .setOrigin(0.5);
    this.add.text(width / 2, height - 80, 'タップ / クリックでタイトルへ', { fontFamily: 'sans-serif', fontSize: '18px', color: '#9fe8ff' }).setOrigin(0.5);
    this.time.delayedCall(600, () => this.input.once('pointerdown', () => this.scene.start('Title')));
  }
}
