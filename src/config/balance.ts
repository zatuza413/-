// ============================================================================
// 調整用の数値はすべてここに集める。
// 時間は「秒」、距離は「px」、速度は「px/秒」が基本単位。
// HP は「ハート半分 = 1」で数える。
// ============================================================================

import type { EnemyDef, WeaponDef, WeaponId } from '../core/types';

/** 画面・ワールド */
export const VIEW = {
  /** 画面の幅・高さ（論理解像度）。16:9 固定で、機種によらず見える広さを同じにする（仮） */
  width: 960,
  height: 540,
};

/** スマホ用のタッチ操作（スティックは画面 960×540 基準、ボタンは CSS px） */
export const TOUCH = {
  /** スティックの最大の倒し幅 */
  stickRadius: 60,
  /** これ未満の倒し幅は無視する（右スティックは、これを超えると射撃） */
  deadZone: 12,
  /** ボタンの直径（CSS px）。右の黒帯がダッシュボタン＋barPadding×2 より広ければ黒帯に置く */
  buttonSize: { dash: 64, reload: 50, switch: 46 },
  /** 黒帯に置くときの左右の余白（CSS px） */
  barPadding: 4,
  /** 黒帯に置けないときに、画面の右端から内側へ置く距離（CSS px） */
  inCanvasMargin: 16,
  /** スマホの照準補正: この距離以上離れた敵に、照準のずれがこの角度以内なら吸い付く（仮） */
  aimAssist: { enabled: true, minDist: 200, maxAngleDeg: 3 },
};

/** 接触ダメージ */
export const CONTACT = {
  /** 同じ敵からの接触被弾はこの秒数に1回まで */
  cooldown: 1.0,
  /** 接触したら自機をこの距離だけ押し返す (px) */
  push: 40,
  /** 押し返しにかける時間（秒） */
  pushTime: 0.1,
};

/** 相殺ポイントの倍率と撃破ボーナス */
export const POINTS = {
  /**
   * 実効倍率の上限。生の倍率 r（武器 × (1 + レリック加算の合計)）から:
   * r ≤ knee1 → r / knee1〜knee2 → 傾き slope2 / knee2〜 → 傾き slope3 / 最大 max
   */
  softcap: { knee1: 2.0, knee2: 3.0, slope2: 0.5, slope3: 0.25, max: 4.0 },
  /** 狙撃撃破: 自機からこの距離以上の敵を倒すと撃破ポイントに加算 */
  snipe: { range: 300, bonus: 0.5, /** 倒した敵が「仇」（予告を作った敵）なら代わりにこの値 */ nemesisBonus: 0.75 },
};

