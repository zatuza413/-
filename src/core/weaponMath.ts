import type { WeaponDef } from './types';

/** 敵との距離 dist で当てたときの、与ダメージ由来ポイントの倍率（pointRate × 距離倍率） */
export function pointRateAt(def: Pick<WeaponDef, 'pointRate' | 'pointFalloff'>, dist: number): number {
  const table = def.pointFalloff;
  if (!table || table.length === 0) return def.pointRate;
  if (dist <= table[0][0]) return def.pointRate * table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [d1, m1] = table[i];
    if (dist <= d1) {
      const [d0, m0] = table[i - 1];
      const t = (dist - d0) / (d1 - d0);
      return def.pointRate * (m0 + (m1 - m0) * t);
    }
  }
  return def.pointRate * table[table.length - 1][1];
}

/** 距離 dist で倒したときの撃破ボーナス */
export function closeKillBonusAt(def: Pick<WeaponDef, 'closeKillBonus'> | null, dist: number): number {
  const b = def?.closeKillBonus;
  return b && dist <= b.range ? b.points : 0;
}

/** マシンガン: 押しっぱなしの時間による倍率。holdRamp が無ければ 1 */
export function holdRate(def: Pick<WeaponDef, 'holdRamp'>, holdTime: number): number {
  const r = def.holdRamp;
  if (!r) return 1;
  const t = Math.min(1, Math.max(0, holdTime / r.time));
  return r.from + (r.to - r.from) * t;
}

/** レーザー: 同時に当たっている敵の数による倍率 */
export function beamRate(def: Pick<WeaponDef, 'beamRate'>, hitCount: number): number {
  const b = def.beamRate;
  if (!b || hitCount <= 0) return 1;
  return Math.min(b.base + b.perExtra * (hitCount - 1), b.max);
}

/** 跳弾銃: 跳ねた回数による倍率 */
export function bounceRate(def: Pick<WeaponDef, 'ricochet'>, bounces: number): number {
  const r = def.ricochet;
  if (!r) return 1;
  return r.rates[Math.min(bounces, r.rates.length - 1)];
}

/** ロケット: 爆風で消した敵弾のポイント（1発あたり上限あり） */
export function erasePoints(def: Pick<WeaponDef, 'explosion'>, erased: number): number {
  const x = def.explosion;
  if (!x) return 0;
  return Math.min(erased * x.erasePoints, x.eraseMax);
}
