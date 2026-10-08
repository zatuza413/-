import { describe, expect, it } from 'vitest';
import { closeKillBonusAt, pointRateAt } from './weaponMath';

describe('距離によるポイント倍率', () => {
  const def = { pointRate: 1, pointFalloff: [[80, 2], [160, 1], [240, 0.3]] as Array<[number, number]> };

  it('近いほど高く、遠いほど低い（間は直線補間）', () => {
    expect(pointRateAt(def, 0)).toBe(2);
    expect(pointRateAt(def, 80)).toBe(2);
    expect(pointRateAt(def, 120)).toBeCloseTo(1.5);
    expect(pointRateAt(def, 160)).toBe(1);
    expect(pointRateAt(def, 240)).toBeCloseTo(0.3);
    expect(pointRateAt(def, 999)).toBeCloseTo(0.3);
  });

  it('距離倍率が無い武器は pointRate のまま', () => {
    expect(pointRateAt({ pointRate: 1.5 }, 500)).toBe(1.5);
  });

  it('至近距離の撃破ボーナス', () => {
    const w = { closeKillBonus: { range: 100, points: 0.5 } };
    expect(closeKillBonusAt(w, 90)).toBe(0.5);
    expect(closeKillBonusAt(w, 101)).toBe(0);
    expect(closeKillBonusAt(null, 0)).toBe(0);
  });
});
