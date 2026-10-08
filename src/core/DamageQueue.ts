// 相殺システムの中核ロジック。描画・Phaser に一切依存しない。
// 時間は update(dt) でのみ進む（テストで決定的に扱えるように）。

/** 予告になる被弾の種類 */
export type HitKind = 'bullet' | 'contact' | 'explosion' | 'boss' | 'hazard';
/** 即座に確定するダメージの種類 */
export type InstantKind = 'pit' | 'selfExplosion' | 'sacrifice';
/** 確定の理由 */
export type ConfirmReason = 'timeout' | 'overflow' | 'instant';

export interface PendingDamage {
  readonly id: number;
  /** 残り時間（秒） */
  remaining: number;
  /** 積まれた時点のタイマー長（秒） */
  readonly duration: number;
  /** 予告を作った敵などの ID。分からなければ null */
  readonly sourceId: number | null;
  readonly kind: HitKind;
  /** 積まれた時刻（キュー内部の時計） */
  readonly createdAt: number;
  /** 猶予の天秤で一度延長済みか */
  graced: boolean;
}

export interface DamageQueueConfig {
  baseTimer: number;
  maxTimer: number;
  maxPending: number;
  stackGuard: number;
  postConfirmInvuln: number;
  confirmDamage: number;
  baseMaxStock: number;
  chainWindow: number;
  chainMin: number;
  /** 連鎖の受付時間の上限（アイテム込み） */
  chainWindowMax: number;
  /** window 秒以内の連続相殺は maxSteps 段までしか連鎖を伸ばさない（フラグ） */
  rapidChainLimit: { enabled: boolean; window: number; maxSteps: number };
  /** 前借りの証文: 借金の上限 */
  maxDebt: number;
  /** 猶予の天秤: 次の1ポイントまでこの割合以上溜まっていれば、確定を delay 秒延ばす（1つの予告に1回） */
  grace: { threshold: number; delay: number };
}

/** アイテムによる補正。上限は呼び出し側（アイテム側）で制限する前提だが、ここでも最低限クランプする */
export interface DamageQueueModifiers {
  /** タイマー延長（秒）。maxTimer を超えない */
  timerBonus: number;
  /** ストック上限の追加 */
  stockBonus: number;
  /** 連鎖の受付時間の倍率（連鎖の鐘）。chainWindowMax を超えない */
  chainWindowMult: number;
  /** ポイント獲得時に2倍になる確率 (0〜1) */
  doublePointChance: number;
  /** 前借りの証文: 時間切れの瞬間、借金が上限未満なら確定せずに消し、借金を1増やす */
  canBorrow: boolean;
  /** 猶予の天秤を持っているか */
  hasGrace: boolean;
}

export type DamageQueueEvent =
  | { type: 'queued'; pending: PendingDamage }
  | { type: 'ignored'; reason: 'invulnerable' | 'stackGuard'; kind: HitKind | InstantKind; sourceId: number | null }
  | {
      type: 'confirmed';
      reason: ConfirmReason;
      /** timeout のときは確定した予告。overflow/instant では null */
      pending: PendingDamage | null;
      kind: HitKind | InstantKind;
      sourceId: number | null;
      damage: number;
      /** 相殺に足りなかったポイント量 (0〜1]。timeout のとき 1 - 端数 */
      pointShort: number;
    }
  | { type: 'cancelled'; pending: PendingDamage; viaStock: boolean }
  | { type: 'pointGained'; amount: number; doubled: boolean }
  | { type: 'stockGained'; stock: number }
  | { type: 'chain'; count: number }
  | { type: 'chainEnded'; count: number }
  | { type: 'roomCleared'; count: number }
  /** 猶予の天秤で確定が延びた */
  | { type: 'graced'; pending: PendingDamage }
  /** 前借りで予告を消した（相殺にも数える） */
  | { type: 'borrowed'; pending: PendingDamage; debt: number }
  /** 得たポイントで借金を返した */
  | { type: 'debtRepaid'; debt: number };

