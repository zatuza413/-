// リザルト画面。死亡時は「死ぬ直前5秒のスロー再生」と成績・死因、クリア時は成績だけ。
// 戦闘中の画面には分析情報を出さず、振り返りはここにまとめる。

import Phaser from 'phaser';
import { FX, REPLAY } from '../config/balance';
import type { ConfirmReason, DamageQueueStats } from '../core/DamageQueue';
import type { ReplayFrame } from '../core/Replay';
import { cancelRate } from '../core/Telemetry';

export interface ResultData {
  mode: 'death' | 'clear';
  /** 「もう一度」で始めるシーン */
  restart: 'Floor' | 'TestRoom';
  floor: number;
  stats: DamageQueueStats;
  /** 死因（最後の確定） */
  cause: { reason: ConfirmReason; label: string; source: string | null; short: string | null } | null;
  frames: ReplayFrame[];
  items: string[];
  currency: number;
}

const REASON_LABEL: Record<ConfirmReason, string> = { timeout: '時間切れ', overflow: '上限超過', instant: '即時確定' };

export class ResultScene extends Phaser.Scene {
  private result!: ResultData;
  private replayG!: Phaser.GameObjects.Graphics;
  private timelineG!: Phaser.GameObjects.Graphics;
  private playhead = 0;
  private holdAtEnd = 0;
  private replayLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('Result');
  }

  init(data: ResultData): void {
    this.result = data;
    this.playhead = 0;
    this.holdAtEnd = 0;
  }

  create(): void {
    const { width, height } = this.scale;
    const d = this.result;
    const death = d.mode === 'death';
    const font = 'sans-serif';
    this.add.rectangle(0, 0, width, height, 0x0e0e16).setOrigin(0);
    this.add
      .text(death ? 290 : width / 2, 30, death ? '相殺に失敗した' : '脱出成功', { fontFamily: font, fontSize: '28px', fontStyle: 'bold', color: death ? '#ff6680' : '#ffe066' })
      .setOrigin(0.5);

    // ------------------------------------------------ スロー再生（死亡時のみ）
    if (death && d.frames.length > 0) {
      const box = { x: 20, y: 60, w: 540, h: 400 };
      this.add.rectangle(box.x, box.y, box.w, box.h, 0x14141e).setOrigin(0).setStrokeStyle(1, 0x333348);
      this.replayG = this.add.graphics();
      const mask = this.make.graphics({}, false).fillRect(box.x, box.y, box.w, box.h);
      this.replayG.setMask(mask.createGeometryMask());
      this.timelineG = this.add.graphics();
      this.replayLabel = this.add.text(box.x + 8, box.y + 6, '', { fontFamily: font, fontSize: '13px', color: '#aaaacc' });
      this.add.text(box.x, box.y + box.h + 30, `死ぬ直前${REPLAY.seconds}秒・${REPLAY.speed}倍速で繰り返し再生`, { fontFamily: font, fontSize: '12px', color: '#777799' });
    }

    // ------------------------------------------------ 成績
    const s = d.stats;
    const rate = cancelRate(s.cancels, s.confirms);
    const lines: string[] = [
      `被弾 ${s.hits}   相殺 ${s.cancels}   連鎖 ${s.chains}（最大 ×${s.bestChain}）`,
      `確定  時間切れ ${s.confirms.timeout} / 上限超過 ${s.confirms.overflow} / 即時 ${s.confirms.instant}`,
      `相殺成功率 ${rate === null ? '—' : Math.round(rate * 100) + '%'}`,
      '',
      `部屋全滅で消えた予告 ${s.roomClearWipes}`,
      '（相殺・成功率には数えない）',
      '',
    ];
    if (death && d.cause) {
      const c = d.cause;
      lines.push(`死因: ${c.label}${c.short ? `（${c.short}）` : ''}`);
      if (c.source) lines.push(`　← ${c.source} の予告`);
      lines.push('');
    }
    lines.push(`到達 フロア ${d.floor}   通貨 ${d.currency}`);
    if (d.items.length > 0) lines.push(`アイテム: ${d.items.join('・')}`);
    const px = death ? 585 : width / 2 - 230;
    this.add.text(px, 70, lines.join('\n'), {
      fontFamily: font,
      fontSize: '16px',
      color: '#e0e0f0',
      lineSpacing: 6,
      wordWrap: { width: death ? 360 : 460, useAdvancedWrap: true },
    });

    // ------------------------------------------------ ボタン
    const button = (x: number, label: string, onTap: () => void) => {
      const t = this.add
        .text(x, height - 34, label, { fontFamily: font, fontSize: '18px', fontStyle: 'bold', color: '#9fe8ff', backgroundColor: '#1c1c2c', padding: { x: 20, y: 9 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', onTap);
    };
    button(death ? 680 : width / 2 - 110, 'もう一度', () => this.scene.start(d.restart, {}));
    button(death ? 850 : width / 2 + 110, 'タイトルへ', () => this.scene.start('Title'));
    this.input.keyboard?.once('keydown-ENTER', () => this.scene.start(d.restart, {}));
  }

  update(_t: number, deltaMs: number): void {
    const frames = this.result.frames;
    if (this.result.mode !== 'death' || frames.length === 0 || !this.replayG) return;
    const dt = deltaMs / 1000;
    if (this.holdAtEnd > 0) {
      this.holdAtEnd -= dt;
      if (this.holdAtEnd <= 0) this.playhead = 0;
    } else {
      this.playhead += dt * REPLAY.fps * REPLAY.speed;
      if (this.playhead >= frames.length - 1) {
        this.playhead = frames.length - 1;
        this.holdAtEnd = 1.5;
      }
    }
    this.drawFrame(Math.floor(this.playhead));
  }

  /** 1フレームを描く。自機を中心に、0.62倍で見せる */
  private drawFrame(i: number): void {
    const frames = this.result.frames;
    const f = frames[i];
    const g = this.replayG;
    g.clear();
    const box = { x: 20, y: 60, w: 540, h: 400 };
    const sc = 0.62;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const X = (wx: number) => cx + (wx - f.player.x) * sc;
    const Y = (wy: number) => cy + (wy - f.player.y) * sc;

    // 床の目印（動きが分かるように）
    g.lineStyle(1, 0x222233, 1);
    const step = 64;
    const ox = ((-f.player.x * sc) % (step * sc)) + cx;
    const oy = ((-f.player.y * sc) % (step * sc)) + cy;
    for (let x = ox - box.w; x < box.x + box.w; x += step * sc) g.lineBetween(x, box.y, x, box.y + box.h);
    for (let y = oy - box.h; y < box.y + box.h; y += step * sc) g.lineBetween(box.x, y, box.x + box.w, y);

    for (const e of f.enemies) g.fillStyle(e.color, 1).fillCircle(X(e.x), Y(e.y), Math.max(4, e.r * sc));
    for (const [x, y] of f.playerBullets) g.fillStyle(0xfff27a, 1).fillCircle(X(x), Y(y), 2);
    // 種類: 0 ふつう / 1 大きい / 2 硬い（ボス）
    for (const [x, y, kind] of f.enemyBullets) g.fillStyle(kind === 1 ? 0xff8a3f : kind === 2 ? 0xc23a8a : 0xff5ab4, 1).fillCircle(X(x), Y(y), kind === 1 ? 5 : 3.5);

    // 自機と予告リング
    const px = X(f.player.x);
    const py = Y(f.player.y);
    g.fillStyle(0x5fd3ff, 1).fillCircle(px, py, 7);
    const R = FX.ringRadius * sc + 4;
    const seg = (Math.PI * 2) / 4;
    f.pending.forEach((p, k) => {
      const ratio = Phaser.Math.Clamp(p.remaining / p.duration, 0, 1);
      const col = p.remaining < 1 ? 0xff3344 : ratio < 0.6 ? 0xff9a1f : 0xffd84a;
      g.lineStyle(5, col, 1);
      g.beginPath();
      g.arc(px, py, R, -Math.PI / 2 + k * seg + 0.07, -Math.PI / 2 + k * seg + 0.07 + (seg - 0.14) * ratio);
      g.strokePath();
    });

    // 直近の出来事を強調（少しの間残す）
    let label = '';
    for (let k = Math.max(0, i - 8); k <= i; k++) {
      for (const ev of frames[k].events) {
        const age = (i - k) / 8;
        if (ev === 'hit') g.lineStyle(2, 0xffffff, 1 - age).strokeCircle(px, py, 16 + age * 14);
        else if (ev === 'cancel') g.lineStyle(3, 0xffe066, 1 - age).strokeCircle(px, py, R + 6 + age * 16);
        else if (ev.startsWith('confirm:')) {
          const reason = ev.slice(8) as ConfirmReason;
          g.fillStyle(FX.reasonColor[reason], 0.35 * (1 - age)).fillRect(box.x, box.y, box.w, box.h);
          label = `確定（${REASON_LABEL[reason]}）`;
        }
      }
    }
    const remain = ((frames.length - 1 - i) / REPLAY.fps).toFixed(1);
    this.replayLabel.setText(`残り ${remain} 秒   HP ${f.player.hp}/${f.player.maxHp}   ${label}`);

    // 時間軸: 被弾は白、確定は理由の色
    const tl = this.timelineG;
    tl.clear();
    const ty = box.y + box.h + 12;
    tl.fillStyle(0x333348, 1).fillRect(box.x, ty, box.w, 6);
    frames.forEach((fr, k) => {
      const x = box.x + (k / Math.max(1, frames.length - 1)) * box.w;
      for (const ev of fr.events) {
        if (ev === 'hit') tl.fillStyle(0xffffff, 0.8).fillRect(x - 1, ty - 3, 2, 12);
        else if (ev.startsWith('confirm:')) tl.fillStyle(FX.reasonColor[ev.slice(8) as ConfirmReason], 1).fillRect(x - 2, ty - 5, 4, 16);
      }
    });
    tl.fillStyle(0x9fe8ff, 1).fillRect(box.x + (i / Math.max(1, frames.length - 1)) * box.w - 1, ty - 6, 3, 18);
  }
}
