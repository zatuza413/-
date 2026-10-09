import { describe, expect, it } from 'vitest';
import { bandOf, cancelRate, latencyBin, latencyMedian, Telemetry, TELEMETRY_KEY, type StorageLike } from './Telemetry';

function memStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('相殺成功率', () => {
  it('相殺 ÷ (相殺 + 時間切れ + 上限超過)。全滅で消えた数と即時確定は分母に入れない', () => {
    expect(cancelRate(8, { timeout: 1, overflow: 1 })).toBeCloseTo(0.8);
    const t = new Telemetry();
    t.startRun();
    t.startRoom(1, 'combat', 'pc');
    for (let i = 0; i < 3; i++) t.cancel();
    t.confirm('timeout');
    t.confirm('instant');
    t.wipe(5);
    t.endRun({ cleared: false, died: true });
    const s = t.summary().pc;
    expect(s.total.wipes).toBe(5);
    expect(s.cancelRate).toBeCloseTo(0.75);
  });

  it('分母が0なら null', () => {
    expect(cancelRate(0, { timeout: 0, overflow: 0 })).toBeNull();
  });
});

describe('計測', () => {
  it('距離帯は 150以下 / 150〜300 / 300以上', () => {
    expect(bandOf(150)).toBe('near');
    expect(bandOf(151)).toBe('mid');
    expect(bandOf(300)).toBe('far');
  });

  it('全滅で消えた数を部屋ごとに集計する', () => {
    const t = new Telemetry();
    t.startRun();
    t.startRoom(1, 'combat', 'pc');
    t.wipe(2);
    t.startRoom(1, 'combat', 'pc');
    t.wipe(3);
    const run = t.endRun({ cleared: false, died: false })!;
    expect(run.rooms.map((r) => r.wipes)).toEqual([2, 3]);
  });

  it('PC とスマホを分けて集計する', () => {
    const t = new Telemetry();
    t.startRun();
    t.startRoom(1, 'combat', 'pc');
    t.hit('near');
    t.startRoom(1, 'combat', 'touch');
    t.hit('far');
    t.hit('far');
    t.endRun({ cleared: false, died: true });
    const s = t.summary();
    expect(s.pc.total.hits).toBe(1);
    expect(s.touch.total.hits).toBe(2);
    expect(s.touch.total.bands.far.hits).toBe(2);
  });

  it('3フロア目で成功率95%以上かつ確定2回以下なら壊れビルド', () => {
    const t = new Telemetry();
    t.startRun();
    t.startRoom(3, 'combat', 'pc');
    for (let i = 0; i < 38; i++) t.cancel();
    t.confirm('timeout');
    t.confirm('instant');
    const run = t.endRun({ cleared: true, died: false })!;
    expect(run.floor3CancelRate).toBeCloseTo(38 / 39);
    expect(run.floor3Confirms).toBe(2);
    expect(run.brokenBuild).toBe(true);
  });

  it('3フロア目の確定が3回なら壊れビルドではない', () => {
    const t = new Telemetry();
    t.startRun();
    t.startRoom(3, 'combat', 'pc');
    for (let i = 0; i < 100; i++) t.cancel();
    t.confirm('instant');
    t.confirm('instant');
    t.confirm('instant');
    expect(t.endRun({ cleared: true, died: false })!.brokenBuild).toBe(false);
  });

  it('localStorage に保存し、次回読み込む', () => {
    const st = memStorage();
    const t = new Telemetry({ storage: st });
    t.startRun();
    t.item('hourglass');
    t.endRun({ cleared: false, died: true });
    expect(st.data.has(TELEMETRY_KEY)).toBe(true);
    const t2 = new Telemetry({ storage: st });
    expect(t2.runs[0].items).toEqual(['hourglass']);
    expect(JSON.parse(t2.exportJson()).runs).toHaveLength(1);
  });
});

describe('被弾から相殺までの時間', () => {
  it('0.5秒刻みに数え、3.5秒以上はまとめる。ストックの即相殺は数えない', () => {
    expect(latencyBin(0.2)).toBe(0);
    expect(latencyBin(2.9)).toBe(5);
    expect(latencyBin(9)).toBe(7);
    const t = new Telemetry();
    t.startRun();
    t.startRoom(1, 'combat', 'pc');
    t.cancel(1.2);
    t.cancel(1.4);
    t.cancel(2.6);
    t.cancel(null);
    const run = t.endRun({ cleared: false, died: true })!;
    expect(run.rooms[0].cancels).toBe(4);
    expect(run.rooms[0].cancelLatency).toEqual([0, 0, 2, 0, 0, 1, 0, 0]);
    expect(latencyMedian(run.rooms[0].cancelLatency)).toBeCloseTo(1.25);
  });
});