export type DamageQueueListener = (e: DamageQueueEvent) => void;

export interface DamageQueueStats {
  hits: number;
  cancels: number;
  /** 連鎖が成立した回数 */
  chains: number;
  /** 最大連鎖数 */
  bestChain: number;
  confirms: Record<ConfirmReason, number>;
  roomClearWipes: number;
}

export type HitResult = 'queued' | 'cancelledByStock' | 'overflow' | 'ignored';

const DEFAULT_MODS: DamageQueueModifiers = {
  timerBonus: 0,
  stockBonus: 0,
  chainWindowMult: 1,
  doublePointChance: 0,
  canBorrow: false,
  hasGrace: false,
};

export class DamageQueue {
  private readonly cfg: DamageQueueConfig;
  private mods: DamageQueueModifiers = { ...DEFAULT_MODS };
  private readonly rng: () => number;
  private readonly listeners: DamageQueueListener[] = [];

  private items: PendingDamage[] = [];
  private nextId = 1;
  private now = 0;
  private guardUntil = -Infinity;
  private invulnUntil = -Infinity;
  private _stock = 0;
  private _partial = 0;
  private _chainCount = 0;
  private lastCancelAt = -Infinity;
  /** 0.1秒以内に続いた相殺の数（同時撃破の連鎖制限用） */
  private burst = 0;
  private _debt = 0;

  readonly stats: DamageQueueStats = {
    hits: 0,
    cancels: 0,
    chains: 0,
    bestChain: 0,
    confirms: { timeout: 0, overflow: 0, instant: 0 },
    roomClearWipes: 0,
  };

  constructor(cfg: DamageQueueConfig, rng: () => number = Math.random) {
    this.cfg = cfg;
    this.rng = rng;
  }

  // ---------------------------------------------------------------- 購読

