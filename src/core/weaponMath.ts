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
