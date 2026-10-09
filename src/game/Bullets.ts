import Phaser from 'phaser';
import type { WeaponDef } from '../core/types';

/** 自機・敵共通の弾 */
export class Bullet extends Phaser.Physics.Arcade.Image {
  damage = 0;
  /** 撃った敵の ID（自機弾は -1） */
  ownerId = -1;
  /** 残り寿命（秒） */
  life = 0;
  /** 撃った武器（自機弾のみ。相殺ポイントの計算に使う） */
  weapon: WeaponDef | null = null;
  /** 大きめの敵弾（撃ち落とせる） */
  big = false;
  /** 硬い弾（ボス本体）: 衝撃波・爆風で消えない */
  sturdy = false;
  /** 撃った時点の武器固有の倍率（マシンガン） */
  rateMult = 1;
  /** 早撃ちの弾帯で強化された弾倉の弾 */
  boosted = false;
  /** 壁で跳ねた回数と上限（跳弾銃） */
  bounces = 0;
  maxBounces = 0;
  /** かすめの判定: 0 まだ / 1 近くにいる / 2 判定済み */
  graze: 0 | 1 | 2 = 0;
  /** 加速（ボスの弾）: 最高速と、最高速になるまでの残り時間・全体の時間 */
  private topSpeed = 0;
  private accelLeft = 0;
  private accelTime = 0;
  private startRatio = 1;

  fire(x: number, y: number, angle: number, speed: number, opts: { damage: number; life: number; ownerId?: number; weapon?: WeaponDef; big?: boolean; sturdy?: boolean; accel?: { startRatio: number; time: number }; rateMult?: number; boosted?: boolean; maxBounces?: number; tint?: number; scale?: number; hitRadius: number }): void {
    this.enableBody(true, x, y, true, true);
    this.setRotation(angle);
    this.damage = opts.damage;
    this.life = opts.life;
    this.ownerId = opts.ownerId ?? -1;
    this.weapon = opts.weapon ?? null;
    this.big = opts.big ?? false;
    this.sturdy = opts.sturdy ?? false;
    this.rateMult = opts.rateMult ?? 1;
    this.boosted = opts.boosted ?? false;
    this.bounces = 0;
    this.maxBounces = opts.maxBounces ?? 0;
    this.graze = 0;
    this.topSpeed = speed;
    this.accelTime = opts.accel?.time ?? 0;
    this.accelLeft = this.accelTime;
    this.startRatio = opts.accel?.startRatio ?? 1;
    if (this.accelLeft > 0) speed *= this.startRatio;
    this.setScale(opts.scale ?? 1);
    if (opts.tint !== undefined) this.setTint(opts.tint);
    else this.clearTint();
    const body = this.body as Phaser.Physics.Arcade.Body;
    // 円形の当たり判定（テクスチャ中心に合わせる）
    const r = opts.hitRadius / (opts.scale ?? 1);
    body.setCircle(r, this.width / 2 - r, this.height / 2 - r);
    // 跳弾は壁で反射させる（それ以外は壁で消す）
    body.setBounce(this.maxBounces > 0 ? 1 : 0);
    this.scene.physics.velocityFromRotation(angle, speed, body.velocity);
  }

  kill(): void {
    this.disableBody(true, true);
  }

  /** 寿命が尽きたら true */
  tick(dt: number): boolean {
    if (this.accelLeft > 0) {
      this.accelLeft = Math.max(0, this.accelLeft - dt);
      const k = this.startRatio + (1 - this.startRatio) * (1 - this.accelLeft / this.accelTime);
      const body = this.body as Phaser.Physics.Arcade.Body;
      body.velocity.setLength(this.topSpeed * k);
    }
    this.life -= dt;
    if (this.life <= 0) {
      this.kill();
      return true;
    }
    return false;
  }
}

export function createBulletGroup(scene: Phaser.Scene, texture: string, max: number): Phaser.Physics.Arcade.Group {
  return scene.physics.add.group({
    classType: Bullet,
    defaultKey: texture,
    maxSize: max,
    runChildUpdate: false,
  });
}

export function spawnBullet(group: Phaser.Physics.Arcade.Group, texture: string): Bullet | null {
  const b = group.get(0, 0, texture) as Bullet | null;
  if (b) b.setTexture(texture);
  return b;
}

export function tickBullets(group: Phaser.Physics.Arcade.Group, dt: number, onExpire?: (b: Bullet) => void): void {
  for (const obj of group.getChildren()) {
    const b = obj as Bullet;
    if (b.active && b.tick(dt)) onExpire?.(b);
  }
}
