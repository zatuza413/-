// 敵の行動パターン。EnemyDef.behavior の値でここから選ばれる。
// 新しい敵を足すときは、関数を1つ追加して BEHAVIORS に登録し、balance.ts の ENEMIES に定義を書く。
// 攻撃の前には必ず予備動作（光る・線・着弾予告）を見せる。

import Phaser from 'phaser';
import { BOSS } from '../config/balance';
import { stepRepel } from '../core/rules';
import type { EnemyBehaviorId } from '../core/types';
import type { Enemy } from './Enemy';

export interface EnemyContext {
  playerX: number;
  playerY: number;
  /** 敵弾を撃つ */
  fire(enemy: Enemy, angle: number, speed: number, opts?: { big?: boolean; accel?: boolean; sturdy?: boolean; life?: number }): void;
  /** ボス: 雑魚を予告つきで召喚する（hp を渡すとその HP で出す） */
  summon(enemy: Enemy, id: string, count: number, hp?: number): void;
  /** ボス: 避けられない全方位の波を出す（warn 秒の予告のあと広がる） */
  pulse(enemy: Enemy): void;
  /** 迫撃砲: (x, y) に着弾予告を出し、時間がたつと爆発する */
  lobShell(enemy: Enemy, x: number, y: number): void;
  /** 2点の間に壁・柱が無いか */
  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean;
}

type Behavior = (e: Enemy, ctx: EnemyContext, dt: number) => void;

function body(e: Enemy): Phaser.Physics.Arcade.Body {
  return e.body as Phaser.Physics.Arcade.Body;
}

/** 好みの距離へ寄りつつ、ゆっくり周回する移動。2.5秒ごとに周回の向きを変える */
function orbit(e: Enemy, ctx: EnemyContext, preferredRange: number, speed = e.def.speed): void {
  const dx = ctx.playerX - e.x;
  const dy = ctx.playerY - e.y;
  const dist = Math.hypot(dx, dy);
  const toPlayer = Math.atan2(dy, dx);
  if (e.ai === 'idle') {
    e.setAi('move');
    e.dir = Math.random() < 0.5 ? 1 : -1;
  }
  const radial = dist > preferredRange + 30 ? 1 : dist < preferredRange - 30 ? -1 : 0;
  const strafe = toPlayer + (Math.PI / 2) * e.dir;
  const vx = Math.cos(toPlayer) * radial + Math.cos(strafe) * 0.6;
  const vy = Math.sin(toPlayer) * radial + Math.sin(strafe) * 0.6;
  const len = Math.hypot(vx, vy) || 1;
  if (e.aiTime > 2.5) {
    e.dir *= -1;
    e.aiTime = 0;
  }
  body(e).setVelocity((vx / len) * speed, (vy / len) * speed);
}

/**
 * 弾を撃つ雑魚（直進撃ち・扇撃ち）: 距離を保って周回し、光ってから撃つ。
 * params.count > 1 なら spreadDeg の扇状に撃つ。
 */