/** 自機 */
export const PLAYER = {
  /** 最大HP（ハート半分の数。6 = ハート3つ） */
  maxHp: 6,
  /** 移動速度 */
  speed: 210,
  /** 戦闘中でないとき（通路・クリア済みの部屋）の移動速度の倍率（仮） */
  travelSpeedMult: 1.8,
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
  /**
   * 予告タイマーの初期値（秒）。仮で 3.0 → 3.5。
   * 見積もり: 被弾→知覚→判断→照準→撃破に、初心者は PC 2.7〜3.0秒・スマホ 3.2〜3.6秒、慣れると 1.7〜2.3秒。
   * 計測の「被弾から相殺までの時間」で確かめて調整する。
   */
  baseTimer: 3.5,
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
  /** 連鎖の受付時間の上限（連鎖の鐘込み） */
  chainWindowMax: 2.5,
  /** 同時撃破の連鎖を制限するフラグ: window 秒以内の連続相殺は maxSteps 段までしか連鎖を伸ばさない */
  rapidChainLimit: { enabled: false, window: 0.1, maxSteps: 2 },
  /** 前借りの証文: 借金の上限 */
  maxDebt: 1,
  /** 猶予の天秤: 次の1ポイントまで threshold 以上溜まっていれば確定を delay 秒延ばす（1つの予告に1回、タイマー上限とは別枠） */
  grace: { threshold: 0.8, delay: 0.5 },
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

/** タイル1枚の大きさ (px) */
export const TILE = 32;

/** フロア */
export const FLOOR = {
  /** フロア数。最後のフロアのボス部屋をクリアするとゲームクリア */
  count: 3,
  /** 生成の設定（単位はタイル） */
  gen: {
    roomsMin: 10,
    roomsMax: 15,
    gridW: 7,
    gridH: 7,
    cellW: 36,
    cellH: 28,
    roomW: [16, 28] as [number, number],
    roomH: [12, 20] as [number, number],
    corridorWidth: 3,
    extraLoopChance: 0.15,
    treasureRooms: [1, 2] as [number, number],
    shopRooms: 1,
    hazardChance: 0.4,
    hazardSize: [3, 5] as [number, number],
    /** 戦闘部屋の柱（2×2タイル）の数（仮）。狙撃エリートの隠れ場所・跳弾の壁・射線を切る遊び */
    pillars: { min: 0, max: 3, size: 2 },
  },
  /** 戦闘部屋の敵の数: base + perFloor × (フロア-1) + 0〜random。ボス部屋は × bossRoomMultiplier */
  enemies: { base: 3, perFloor: 1, random: 2, bossRoomMultiplier: 1.8 },
  /** フロアごとに出る敵（敵ID の配列。重複させると出やすくなる） */
  enemyPool: [
    ['shooter', 'shooter', 'charger', 'fan', 'bomber'],
    ['shooter', 'charger', 'fan', 'bomber', 'mortar', 'mortar', 'sniper'],
    ['shooter', 'charger', 'fan', 'bomber', 'bomber', 'mortar', 'mortar', 'sniper', 'sniper'],
  ] as string[][],
  /** 敵を自機からこれ以上離れた位置に出す (px) */
  spawnMinDistance: 220,
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
    ['fan', 'shooter', 'bomber', 'charger'],
    ['mortar', 'shooter', 'shooter', 'bomber', 'bomber'],
    ['sniper', 'fan', 'charger', 'charger'],
    ['sniper', 'mortar', 'mortar', 'fan', 'bomber', 'bomber', 'shooter'],
  ],
};

/** アイテムの数値（すべて仮）。重ねがけで相殺が壊れないよう、各効果に上限を設ける */
export const ITEM_NUM = {
  /** 砂時計: 予告のタイマー +1秒（タイマーは上限6秒） */
  hourglassTimer: 1.0,
  /** 二重相殺: ポイントが2倍になる確率 */
  doubleChance: 0.15,
  /** 貯蓄の指輪: ストック上限 +1 */
  ringStock: 1,
  /** 怒りの予告: 予告が minPending 個以上ある間、攻撃力 +attack */
  wrath: { minPending: 2, attack: 0.25 },
  /** 連鎖の鐘: 連鎖の受付時間 ×1.5（上限は CANCEL.chainWindowMax） */
  bellWindowMult: 1.5,
  /** 呪詛返し: 相殺すると、その予告を作った敵に damage。同じ敵には cooldown 秒に1回。ポイントは入らない */
  curse: { damage: 20, cooldown: 1.0 },
  /** 危険報酬の財布: 予告がある間に敵を倒すと通貨 +1 */
  walletCurrency: 1,
  /** 弾倉の誓い: 予告が積まれるたびに弾を rounds 発補充（cooldown 秒に1回、ハンドガンには効果なし） */
  magazineVow: { rounds: 2, cooldown: 0.5 },
  /** 予告中のポイント倍率レリック（仮名「背水の札」）: 予告がある間、倍率 +add */
  backwater: 0.3,
  /** 集中の照準器: minDist 以上での命中が続くたびに +perHit（上限 max）、外すと −missPenalty。farDist 以上は2回分 */
  focus: { minDist: 200, farDist: 400, perHit: 0.1, max: 1.0, missPenalty: 0.3 },
  /** 弾撃ちの銃身: 大きめの敵弾を撃ち落とすと +perBullet（1部屋で roomMax まで） */
  shootdown: { perBullet: 0.1, roomMax: 1.0 },
  /** 反撃の型: 予告が積まれてから duration 秒間、倍率 +bonus。発動後 lockout 秒は再発動しない */
  counter: { bonus: 0.5, duration: 1.0, lockout: 2.0 },
  /** 据え撃ちの台座: stillTime 秒以上動かずに撃ち続けると倍率 +bonus。移動・ダッシュで解除 */
  stance: { bonus: 0.5, stillTime: 1.0 },
  /** かすめの護符: 敵弾が radius 以内を通過すると +perGraze（毎秒 perSecond、1部屋 roomMax まで） */
  graze: { radius: 24, perGraze: 0.05, perSecond: 0.3, roomMax: 1.5 },
  /** 早撃ちの弾帯: リロードの start（割合）から width 秒の間に再入力で即完了、次の1弾倉は倍率 +boost */
  quickdraw: { start: 0.45, width: 0.15 },
  quickdrawBoost: 0.3,
  /** 「撃っている間」とみなす、最後に撃ってからの秒数（撃っていない間はポイントが溜まらない） */
  shootingGrace: 0.5,
};

