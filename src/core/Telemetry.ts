// 計測（描画から独立）。部屋ごと・周回ごとに相殺の成績を記録し、調整の材料にする。
// 保存先は localStorage（StorageLike を差し替えられる）。JSON で書き出せる。

import type { ConfirmReason } from './DamageQueue';

export type Platform = 'pc' | 'touch';
/** 距離帯: 150px以下 / 150〜300px / 300px以上 */
export type DistanceBand = 'near' | 'mid' | 'far';

export interface BandStat {
  /** 獲得ポイント（撃破・与ダメージ・ボーナスすべて） */
  points: number;
  /** 被弾数（予告が積まれた、または上限超過した被弾） */
  hits: number;
}

export interface RoomRecord {
  floor: number;
  roomType: string;
  platform: Platform;
  hits: number;
  cancels: number;
  confirms: Record<ConfirmReason, number>;
  chains: number;
  /** 部屋全滅で消えた予告 */
  wipes: number;
  /** 部屋にいた時間（秒） */
  time: number;
  bands: Record<DistanceBand, BandStat>;
  snipeKills: number;
}

export interface RunRecord {
  id: string;
  startedAt: string;
  rooms: RoomRecord[];
  /** 拾ったアイテム（拾った順） */
  items: string[];
  /** 到達フロア */
  floorReached: number;
  cleared: boolean;
  died: boolean;
  /** 3フロア目の相殺成功率（3フロア目に戦闘が無ければ null） */
  floor3CancelRate: number | null;
  /** 3フロア目の確定数（理由を問わず） */
  floor3Confirms: number | null;
  /** 3フロア目で成功率95%以上かつ確定2回以下 */
  brokenBuild: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const TELEMETRY_KEY = 'sousai.telemetry.v1';

/** 距離から距離帯へ */
export function bandOf(dist: number, nearMax = 150, farMin = 300): DistanceBand {
  if (dist <= nearMax) return 'near';
  if (dist >= farMin) return 'far';
  return 'mid';
}

/**
 * 相殺成功率 = 相殺数 ÷ (相殺数 + 時間切れ + 上限超過)。
 * 部屋全滅で消えた予告と即時確定は分母に入れない。分母が0なら null。
 */
export function cancelRate(cancels: number, confirms: Pick<Record<ConfirmReason, number>, 'timeout' | 'overflow'>): number | null {
  const d = cancels + confirms.timeout + confirms.overflow;
  return d === 0 ? null : cancels / d;
}

export function emptyRoom(floor: number, roomType: string, platform: Platform): RoomRecord {
  const band = (): BandStat => ({ points: 0, hits: 0 });
  return {
    floor,
    roomType,
    platform,
    hits: 0,
    cancels: 0,
    confirms: { timeout: 0, overflow: 0, instant: 0 },
    chains: 0,
    wipes: 0,
    time: 0,
    bands: { near: band(), mid: band(), far: band() },
    snipeKills: 0,
  };
}

/** 複数の部屋を足し合わせる */
export function sumRooms(rooms: RoomRecord[]): RoomRecord {
  const s = emptyRoom(0, 'sum', rooms[0]?.platform ?? 'pc');
  for (const r of rooms) {
    s.hits += r.hits;
    s.cancels += r.cancels;
    s.confirms.timeout += r.confirms.timeout;
    s.confirms.overflow += r.confirms.overflow;
    s.confirms.instant += r.confirms.instant;
    s.chains += r.chains;
    s.wipes += r.wipes;
    s.time += r.time;
    s.snipeKills += r.snipeKills;
    for (const b of ['near', 'mid', 'far'] as const) {
      s.bands[b].points += r.bands[b].points;
      s.bands[b].hits += r.bands[b].hits;
    }
  }
  return s;
}

export interface TelemetryOptions {
  storage?: StorageLike | null;
  /** 保存しておく周回の数（古いものから捨てる） */
  maxRuns?: number;
  brokenRate?: number;
  brokenMaxConfirms?: number;
}

export class Telemetry {
  runs: RunRecord[] = [];
  run: RunRecord | null = null;
  room: RoomRecord | null = null;
  private readonly storage: StorageLike | null;
  private readonly maxRuns: number;
  private readonly brokenRate: number;
  private readonly brokenMaxConfirms: number;

