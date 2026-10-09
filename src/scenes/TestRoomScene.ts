// テスト部屋: 1部屋でウェーブが続く。相殺や武器の手触りの調整用。

import Phaser from 'phaser';
import { TEST_ROOM, TEST_ROOM_WEAPONS } from '../config/balance';
import type { Enemy } from '../game/Enemy';
import { WeaponSystem } from '../game/WeaponSystem';
import { CombatScene, newRunState, type RunState } from './CombatScene';

export class TestRoomScene extends CombatScene {
  private waveIndex = 0;
  private waveTimer = 0;
  private waveActive = false;
  private wallRects: Phaser.Geom.Rectangle[] = [];

  constructor() {
    super('TestRoom');
  }

  init(data: { run?: RunState }): void {
    // テスト部屋ではすべての武器を持つ
    const run = data.run ?? newRunState();
    if (!data.run) run.weapons = new WeaponSystem(TEST_ROOM_WEAPONS);
    super.init({ run });
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
    this.wallRects = [];
    const T = 32;
    const wall = (x: number, y: number, w: number, h: number) => {
      const r = this.add.tileSprite(x + w / 2, y + h / 2, w, h, 'wall');
      this.physics.add.existing(r, true);
      walls.add(r);
      this.wallRects.push(new Phaser.Geom.Rectangle(x, y, w, h));
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
        this.resetRoomCounters();
      }
    }
  }

  protected onEnemyKilled(e: Enemy): void {
    if (e.def.behavior === 'boss') this.clearBossLeftovers();
    // 部屋（ウェーブ）の全滅: 残った予告はすべて消える。テスト部屋では弾も補充
    if (this.waveActive && this.enemiesAlive === 0) {
      this.waveActive = false;
      this.waveTimer = TEST_ROOM.waveDelay;
      this.queue.clearAll();
      this.weapons.refillAll();
    }
  }

  protected isOpenAt(x: number, y: number): boolean {
    return !this.wallRects.some((r) => Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(r), 20, 20).contains(x, y));
  }

  protected blocksSight(x: number, y: number): boolean {
    return this.wallRects.some((r) => r.contains(x, y));
  }

  protected restartAfterDeath(): void {
    this.scene.restart({});
  }

  protected infoLines(): string[] {
    return [`テスト部屋  ウェーブ ${this.waveIndex}`];
  }

  protected helpLines(): string[] {
    return [...super.helpLines(), 'テスト用: 1 直進撃ち / 2 突進 / 3 扇撃ち / 4 自爆型 / 5 迫撃砲 / 6 狙撃エリート / 7 ボス を出す / I 宝箱 / H この表示を切替'];
  }

  protected onDebugKey(code: string): void {
    const keys: Record<string, string> = { Digit1: 'shooter', Digit2: 'charger', Digit3: 'fan', Digit4: 'bomber', Digit5: 'mortar', Digit6: 'sniper', Digit7: 'boss' };
    if (keys[code]) this.spawnRandom(keys[code]);
    else if (code === 'KeyI') this.openChest();
  }
}
