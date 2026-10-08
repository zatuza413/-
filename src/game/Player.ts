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
  /** 落とし穴から戻すための安全な位置 */
  safeX = 0;
  safeY = 0;

  private keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

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
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D') as Player['keys'];
  }

  get isDashing(): boolean {
    return this.dashTime > 0;
  }

  /** ダッシュを試みる。無敵も硬直もない */
  tryDash(): boolean {
    if (this.dashCooldown > 0 || this.isDashing) return false;
    const move = this.readMove();
    if (move.lengthSq() > 0) this.dashDir.copy(move);
    else this.dashDir.setToPolar(this.aim, 1);
    this.dashTime = PLAYER.dash.duration;
    this.dashCooldown = PLAYER.dash.cooldown;
    return true;
  }

  private readMove(): Phaser.Math.Vector2 {
    const v = new Phaser.Math.Vector2(
      (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0),
      (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0),
    );
    return v.lengthSq() > 0 ? v.normalize() : v;
  }

  tick(dt: number, aimX: number, aimY: number): void {
    this.aim = Phaser.Math.Angle.Between(this.x, this.y, aimX, aimY);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    const body = this.body as Phaser.Physics.Arcade.Body;

    if (this.isDashing) {
      this.dashTime -= dt;
      body.setVelocity(this.dashDir.x * PLAYER.dash.speed, this.dashDir.y * PLAYER.dash.speed);
      this.setScale(1.15, 0.85);
      this.setRotation(Math.atan2(this.dashDir.y, this.dashDir.x));
    } else {
      const move = this.readMove();
      body.setVelocity(move.x * PLAYER.speed, move.y * PLAYER.speed);
      this.setScale(1);
      this.setRotation(this.aim);
    }
  }
}
