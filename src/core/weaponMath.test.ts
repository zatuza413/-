import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../config/balance';
import { beamRate, bounceRate, closeKillBonusAt, erasePoints, holdRate, pointRateAt } from './weaponMath';

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

describe('武器ごとの倍率', () => {
  it('マシンガン: 押しっぱなしで ×0.5 から2秒で ×1.5', () => {
    expect(holdRate(WEAPONS.machinegun, 0)).toBeCloseTo(0.5);
    expect(holdRate(WEAPONS.machinegun, 1)).toBeCloseTo(1.0);
    expect(holdRate(WEAPONS.machinegun, 5)).toBeCloseTo(1.5);
    expect(holdRate(WEAPONS.handgun, 5)).toBe(1);
  });

  it('レーザー: ×(0.6 + 0.4×(同時に当たる数−1))、上限 ×2.2', () => {
    expect(beamRate(WEAPONS.laser, 1)).toBeCloseTo(0.6);
    expect(beamRate(WEAPONS.laser, 3)).toBeCloseTo(1.4);
    expect(beamRate(WEAPONS.laser, 10)).toBeCloseTo(2.2);
  });

  it('跳弾銃: 直撃 ×0.4、1回 ×1.4、2回 ×2.0', () => {
    expect(bounceRate(WEAPONS.ricochet, 0)).toBeCloseTo(0.4);
    expect(bounceRate(WEAPONS.ricochet, 1)).toBeCloseTo(1.4);
    expect(bounceRate(WEAPONS.ricochet, 2)).toBeCloseTo(2.0);
  });

  it('ロケット: 消した敵弾1発 +0.15、1発あたり上限 1.0', () => {
    expect(erasePoints(WEAPONS.rocket, 4)).toBeCloseTo(0.6);
    expect(erasePoints(WEAPONS.rocket, 20)).toBeCloseTo(1.0);
  });
});
