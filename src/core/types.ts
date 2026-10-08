// 武器・敵などのデータ定義の型。数値そのものは src/config/balance.ts に置く。

export type WeaponId = 'handgun' | 'shotgun' | 'machinegun' | 'laser' | 'ricochet' | 'rocket';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** 1発のダメージ */
  damage: number;
  /** 1秒あたりの発射回数 */
  fireRate: number;
  /** 1回の発射で出る弾数（ショットガンなら複数） */
  pellets: number;
  /** 拡散角（度）。pellets>1 なら扇の全幅、1なら±ランダムぶれ幅 */
  spreadDeg: number;
  /** 弾速 (px/秒) */
  bulletSpeed: number;
  /** 射程 (px)。これを超えると弾が消える */
  range: number;
  /** マガジン容量 */
  magazine: number;
  /** 総弾数。null なら無限 */
  maxAmmo: number | null;
  /** リロード時間（秒） */
  reloadTime: number;
  /**
   * 与ダメージ由来の相殺ポイント倍率。
   * 単発の重い武器ほど高くして、範囲武器一強にならないようにする。
   */
  pointRate: number;
  /**
   * 敵との距離による pointRate の倍率（任意）。[距離px, 倍率] を距離の昇順で並べ、間は直線で補間する。
   * 範囲武器を「張り付くほど相殺が溜まる」武器にするために使う。
   */
  pointFalloff?: Array<[number, number]>;
  /** この距離以内で倒すと撃破ポイントにボーナスを足す（任意） */
  closeKillBonus?: { range: number; points: number };
  /** 弾の種類: 通常弾 / 照射（レーザー）/ ロケット（爆風）。省略時は通常弾 */
  kind?: 'bullet' | 'beam' | 'rocket';
  /** 押しっぱなしで倍率が from から time 秒かけて to まで上がる（マシンガン）。指を離すかリロードでリセット */
  holdRamp?: { from: number; to: number; time: number };
  /** 照射: damage は毎秒のダメージ。maxHeat 秒撃ち続けると過熱し、cooldown 秒撃てない */
  heat?: { max: number; cooldown: number };
  /** 照射の倍率: base + perExtra × (同時に当たっている敵の数 − 1)、上限 max */
  beamRate?: { base: number; perExtra: number; max: number };
  /** 跳弾: 壁で跳ねる回数と、跳ねた回数ごとの倍率 [直撃, 1回, 2回]、跳弾で倒したときの撃破ボーナス */
  ricochet?: { bounces: number; rates: number[]; killBonus: number };
  /** ロケットの爆風。自分が selfRadius 以内にいると即確定。爆風で消した敵弾1発につき erasePoints（1発あたり eraseMax まで） */
  explosion?: { damage: number; radius: number; selfRadius: number; erasePoints: number; eraseMax: number };
  /** 弾の見た目 */
  bulletRadius: number;
  bulletColor: number;
}

export type EnemyBehaviorId = 'shooter' | 'charger' | 'bomber' | 'mortar' | 'sniper';

export interface EnemyDef {
  id: string;
  name: string;
  behavior: EnemyBehaviorId;
  hp: number;
  /** 移動速度 (px/秒) */
  speed: number;
  radius: number;
  color: number;
  /** エリートは撃破時の相殺ポイントが多い */
  elite: boolean;
  /** 接触ダメージが無い（ボス本体など。押し出しだけ行う） */
  noContactDamage?: boolean;
  /** 行動ごとの追加パラメータ（behavior ごとに意味が変わる） */
  params: Record<string, number>;
}