/** 宝箱 */
export const CHEST = {
  /** 候補の数 */
  choices: 3,
  /** 最初の宝箱で必ず候補に入れるアイテム */
  firstGuaranteed: 'backwater',
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
  // 張り付き型: 遠くから撒いても相殺はほとんど溜まらない。近づいて殴り合うほど溜まる
  shotgun: {
    id: 'shotgun',
    name: 'ショットガン',
    damage: 7,
    fireRate: 1.7,
    pellets: 6,
    spreadDeg: 38,
    bulletSpeed: 520,
    range: 300,
    magazine: 6,
    maxAmmo: 60,
    reloadTime: 1.3,
    pointRate: 1.0,
    pointFalloff: [
      [80, 2.0], // 80px以内: 2倍
      [160, 1.0],
      [240, 0.3], // 240px以上: 0.3倍
    ],
    closeKillBonus: { range: 100, points: 0.5 },
    bulletRadius: 3,
    bulletColor: 0xffb35a,
  },
  // 押しっぱなしで倍率が上がる（×0.5 → 2秒で ×1.5）。指を離すかリロードでリセット
  machinegun: {
    id: 'machinegun',
    name: 'マシンガン',
    damage: 6,
    fireRate: 12,
    pellets: 1,
    spreadDeg: 7,
    bulletSpeed: 620,
    range: 560,
    magazine: 40,
    maxAmmo: 400,
    reloadTime: 1.5,
    pointRate: 1.0,
    holdRamp: { from: 0.5, to: 1.5, time: 2.0 },
    bulletRadius: 3,
    bulletColor: 0xfff7b0,
  },
  // 照射・すべて貫通。貫通した数で稼ぐ（同時に当たる敵が多いほど倍率が上がる）。
  // 必ず当たるので、遠くほどダメージが下がる（遠距離の狙撃撃破を簡単にしすぎない）
  laser: {
    id: 'laser',
    name: 'レーザー',
    kind: 'beam',
    damage: 55, // 毎秒（仮。持続で約37 = 過熱3秒＋冷却1.5秒）
    fireRate: 1,
    pellets: 1,
    spreadDeg: 0,
    bulletSpeed: 0,
    range: 600,
    magazine: 1,
    maxAmmo: null,
    reloadTime: 0,
    pointRate: 1.0,
    heat: { max: 3.0, cooldown: 1.5 },
    /** 距離によるダメージ倍率（仮）: 250px までは100%、600px で50% */
    damageFalloff: [
      [250, 1.0],
      [600, 0.5],
    ],
    beamRate: { base: 0.6, perExtra: 0.4, max: 2.2 },
    bulletRadius: 3,
    bulletColor: 0x9ff0ff,
  },
  // 壁で2回まで跳ねる。跳ねてから当てるほど倍率が高い。跳弾で倒すと撃破+0.5
  ricochet: {
    id: 'ricochet',
    name: '跳弾銃',
    damage: 12,
    fireRate: 3,
    pellets: 1,
    spreadDeg: 2,
    bulletSpeed: 480,
    range: 1100,
    magazine: 8,
    maxAmmo: 160, // 仮（指示に無いため）
    reloadTime: 1.2,
    pointRate: 1.0,
    ricochet: { bounces: 2, rates: [0.4, 1.4, 2.0], killBonus: 0.5 },
    bulletRadius: 4,
    bulletColor: 0xa0ffa0,
  },
  // 爆風で稼ぐ。ポイント倍率は低いが、爆風で敵弾を消すとポイント。自分が爆心近くにいると即確定
  rocket: {
    id: 'rocket',
    name: 'ロケット',
    kind: 'rocket',
    damage: 0, // ダメージは爆風のみ
    fireRate: 1,
    pellets: 1,
    spreadDeg: 0,
    bulletSpeed: 380,
    range: 800,
    magazine: 4,
    maxAmmo: 24,
    reloadTime: 1.6,
    pointRate: 0.5,
    explosion: { damage: 50, radius: 70, selfRadius: 60, erasePoints: 0.15, eraseMax: 1.0 },
    bulletRadius: 6,
    bulletColor: 0xff8a3f,
  },
};