  on(listener: DamageQueueListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(e: DamageQueueEvent): void {
    for (const l of this.listeners) l(e);
  }

  // ---------------------------------------------------------------- 参照

  /** 予告の一覧（残り時間の短い順） */
  get pending(): readonly PendingDamage[] {
    return this.items;
  }
  get count(): number {
    return this.items.length;
  }
  get stock(): number {
    return this._stock;
  }
  get maxStock(): number {
    return Math.max(0, this.cfg.baseMaxStock + this.mods.stockBonus);
  }
  /** 次の1ポイントまでの端数 [0,1) */
  get partial(): number {
    return this._partial;
  }
  get time(): number {
    return this.now;
  }
  get maxPending(): number {
    return this.cfg.maxPending;
  }
  /** いま積まれる予告のタイマー長 */
  get timerDuration(): number {
    return Math.min(this.cfg.baseTimer + Math.max(0, this.mods.timerBonus), this.cfg.maxTimer);
  }
  get chainMin(): number {
    return this.cfg.chainMin;
  }
  /** 連鎖の受付時間（連鎖の鐘込み、上限あり） */
  get chainWindow(): number {
    return Math.min(this.cfg.chainWindow * Math.max(1, this.mods.chainWindowMult), this.cfg.chainWindowMax);
  }
  /** 前借りの借金 */
  get debt(): number {
    return this._debt;
  }
  /** 進行中の相殺カウント（連鎖未成立も含む） */
  get chainCount(): number {
    return this._chainCount;
  }
  get isInvulnerable(): boolean {
    return this.now < this.invulnUntil;
  }
  get isGuarded(): boolean {
    return this.now < this.guardUntil;
  }
  /** 一番早く確定する予告の残り時間。無ければ null */
  get soonestRemaining(): number | null {
    return this.items.length > 0 ? this.items[0].remaining : null;
  }

  setModifiers(mods: Partial<DamageQueueModifiers>): void {
    this.mods = { ...this.mods, ...mods };
    this.mods.doublePointChance = Math.min(1, Math.max(0, this.mods.doublePointChance));
    // ストック上限が下がったら切り詰める
    if (this._stock > this.maxStock) this._stock = this.maxStock;
  }

  // ---------------------------------------------------------------- 被弾

  /** 予告になる被弾。 */
  hit(kind: HitKind, sourceId: number | null = null): HitResult {
    if (this.isInvulnerable) {
      this.emit({ type: 'ignored', reason: 'invulnerable', kind, sourceId });
      return 'ignored';
    }
    if (this.isGuarded) {
      this.emit({ type: 'ignored', reason: 'stackGuard', kind, sourceId });
      return 'ignored';
    }
    this.stats.hits++;

    if (this.items.length >= this.cfg.maxPending) {
      this.confirm('overflow', null, kind, sourceId, 1);
      return 'overflow';
    }

    const duration = this.timerDuration;
    const p: PendingDamage = {
      id: this.nextId++,
      remaining: duration,
      duration,
      sourceId,
      kind,
      createdAt: this.now,
      graced: false,
    };
    this.insert(p);
    this.guardUntil = this.now + this.cfg.stackGuard;
    this.emit({ type: 'queued', pending: p });

    // ストックがあれば即座に相殺する
    if (this._stock > 0) {
      this._stock--;
      this.cancelOne(true);
      return 'cancelledByStock';
    }
    return 'queued';
  }

  /**
   * 即座に確定するダメージ（落とし穴、自爆、HP代償）。
   * bypassInvuln: HP を代償にするアイテム等、無敵中でも必ず払わせたい場合に true。
   */
  instant(kind: InstantKind, opts: { bypassInvuln?: boolean; damage?: number } = {}): boolean {
    if (this.isInvulnerable && !opts.bypassInvuln) {
      this.emit({ type: 'ignored', reason: 'invulnerable', kind, sourceId: null });
      return false;
    }
    this.confirm('instant', null, kind, null, 0, opts.damage);
    return true;
  }

  // ---------------------------------------------------------------- ポイント

  /**
   * 相殺ポイントを加える。端数は蓄積され、1 に達するごとに相殺 or ストック。
   * canDouble: 「二重相殺」の判定対象にするか（撃破ボーナスなど）。
   */
  addPoints(amount: number, opts: { canDouble?: boolean } = {}): void {
    if (amount <= 0) return;
    let doubled = false;
    if (opts.canDouble !== false && this.mods.doublePointChance > 0 && this.rng() < this.mods.doublePointChance) {
      amount *= 2;
      doubled = true;
    }
    this.emit({ type: 'pointGained', amount, doubled });
    this._partial += amount;
    while (this._partial >= 1 - 1e-9) {
      this._partial = Math.max(0, this._partial - 1);
      this.spendPoint();
    }
  }

  private spendPoint(): void {
    // 借金があれば返済が先
    if (this._debt > 0) {
      this._debt--;
      this.emit({ type: 'debtRepaid', debt: this._debt });
      return;
    }
    if (this.items.length > 0) {
      this.cancelOne(false);
    } else if (this._stock < this.maxStock) {
      this._stock++;
      this.emit({ type: 'stockGained', stock: this._stock });
    }
    // 予告が無くストックも満杯なら捨てる
  }

  /** タイマー残りが最も少ない予告を1つ消す */
  private cancelOne(viaStock: boolean): void {
    const p = this.items.shift();
    if (!p) return;
    this.registerCancel();
    // chainCount は更新済み（演出側が連鎖数で音程を変えられるように）
    this.emit({ type: 'cancelled', pending: p, viaStock });
    this.emitChain();
  }

  /** 相殺を数え、連鎖を進める。進んだら true */
  private registerCancel(): boolean {
    this.stats.cancels++;
    const gap = this.now - this.lastCancelAt;
    const rl = this.cfg.rapidChainLimit;
    const rapid = rl.enabled && gap <= rl.window;
    this.burst = rapid ? this.burst + 1 : 1;
    let advanced = true;
    if (gap <= this.chainWindow) {
      if (rapid && this.burst > rl.maxSteps) advanced = false;
      else this._chainCount++;
    } else {
      this.endChain();
      this._chainCount = 1;
    }
    this.lastCancelAt = this.now;
    this.chainAdvanced = advanced;
    return advanced;
  }

  private chainAdvanced = false;

  private emitChain(): void {
    if (this.chainAdvanced && this._chainCount >= this.chainMin) {
      if (this._chainCount === this.chainMin) this.stats.chains++;
      this.stats.bestChain = Math.max(this.stats.bestChain, this._chainCount);
      this.emit({ type: 'chain', count: this._chainCount });
    }
  }

  private endChain(): void {
    if (this._chainCount >= this.chainMin) this.emit({ type: 'chainEnded', count: this._chainCount });
    this._chainCount = 0;
  }

  // ---------------------------------------------------------------- 時間

  update(dt: number): void {
    if (dt <= 0) return;
    this.now += dt;
    for (const p of this.items) p.remaining -= dt;

    // 時間切れ（残りの短い順に並んでいるので先頭から）
    while (this.items.length > 0 && this.items[0].remaining <= 0) {
      const p = this.items[0];
      // 猶予の天秤: あと少しで1ポイントなら一度だけ延ばす（タイマー上限とは別枠）
      if (this.mods.hasGrace && !p.graced && this._partial >= this.cfg.grace.threshold) {
        p.graced = true;
        p.remaining += this.cfg.grace.delay;
        this.items.sort((a, b) => a.remaining - b.remaining);
        this.emit({ type: 'graced', pending: p });
        continue;
      }
      this.items.shift();
      p.remaining = 0;
      // 前借りの証文: 借金が上限未満なら確定せずに消す
      if (this.mods.canBorrow && this._debt < this.cfg.maxDebt) {
        this._debt++;
        this.registerCancel();
        this.emit({ type: 'borrowed', pending: p, debt: this._debt });
        this.emit({ type: 'cancelled', pending: p, viaStock: false });
        this.emitChain();
        continue;
      }
      this.confirm('timeout', p, p.kind, p.sourceId, 1 - this._partial);
    }

    if (this._chainCount > 0 && this.now - this.lastCancelAt > this.chainWindow) {
      this.endChain();
    }
  }

  /** 部屋の敵を全滅させた: 残りの予告をすべて消す（相殺扱いではない） */
  clearAll(): number {
    const n = this.items.length;
    this.items = [];
    if (n > 0) this.stats.roomClearWipes += n;
    this.emit({ type: 'roomCleared', count: n });
    return n;
  }

  /** 新しいランを始めるときなどに状態を初期化（統計も消す） */
  reset(): void {
    this.items = [];
    this.now = 0;
    this.guardUntil = -Infinity;
    this.invulnUntil = -Infinity;
    this._stock = 0;
    this._partial = 0;
    this._chainCount = 0;
    this.lastCancelAt = -Infinity;
    this.burst = 0;
    this._debt = 0;
    this.stats.hits = 0;
    this.stats.cancels = 0;
    this.stats.chains = 0;
    this.stats.bestChain = 0;
    this.stats.confirms = { timeout: 0, overflow: 0, instant: 0 };
    this.stats.roomClearWipes = 0;
  }

  // ---------------------------------------------------------------- 内部

  private insert(p: PendingDamage): void {
    // 残り時間の昇順を保つ（同値なら古い方が先）
    let i = this.items.length;
    while (i > 0 && this.items[i - 1].remaining > p.remaining) i--;
    this.items.splice(i, 0, p);
  }

  private confirm(
    reason: ConfirmReason,
    pending: PendingDamage | null,
    kind: HitKind | InstantKind,
    sourceId: number | null,
    pointShort: number,
    damage = this.cfg.confirmDamage,
  ): void {
    this.stats.confirms[reason]++;
    this.invulnUntil = this.now + this.cfg.postConfirmInvuln;
    this.emit({ type: 'confirmed', reason, pending, kind, sourceId, damage, pointShort });
  }
}
