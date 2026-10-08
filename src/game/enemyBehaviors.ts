// 敵の行動パターン。EnemyDef.behavior の値でここから選ばれる。
// 新しい敵を足すときは、関数を1つ追加して BEHAVIORS に登録し、balance.ts の ENEMIES に定義を書く。

import Phaser from 'phaser';
import type { EnemyBehaviorId } from '../core/types';
import type { Enemy } from './Enemy';

export interface EnemyContext {
  playerX: number;
  playerY: number;
  /** 敵弾を撃つ */
  fire(enemy: Enemy, angle: number, speed: number): void;
}

type Behavior = (e: Enemy, ctx: EnemyContext, dt: number) => void;

function body(e: Enemy): Phaser.Physics.Arcade.Body {
  return e.body as Phaser.Physics.Arcade.Body;
}

/** 直進弾を撃つ雑魚: 距離を保ちつつ横移動し、予備動作のあと自機へ1発 */
const shooter: Behavior = (e, ctx, dt) => {
  const p = e.def.params;
  const dx = ctx.playerX - e.x;
  const dy = ctx.playerY - e.y;
  const dist = Math.hypot(dx, dy);
  const toPlayer = Math.atan2(dy, dx);

  // 移動: 好みの距離へ寄りつつ、ゆっくり周回する
  if (e.ai === 'idle') {
    e.setAi('move');
    e.dir = Math.random() < 0.5 ? 1 : -1;
  }
  const radial = dist > p.preferredRange + 30 ? 1 : dist < p.preferredRange - 30 ? -1 : 0;
  const strafe = toPlayer + (Math.PI / 2) * e.dir;
  const vx = Math.cos(toPlayer) * radial + Math.cos(strafe) * 0.6;
  const vy = Math.sin(toPlayer) * radial + Math.sin(strafe) * 0.6;
  const len = Math.hypot(vx, vy) || 1;
  if (e.aiTime > 2.5) {
    e.dir *= -1;
    e.aiTime = 0;
  }

  e.timer += dt;
  const untilFire = p.fireInterval - e.timer;
  if (untilFire <= p.telegraph) {
    // 予備動作中は止まる
    body(e).setVelocity(0, 0);
    e.telegraph = { type: 'flash', angle: toPlayer, progress: 1 - untilFire / p.telegraph, length: 0 };
  } else {
    body(e).setVelocity((vx / len) * e.def.speed, (vy / len) * e.def.speed);
  }
  if (e.timer >= p.fireInterval) {
    e.timer = 0;
    ctx.fire(e, toPlayer, p.bulletSpeed);
  }
};

/** 突進してくる近接型: 近づく → 構え（方向固定）→ 突進 → 硬直 */
const charger: Behavior = (e, ctx) => {
  const p = e.def.params;
  const toPlayer = Math.atan2(ctx.playerY - e.y, ctx.playerX - e.x);
  const dist = Phaser.Math.Distance.Between(e.x, e.y, ctx.playerX, ctx.playerY);
  const b = body(e);

  switch (e.ai) {
    case 'idle':
    case 'approach':
      if (e.ai === 'idle') e.setAi('approach');
      e.contactActive = true;
      b.setVelocity(Math.cos(toPlayer) * e.def.speed, Math.sin(toPlayer) * e.def.speed);
      if (dist < p.triggerRange && e.aiTime > 0.5) {
        e.setAi('windup');
        e.dir = toPlayer;
      }
      break;
    case 'windup':
      b.setVelocity(0, 0);
      // 構えの前半は自機を追って向きを変え、後半は固定（避ける猶予）
      if (e.aiTime < p.windup * 0.5) e.dir = toPlayer;
      e.telegraph = { type: 'line', angle: e.dir, progress: e.aiTime / p.windup, length: p.chargeSpeed * p.chargeTime };
      if (e.aiTime >= p.windup) e.setAi('charge');
      break;
    case 'charge':
      b.setVelocity(Math.cos(e.dir) * p.chargeSpeed, Math.sin(e.dir) * p.chargeSpeed);
      if (e.aiTime >= p.chargeTime || b.blocked.left || b.blocked.right || b.blocked.up || b.blocked.down) {
        e.setAi('recover');
      }
      break;
    case 'recover':
      b.setVelocity(0, 0);
      if (e.aiTime >= p.recover) e.setAi('approach');
      break;
  }
};

export const BEHAVIORS: Record<EnemyBehaviorId, Behavior> = {
  shooter,
  charger,
};
