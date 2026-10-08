// 相殺システムの「見せ方」をまとめたもの。DamageQueue のイベントを受けて演出する。
// ミス認知の演出 1〜6 はここに集める。
//  1. 被弾（軽い）と確定（ヒットストップ・赤点滅・重い音）の手応えを分ける
//  2. 確定時に予告元の敵へ線を引き、足りなかった分を表示する
//  3. 確定の理由ごとに色と音を変える
//  4. 予告がある間、倒せそうな敵に印を出す（描画は drawKillMarks）
//  5. 予告の残り時間に応じて心音が速くなる
//  6. 予告は自機の周囲の円形ゲージで表示する

import Phaser from 'phaser';
import { CHAIN, FX } from '../config/balance';
import type { ConfirmReason, DamageQueue, DamageQueueEvent, InstantKind, HitKind } from '../core/DamageQueue';
import { Sfx } from './Sfx';

export interface PresenterHost {
  scene: Phaser.Scene;
  queue: DamageQueue;
  getPlayerPos(): { x: number; y: number };
  /** 敵 ID から現在位置（死んでいれば最後の位置）と名前を引く */
  getSourceInfo(id: number): { x: number; y: number; name: string; alive: boolean } | null;
  /** ヒットストップ */
  hitstop(ms: number): void;
  /** 連鎖ボーナスを実行する（衝撃波・弾薬・攻撃力）。count は連鎖数 */
  applyChainBonus(count: number): void;
}

const INSTANT_LABEL: Record<InstantKind, string> = {
  pit: '落とし穴',
  selfExplosion: '自爆',
  sacrifice: '代償',
};
const HIT_LABEL: Record<HitKind, string> = {
  bullet: '弾',
  contact: '接触',
  explosion: '爆発',
  boss: 'ボス',
  hazard: '床',
};

interface Blame {
  text: Phaser.GameObjects.Text;
  line: Phaser.GameObjects.Graphics;
  /** 確定してからの経過（秒） */
  age: number;
  /** 「あと◯秒」に書き換え済みか */
  resolved: boolean;
  reason: ConfirmReason;
}

export class CancelPresenter {
  private readonly host: PresenterHost;
  private readonly scene: Phaser.Scene;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private blames: Blame[] = [];
  private nextBeat = 0;
  private clock = 0;
  /** 予告ゲージの各スロットの「出現アニメ」 */
  private popTimes = new Map<number, number>();
  private readonly unsubscribe: () => void;

  constructor(host: PresenterHost) {
    this.host = host;
    this.scene = host.scene;
    this.ring = this.scene.add.graphics().setDepth(20);
    this.marks = this.scene.add.graphics().setDepth(19);
    this.flash = this.scene.add
      .rectangle(0, 0, this.scene.scale.width, this.scene.scale.height, 0xff0000, 0)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(100);
    // キューはフロアをまたいで使い回すので、破棄時に購読を外す
    this.unsubscribe = host.queue.on((e) => this.onEvent(e));
  }

  destroy(): void {
    this.unsubscribe();
    this.ring.destroy();
    this.marks.destroy();
    this.flash.destroy();
    for (const b of this.blames) {
      b.text.destroy();
      b.line.destroy();
    }
  }

  // ------------------------------------------------------------ イベント

  private onEvent(e: DamageQueueEvent): void {
    const p = this.host.getPlayerPos();
    switch (e.type) {
      case 'queued':
        // 1. 被弾は軽い音と小さなエフェクトのみ
        Sfx.pendingHit();
        this.spark(p.x, p.y, 0xffe28a, 6, 90);
        this.popTimes.set(e.pending.id, this.clock);
        break;
      case 'ignored':
        Sfx.absorb();
        break;
      case 'cancelled':
        this.onCancelled(e.viaStock);
        if (!e.viaStock) this.resolveLate();
        break;
      case 'chain':
        this.onChain(e.count);
        break;
      case 'stockGained':
        Sfx.stock();
        this.resolveLate();
        this.floatText(p.x, p.y - 34, 'ストック', '#9fe8ff', 16);
        break;
      case 'roomCleared':
        if (e.count > 0) {
          Sfx.roomClear();
          this.floatText(p.x, p.y - 40, `予告 ${e.count} 個 消去`, '#b8ffb0', 20);
          this.burstRing(p.x, p.y, 0x9dff9a, e.count);
        }
        break;
      case 'confirmed':
        this.onConfirmed(e);
        break;
      case 'graced':
        this.floatText(p.x, p.y - 40, '猶予 +0.5秒', '#c9b0ff', 16);
        break;
      case 'borrowed':
        Sfx.stock();
        this.floatText(p.x, p.y - 40, '前借り（借金1）', '#c9b0ff', 16);
        break;
      case 'debtRepaid':
        this.floatText(p.x, p.y - 40, '返済', '#c9b0ff', 14);
        break;
    }
  }

