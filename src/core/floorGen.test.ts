import { describe, expect, it } from 'vitest';
import { FLOOR } from '../config/balance';
import { bfs, generateFloor, TILE_FLOOR, type FloorLayout } from './floorGen';
import { createRng } from './rng';

const gen = (seed: number) => generateFloor(createRng(seed), FLOOR.gen);
const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

function center(f: FloorLayout, id: number) {
  const r = f.rooms[id].rect;
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

/** タイル上で start の中心から歩いて届くタイル */
function reachable(f: FloorLayout): Uint8Array {
  const seen = new Uint8Array(f.width * f.height);
  const s = center(f, f.startId);
  const q = [s.y * f.width + s.x];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % f.width;
    const y = (i - x) / f.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= f.width || ny >= f.height) continue;
      const j = ny * f.width + nx;
      if (!seen[j] && f.tiles[j] === TILE_FLOOR) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  return seen;
}

describe('フロア生成', () => {
  it('部屋数は10〜15', () => {
    for (const seed of SEEDS) {
      const n = gen(seed).rooms.length;
      expect(n).toBeGreaterThanOrEqual(FLOOR.gen.roomsMin);
      expect(n).toBeLessThanOrEqual(FLOOR.gen.roomsMax);
    }
  });

  it('同じシードなら同じフロア', () => {
    expect(gen(42)).toEqual(gen(42));
  });

  it('スタート・ボス・ショップは1つずつ、宝箱は1〜2', () => {
    for (const seed of SEEDS) {
      const types = gen(seed).rooms.map((r) => r.type);
      const n = (t: string) => types.filter((x) => x === t).length;
      expect(n('start')).toBe(1);
      expect(n('boss')).toBe(1);
      expect(n('shop')).toBe(1);
      expect(n('treasure')).toBeGreaterThanOrEqual(1);
      expect(n('treasure')).toBeLessThanOrEqual(2);
    }
  });

  it('ボス部屋は行き止まりで、スタートから最も遠い', () => {
    for (const seed of SEEDS) {
      const f = gen(seed);
      const boss = f.rooms[f.bossId];
      expect(boss.neighbors).toHaveLength(1);
      const d = bfs(f.rooms.map((r) => r.neighbors), f.startId);
      const leafMax = Math.max(...f.rooms.filter((r) => r.neighbors.length === 1 && r.id !== f.startId).map((r) => d[r.id]));
      expect(d[f.bossId]).toBe(leafMax);
    }
  });

  it('すべての部屋に歩いて行ける（部屋グラフでもタイルでも）', () => {
    for (const seed of SEEDS) {
      const f = gen(seed);
      const d = bfs(f.rooms.map((r) => r.neighbors), f.startId);
      expect(d.every((x) => x < Infinity)).toBe(true);
      const seen = reachable(f);
      for (const r of f.rooms) {
        const c = center(f, r.id);
        expect(seen[c.y * f.width + c.x]).toBe(1);
      }
    }
  });

  it('つながりは双方向で、部屋同士は重ならない', () => {
    for (const seed of SEEDS) {
      const f = gen(seed);
      for (const r of f.rooms) {
        for (const n of r.neighbors) expect(f.rooms[n].neighbors).toContain(r.id);
        for (const o of f.rooms) {
          if (o.id === r.id) continue;
          const sep = r.rect.x + r.rect.w + 1 < o.rect.x || o.rect.x + o.rect.w + 1 < r.rect.x || r.rect.y + r.rect.h + 1 < o.rect.y || o.rect.y + o.rect.h + 1 < r.rect.y;
          expect(sep).toBe(true);
        }
      }
    }
  });

  it('扉は通路の数 × 通路幅だけあり、どれも床タイル', () => {
    for (const seed of SEEDS) {
      const f = gen(seed);
      for (const r of f.rooms) {
        expect(r.doors).toHaveLength(r.neighbors.length * FLOOR.gen.corridorWidth);
        for (const d of r.doors) expect(f.tiles[d.y * f.width + d.x]).toBe(TILE_FLOOR);
      }
    }
  });

  it('床ギミックは戦闘部屋の床の中に収まり、部屋の中心（通路の延長線）にかからない', () => {
    let count = 0;
    for (const seed of SEEDS) {
      const f = gen(seed);
      for (const r of f.rooms) {
        for (const h of r.hazards) {
          count++;
          expect(r.type).toBe('combat');
          expect(h.rect.x).toBeGreaterThanOrEqual(r.rect.x);
          expect(h.rect.y).toBeGreaterThanOrEqual(r.rect.y);
          expect(h.rect.x + h.rect.w).toBeLessThanOrEqual(r.rect.x + r.rect.w);
          expect(h.rect.y + h.rect.h).toBeLessThanOrEqual(r.rect.y + r.rect.h);
          const c = center(f, r.id);
          const crossesV = h.rect.x <= c.x + 1 && c.x - 1 < h.rect.x + h.rect.w;
          const crossesH = h.rect.y <= c.y + 1 && c.y - 1 < h.rect.y + h.rect.h;
          expect(crossesV || crossesH).toBe(false);
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('柱は戦闘部屋に0〜3本、部屋の中・中央の十字と床ギミックを避け、タイルは壁', () => {
    let total = 0;
    for (const seed of SEEDS) {
      const f = gen(seed);
      for (const r of f.rooms) {
        if (r.type !== 'combat') {
          expect(r.pillars).toHaveLength(0);
          continue;
        }
        expect(r.pillars.length).toBeLessThanOrEqual(3);
        const c = center(f, r.id);
        for (const p of r.pillars) {
          total++;
          expect(p.x).toBeGreaterThanOrEqual(r.rect.x + 2);
          expect(p.y).toBeGreaterThanOrEqual(r.rect.y + 2);
          expect(p.x + p.w).toBeLessThanOrEqual(r.rect.x + r.rect.w - 2);
          expect(p.y + p.h).toBeLessThanOrEqual(r.rect.y + r.rect.h - 2);
          const crossesV = p.x <= c.x + 2 && c.x - 2 < p.x + p.w;
          const crossesH = p.y <= c.y + 2 && c.y - 2 < p.y + p.h;
          expect(crossesV || crossesH).toBe(false);
          for (const h of r.hazards) {
            const hit = p.x < h.rect.x + h.rect.w && h.rect.x < p.x + p.w && p.y < h.rect.y + h.rect.h && h.rect.y < p.y + p.h;
            expect(hit).toBe(false);
          }
          expect(f.tiles[p.y * f.width + p.x]).toBe(0);
        }
      }
    }
    expect(total).toBeGreaterThan(0);
  });
});