/** 初期装備 */
export const STARTING_WEAPONS: WeaponId[] = ['handgun'];
/** テスト部屋ではすべての武器を持つ */
export const TEST_ROOM_WEAPONS: WeaponId[] = ['handgun', 'shotgun', 'machinegun', 'laser', 'ricochet', 'rocket'];

/** 敵弾の共通設定 */
export const ENEMY_BULLET = {
  radius: 6,
  /** 当たり判定は見た目より小さく */
  hitRadius: 4,
  color: 0xff5ab4,
  lifetime: 5,
  /** 大きめの弾（狙撃など）。「弾撃ちの銃身」で撃ち落とせる */
  big: { radius: 9, hitRadius: 6, color: 0xff8a3f },
};

/** 迫撃砲の着弾 */
export const MORTAR = {
  /** 着弾予告の時間（秒） */
  warn: 1.0,
  /** 爆風の半径 (px) */
  radius: 60,
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
  // 役割なし（数合わせ・ボスの召喚用）
  fan: {
    id: 'fan',
    name: '扇撃ち',
    behavior: 'shooter',
    hp: 30,
    speed: 65,
    radius: 13,
    color: 0xc9508f,
    elite: false,
    params: {
      fireInterval: 1.5,
      telegraph: 0.35,
      bulletSpeed: 170,
      preferredRange: 240,
      initialDelayJitter: 1.0,
      /** 1回に撃つ弾の数と扇の全幅（度） */
      count: 5,
      spreadDeg: 60,
    },
  },
  // 近距離を罰する: 倒すと全方位に弾をばらまく
  bomber: {
    id: 'bomber',
    name: '自爆型',
    behavior: 'bomber',
    hp: 25,
    speed: 150,
    radius: 12,
    color: 0x9ad04a,
    elite: false,
    params: {
      /** 倒したときの1回目の全方位弾 */
      burst1: 12,
      /** 0.35秒後の2回目（1回目の隙間を埋める向き） */
      burst2: 8,
      burstDelay: 0.35,
      bulletSpeed: 170,
    },
  },
  // 遠距離を罰する: 自機の位置に予告してから着弾
  mortar: {
    id: 'mortar',
    name: '迫撃砲',
    behavior: 'mortar',
    hp: 40,
    speed: 45,
    radius: 14,
    color: 0x6fa0d8,
    elite: false,
    params: {
      fireInterval: 2.5,
      /** 自機がこの距離より近いと撃たない */
      minRange: 120,
      preferredRange: 340,
      initialDelayJitter: 1.5,
    },
  },
  // ボス本体（行動の数値は BOSS）。接触ダメージなし、押し出しのみ
  boss: {
    id: 'boss',
    name: 'ボス',
    behavior: 'boss',
    hp: 2400,
    speed: 40,
    radius: 34,
    color: 0xb04060,
    elite: false,
    noContactDamage: true,
    params: {
      /** ボス本体へのダメージは、この量ごとに相殺ポイント1（武器・レリックの倍率はかける） */
      damagePerPoint: 120,
    },
  },
  // 攻めの遠距離を試す: 照準線のあと高速弾。柱の陰に隠れながら後退する
  sniper: {
    id: 'sniper',
    name: '狙撃エリート',
    behavior: 'sniper',
    hp: 120,
    speed: 95,
    radius: 15,
    color: 0xd8d8f0,
    elite: true,
    params: {
      /** 照準線の時間（秒）。最後の lockTime 秒は向きが固定（避ける猶予） */
      aimTime: 0.8,
      lockTime: 0.25,
      bulletSpeed: 520,
      /** 撃ったあと後退する時間（秒） */
      retreatTime: 1.4,
      /** 射撃の間隔の下限（秒） */
      cooldown: 2.2,
      preferredRange: 380,
      initialDelayJitter: 1.0,
    },
  },
};