  private onCancelled(viaStock: boolean): void {
    const p = this.host.getPlayerPos();
    const chain = Math.max(1, this.host.queue.chainCount);
    Sfx.cancel(chain);
    this.burstRing(p.x, p.y, viaStock ? 0x9fe8ff : 0xfff3a0, 1);
    this.floatText(p.x, p.y - 36, viaStock ? 'ストック相殺' : '相殺！', viaStock ? '#9fe8ff' : '#fff3a0', 18);
  }

  private onChain(count: number): void {
    const p = this.host.getPlayerPos();
    Sfx.chain(count);
    this.host.applyChainBonus(count);
    const cam = this.scene.cameras.main;
    cam.shake(160, 0.004 + 0.002 * Math.min(count, 5));
    // 軽いズームパンチ
    this.scene.tweens.add({ targets: cam, zoom: 1.04 + 0.01 * Math.min(count, 4), duration: 70, yoyo: true, ease: 'Quad.Out' });
    this.host.hitstop(40);

    const t = this.scene.add
      .text(p.x, p.y - 60, `連鎖 ×${count}`, {
        fontFamily: 'sans-serif',
        fontSize: `${30 + Math.min(count, 6) * 4}px`,
        fontStyle: 'bold',
        color: '#ffe066',
        stroke: '#7a3a00',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(60)
      .setScale(0.3);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: t, y: t.y - 30, alpha: 0, delay: 650, duration: 450, onComplete: () => t.destroy() });

    // 衝撃波の見た目
    const r = Math.min(CHAIN.shockwave.base + CHAIN.shockwave.perChain * (count - this.host.queue.chainMin), CHAIN.shockwave.max);
    const wave = this.scene.add.circle(p.x, p.y, 10, 0xffffff, 0).setStrokeStyle(6, 0xffe066, 1).setDepth(55);
    this.scene.tweens.add({
      targets: wave,
      radius: r,
      duration: 260,
      ease: 'Cubic.Out',
      onUpdate: () => wave.setStrokeStyle(6, 0xffe066, wave.alpha),
    });
    this.scene.tweens.add({ targets: wave, alpha: 0, delay: 140, duration: 220, onComplete: () => wave.destroy() });
  }

  private onConfirmed(e: Extract<DamageQueueEvent, { type: 'confirmed' }>): void {
    const p = this.host.getPlayerPos();
    const color = FX.reasonColor[e.reason];
    // 1. 確定: ヒットストップ・画面点滅・重い音（3. 理由ごとに色と音を変える）
    Sfx.confirm(e.reason);
    this.host.hitstop(FX.hitstopMs);
    this.scene.cameras.main.shake(220, 0.012);
    this.flash.setFillStyle(color, 0.45);
    this.scene.tweens.killTweensOf(this.flash);
    this.scene.tweens.add({ targets: this.flash, fillAlpha: 0, duration: FX.confirmFlashMs, ease: 'Quad.In' });
    this.spark(p.x, p.y, color, 16, 220);

    // 2. 予告元へ線を引き、足りなかった分を表示する
    let label: string;
    switch (e.reason) {
      case 'timeout':
        label = e.pointShort >= 0.999 ? '時間切れ  あと1体' : `時間切れ  あと${Math.ceil(e.pointShort * 100)}%`;
        break;
      case 'overflow':
        label = `上限超過  予告が満杯（${HIT_LABEL[e.kind as HitKind] ?? ''}）`;
        break;
      case 'instant':
        label = `即時確定  ${INSTANT_LABEL[e.kind as InstantKind] ?? ''}`;
        break;
    }
    const line = this.scene.add.graphics().setDepth(45);
    const src = e.sourceId !== null ? this.host.getSourceInfo(e.sourceId) : null;
    if (src) {
      line.lineStyle(3, color, 1);
      line.lineBetween(p.x, p.y, src.x, src.y);
      line.strokeCircle(src.x, src.y, 22);
      line.fillStyle(color, 1);
      line.fillCircle(src.x, src.y, 4);
      label += `\n← ${src.name}${src.alive ? '' : '（撃破済）'}`;
    }
    const css = '#' + color.toString(16).padStart(6, '0');
    const text = this.scene.add
      .text(p.x, p.y + FX.ringRadius + 14, label, {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: css,
        stroke: '#000000',
        strokeThickness: 5,
        align: 'center',
      })
      .setOrigin(0.5, 0) // 連鎖表示（上）と重ならないよう自機の下に出す
      .setDepth(61);
    this.blames.push({ text, line, age: 0, resolved: false, reason: e.reason });
  }