  constructor(opts: TelemetryOptions = {}) {
    this.storage = opts.storage ?? null;
    this.maxRuns = opts.maxRuns ?? 100;
    this.brokenRate = opts.brokenRate ?? 0.95;
    this.brokenMaxConfirms = opts.brokenMaxConfirms ?? 2;
    this.load();
  }

  // ------------------------------------------------------------ 周回・部屋

  startRun(): void {
    this.run = {
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      startedAt: new Date().toISOString(),
      rooms: [],
      items: [],
      floorReached: 1,
      cleared: false,
      died: false,
      floor3CancelRate: null,
      floor3Confirms: null,
      brokenBuild: false,
    };
    this.room = null;
  }

  startRoom(floor: number, roomType: string, platform: Platform): void {
    if (!this.run) return;
    this.endRoom();
    this.room = emptyRoom(floor, roomType, platform);
    this.run.floorReached = Math.max(this.run.floorReached, floor);
  }

  /** 部屋を出た・クリアした・死んだ */
  endRoom(): void {
    if (this.run && this.room) this.run.rooms.push(this.room);
    this.room = null;
  }

  endRun(result: { cleared: boolean; died: boolean }): RunRecord | null {
    if (!this.run) return null;
    this.endRoom();
    const run = this.run;
    run.cleared = result.cleared;
    run.died = result.died;
    const f3 = run.rooms.filter((r) => r.floor === 3);
    if (f3.length > 0) {
      const s = sumRooms(f3);
      run.floor3CancelRate = cancelRate(s.cancels, s.confirms);
      run.floor3Confirms = s.confirms.timeout + s.confirms.overflow + s.confirms.instant;
      run.brokenBuild = run.floor3CancelRate !== null && run.floor3CancelRate >= this.brokenRate && run.floor3Confirms <= this.brokenMaxConfirms;
    }
    this.runs.push(run);
    if (this.runs.length > this.maxRuns) this.runs.splice(0, this.runs.length - this.maxRuns);
    this.run = null;
    this.save();
    return run;
  }

  // ------------------------------------------------------------ 記録

  tick(dt: number): void {
    if (this.room) this.room.time += dt;
  }
  hit(band: DistanceBand | null): void {
    if (!this.room) return;
    this.room.hits++;
    if (band) this.room.bands[band].hits++;
  }
  points(amount: number, band: DistanceBand | null): void {
    if (!this.room || amount <= 0) return;
    if (band) this.room.bands[band].points += amount;
  }
  cancel(): void {
    if (this.room) this.room.cancels++;
  }
  confirm(reason: ConfirmReason): void {
    if (this.room) this.room.confirms[reason]++;
  }
  chain(): void {
    if (this.room) this.room.chains++;
  }
  wipe(n: number): void {
    if (this.room) this.room.wipes += n;
  }
  snipeKill(): void {
    if (this.room) this.room.snipeKills++;
  }
  item(id: string): void {
    this.run?.items.push(id);
  }

  // ------------------------------------------------------------ 集計

  /** PC とスマホを分けた全部屋の合計 */
  summary(): Record<Platform, { rooms: number; total: RoomRecord; cancelRate: number | null }> {
    const all = this.runs.flatMap((r) => r.rooms);
    const of = (p: Platform) => {
      const rooms = all.filter((r) => r.platform === p);
      const total = sumRooms(rooms);
      return { rooms: rooms.length, total, cancelRate: cancelRate(total.cancels, total.confirms) };
    };
    return { pc: of('pc'), touch: of('touch') };
  }

  exportJson(): string {
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), summary: this.summary(), runs: this.runs }, null, 2);
  }

  clear(): void {
    this.runs = [];
    this.save();
  }

  private load(): void {
    try {
      const raw = this.storage?.getItem(TELEMETRY_KEY);
      if (raw) this.runs = JSON.parse(raw) as RunRecord[];
    } catch {
      this.runs = [];
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(TELEMETRY_KEY, JSON.stringify(this.runs));
    } catch {
      // 容量超過やプライベートモードでは保存しない
    }
  }
}
