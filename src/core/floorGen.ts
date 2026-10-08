// フロアの自動生成（描画から独立）。
// 部屋は格子状のセルに1つずつ置き、隣り合うセル同士を直線の通路でつなぐ。
// 出力はタイルの配列（0 = 壁/虚空, 1 = 床）と部屋の一覧。

import { randInt, shuffle, type Rng } from './rng';

export const TILE_VOID = 0;
export const TILE_FLOOR = 1;

export type RoomType = 'start' | 'combat' | 'treasure' | 'shop' | 'boss';

/** タイル単位の矩形 */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HazardSpec {
  kind: 'fire' | 'pit';
  rect: TileRect;
}

export interface RoomSpec {
  id: number;
  /** 格子上の位置 */
  gx: number;
  gy: number;
  type: RoomType;
  /** 床の範囲（タイル） */
  rect: TileRect;
  /** つながっている部屋の id */
  neighbors: number[];
  /** 扉のタイル（部屋の床のすぐ外側で、通路が通っている場所）。入ると閉まる */
  doors: Array<{ x: number; y: number }>;
  hazards: HazardSpec[];
  /** 柱（遮蔽物）。タイルは壁になる */
  pillars: TileRect[];
}

export interface FloorLayout {
  /** タイル数 */
  width: number;
  height: number;
  /** width × height。TILE_VOID / TILE_FLOOR */
  tiles: Uint8Array;
  rooms: RoomSpec[];
  startId: number;
  bossId: number;
}

