import Phaser from 'phaser';
import { PLAYER } from '../config/balance';

export class Player extends Phaser.Physics.Arcade.Image {
  hp: number = PLAYER.maxHp;
  maxHp: number = PLAYER.maxHp;

  /** ダッシュの残り時間（秒） */
  dashTime = 0;
  /** ダッシュのクールダウン残り（秒） */
  dashCooldown = 0;
  private dashDir = new Phaser.Math.Vector2();

  /** 照準角 */
  aim = 0;
  /** 押し返し（接触時）の速度と残り時間 */
  private pushVel = new Phaser.Math.Vector2();
  private pushTime = 0;
  /** 落とし穴から戻すための安全な位置 */
  safeX = 0;
  safeY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    const r = PLAYER.hitRadius;
    body.setCircle(r, this.width / 2 - r, this.height / 2 - r);
    body.setCollideWorldBounds(true);
    this.setDepth(10);
    this.safeX = x;
    this.safeY = y;
  }

  get isDashing(): boolean {
    return this.dashTime > 0;
  }

  /** ダッシュを試みる。無敵も硬直もない。move は移動入力（長さ0なら照準方向へ） */
  tryDash(move: Phaser.Math.Vector2): boolean {
    if (this.dashCooldown > 0 || this.isDashing) return false;
    if (move.lengthSq() > 0) this.dashDir.copy(move).normalize();
    else this.dashDir.setToPolar(this.aim, 1);
    this.dashTime = PLAYER.dash.duration;
    this.dashCooldown = PLAYER.dash.cooldown;
    return true;
  }

  /** 押し返す。dx, dy の移動を time 秒かけて行う（壁は抜けない） */
  push(dx: number, dy: number, time: number): void {
    this.pushVel.set(dx / time, dy / time);
    this.pushTime = time;
  }

  /** move: 移動入力（長さ0〜1。スティックの倒し具合で速度が変わる）、aim: 照準角 */
  tick(dt: number, move: Phaser.Math.Vector2, aim: number): void {
    this.aim = aim;
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    const body = this.body as Phaser.Physics.Arcade.Body;

    if (this.pushTime > 0) {
      this.pushTime -= dt;
      body.setVelocity(this.pushVel.x, this.pushVel.y);
    } else if (this.isDashing) {
      this.dashTime -= dt;
      body.setVelocity(this.dashDir.x * PLAYER.dash.speed, this.dashDir.y * PLAYER.dash.speed);
      this.setScale(1.15, 0.85);
      this.setRotation(Math.atan2(this.dashDir.y, this.dashDir.x));
    } else {
      body.setVelocity(move.x * PLAYER.speed, move.y * PLAYER.speed);
      this.setScale(1);
      this.setRotation(this.aim);
    }
  }
}