const shooter: Behavior = (e, ctx, dt) => {
  const p = e.def.params;
  const toPlayer = Math.atan2(ctx.playerY - e.y, ctx.playerX - e.x);
  e.timer += dt;
  const untilFire = p.fireInterval - e.timer;
  if (untilFire <= p.telegraph) {
    // 予備動作中は止まる
    body(e).setVelocity(0, 0);
    e.telegraph = { type: 'flash', angle: toPlayer, progress: 1 - untilFire / p.telegraph, length: 0 };
  } else {
    orbit(e, ctx, p.preferredRange);
  }
  if (e.timer >= p.fireInterval) {
    e.timer = 0;
    const n = p.count ?? 1;
    const spread = ((p.spreadDeg ?? 0) * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? toPlayer : toPlayer - spread / 2 + (spread * i) / (n - 1);
      ctx.fire(e, a, p.bulletSpeed);
    }
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

/** 自爆型: まっすぐ近づいてくる。倒すと弾をばらまく（ばらまきは CombatScene が行う） */
const bomber: Behavior = (e, ctx) => {
  const toPlayer = Math.atan2(ctx.playerY - e.y, ctx.playerX - e.x);
  // 少し蛇行させて、撃ち抜きにくくする
  const wobble = Math.sin(e.age * 5) * 0.35;
  body(e).setVelocity(Math.cos(toPlayer + wobble) * e.def.speed, Math.sin(toPlayer + wobble) * e.def.speed);
};

/** 迫撃砲型: 遠めを保ち、一定間隔で自機の位置へ曲射。自機が近すぎると撃たない */
const mortar: Behavior = (e, ctx, dt) => {
  const p = e.def.params;
  orbit(e, ctx, p.preferredRange);
  e.timer += dt;
  if (e.timer < p.fireInterval) return;
  const dist = Phaser.Math.Distance.Between(e.x, e.y, ctx.playerX, ctx.playerY);
  if (dist < p.minRange) return; // 撃てる距離になるまで待つ
  e.timer = 0;
  e.telegraph = { type: 'flash', angle: 0, progress: 0, length: 0 };
  ctx.lobShell(e, ctx.playerX, ctx.playerY);
};

/**
 * 狙撃エリート: 射線が通っていれば照準線を出し、最後に向きを固定して高速弾を撃つ。
 * 撃ったあとは自機から離れる向きに後退し、柱の陰に入って射線を切る。
 */
const sniper: Behavior = (e, ctx, dt) => {
  const p = e.def.params;
  const toPlayer = Math.atan2(ctx.playerY - e.y, ctx.playerX - e.x);
  const dist = Phaser.Math.Distance.Between(e.x, e.y, ctx.playerX, ctx.playerY);
  const los = ctx.hasLineOfSight(e.x, e.y, ctx.playerX, ctx.playerY);
  const b = body(e);
  e.timer += dt;

  switch (e.ai) {
    case 'idle':
    case 'move':
      orbit(e, ctx, p.preferredRange, e.def.speed * 0.7);
      if (los && e.timer >= p.cooldown) {
        e.setAi('aim');
        e.aimAngle = toPlayer;
      }
      break;
    case 'aim': {
      b.setVelocity(0, 0);
      // 射線が切れたら撃たない
      if (!los && e.aiTime < p.aimTime - p.lockTime) {
        e.setAi('move');
        break;
      }
      if (e.aiTime < p.aimTime - p.lockTime) e.aimAngle = toPlayer;
      e.telegraph = { type: 'line', angle: e.aimAngle, progress: e.aiTime / p.aimTime, length: Math.max(dist + 80, 400), sniper: true };
      if (e.aiTime >= p.aimTime) {
        ctx.fire(e, e.aimAngle, p.bulletSpeed, { big: true });
        e.timer = 0;
        e.setAi('retreat');
      }
      break;
    }
    case 'retreat': {
      // 自機から離れつつ、射線が切れる向き（横）にずれる
      const away = toPlayer + Math.PI + (los ? 0.6 * (e.dir > 0 ? 1 : -1) : 0);
      b.setVelocity(Math.cos(away) * e.def.speed, Math.sin(away) * e.def.speed);
      if (e.aiTime >= p.retreatTime) e.setAi('move');
      break;
    }
  }
};

/**
 * ボス: HP の割合で3段階に切り替わる。弾は初速60%から加速する（避けやすくするため）。
 * 一定間隔で雑魚を召喚し、相殺の手段を常に用意する。
 */
const boss: Behavior = (e, ctx, dt) => {
  const m = e.mem;
  const ratio = e.hp / e.maxHp;
  const phase = ratio > BOSS.p1.until ? 1 : ratio > BOSS.p2.until ? 2 : 3;
  if (m.phase !== phase) {
    // 段階が変わったらタイマーを仕切り直す（少し間を置く）
    m.phase = phase;
    m.ring = 0;
    m.summon = phase === 3 ? 0 : -1.5;
    m.arm = 0;
    m.aimed = -1;
    m.pulse = BOSS.p3.pulseEvery - 2;
  }
  const toPlayer = Math.atan2(ctx.playerY - e.y, ctx.playerX - e.x);
  // ゆっくり自機の周りを回る（P3 は速くなる）
  orbit(e, ctx, 230, e.def.speed * (phase === 3 ? BOSS.p3.speedMult : 1));
  // ボス本体の弾はすべて硬い弾（衝撃波・爆風で消えない）
  const fire = (a: number, speed: number) => ctx.fire(e, a, speed, { accel: true, sturdy: true });

  // 張り付きへの返し: 近くに居続けると光ってから、至近だけに届く硬い弾の輪
  const R = BOSS.repel;
  const rep = stepRepel(e.repel, Math.hypot(ctx.playerX - e.x, ctx.playerY - e.y), dt, R);
  if (rep.fire) {
    const off = Math.random() * Math.PI * 2;
    for (let i = 0; i < R.count; i++) ctx.fire(e, off + (i / R.count) * Math.PI * 2, R.speed, { sturdy: true, life: R.life });
  }

  if (phase === 1) {
    const P = BOSS.p1;
    m.ring += dt;
    if (m.ring >= P.ringInterval - 0.25) e.telegraph = { type: 'flash', angle: 0, progress: (m.ring - (P.ringInterval - 0.25)) / 0.25, length: 0 };
    if (m.ring >= P.ringInterval) {
      m.ring = 0;
      const off = Math.random() * Math.PI * 2;
      for (let i = 0; i < P.ring; i++) fire(off + (i / P.ring) * Math.PI * 2, P.ringSpeed);
    }
    m.summon += dt;
    if (m.summon >= P.summonEvery) {
      m.summon = 0;
      ctx.summon(e, P.summonId, P.summonCount);
    }
  } else if (phase === 2) {
    const P = BOSS.p2;
    m.armAngle = (m.armAngle ?? 0) + P.armSpin * dt;
    m.arm += dt;
    if (m.arm >= P.armInterval) {
      m.arm = 0;
      for (let i = 0; i < P.arms; i++) fire(m.armAngle + (i / P.arms) * Math.PI * 2, P.armSpeed);
    }
    m.aimed += dt;
    if (m.aimed >= P.aimedEvery) {
      m.aimed = 0;
      const sp = (P.aimedSpreadDeg * Math.PI) / 180;
      for (let i = 0; i < P.aimedCount; i++) fire(toPlayer - sp / 2 + (sp * i) / (P.aimedCount - 1), P.aimedSpeed);
    }
    m.summon += dt;
    if (m.summon >= P.summonEvery) {
      m.summon = 0;
      ctx.summon(e, P.summonId, P.summonCount);
    }
  } else {
    const P = BOSS.p3;
    m.pulse += dt;
    if (m.pulse >= P.pulseEvery) {
      m.pulse = 0;
      ctx.pulse(e);
      // 種類の違う雑魚を1体ずつ（相殺と連鎖の材料）
      for (const id of P.minionIds) ctx.summon(e, id, 1, P.minionHp);
    }
    // 逆回転の二重らせん（波の予告中と直後は止めて、波を読みやすくする）
    m.spiralA = (m.spiralA ?? 0) + P.spiralSpin * dt;
    m.spiral = (m.spiral ?? 0) + dt;
    const calm = m.pulse > P.pulseEvery - P.pulseWarn - 0.5 || m.pulse < 1.2;
    if (m.spiral >= P.spiralInterval && !calm) {
      m.spiral = 0;
      const a = m.spiralA;
      for (const ang of [a, a + Math.PI, -a + Math.PI / 2, -a - Math.PI / 2]) fire(ang, P.spiralSpeed);
    }
    // 波の合間は自機狙いの3方向で圧をかける
    m.aimed += dt;
    if (m.aimed >= P.aimedEvery) {
      m.aimed = 0;
      const A = BOSS.p2;
      const sp = (A.aimedSpreadDeg * Math.PI) / 180;
      for (let i = 0; i < A.aimedCount; i++) fire(toPlayer - sp / 2 + (sp * i) / (A.aimedCount - 1), A.aimedSpeed);
    }
  }
  // 返しの予告は他の予告より優先して見せる
  if (rep.warnProgress !== null) e.telegraph = { type: 'repel', angle: 0, progress: rep.warnProgress, length: R.speed * R.life + e.def.radius };
};

export const BEHAVIORS: Record<EnemyBehaviorId, Behavior> = {
  boss,
  shooter,
  charger,
  bomber,
  mortar,
  sniper,
};
