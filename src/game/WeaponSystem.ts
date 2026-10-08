import { WEAPONS } from '../config/balance';
import type { WeaponDef, WeaponId } from '../core/types';

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
}

/** 所持武器・弾薬・リロード・連射間隔を管理する（描画なし） */
export class WeaponSystem {
  slots: WeaponSlot[] = [];
  index = 0;
  private cooldown = 0;
  /** リロード残り時間（0 ならリロードしていない） */
  reloading = 0;

  constructor(ids: WeaponId[]) {
    for (const id of ids) this.add(id);
  }

  add(id: WeaponId): void {
    const def = WEAPONS[id];
    this.slots.push({ def, mag: def.magazine, reserve: def.maxAmmo === null ? null : def.maxAmmo - def.magazine });
  }

  get current(): WeaponSlot {
    return this.slots[this.index];
  }

  switch(delta: number): void {
    if (this.slots.length <= 1) return;
    this.index = (this.index + delta + this.slots.length) % this.slots.length;
    this.reloading = 0;
    this.cooldown = Math.max(this.cooldown, 0.1);
  }

  startReload(): boolean {
    const s = this.current;
    if (this.reloading > 0 || s.mag >= s.def.magazine) return false;
    if (s.reserve !== null && s.reserve <= 0) return false;
    this.reloading = s.def.reloadTime;
    return true;
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
    s.mag = Math.min(s.def.magazine, s.mag + Math.ceil(s.def.magazine * ratio));
    if (s.mag > 0) this.reloading = 0;
  }

  /** 毎フレーム呼ぶ。発射したらショットの配列、しなければ空配列 */
  tick(dt: number, triggerHeld: boolean, aim: number): { shots: Shot[]; reloaded: boolean; autoReload: boolean } {
    this.cooldown -= dt;
    let reloaded = false;
    let autoReload = false;
    const s = this.current;

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        const need = s.def.magazine - s.mag;
        const take = s.reserve === null ? need : Math.min(need, s.reserve);
        s.mag += take;
        if (s.reserve !== null) s.reserve -= take;
        reloaded = true;
      }
      return { shots: [], reloaded, autoReload };
    }

    if (!triggerHeld || this.cooldown > 0) return { shots: [], reloaded, autoReload };

    if (s.mag <= 0) {
      autoReload = this.startReload();
      return { shots: [], reloaded, autoReload };
    }

    this.cooldown = 1 / s.def.fireRate;
    s.mag--;
    const shots: Shot[] = [];
    const spread = (s.def.spreadDeg * Math.PI) / 180;
    if (s.def.pellets <= 1) {
      shots.push({ angle: aim + (Math.random() - 0.5) * spread, def: s.def });
    } else {
      for (let i = 0; i < s.def.pellets; i++) {
        const t = i / (s.def.pellets - 1) - 0.5;
        shots.push({ angle: aim + t * spread + (Math.random() - 0.5) * 0.05, def: s.def });
      }
    }
    return { shots, reloaded, autoReload };
  }
}
