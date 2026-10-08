import { WEAPONS } from '../config/balance';
import type { WeaponDef, WeaponId } from '../core/types';
import { holdRate } from '../core/weaponMath';

export interface WeaponSlot {
  def: WeaponDef;
  /** マガジン内の弾 */
  mag: number;
  /** 予備弾（null なら無限） */
  reserve: number | null;
}

export interface Shot {
  angle: number;
  def: WeaponDef;
  /** 撃った時点の武器固有の倍率（マシンガンの押しっぱなしなど） */
  rateMult: number;
  /** 早撃ちの弾帯で強化された弾倉の弾か */
  boosted: boolean;
}

export interface WeaponTick {
  shots: Shot[];
  /** 照射（レーザー）が出ているか */
  beam: boolean;
  reloaded: boolean;
  autoReload: boolean;
}

/** 早撃ちの弾帯: リロードの進み具合が start〜start+width 秒の間に再入力すると即完了 */
export interface ActiveReloadWindow {
  /** 判定の開始位置（リロード時間に対する割合） */
  start: number;
  /** 判定の幅（秒） */
  width: number;
}

/** 所持武器・弾薬・リロード・連射間隔・過熱を管理する（描画なし） */
export class WeaponSystem {
  slots: WeaponSlot[] = [];
  index = 0;
  private cooldown = 0;
  /** リロード残り時間（0 ならリロードしていない） */
  reloading = 0;
  /** 押しっぱなしの時間（マシンガンの倍率） */
  holdTime = 0;
  /** 照射の熱（秒）と、過熱して冷えるまでの残り（秒） */
  heat = 0;
  overheated = 0;
  /** 早撃ちの弾帯（null なら無し） */
  activeReload: ActiveReloadWindow | null = null;
  /** 早撃ちに成功した直後の弾倉か（次のリロードまで） */
  boosted = false;

  constructor(ids: WeaponId[]) {
    for (const id of ids) this.add(id);
  }

  add(id: WeaponId): void {
    if (this.has(id)) return;
    const def = WEAPONS[id];
    this.slots.push({ def, mag: def.magazine, reserve: def.maxAmmo === null ? null : def.maxAmmo - def.magazine });
  }

  has(id: WeaponId): boolean {
    return this.slots.some((s) => s.def.id === id);
  }

  get current(): WeaponSlot {
    return this.slots[this.index];
  }

  switch(delta: number): void {
    if (this.slots.length <= 1) return;
    this.index = (this.index + delta + this.slots.length) % this.slots.length;
    this.reloading = 0;
    this.holdTime = 0;
    this.boosted = false;
    this.cooldown = Math.max(this.cooldown, 0.1);
  }

  /** リロードを始める。リロード中に呼ぶと早撃ちの判定になる（'fast' = 即完了） */
  startReload(): boolean | 'fast' {
    const s = this.current;
    if (this.reloading > 0) return this.tryActiveReload() ? 'fast' : false;
    if (s.def.kind === 'beam' || s.mag >= s.def.magazine) return false;
    if (s.reserve !== null && s.reserve <= 0) return false;
    this.reloading = s.def.reloadTime;
    this.holdTime = 0;
    this.boosted = false;
    return true;
  }

  /** 早撃ち: 判定の幅の中なら即完了し、次の弾倉を強化する */
  private tryActiveReload(): boolean {
    const w = this.activeReload;
    if (!w || this.reloading <= 0) return false;
    const total = this.current.def.reloadTime;
    const elapsed = total - this.reloading;
    const from = w.start * total;
    if (elapsed < from || elapsed > from + w.width) return false;
    this.finishReload();
    this.boosted = true;
    return true;
  }

  /** 判定の幅（リロード時間に対する割合）。HUD 表示用 */
  get activeReloadSpan(): [number, number] | null {
    const w = this.activeReload;
    if (!w) return null;
    const total = this.current.def.reloadTime || 1;
    return [w.start, w.start + w.width / total];
  }

  private finishReload(): void {
    const s = this.current;
    this.reloading = 0;
    const need = s.def.magazine - s.mag;
    const take = s.reserve === null ? need : Math.min(need, s.reserve);
    s.mag += take;
    if (s.reserve !== null) s.reserve -= take;
  }

  /** 全武器の予備弾を満タンにする（テスト部屋のウェーブ間など） */
  refillAll(): void {
    for (const s of this.slots) {
      s.mag = s.def.magazine;
      if (s.def.maxAmmo !== null) s.reserve = s.def.maxAmmo - s.def.magazine;
    }
  }

  /** マガジンに弾を足す（連鎖ボーナスの弾薬回復）。予備弾は消費しない */
  refill(ratio: number): void {
    const s = this.current;
    if (s.def.kind === 'beam') {
      this.heat = Math.max(0, this.heat - (s.def.heat?.max ?? 0) * ratio);
      return;
    }
    s.mag = Math.min(s.def.magazine, s.mag + Math.ceil(s.def.magazine * ratio));
    if (s.mag > 0) this.reloading = 0;
  }

  /** 弾を n 発マガジンに足す（弾倉の誓い）。照射武器には効かない */
  addRounds(n: number): void {
    const s = this.current;
    if (s.def.kind === 'beam') return;
    s.mag = Math.min(s.def.magazine, s.mag + n);
  }

  /** 毎フレーム呼ぶ */
  tick(dt: number, triggerHeld: boolean, aim: number): WeaponTick {
    this.cooldown -= dt;
    const out: WeaponTick = { shots: [], beam: false, reloaded: false, autoReload: false };
    const s = this.current;

    // 照射（レーザー）: 弾数なし。撃ち続けると過熱する
    if (s.def.kind === 'beam') {
      const h = s.def.heat!;
      if (this.overheated > 0) {
        this.overheated -= dt;
        if (this.overheated <= 0) this.heat = 0;
        return out;
      }
      if (triggerHeld) {
        this.heat += dt;
        if (this.heat >= h.max) {
          this.heat = h.max;
          this.overheated = h.cooldown;
          return out;
        }
        out.beam = true;
      } else {
        this.heat = Math.max(0, this.heat - (h.max / h.cooldown) * dt);
      }
      return out;
    }

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.finishReload();
        out.reloaded = true;
      }
      return out;
    }

    if (!triggerHeld) {
      this.holdTime = 0;
      return out;
    }
    this.holdTime += dt;
    if (this.cooldown > 0) return out;

    if (s.mag <= 0) {
      out.autoReload = this.startReload() === true;
      return out;
    }

    this.cooldown = 1 / s.def.fireRate;
    s.mag--;
    const rateMult = holdRate(s.def, this.holdTime);
    const spread = (s.def.spreadDeg * Math.PI) / 180;
    if (s.def.pellets <= 1) {
      out.shots.push({ angle: aim + (Math.random() - 0.5) * spread, def: s.def, rateMult, boosted: this.boosted });
    } else {
      for (let i = 0; i < s.def.pellets; i++) {
        const t = i / (s.def.pellets - 1) - 0.5;
        out.shots.push({ angle: aim + t * spread + (Math.random() - 0.5) * 0.05, def: s.def, rateMult, boosted: this.boosted });
      }
    }
    if (s.mag <= 0) this.boosted = false;
    return out;
  }
}
