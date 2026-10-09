import Phaser from 'phaser';
import { ENEMY_SPAWN_GRACE } from '../config/balance';
import type { EnemyDef } from '../core/types';
import { BEHAVIORS, type EnemyContext } from './enemyBehaviors';

let nextEnemyId = 1;

export class Enemy extends Phaser.Physics.Arcade.Image {
  readonly uid: number;
  readonly def: EnemyDef;
  hp: number;
  /** 最大HP（フロアでHPが変わるボスなど。割合の計算に使う） */
  maxHp: number;
  /** 出現からの経過（秒） */
  age = 0;
  /** 行動ごとの状態（behavior が自由に使う） */
  ai: string = 'idle';
  aiTime = 0;
  timer = 0;
  dir = 0;
  /** 狙いの角度（狙撃の照準など） */
  aimAngle = 0;
  /** 行動ごとの自由な記録（ボスのタイマーなど） */
  mem: Record<string, number> = {};
  /** ボスに召喚された雑魚（撃破0.5ポイント、与ダメージのポイント半分、通貨なし） */
  summoned = false;
  /** 予備動作の表示（描画は CombatScene がまとめて行う）。sniper は細い照準線 */
  telegraph: { type: 'flash' | 'line'; angle: number; progress: number; length: number; sniper?: boolean } | null = null;
  /** 突進中など、接触ダメージが有効か */
  contactActive = true;
  /** 衝撃波などでのけぞっている残り時間（秒）。この間は行動しない */
  stun = 0;
  /** 被弾フラッシュ用 */
  private hurtFlash = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, def: EnemyDef) {
    super(scene, x, y, `enemy_${def.id}`);
    this.uid = nextEnemyId++;
    this.def = def;
    this.hp = def.hp;
    this.maxHp = def.hp;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(def.radius, this.width / 2 - def.radius, this.height / 2 - def.radius);
    body.setCollideWorldBounds(true);
    this.setDepth(5);
    this.timer = Math.random() * (def.params.initialDelayJitter ?? 0);
    // 出現演出
    this.setScale(0.1);
    scene.tweens.add({ targets: this, scale: 1, duration: 250, ease: 'Back.Out' });
  }

  get isSpawning(): boolean {
    return this.age < ENEMY_SPAWN_GRACE;
  }

  setAi(s: string): void {
    this.ai = s;
    this.aiTime = 0;
  }

  knockback(fromX: number, fromY: number, power: number, stun = 0.35): void {
    const a = Math.atan2(this.y - fromY, this.x - fromX);
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(a) * power, Math.sin(a) * power);
    this.stun = stun;
    // 突進などの状態は仕切り直し
    this.setAi('idle');
  }

  /** ダメージを受ける。倒れたら true */
  damage(amount: number): boolean {
    this.hp -= amount;
    this.hurtFlash = 0.06;
    return this.hp <= 0;
  }

  tick(dt: number, ctx: EnemyContext): void {
    this.age += dt;
    this.aiTime += dt;
    this.telegraph = null;
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (this.isSpawning) {
      body.setVelocity(0, 0);
    } else if (this.stun > 0) {
      this.stun -= dt;
      body.velocity.scale(Math.pow(0.02, dt));
    } else {
      BEHAVIORS[this.def.behavior](this, ctx, dt);
    }

    this.hurtFlash -= dt;
    // behavior 内で書き換わるので型の絞り込みを外す
    const tg = this.telegraph as Enemy['telegraph'];
    if (this.hurtFlash > 0) this.setTintFill(0xffffff);
    else if (tg?.type === 'flash' && Math.floor(tg.progress * 6) % 2 === 0) this.setTint(0xffffff);
    else this.clearTint();
    if (this.isSpawning) this.setAlpha(0.5);
    else this.setAlpha(1);
  }
}
