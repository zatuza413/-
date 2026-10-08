import Phaser from 'phaser';
import { ENEMIES, ENEMY_BULLET, PLAYER, TILE } from '../config/balance';

/** 仮素材（図形）のテクスチャを生成する。後で画像に差し替える前提 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const g = this.add.graphics();

    // 自機: 水色の円 + 銃身
    const pr = PLAYER.radius;
    const ps = pr * 2 + 12;
    g.clear();
    g.fillStyle(0x2b6f8a, 1).fillRect(ps / 2, ps / 2 - 3, pr + 6, 6);
    g.fillStyle(0x5fd3ff, 1).fillCircle(ps / 2, ps / 2, pr);
    g.lineStyle(2, 0xd8f6ff, 1).strokeCircle(ps / 2, ps / 2, pr);
    g.fillStyle(0xffffff, 1).fillCircle(ps / 2, ps / 2, 2.5);
    g.generateTexture('player', ps, ps);

    // 敵: 色付きの円 + 目
    for (const def of Object.values(ENEMIES)) {
      const r = def.radius;
      const s = r * 2 + 4;
      g.clear();
      g.fillStyle(def.color, 1).fillCircle(s / 2, s / 2, r);
      g.lineStyle(2, 0x000000, 0.6).strokeCircle(s / 2, s / 2, r);
      g.fillStyle(0x000000, 0.8).fillCircle(s / 2 - r * 0.3, s / 2 - r * 0.15, r * 0.18);
      g.fillCircle(s / 2 + r * 0.3, s / 2 - r * 0.15, r * 0.18);
      if (def.elite) g.lineStyle(2, 0xffffff, 1).strokeCircle(s / 2, s / 2, r - 3);
      g.generateTexture(`enemy_${def.id}`, s, s);
    }

    // 自機弾（白で作って武器ごとに tint する）
    g.clear();
    g.fillStyle(0xffffff, 1).fillCircle(6, 6, 4);
    g.generateTexture('pbullet', 12, 12);

    // 敵弾: 縁取りで背景から浮かせる
    const er = ENEMY_BULLET.radius;
    const es = er * 2 + 4;
    g.clear();
    g.fillStyle(ENEMY_BULLET.color, 1).fillCircle(es / 2, es / 2, er);
    g.fillStyle(0xffffff, 1).fillCircle(es / 2, es / 2, er * 0.45);
    g.lineStyle(1.5, 0x3a0020, 1).strokeCircle(es / 2, es / 2, er);
    g.generateTexture('ebullet', es, es);

    // 壁
    g.clear();
    g.fillStyle(0x3a3a52, 1).fillRect(0, 0, 32, 32);
    g.lineStyle(2, 0x56567a, 1).strokeRect(1, 1, 30, 30);
    g.generateTexture('wall', 32, 32);

    // フロアのタイルセット: 0 虚空 / 1 床 / 2 壁 / 3 閉じた扉（各 TILE px を横に並べる）
    const T = TILE;
    g.clear();
    g.fillStyle(0x08080d, 1).fillRect(0, 0, T, T);
    g.fillStyle(0x191926, 1).fillRect(T, 0, T, T);
    g.lineStyle(1, 0x222233, 1).strokeRect(T + 0.5, 0.5, T - 1, T - 1);
    g.fillStyle(0x3a3a52, 1).fillRect(T * 2, 0, T, T);
    g.lineStyle(2, 0x56567a, 1).strokeRect(T * 2 + 1, 1, T - 2, T - 2);
    g.fillStyle(0x7a2a3a, 1).fillRect(T * 3, 0, T, T);
    g.lineStyle(2, 0xff5a7a, 1).strokeRect(T * 3 + 1, 1, T - 2, T - 2);
    g.generateTexture('tiles', T * 4, T);

    g.destroy();
    this.scene.start('Title');
  }
}