export interface FloorGenConfig {
  roomsMin: number;
  roomsMax: number;
  /** 格子のセル数 */
  gridW: number;
  gridH: number;
  /** 1セルの大きさ（タイル） */
  cellW: number;
  cellH: number;
  /** 部屋の床の大きさの範囲（タイル） */
  roomW: [number, number];
  roomH: [number, number];
  /** 通路の幅（タイル、奇数） */
  corridorWidth: number;
  /** 木構造に加えて、隣り合う部屋をつなぐ確率（周回できるループを作る） */
  extraLoopChance: number;
  treasureRooms: [number, number];
  shopRooms: number;
  /** 戦闘部屋に床ギミック（火の床・落とし穴）を置く確率 */
  hazardChance: number;
  /** ギミックの一辺（タイル） */
  hazardSize: [number, number];
  /** 戦闘部屋に置く柱の数の範囲と一辺（タイル） */
  pillars: { min: number; max: number; size: number };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function generateFloor(rng: Rng, cfg: FloorGenConfig): FloorLayout {
  const count = randInt(rng, cfg.roomsMin, Math.min(cfg.roomsMax, cfg.gridW * cfg.gridH));

  // 1. 格子上に部屋を広げる（中央から、既存の部屋の隣へ）
  const grid = new Map<string, number>();
  const key = (x: number, y: number) => `${x},${y}`;
  const cells: Array<{ gx: number; gy: number }> = [];
  const edges: Array<[number, number]> = [];
  const sx = Math.floor(cfg.gridW / 2);
  const sy = Math.floor(cfg.gridH / 2);
  cells.push({ gx: sx, gy: sy });
  grid.set(key(sx, sy), 0);
  let guard = 0;
  while (cells.length < count && guard++ < 10000) {
    const from = Math.floor(rng() * cells.length);
    const [dx, dy] = DIRS[Math.floor(rng() * 4)];
    const nx = cells[from].gx + dx;
    const ny = cells[from].gy + dy;
    if (nx < 0 || ny < 0 || nx >= cfg.gridW || ny >= cfg.gridH || grid.has(key(nx, ny))) continue;
    // 3方向以上を塞いだ部屋が増えすぎると単調になるので、隣接が多いセルは少し避ける
    let adj = 0;
    for (const [ax, ay] of DIRS) if (grid.has(key(nx + ax, ny + ay))) adj++;
    if (adj >= 2 && rng() < 0.6) continue;
    grid.set(key(nx, ny), cells.length);
    edges.push([from, cells.length]);
    cells.push({ gx: nx, gy: ny });
  }

  const neighbors: number[][] = cells.map(() => []);
  for (const [a, b] of edges) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  // 2. ループを足す。行き止まり同士・行き止まりへは足さない（行き止まりを残してボス部屋・宝箱部屋に使う）
  const treeDegree = neighbors.map((n) => n.length);
  for (let i = 0; i < cells.length; i++) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const j = grid.get(key(cells[i].gx + dx, cells[i].gy + dy));
      if (j === undefined || treeDegree[i] < 2 || treeDegree[j] < 2 || neighbors[i].includes(j)) continue;
      if (rng() < cfg.extraLoopChance) {
        neighbors[i].push(j);
        neighbors[j].push(i);
      }
    }
  }

  // 3. ボス部屋: スタートから最も遠い行き止まり
  const dist = bfs(neighbors, 0);
  const leaves = cells.map((_, i) => i).filter((i) => i !== 0 && neighbors[i].length === 1);
  const bossId = (leaves.length > 0 ? leaves : cells.map((_, i) => i).filter((i) => i !== 0)).reduce((best, i) => (dist[i] > dist[best] ? i : best));

  // 4. 部屋の種類
  const types: RoomType[] = cells.map(() => 'combat');
  types[0] = 'start';
  types[bossId] = 'boss';
  const others = shuffle(
    rng,
    cells.map((_, i) => i).filter((i) => i !== 0 && i !== bossId),
  );
  // 宝箱は行き止まりを優先（寄り道のご褒美）
  others.sort((a, b) => neighbors[a].length - neighbors[b].length);
  const nTreasure = Math.min(randInt(rng, cfg.treasureRooms[0], cfg.treasureRooms[1]), others.length);
  for (let i = 0; i < nTreasure; i++) types[others.shift()!] = 'treasure';
  shuffle(rng, others);
  for (let i = 0; i < cfg.shopRooms && others.length > 1; i++) types[others.shift()!] = 'shop';

  // 5. タイルに描く
  const width = cfg.gridW * cfg.cellW;
  const height = cfg.gridH * cfg.cellH;
  const tiles = new Uint8Array(width * height);
  const fill = (r: TileRect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) tiles[y * width + x] = TILE_FLOOR;
  };

  const rooms: RoomSpec[] = cells.map((c, i) => {
    const big = types[i] === 'boss';
    const w = big ? cfg.roomW[1] : randInt(rng, cfg.roomW[0], cfg.roomW[1]);
    const h = big ? cfg.roomH[1] : randInt(rng, cfg.roomH[0], cfg.roomH[1]);
    const cx = c.gx * cfg.cellW + Math.floor(cfg.cellW / 2);
    const cy = c.gy * cfg.cellH + Math.floor(cfg.cellH / 2);
    const rect = { x: cx - Math.floor(w / 2), y: cy - Math.floor(h / 2), w, h };
    fill(rect);
    return { id: i, gx: c.gx, gy: c.gy, type: types[i], rect, neighbors: [...neighbors[i]].sort((a, b) => a - b), doors: [], hazards: [], pillars: [] };
  });

  // 通路（部屋の中心を通る直線）
  const half = Math.floor(cfg.corridorWidth / 2);
  for (const a of rooms) {
    for (const bi of a.neighbors) {
      if (bi < a.id) continue;
      const b = rooms[bi];
      const [l, r] = a.gx + a.gy * 1000 < b.gx + b.gy * 1000 ? [a, b] : [b, a];
      if (l.gy === r.gy) {
        // 横の通路
        const cy = l.rect.y + Math.floor(l.rect.h / 2);
        const x0 = l.rect.x + l.rect.w;
        const x1 = r.rect.x - 1;
        fill({ x: x0, y: cy - half, w: x1 - x0 + 1, h: cfg.corridorWidth });
        for (let k = -half; k <= half; k++) {
          l.doors.push({ x: x0, y: cy + k });
          r.doors.push({ x: x1, y: cy + k });
        }
      } else {
        // 縦の通路
        const cx = l.rect.x + Math.floor(l.rect.w / 2);
        const y0 = l.rect.y + l.rect.h;
        const y1 = r.rect.y - 1;
        fill({ x: cx - half, y: y0, w: cfg.corridorWidth, h: y1 - y0 + 1 });
        for (let k = -half; k <= half; k++) {
          l.doors.push({ x: cx + k, y: y0 });
          r.doors.push({ x: cx + k, y: y1 });
        }
      }
    }
  }

  // 6. 床ギミック（戦闘部屋の四隅寄りに1つ。中央の十字＝通路の延長線上は避ける）
  for (const room of rooms) {
    if (room.type !== 'combat' || rng() >= cfg.hazardChance) continue;
    const s = randInt(rng, cfg.hazardSize[0], cfg.hazardSize[1]);
    const hw = s;
    const hh = Math.max(2, s - 1);
    const r = room.rect;
    const band = half + 3;
    const cx = r.x + Math.floor(r.w / 2);
    const cy = r.y + Math.floor(r.h / 2);
    const left = rng() < 0.5;
    const top = rng() < 0.5;
    const xMin = left ? r.x + 2 : cx + band;
    const xMax = left ? cx - band - hw : r.x + r.w - 2 - hw;
    const yMin = top ? r.y + 2 : cy + band;
    const yMax = top ? cy - band - hh : r.y + r.h - 2 - hh;
    if (xMax < xMin || yMax < yMin) continue;
    room.hazards.push({
      kind: rng() < 0.5 ? 'fire' : 'pit',
      rect: { x: randInt(rng, xMin, xMax), y: randInt(rng, yMin, yMax), w: hw, h: hh },
    });
  }

  // 7. 柱（戦闘部屋に0〜3本。中央の十字＝通路の延長線と床ギミックには重ねない。柱同士も離す）
  const overlaps = (a: TileRect, b: TileRect, gap: number) =>
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  for (const room of rooms) {
    if (room.type !== 'combat') continue;
    const n = randInt(rng, cfg.pillars.min, cfg.pillars.max);
    const ps = cfg.pillars.size;
    const r = room.rect;
    const band = half + 2;
    const cx = r.x + Math.floor(r.w / 2);
    const cy = r.y + Math.floor(r.h / 2);
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 30; tries++) {
        const left = rng() < 0.5;
        const top = rng() < 0.5;
        const xMin = left ? r.x + 2 : cx + band + 1;
        const xMax = left ? cx - band - ps : r.x + r.w - 2 - ps;
        const yMin = top ? r.y + 2 : cy + band + 1;
        const yMax = top ? cy - band - ps : r.y + r.h - 2 - ps;
        if (xMax < xMin || yMax < yMin) continue;
        const p = { x: randInt(rng, xMin, xMax), y: randInt(rng, yMin, yMax), w: ps, h: ps };
        if (room.hazards.some((h) => overlaps(p, h.rect, 1)) || room.pillars.some((q) => overlaps(p, q, 2))) continue;
        room.pillars.push(p);
        for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) tiles[y * width + x] = TILE_VOID;
        break;
      }
    }
  }

  return { width, height, tiles, rooms, startId: 0, bossId };
}

/** 部屋グラフ上の距離 */
export function bfs(neighbors: number[][], from: number): number[] {
  const d = neighbors.map(() => Infinity);
  d[from] = 0;
  const q = [from];
  while (q.length > 0) {
    const i = q.shift()!;
    for (const j of neighbors[i]) {
      if (d[j] === Infinity) {
        d[j] = d[i] + 1;
        q.push(j);
      }
    }
  }
  return d;
}
