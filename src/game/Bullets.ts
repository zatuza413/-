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
  /** 撃った時点の武器固有の倍率（マシンガン） */
  rateMult = 1;
  /** 早撃ちの弾帯で強化された弾倉の弾 */
  boosted = false;
  /** 壁で跳ねた回数と上限（跳弾銃） */
  bounces = 0;
  maxBounces = 0;
  /** かすめの判定: 0 まだ / 1 近くにいる / 2 判定済み */
  graze: 0 | 1 | 2 = 0;

  fire(x: number, y: number, angle: number, speed: number, opts: { damage: number; life: number; ownerId?: number; weapon?: WeaponDef; big?: boolean; rateMult?: number; boosted?: boolean; maxBounces?: number; tint?: number; scale?: number; hitRadius: number }): void {
    this.enableBody(true, x, y, true, true);
    this.setRotation(angle);
    this.damage = opts.damage;
    this.life = opts.life;
    this.ownerId = opts.ownerId ?? -1;
    this.weapon = opts.weapon ?? null;
    this.big = opts.big ?? false;
    this.rateMult = opts.rateMult ?? 1;
    this.boosted = opts.boosted ?? false;
    this.bounces = 0;
    this.maxBounces = opts.maxBounces ?? 0;
    this.graze = 0;
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