/** ボス（数値はすべて仮） */
export const BOSS = {
  // 大きさ・速さ・ポイントの数値は ENEMIES.boss にある
  /** フロアごとの HP（仮）。ハンドガンだけ・命中率80%で 約51秒 / 69秒 / 87秒 */
  hpByFloor: [1400, 1900, 2400],
  /** ボスの弾は初速 startRatio で出て、accelTime 秒で最高速まで加速する */
  bullet: { startRatio: 0.6, accelTime: 0.3 },
  /** 召喚: warn 秒予告し、自機から minDist 以上離して出す。場に最大 maxAlive 体 */
  summon: { warn: 0.8, minDist: 200, maxAlive: 5, killPoints: 0.5, damagePointMult: 0.5 },
  /** P1（HP 100〜70%）: 全方位リング、直進撃ちを召喚 */
  p1: { until: 0.7, ring: 24, ringInterval: 1.2, ringSpeed: 140, summonEvery: 8, summonId: 'shooter', summonCount: 2 },
  /** P2（HP 70〜35%）: 4本腕の回転弾、自機狙いの3方向、突進を召喚 */
  p2: {
    until: 0.35,
    arms: 4,
    /** 腕の回転速度（ラジアン/秒）と、腕1本あたりの発射間隔 */
    armSpin: 1.2,
    armInterval: 0.16,
    armSpeed: 170,
    aimedEvery: 2.0,
    aimedCount: 3,
    aimedSpreadDeg: 24,
    aimedSpeed: 200,
    summonEvery: 6,
    summonId: 'charger',
    summonCount: 1,
  },
  /**
   * P3（HP 35〜0%）: 隙間のない全方位の波（避けられない）で確実に1回被弾させ、直後に種類の違う弱い雑魚を3体。
   * 「当てられた予告を、出てきた雑魚で相殺して連鎖する」リズムを作る。合間は逆回転の二重らせん弾。ボスは速くなる
   */
  p3: {
    pulseEvery: 8,
    pulseWarn: 1.0,
    pulseSpeed: 260,
    minionIds: ['fan', 'bomber', 'shooter'],
    minionHp: 20,
    aimedEvery: 2.5,
    /** らせん: 腕の回転速度（ラジアン/秒）、発射間隔、弾速 */
    spiralSpin: 1.6,
    spiralInterval: 0.2,
    spiralSpeed: 150,
    /** 移動速度の倍率 */
    speedMult: 1.4,
  },
};

/** ショップ（価格はすべて仮） */
export const SHOP = {
  /** 並ぶ品の数（アイテムか未所持の武器） */
  wares: 3,
  price: { item: 18, weapon: 22, heal: 6 },
  /** 回復で戻るHP（ハート半分の数） */
  healAmount: 2,
};

/** リザルト画面のスロー再生 */
export const REPLAY = {
  /** 死ぬ直前の何秒を記録するか */
  seconds: 5,
  /** 1秒あたりの記録数 */
  fps: 30,
  /** 再生速度（1 = 等速） */
  speed: 0.35,
};

/** 敵が出現してから攻撃を始めるまでの猶予（秒） */
export const ENEMY_SPAWN_GRACE = 0.8;
