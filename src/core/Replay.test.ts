import { describe, expect, it } from 'vitest';
import { ReplayRecorder, type ReplayFrame } from './Replay';

const snap = (t: number): Omit<ReplayFrame, 'events'> => ({
  t,
  player: { x: t, y: 0, aim: 0, hp: 6, maxHp: 6 },
  enemies: [],
  enemyBullets: [],
  playerBullets: [],
  pending: [],
});

describe('スロー再生の記録', () => {
  it('毎秒 fps 回だけ記録し、最後の seconds 秒分だけ残す', () => {
    const r = new ReplayRecorder(5, 30);
    let t = 0;
    for (let i = 0; i < 60 * 10; i++) {
      t += 1 / 60;
      r.tick(1 / 60, () => snap(t));
    }
    expect(r.all.length).toBe(150);
    expect(r.all[r.all.length - 1].t).toBeCloseTo(10, 1);
    expect(r.all[0].t).toBeGreaterThan(4.9);
  });

  it('起きたことは次に記録するフレームに付く', () => {
    const r = new ReplayRecorder(5, 30);
    r.event('hit');
    r.tick(1 / 30, () => snap(0));
    r.tick(1 / 30, () => snap(1));
    expect(r.all[0].events).toEqual(['hit']);
    expect(r.all[1].events).toEqual([]);
  });

  it('flush は間隔を待たずに最後のフレームを記録する', () => {
    const r = new ReplayRecorder(5, 30);
    r.event('confirm:timeout');
    r.flush(() => snap(2));
    expect(r.all).toHaveLength(1);
    expect(r.all[0].events).toEqual(['confirm:timeout']);
  });
});