  /** 確定直後に1ポイント分が溜まった → 「あと◯秒」だったと書き換える */
  private resolveLate(): void {
    for (const b of this.blames) {
      if (b.resolved || b.reason !== 'timeout' || b.age > FX.lateWindow) continue;
      b.resolved = true;
      b.text.setText(`時間切れ  あと${b.age.toFixed(1)}秒`);
    }
  }

  // ------------------------------------------------------------ 毎フレーム

  update(dt: number): void {
    this.clock += dt;
    this.drawRing();
    this.updateHeartbeat();

    for (const b of this.blames) {
      b.age += dt;
      const life = FX.blameLineMs / 1000;
      const a = Phaser.Math.Clamp(1 - (b.age - life * 0.6) / (life * 0.4), 0, 1);
      b.line.setAlpha(a);
      b.text.setAlpha(a);
    }
    this.blames = this.blames.filter((b) => {
      if (b.age < FX.blameLineMs / 1000) return true;
      b.text.destroy();
      b.line.destroy();
      return false;
    });
  }

  /** 6. 自機周囲の円形ゲージ */
  private drawRing(): void {
    const q = this.host.queue;
    const { x, y } = this.host.getPlayerPos();
    const g = this.ring;
    g.clear();
    const R = FX.ringRadius;
    const n = q.maxPending;
    const gap = 0.14;
    const seg = (Math.PI * 2) / n;
    const start = -Math.PI / 2;

    const items = q.pending;
    if (items.length > 0 || q.stock > 0 || q.partial > 0) {
      // 空きスロット（薄く）
      for (let i = 0; i < n; i++) {
        const a0 = start + i * seg + gap / 2;
        const a1 = start + (i + 1) * seg - gap / 2;
        g.lineStyle(5, 0xffffff, items.length > 0 ? 0.13 : 0.06);
        g.beginPath();
        g.arc(x, y, R, a0, a1);
        g.strokePath();
      }
    }
    // 予告: 残りの短い順に時計回り。弧の長さ = 残り時間の割合
    items.forEach((p, i) => {
      const ratio = Phaser.Math.Clamp(p.remaining / p.duration, 0, 1);
      const a0 = start + i * seg + gap / 2;
      const full = seg - gap;
      const urgent = p.remaining < 1;
      const col = urgent ? 0xff3344 : ratio < 0.6 ? 0xff9a1f : 0xffd84a;
      const pop = this.popTimes.get(p.id);
      const popT = pop !== undefined ? Math.min(1, (this.clock - pop) / 0.15) : 1;
      const width = 7 + (1 - popT) * 6 + (urgent ? Math.sin(this.clock * 30) * 1.5 : 0);
      g.lineStyle(width, col, 1);
      g.beginPath();
      g.arc(x, y, R, a0, a0 + full * ratio);
      g.strokePath();
    });
    // 次の1ポイントまでの端数（内側の細い弧）
    if (q.partial > 0 && items.length > 0) {
      g.lineStyle(2, 0x9fe8ff, 0.8);
      g.beginPath();
      g.arc(x, y, R - 7, start, start + Math.PI * 2 * q.partial);
      g.strokePath();
    }
    // ストック（内側の点）
    for (let i = 0; i < q.maxStock; i++) {
      const ax = x + (i - (q.maxStock - 1) / 2) * 9;
      const ay = y + R + 10;
      if (i < q.stock) {
        g.fillStyle(0x9fe8ff, 1);
        g.fillCircle(ax, ay, 3.5);
      } else if (items.length > 0 || q.stock > 0) {
        g.lineStyle(1, 0x9fe8ff, 0.4);
        g.strokeCircle(ax, ay, 3.5);
      }
    }
    // 予告無敵 / 確定後無敵の表示（細い白い輪）
    if (q.isInvulnerable) {
      g.lineStyle(2, 0xffffff, 0.5 + 0.5 * Math.sin(this.clock * 40));
      g.strokeCircle(x, y, R + 7);
    }
    // 古いポップ記録を掃除
    if (this.popTimes.size > 16) {
      const ids = new Set(items.map((p) => p.id));
      for (const k of this.popTimes.keys()) if (!ids.has(k)) this.popTimes.delete(k);
    }
  }

