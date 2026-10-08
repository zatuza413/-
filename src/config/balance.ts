// ============================================================================
// 調整用の数値はすべてここに集める。
// 時間は「秒」、距離は「px」、速度は「px/秒」が基本単位。
// HP は「ハート半分 = 1」で数える。
// ============================================================================

import type { EnemyDef, WeaponDef, WeaponId } from '../core/types';

/** 画面・ワールド */
export const VIEW = {
  /** 画面の幅・高さ */
  width: 960,
  height: 640,
};

/** 自機 */
export const PLAYER = {
  /** 最大HP（ハート半分の数。6 = ハート3つ） */
  maxHp: 6,
  /** 移動速度 */
  speed: 210,
  /** 当たり判定の半径。見た目より小さめにして「避けた感」を出す */
  hitRadius: 6,
  /** 見た目の半径 */
  radius: 11,
  dash: {
    /** ダッシュ中の速度 */
    speed: 620,
    /** ダッシュの持続時間（秒）。speed × duration が移動距離 */
    duration: 0.13,
    /** クールダウン（秒） */
    cooldown: 0.8,
  },
};

/** 相殺システム（DamageQueue に渡す設定） */
export const CANCEL = {
  /** 予告タイマーの初期値（秒） */
  baseTimer: 3.0,
  /** 予告タイマーの上限（アイテム込み、秒） */
  maxTimer: 6.0,
  /** 同時に積める予告の最大数。超えた被弾は即確定（上限超過） */
  maxPending: 4,
  /** 予告が積まれた直後、次の予告が積まれない時間（秒） */
  stackGuard: 0.3,
  /** 確定ダメージ直後の無敵時間（秒） */
  postConfirmInvuln: 0.8,
  /** 確定1回で減るHP（ハート半分 = 1） */
  confirmDamage: 1,
  /** 予告が無いときに保持できる相殺ポイント（ストック）の上限 */
  baseMaxStock: 1,
  /** この秒数以内に次の相殺が起きると連鎖が続く */
  chainWindow: 1.5,
  /** 連鎖と呼ぶのに必要な相殺数 */
  chainMin: 2,
  /** 撃破時の相殺ポイント */
  killPoints: { normal: 1, elite: 2 },
  /**
   * 与ダメージ由来のポイント: (ダメージ ÷ damagePerPoint) × 武器の pointRate。
   * 倒しきれなかった努力も少しずつ報われる。
   */
  damagePerPoint: 150,
};

/** 連鎖ボーナス。count は連鎖数（2以上） */
export const CHAIN = {
  /** 衝撃波（敵弾を消す）の半径: base + perChain × (count - chainMin)、上限 max */
  shockwave: { base: 140, perChain: 70, max: 420 },
  /** 弾薬回復: マガジン容量 × ratioPerChain × (count - 1)、上限はマガジン満タン */
  ammoRefillRatioPerChain: 0.35,
  /** 攻撃力アップ: +perChain × (count - 1)、上限 max。duration 秒持続（連鎖が伸びると更新） */
  attackBuff: { perChain: 0.2, max: 0.8, duration: 4.0 },
  /** 衝撃波で押し返す力 */
  knockback: 260,
};

/** ミス認知の演出 */
export const FX = {
  /** 確定時のヒットストップ（ミリ秒） */
  hitstopMs: 110,
  /** 確定時の画面点滅（ミリ秒） */
  confirmFlashMs: 260,
  /** 確定時に予告元の敵へ引く線の表示時間（ミリ秒） */
  blameLineMs: 1600,
  /** 確定後、この秒数以内にポイントが入ったら「あと◯秒」に書き換える */
  lateWindow: 2.0,
  /** 「倒せそう」印: 現在の武器で残り何発以内なら印を出すか */
  killableShots: 2,
  /** 心音の間隔（秒）。残り時間が長いと slow、0 に近いと fast */
  heartbeat: { slow: 1.0, fast: 0.24, /** この残り秒数以上なら最も遅い */ calmAt: 3.0 },
  /** 自機周囲の予告ゲージの半径 */
  ringRadius: 26,
  /** 確定理由ごとの色 */
  reasonColor: {
    timeout: 0xff3344, // 時間切れ: 赤
    overflow: 0xc04bff, // 上限超過: 紫
    instant: 0xff9a1f, // 即時確定: 橙
  },
};

/** テスト部屋の設定（段階2用） */
export const TEST_ROOM = {
  width: 1280,
  height: 900,
  /** ウェーブ全滅から次のウェーブまで（秒） */
  waveDelay: 2.0,
  /** ウェーブの構成（敵ID の配列）。最後まで行ったらループ */
  waves: [
    ['shooter', 'shooter', 'charger'],
    ['shooter', 'shooter', 'shooter', 'charger', 'charger'],
    ['charger', 'charger', 'charger', 'shooter', 'shooter', 'shooter'],
    ['shooter', 'shooter', 'shooter', 'shooter', 'charger', 'charger', 'charger'],
  ],
};

/** 武器 */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  handgun: {
    id: 'handgun',
    name: 'ハンドガン',
    damage: 10,
    fireRate: 5,
    pellets: 1,
    spreadDeg: 3,
    bulletSpeed: 560,
    range: 650,
    magazine: 10,
    maxAmmo: null, // 弾数無限
    reloadTime: 0.9,
    pointRate: 1.0,
    bulletRadius: 4,
    bulletColor: 0xfff27a,
  },
};

/** 初期装備 */
export const STARTING_WEAPONS: WeaponId[] = ['handgun'];

/** 敵弾の共通設定 */
export const ENEMY_BULLET = {
  radius: 6,
  /** 当たり判定は見た目より小さく */
  hitRadius: 4,
  color: 0xff5ab4,
  lifetime: 5,
};

/** 敵 */
export const ENEMIES: Record<string, EnemyDef> = {
  shooter: {
    id: 'shooter',
    name: '直進撃ち',
    behavior: 'shooter',
    hp: 30,
    speed: 70,
    radius: 13,
    color: 0xe0584a,
    elite: false,
    params: {
      /** 射撃間隔（秒） */
      fireInterval: 1.7,
      /** 撃つ前の予備動作（秒）。この間光る */
      telegraph: 0.35,
      /** 弾速 */
      bulletSpeed: 210,
      /** 自機と保ちたい距離 */
      preferredRange: 260,
      /** 射撃開始までのばらつき（秒） */
      initialDelayJitter: 1.2,
    },
  },
  charger: {
    id: 'charger',
    name: '突進',
    behavior: 'charger',
    hp: 40,
    speed: 85,
    radius: 14,
    color: 0xe0a33a,
    elite: false,
    params: {
      /** この距離まで近づいたら突進の構えに入る */
      triggerRange: 280,
      /** 構え（予備動作）の時間（秒） */
      windup: 0.55,
      /** 突進の速度 */
      chargeSpeed: 480,
      /** 突進の持続（秒） */
      chargeTime: 0.45,
      /** 突進後の硬直（秒） */
      recover: 0.9,
    },
  },
};

/** 敵が出現してから攻撃を始めるまでの猶予（秒） */
export const ENEMY_SPAWN_GRACE = 0.8;
