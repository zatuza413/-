// 基本ルールの計算（描画から独立）。数値は balance.ts から渡す。

import type { WeaponDef } from './types';
import { closeKillBonusAt } from './weaponMath';

export interface SoftcapConfig {
  knee1: number;
  knee2: number;
  slope2: number;
  slope3: number;
  max: number;
}

/** 生の倍率 = 武器の倍率 × (1 + レリック加算の合計)。レリック同士は掛け算にしない */
export function rawRate(weaponRate: number, relicAdds: readonly number[]): number {
  return weaponRate * (1 + relicAdds.reduce((a, b) => a + b, 0));
}

/** 実効倍率（二段階で伸びを抑え、上限で止める） */
export function effectiveRate(r: number, c: SoftcapConfig): number {
  let v: number;
  if (r <= c.knee1) v = r;
  else if (r <= c.knee2) v = c.knee1 + (r - c.knee1) * c.slope2;
  else v = c.knee1 + (c.knee2 - c.knee1) * c.slope2 + (r - c.knee2) * c.slope3;
  return Math.min(Math.max(0, v), c.max);
}

export type KillBonusKind = 'close' | 'snipe' | 'nemesis' | null;

/**
 * 撃破ボーナス（撃破ポイントに足す。倍率はかけない）。
 * - 武器の至近ボーナス（ショットガン）
 * - 狙撃撃破: range 以上離れて倒すと bonus。仇なら代わりに nemesisBonus（足し合わせない）
 * 至近と狙撃は距離が違うので重ならない。
 */
export function killBonus(
  args: { dist: number; weapon: Pick<WeaponDef, 'closeKillBonus'> | null; isNemesis: boolean },
  snipe: { range: number; bonus: number; nemesisBonus: number },
): { bonus: number; kind: KillBonusKind } {
  const close = closeKillBonusAt(args.weapon, args.dist);
  if (close > 0) return { bonus: close, kind: 'close' };
  if (args.dist >= snipe.range) {
    return args.isNemesis ? { bonus: snipe.nemesisBonus, kind: 'nemesis' } : { bonus: snipe.bonus, kind: 'snipe' };
  }
  return { bonus: 0, kind: null };
}

/** キーごとのクールダウン（接触の1秒制限、呪詛返しなど） */
export class PerKeyCooldown {
  private readonly last = new Map<number, number>();
  constructor(private readonly interval: number) {}

  /** now に発動できるなら記録して true */
  tryUse(key: number, now: number): boolean {
    const t = this.last.get(key);
    if (t !== undefined && now - t < this.interval) return false;
    this.last.set(key, now);
    return true;
  }

  clear(): void {
    this.last.clear();
  }
}

/** 敵 (ex, ey) から自機 (px, py) を dist だけ押し離す移動量。重なっているときは右へ */
export function pushAway(px: number, py: number, ex: number, ey: number, dist: number): { x: number; y: number } {
  const dx = px - ex;
  const dy = py - ey;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: dist, y: 0 };
  return { x: (dx / d) * dist, y: (dy / d) * dist };
}

/** 角度の差（-π〜π） */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * 照準補正: minDist 以上離れた敵のうち、照準とのずれが maxAngle 以内で最も近い角度の敵へ合わせる。
 * 該当が無ければ元の照準のまま。
 */
export function aimAssist(
  aim: number,
  px: number,
  py: number,
  targets: ReadonlyArray<{ x: number; y: number }>,
  minDist: number,
  maxAngle: number,
): number {
  let best = aim;
  let bestDiff = maxAngle;
  for (const t of targets) {
    if (Math.hypot(t.x - px, t.y - py) < minDist) continue;
    const a = Math.atan2(t.y - py, t.x - px);
    const d = Math.abs(angleDiff(a, aim));
    if (d <= bestDiff) {
      bestDiff = d;
      best = a;
    }
  }
  return best;
}

/**
 * 呪詛返し: 相殺した予告を作った敵にダメージ。同じ敵には interval 秒に1回まで。
 * このダメージ（と、それで倒したこと）からは相殺ポイントが入らない。
 */
export class CurseReturn {
  private readonly cd: PerKeyCooldown;
  constructor(
    private readonly damage: number,
    interval: number,
  ) {
    this.cd = new PerKeyCooldown(interval);
  }

  /** 相殺したときに呼ぶ。与えるダメージ（0 なら何もしない）と、ポイントを与えるか（常に false） */
  trigger(sourceId: number | null, now: number): { damage: number; givesPoints: false } {
    if (sourceId === null || sourceId < 0 || !this.cd.tryUse(sourceId, now)) return { damage: 0, givesPoints: false };
    return { damage: this.damage, givesPoints: false };
  }

  clear(): void {
    this.cd.clear();
  }
}

/** 敵ごとの武器倍率の上限（ボスなど）。cap が無ければそのまま */
export function capWeaponRate(rate: number, cap: number | undefined): number {
  return cap === undefined ? rate : Math.min(rate, cap);
}

export interface RepelConfig {
  range: number;
  after: number;
  warn: number;
  cooldown: number;
}

/**
 * 張り付きへの返し（ボス）の進み方。
 * close: 近くにいた時間、warn: 予告の経過（-1 で予告なし）、cool: 次に出せるまでの残り。
 * 予告が始まったら、自機が離れても最後まで撃つ（光ったら引く、を覚えさせるため）
 */
export interface RepelState {
  close: number;
  warn: number;
  cool: number;
}

export function stepRepel(s: RepelState, dist: number, dt: number, c: RepelConfig): { fire: boolean; warnProgress: number | null } {
  s.cool = Math.max(0, s.cool - dt);
  if (s.warn >= 0) {
    s.warn += dt;
    if (s.warn >= c.warn) {
      s.warn = -1;
      s.close = 0;
      s.cool = c.cooldown;
      return { fire: true, warnProgress: null };
    }
    return { fire: false, warnProgress: s.warn / c.warn };
  }
  // 離れると少しずつ冷める（出入りを繰り返しても溜まりきらないように、2倍の速さで減る）
  s.close = dist <= c.range ? s.close + dt : Math.max(0, s.close - dt * 2);
  if (s.close >= c.after && s.cool <= 0) {
    s.warn = 0;
    return { fire: false, warnProgress: 0 };
  }
  return { fire: false, warnProgress: null };
}