  /** 5. 心音: 一番早く確定する予告の残り時間で間隔を決める */
  private updateHeartbeat(): void {
    const rem = this.host.queue.soonestRemaining;
    if (rem === null) {
      this.nextBeat = 0;
      return;
    }
    const t = Phaser.Math.Clamp(rem / FX.heartbeat.calmAt, 0, 1);
    const interval = Phaser.Math.Linear(FX.heartbeat.fast, FX.heartbeat.slow, t);
    if (this.nextBeat === 0) this.nextBeat = this.clock + 0.05;
    if (this.clock >= this.nextBeat) {
      Sfx.heartbeat(1 - t);
      // 次の拍は「いまの残り時間」で決め直す
      this.nextBeat = this.clock + interval;
    }
  }

  /** 4. 倒せそうな敵への印。敵リストは呼び出し側が渡す */
  drawKillMarks(targets: Array<{ x: number; y: number; r: number }>, nemesis: Array<{ x: number; y: number; r: number }> = []): void {
    const g = this.marks;
    g.clear();
    if (this.host.queue.count === 0) return;
    // 仇の印: 予告を作った敵を赤い破線の輪で囲む（狙撃撃破でボーナスが上がる）
    for (const t of nemesis) {
      const r = t.r + 9;
      g.lineStyle(2, 0xff4466, 0.9);
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2 + this.clock * 1.5;
        g.beginPath();
        g.arc(t.x, t.y, r, a0, a0 + Math.PI / 8);
        g.strokePath();
      }
    }
    const bob = Math.sin(this.clock * 8) * 2;
    for (const t of targets) {
      const y = t.y - t.r - 10 + bob;
      g.fillStyle(0xffffff, 0.95);
      g.fillTriangle(t.x - 5, y - 6, t.x + 5, y - 6, t.x, y);
      g.lineStyle(1.5, 0xffffff, 0.6);
      const s = t.r + 5;
      // 四隅のカギ括弧
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        g.beginPath();
        g.moveTo(t.x + sx * s, t.y + sy * (s - 5));
        g.lineTo(t.x + sx * s, t.y + sy * s);
        g.lineTo(t.x + sx * (s - 5), t.y + sy * s);
        g.strokePath();
      }
    }
  }

  // ------------------------------------------------------------ 小物

  private spark(x: number, y: number, color: number, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = speed * (0.4 + Math.random() * 0.6) * 0.25;
      const c = this.scene.add.circle(x, y, 2 + Math.random() * 2, color).setDepth(50);
      this.scene.tweens.add({
        targets: c,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        alpha: 0,
        duration: 220 + Math.random() * 120,
        onComplete: () => c.destroy(),
      });
    }
  }

  /** ゲージから破片が飛び散る（相殺・部屋クリア） */
  private burstRing(x: number, y: number, color: number, n: number): void {
    for (let i = 0; i < 10 * n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sx = x + Math.cos(a) * FX.ringRadius;
      const sy = y + Math.sin(a) * FX.ringRadius;
      const c = this.scene.add.rectangle(sx, sy, 4, 4, color).setDepth(50).setRotation(a);
      this.scene.tweens.add({
        targets: c,
        x: sx + Math.cos(a) * 40,
        y: sy + Math.sin(a) * 40,
        alpha: 0,
        duration: 380,
        ease: 'Cubic.Out',
        onComplete: () => c.destroy(),
      });
    }
  }

  floatText(x: number, y: number, s: string, color: string, size: number): void {
    const t = this.scene.add
      .text(x, y, s, { fontFamily: 'sans-serif', fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(58);
    this.scene.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 700, ease: 'Cubic.Out', onComplete: () => t.destroy() });
  }
}
