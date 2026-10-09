import Phaser from 'phaser';
import { FX } from '../config/balance';
import { Sfx } from '../game/Sfx';
import { exportTelemetry, telemetry } from '../game/telemetryStore';

/** タイトル。相殺の流れを小さく実演しつつ、本編とテスト部屋を選ぶ */
export class TitleScene extends Phaser.Scene {
  private demoG!: Phaser.GameObjects.Graphics;
  private demoText!: Phaser.GameObjects.Text;
  private bgDots: Array<{ x: number; y: number; vx: number; vy: number }> = [];
  private bgG!: Phaser.GameObjects.Graphics;
  private clock = 0;

  constructor() {
    super('Title');
  }

  create(): void {
    const { width, height } = this.scale;
    const font = 'sans-serif';
    this.clock = 0;

    // 背景: ゆっくり流れる敵弾
    this.bgG = this.add.graphics();
    this.bgDots = Array.from({ length: 40 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 40,
      vy: 15 + Math.random() * 30,
    }));

    this.add.text(width / 2, 70, '相殺シューター', { fontFamily: font, fontSize: '48px', fontStyle: 'bold', color: '#ffe066', stroke: '#3a2a00', strokeThickness: 6 }).setOrigin(0.5);
    this.add.text(width / 2, 122, '被弾上等。撃ち続けて生き残れ', { fontFamily: font, fontSize: '20px', color: '#ffffff' }).setOrigin(0.5);

    // 遊び方（3行）と実演
    this.add
      .text(
        width / 2 - 40,
        205,
        ['被弾すると、すぐには減らず「予告」が積まれる', '3秒以内に敵を倒せば相殺して消せる', '間に合わなければ確定してハートが減る'].join('\n'),
        { fontFamily: font, fontSize: '16px', color: '#d0d0e0', lineSpacing: 10 },
      )
      .setOrigin(0, 0.5);
    this.demoG = this.add.graphics();
    this.demoText = this.add.text(width / 2 - 150, 250, '', { fontFamily: font, fontSize: '14px', fontStyle: 'bold', color: '#fff3a0' }).setOrigin(0.5);

    const button = (y: number, label: string, scene: string) => {
      const bg = this.add.rectangle(width / 2, y, 300, 52, 0xffffff, 0.08).setStrokeStyle(2, 0x9fe8ff, 0.8);
      this.add.text(width / 2, y, label, { fontFamily: font, fontSize: '22px', fontStyle: 'bold', color: '#9fe8ff' }).setOrigin(0.5);
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.go(scene));
    };
    button(330, 'はじめる', 'Floor');
    button(395, 'テスト部屋', 'TestRoom');
    this.input.keyboard?.once('keydown-ENTER', () => this.go('Floor'));

    // 記録と計測（デバッグ用）
    const runs = telemetry.runs;
    const clears = runs.filter((r) => r.cleared).length;
    const best = runs.reduce((m, r) => Math.max(m, r.floorReached), 0);
    const broken = runs.filter((r) => r.brokenBuild).length;
    this.add
      .text(width / 2, 446, runs.length > 0 ? `記録: ${runs.length}周  クリア ${clears}回  最高到達 フロア${best}${broken > 0 ? `  壊れビルド ${broken}回` : ''}` : '', {
        fontFamily: font,
        fontSize: '14px',
        color: '#aaaacc',
      })
      .setOrigin(0.5);
    const sum = telemetry.summary();
    const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
    const info = this.add
      .text(16, height - 12, `計測: 相殺成功率 PC ${pct(sum.pc.cancelRate)}（${sum.pc.rooms}部屋） / スマホ ${pct(sum.touch.cancelRate)}（${sum.touch.rooms}部屋）  [計測データを書き出す]`, {
        fontFamily: font,
        fontSize: '13px',
        color: '#8888aa',
      })
      .setOrigin(0, 1)
      .setInteractive({ useHandCursor: true });
    info.on('pointerdown', async () => {
      const msg = await exportTelemetry();
      info.setText(`計測データ: ${msg}`);
    });
  }

  private go(scene: string): void {
    Sfx.unlock();
    this.scene.start(scene, {});
  }

  /**
   * 実演（6秒で1周）: 弾が当たって予告が積まれる → タイマーが減る → 敵を倒して相殺。
   * 2周に1回は間に合わずに確定する。
   */
  update(_t: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.clock += dt;
    const { width, height } = this.scale;

    const bg = this.bgG;
    bg.clear();
    for (const d of this.bgDots) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y > height + 10) {
        d.y = -10;
        d.x = Math.random() * width;
      }
      bg.fillStyle(0xff5ab4, 0.18).fillCircle(d.x, d.y, 4);
    }

    const g = this.demoG;
    g.clear();
    const cycle = 6;
    const t = this.clock % cycle;
    const fail = Math.floor(this.clock / cycle) % 2 === 1;
    const px = width / 2 - 150;
    const py = 205;
    const ex = px - 110;
    const ey = py;
    // 自機と敵
    g.fillStyle(0x5fd3ff, 1).fillCircle(px, py, 10);
    const enemyAlive = fail || t < 3.6;
    if (enemyAlive) g.fillStyle(0xe0584a, 1).fillCircle(ex, ey, 12);
    // 敵弾（0〜0.8秒で飛んでくる）
    if (t < 0.8) g.fillStyle(0xff5ab4, 1).fillCircle(ex + ((px - ex) * t) / 0.8, ey, 5);
    // 予告リング
    const R = FX.ringRadius;
    let label = '';
    if (t >= 0.8) {
      const elapsed = t - 0.8;
      const remain = Math.max(0, 3 - elapsed);
      const cancelled = !fail && t >= 3.6;
      const confirmed = fail && remain <= 0;
      if (!cancelled && !confirmed) {
        const ratio = remain / 3;
        const col = remain < 1 ? 0xff3344 : ratio < 0.6 ? 0xff9a1f : 0xffd84a;
        g.lineStyle(7, col, 1);
        g.beginPath();
        g.arc(px, py, R, -Math.PI / 2 + 0.07, -Math.PI / 2 + 0.07 + (Math.PI / 2 - 0.14) * ratio);
        g.strokePath();
        label = `予告 あと${remain.toFixed(1)}秒`;
        // 自機の弾が敵へ
        if (!fail && t > 2.6) {
          for (let k = 0; k < 3; k++) {
            const s = ((t - 2.6) * 3 + k / 3) % 1;
            g.fillStyle(0xfff27a, 1).fillCircle(px + (ex - px) * s, py, 3);
          }
        }
      } else if (cancelled) {
        const a = Math.min(1, (t - 3.6) / 0.6);
        g.lineStyle(3, 0xfff3a0, 1 - a).strokeCircle(px, py, R + a * 24);
        label = '倒して相殺！';
      } else {
        const a = Math.min(1, (elapsed - 3) / 0.8);
        g.fillStyle(0xff3344, 0.5 * (1 - a)).fillCircle(px, py, 40);
        g.lineStyle(2, 0xff3344, 1 - a).lineBetween(px, py, ex, ey);
        label = '時間切れで確定';
      }
    }
    this.demoText.setText(label).setY(py + 46);
    this.demoText.setColor(label === '時間切れで確定' ? '#ff6680' : '#fff3a0');
  }
}
