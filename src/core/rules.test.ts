import { describe, expect, it } from 'vitest';
import { BOSS, POINTS } from '../config/balance';
import { aimAssist, capWeaponRate, effectiveRate, stepRepel, killBonus, PerKeyCooldown, pushAway, rawRate } from './rules';

const C = POINTS.softcap;

describe('ポイント倍率の計算と上限', () => {
  it('レリックは足し合わせる（×1.5 と ×1.3 → 1 + 0.5 + 0.3）', () => {
    expect(rawRate(2, [0.5, 0.3])).toBeCloseTo(3.6);
    expect(rawRate(1, [])).toBe(1);
  });

  it('2.0 までは素通し', () => {
    expect(effectiveRate(0.3, C)).toBeCloseTo(0.3);
    expect(effectiveRate(2.0, C)).toBeCloseTo(2.0);
  });

  it('2.0〜3.0 は半分の伸び', () => {
    expect(effectiveRate(2.5, C)).toBeCloseTo(2.25);
    expect(effectiveRate(3.0, C)).toBeCloseTo(2.5);
  });

  it('3.0 を超えると 1/4 の伸び（例: 4.0 → 2.75、6.0 → 3.25）', () => {
    expect(effectiveRate(4.0, C)).toBeCloseTo(2.75);
    expect(effectiveRate(6.0, C)).toBeCloseTo(3.25);
  });

  it('上限は 4.0', () => {
    expect(effectiveRate(9.0, C)).toBeCloseTo(4.0);
    expect(effectiveRate(100, C)).toBe(4.0);
  });
});

describe('狙撃撃破と仇', () => {
  const S = POINTS.snipe;
  const handgun = { closeKillBonus: undefined };
  const shotgun = { closeKillBonus: { range: 100, points: 0.5 } };

  it('300px 以上で倒すと +0.5', () => {
    expect(killBonus({ dist: 300, weapon: handgun, isNemesis: false }, S)).toEqual({ bonus: 0.5, kind: 'snipe' });
    expect(killBonus({ dist: 299, weapon: handgun, isNemesis: false }, S)).toEqual({ bonus: 0, kind: null });
  });

  it('仇なら +0.75（+0.5 と足し合わない）', () => {
    expect(killBonus({ dist: 400, weapon: handgun, isNemesis: true }, S)).toEqual({ bonus: 0.75, kind: 'nemesis' });
  });

  it('仇の印のボーナスは狙撃撃破の時だけ', () => {
    expect(killBonus({ dist: 200, weapon: handgun, isNemesis: true }, S).bonus).toBe(0);
  });

  it('至近ボーナスは至近距離だけ', () => {
    expect(killBonus({ dist: 50, weapon: shotgun, isNemesis: true }, S)).toEqual({ bonus: 0.5, kind: 'close' });
  });
});

describe('接触の1秒制限と押し返し', () => {
  it('同じ敵からは1秒に1回まで、別の敵は別に数える', () => {
    const cd = new PerKeyCooldown(1.0);
    expect(cd.tryUse(1, 0)).toBe(true);
    expect(cd.tryUse(1, 0.5)).toBe(false);
    expect(cd.tryUse(2, 0.5)).toBe(true);
    expect(cd.tryUse(1, 0.99)).toBe(false);
    expect(cd.tryUse(1, 1.0)).toBe(true);
  });

  it('敵から離れる向きに 40px 押し返す', () => {
    const v = pushAway(100, 100, 70, 60, 40);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(40);
    expect(v.x).toBeCloseTo(24);
    expect(v.y).toBeCloseTo(32);
    expect(pushAway(5, 5, 5, 5, 40)).toEqual({ x: 40, y: 0 });
  });
});

describe('照準補正', () => {
  const deg = (d: number) => (d * Math.PI) / 180;
  it('200px 以上離れた敵に、±3°以内なら吸い付く', () => {
    const far = { x: 300 * Math.cos(deg(2)), y: 300 * Math.sin(deg(2)) };
    expect(aimAssist(0, 0, 0, [far], 200, deg(3))).toBeCloseTo(deg(2));
  });
  it('近い敵やずれの大きい敵には補正しない', () => {
    expect(aimAssist(0, 0, 0, [{ x: 150, y: 3 }], 200, deg(3))).toBe(0);
    expect(aimAssist(0, 0, 0, [{ x: 300 * Math.cos(deg(5)), y: 300 * Math.sin(deg(5)) }], 200, deg(3))).toBe(0);
  });
});

describe('呪詛返し', () => {
  it('同じ敵には1秒に1回まで、ポイントは入らない', async () => {
    const { CurseReturn } = await import('./rules');
    const c = new CurseReturn(20, 1.0);
    expect(c.trigger(7, 0)).toEqual({ damage: 20, givesPoints: false });
    expect(c.trigger(7, 0.5).damage).toBe(0);
    expect(c.trigger(8, 0.5).damage).toBe(20);
    expect(c.trigger(7, 1.0).damage).toBe(20);
    expect(c.trigger(null, 2).damage).toBe(0);
  });
});

describe('ボスへの倍率の上限', () => {
  it('上限を超えた分だけ削る', () => {
    expect(capWeaponRate(2, 1.2)).toBe(1.2);
    expect(capWeaponRate(0.3, 1.2)).toBe(0.3);
    expect(capWeaponRate(2, undefined)).toBe(2);
  });
});

describe('張り付きへの返し', () => {
  const R = BOSS.repel;
  const run = (s: { close: number; warn: number; cool: number }, dist: number, secs: number) => {
    let fired = 0;
    for (let t = 0; t < secs; t += 0.05) if (stepRepel(s, dist, 0.05, R).fire) fired++;
    return fired;
  };

  it('離れていれば出ない', () => {
    expect(run({ close: 0, warn: -1, cool: 0 }, R.range + 1, 10)).toBe(0);
  });

  it('近くに after 秒いると予告、warn 秒後に撃つ', () => {
    const s = { close: 0, warn: -1, cool: 0 };
    expect(run(s, 50, R.after - 0.1)).toBe(0);
    expect(run(s, 50, 0.15)).toBe(0);
    expect(s.warn).toBeGreaterThanOrEqual(0);
    expect(run(s, 50, R.warn + 0.05)).toBe(1);
  });

  it('予告が始まったら離れても撃つ', () => {
    const s = { close: 0, warn: 0, cool: 0 };
    expect(run(s, 999, R.warn + 0.05)).toBe(1);
  });

  it('張り付き続けると max(after, cooldown) + warn 秒ごとに撃つ', () => {
    const s = { close: 0, warn: -1, cool: 0 };
    const per = Math.max(R.after, R.cooldown) + R.warn;
    expect(run(s, 50, per * 3 + 0.2)).toBe(3);
  });

  it('出入りを繰り返しても溜まりにくい（離れると2倍で冷める）', () => {
    const s = { close: 0, warn: -1, cool: 0 };
    let fired = 0;
    for (let i = 0; i < 40; i++) {
      fired += run(s, 50, 0.5);
      fired += run(s, 999, 0.3);
    }
    expect(fired).toBe(0);
  });
});
