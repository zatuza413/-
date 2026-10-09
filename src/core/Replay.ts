// 死ぬ直前のスロー再生のための記録（描画から独立）。
// 状態のスナップショットを一定間隔で取り、最後の数秒分だけ残す。

export interface ReplayFrame {
  /** 記録した時刻（秒） */
  t: number;
  player: { x: number; y: number; aim: number; hp: number; maxHp: number };
  /** 敵: 位置・半径・色・ボスか */
  enemies: Array<{ x: number; y: number; r: number; color: number; boss?: boolean }>;
  /** 敵弾: [x, y, 大きい弾なら1] */
  enemyBullets: Array<[number, number, number]>;
  /** 自機弾: [x, y] */
  playerBullets: Array<[number, number]>;
  /** 予告: 残り時間と長さ */
  pending: Array<{ remaining: number; duration: number }>;
  /** このフレームで起きたこと（'hit' 被弾 / 'cancel' 相殺 / 'confirm:<理由>' 確定） */
  events: string[];
}

export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private acc = 0;
  private pendingEvents: string[] = [];

  constructor(
    private readonly seconds: number,
    private readonly fps: number,
  ) {}

  /** 起きたことを次のフレームに付ける */
  event(e: string): void {
    this.pendingEvents.push(e);
  }

  /** 毎フレーム呼ぶ。記録する時だけ snapshot を呼ぶ */
  tick(dt: number, snapshot: () => Omit<ReplayFrame, 'events'>): void {
    this.acc += dt;
    if (this.acc < 1 / this.fps) return;
    this.acc %= 1 / this.fps;
    this.push({ ...snapshot(), events: this.pendingEvents });
    this.pendingEvents = [];
  }

  /** 最後のフレームを必ず記録する（死んだ瞬間など。間隔を待たない） */
  flush(snapshot: () => Omit<ReplayFrame, 'events'>): void {
    this.push({ ...snapshot(), events: this.pendingEvents });
    this.pendingEvents = [];
    this.acc = 0;
  }

  push(f: ReplayFrame): void {
    this.frames.push(f);
    const max = Math.ceil(this.seconds * this.fps);
    if (this.frames.length > max) this.frames.splice(0, this.frames.length - max);
  }

  /** 記録したフレーム（古い順） */
  get all(): readonly ReplayFrame[] {
    return this.frames;
  }

  clear(): void {
    this.frames = [];
    this.pendingEvents = [];
    this.acc = 0;
  }
}
