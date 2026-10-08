// テスト部屋: 1部屋でウェーブが続く。相殺や武器の手触りの調整用。

import Phaser from 'phaser';
import { TEST_ROOM } from '../config/balance';
import { CombatScene } from './CombatScene';

export class TestRoomScene extends CombatScene {
  private waveIndex = 0;
  private waveTimer = 0;
  private waveActive = false;

  constructor() {
    super('TestRoom');
  }

  protected buildWorld(): { x: number; y: number } {
    this.waveIndex = 0;
    this.waveTimer = 1.0;
    this.waveActive = false;

    const W = TEST_ROOM.width;
    const H = TEST_ROOM.height;
    this.physics.world.setBounds(0, 0, W, H);
    this.cameras.main.setBounds(0, 0, W, H);
    this.add.grid(W / 2, H / 2, W, H, 64, 64, 0x191926, 1, 0x222233, 1).setDepth(-10);

    const walls = this.physics.add.staticGroup();
    const T = 32;
    const wall = (x: number, y: number, w: number, h: number) => {
      const r = this.add.tileSprite(x + w / 2, y + h / 2, w, h, 'wall');
      this.physics.add.existing(r, true);
      walls.add(r);
    };
    wall(0, 0, W, T);
    wall(0, H - T, W, T);
    wall(0, 0, T, H);
    wall(W - T, 0, T, H);
    // 遮蔽物
    wall(W * 0.25 - 32, H * 0.3, 64, 64);
    wall(W * 0.75 - 32, H * 0.3, 64, 64);
    wall(W * 0.25 - 32, H * 0.7 - 64, 64, 64);
    wall(W * 0.75 - 32, H * 0.7 - 64, 64, 64);
    this.addWalls(walls);

    this.addHazard('fire', new Phaser.Geom.Rectangle(W * 0.5 - 300, H * 0.5 - 40, 140, 80));
    this.addHazard('pit', new Phaser.Geom.Rectangle(W * 0.5 + 160, H * 0.5 - 40, 120, 80));
    return { x: W / 2, y: H / 2 + 120 };
  }

  private spawnRandom(id: string): void {
    const area = new Phaser.Geom.Rectangle(80, 80, TEST_ROOM.width - 160, TEST_ROOM.height - 160);
    const p = this.randomSpawnPoint(area, 300);
    this.spawnEnemy(id, p.x, p.y);
  }

  protected updateWorld(dt: number): void {
    if (!this.waveActive) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        const wave = TEST_ROOM.waves[this.waveIndex % TEST_ROOM.waves.length];
        this.waveIndex++;
        for (const id of wave) this.spawnRandom(id);
        this.waveActive = true;
      }
    }
  }

  protected onEnemyKilled(): void {
    // 部屋（ウェーブ）の全滅: 残った予告はすべて消える。テスト部屋では弾も補充
    if (this.waveActive && this.enemiesAlive === 0) {
      this.waveActive = false;
      this.waveTimer = TEST_ROOM.waveDelay;
      this.queue.clearAll();
      this.weapons.refillAll();
    }
  }

  protected restartAfterDeath(): void {
    this.scene.restart({});
  }

  protected infoLines(): string[] {
    return [`テスト部屋  ウェーブ ${this.waveIndex}`];
  }

  protected helpLines(): string[] {
    return [...super.helpLines(), 'テスト用: 1 直進撃ち出現 / 2 突進出現 / H この表示を切替'];
  }

  protected onDebugKey(code: string): void {
    if (code === 'Digit1') this.spawnRandom('shooter');
    else if (code === 'Digit2') this.spawnRandom('charger');
  }
}
