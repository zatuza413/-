// 本編のフロア。部屋に入ると扉が閉まり、全滅で開く（残った予告はすべて消える）。
// ボス部屋をクリアすると階段が出て次のフロアへ。最後のフロアならクリア。

import Phaser from 'phaser';
import { FLOOR, TILE } from '../config/balance';
import { generateFloor, TILE_FLOOR, type FloorLayout, type RoomSpec } from '../core/floorGen';
import { createRng, pick, randInt } from '../core/rng';
import { Sfx } from '../game/Sfx';
import { telemetry } from '../game/telemetryStore';
import { CombatScene } from './CombatScene';

/** タイルセット 'tiles' の並び */
const T_VOID = 0;
const T_FLOOR = 1;
const T_WALL = 2;
const T_DOOR = 3;

interface RoomState {
  spec: RoomSpec;
  /** 床の範囲 (px) */
  area: Phaser.Geom.Rectangle;
  /** 「部屋に入った」と判定する範囲。扉の上で閉じ込めないよう内側に寄せる */
  inner: Phaser.Geom.Rectangle;
  visited: boolean;
  cleared: boolean;
}

const ROOM_LABEL: Partial<Record<RoomSpec['type'], string>> = {
  shop: 'ショップ（段階5で実装）',
  treasure: '宝箱',
  boss: 'ボス部屋',
};

export class FloorScene extends CombatScene {
  private layout!: FloorLayout;
  private layer!: Phaser.Tilemaps.TilemapLayer;
  private rooms: RoomState[] = [];
  private current: RoomState | null = null;
  /** 戦闘中の部屋（扉が閉まっている） */
  private fighting: RoomState | null = null;
  private chests: Array<{ obj: Phaser.GameObjects.Container; opened: boolean }> = [];
  private stairs: Phaser.GameObjects.Container | null = null;
  private minimap!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Floor');
  }

  protected buildWorld(): { x: number; y: number } {
    this.rooms = [];
    this.current = null;
    this.fighting = null;
    this.chests = [];
    this.stairs = null;
    this.recordTelemetry = true;
    if (!this.run.telemetryStarted) {
      telemetry.startRun();
      this.run.telemetryStarted = true;
    }

    const seed = (Math.random() * 2 ** 31) | 0;
    this.layout = generateFloor(createRng(seed), FLOOR.gen);
    const L = this.layout;
    const W = L.width * TILE;
    const H = L.height * TILE;
    this.physics.world.setBounds(0, 0, W, H);
    this.cameras.main.setBounds(0, 0, W, H);

    // タイルマップ（床の周り1マスを壁として描く。その外は虚空。どちらも通れない）
    const data: number[][] = [];
    for (let y = 0; y < L.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < L.width; x++) {
        if (L.tiles[y * L.width + x] === TILE_FLOOR) row.push(T_FLOOR);
        else row.push(this.nearFloor(x, y) ? T_WALL : T_VOID);
      }
      data.push(row);
    }
    const map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0)!;
    this.layer = map.createLayer(0, tileset, 0, 0)!.setDepth(-10);
    this.layer.setCollision([T_VOID, T_WALL, T_DOOR]);
    this.addWalls(this.layer);

    for (const spec of L.rooms) {
      const r = spec.rect;
      const area = new Phaser.Geom.Rectangle(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      const inner = Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(area), -TILE * 1.5, -TILE * 1.5);
      const peaceful = spec.type === 'start' || spec.type === 'treasure' || spec.type === 'shop';
      const state: RoomState = { spec, area, inner, visited: false, cleared: peaceful };
      this.rooms.push(state);

      for (const h of spec.hazards) {
        this.addHazard(h.kind, new Phaser.Geom.Rectangle(h.rect.x * TILE, h.rect.y * TILE, h.rect.w * TILE, h.rect.h * TILE));
      }
      const label = ROOM_LABEL[spec.type];
      if (label && spec.type !== 'treasure') {
        this.add.text(area.centerX, area.y + 28, label, { fontFamily: 'sans-serif', fontSize: '16px', color: '#8888aa' }).setOrigin(0.5).setDepth(-4);
      }
      if (spec.type === 'treasure') this.addChest(area.centerX, area.centerY);
    }

    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(150);

    const start = this.rooms[L.startId].area;
    this.add
      .text(start.centerX, start.centerY - 60, `フロア ${this.run.floor}`, { fontFamily: 'sans-serif', fontSize: '28px', fontStyle: 'bold', color: '#ffe066' })
      .setOrigin(0.5)
      .setDepth(-4);
    return { x: start.centerX, y: start.centerY };
  }

  private nearFloor(x: number, y: number): boolean {
    const L = this.layout;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < L.width && ny < L.height && L.tiles[ny * L.width + nx] === TILE_FLOOR) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ 部屋

  private setDoors(room: RoomState, closed: boolean): void {
    for (const d of room.spec.doors) this.layer.putTileAt(closed ? T_DOOR : T_FLOOR, d.x, d.y);
  }

  private enterRoom(room: RoomState): void {
    room.visited = true;
    if (room.cleared) return;

    // 扉を閉めて敵を出す
    const cfg = FLOOR.enemies;
    const floor = this.run.floor;
    let n = cfg.base + cfg.perFloor * (floor - 1) + randInt(Math.random, 0, cfg.random);
    if (room.spec.type === 'boss') n = Math.round(n * cfg.bossRoomMultiplier);
    const pool = FLOOR.enemyPool[Math.min(floor, FLOOR.enemyPool.length) - 1];
    const area = Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(room.area), -TILE * 2, -TILE * 2);
    for (let i = 0; i < n; i++) {
      const p = this.randomSpawnPoint(area, FLOOR.spawnMinDistance);
      this.spawnEnemy(pick(Math.random, pool), p.x, p.y);
    }
    this.setDoors(room, true);
    this.fighting = room;
    telemetry.startRoom(this.run.floor, room.spec.type, this.controls.touchMode ? 'touch' : 'pc');
    this.cameras.main.shake(120, 0.003);
  }

  protected onEnemyKilled(): void {
    const room = this.fighting;
    if (!room || this.enemiesAlive > 0) return;
    // 全滅: 扉が開き、残っている予告はすべて消える
    room.cleared = true;
    this.fighting = null;
    this.setDoors(room, false);
    this.queue.clearAll();
    telemetry.endRoom();
    if (room.spec.type === 'boss') this.spawnStairs(room.area.centerX, room.area.centerY);
  }

  private addChest(x: number, y: number): void {
    const box = this.add.rectangle(0, 0, 34, 24, 0xc8902a).setStrokeStyle(2, 0xffe08a);
    const lid = this.add.rectangle(0, -8, 34, 6, 0xffe08a);
    const obj = this.add.container(x, y, [box, lid]).setDepth(3);
    this.chests.push({ obj, opened: false });
  }

  private spawnStairs(x: number, y: number): void {
    const last = this.run.floor >= FLOOR.count;
    const ring = this.add.circle(0, 0, 26, 0x000000).setStrokeStyle(3, 0x9fe8ff);
    const text = this.add
      .text(0, 44, last ? '脱出' : '次のフロアへ', { fontFamily: 'sans-serif', fontSize: '15px', color: '#9fe8ff', stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5);
    this.stairs = this.add.container(x, y, [ring, text]).setDepth(3);
    this.tweens.add({ targets: ring, scale: 1.15, duration: 500, yoyo: true, repeat: -1 });
    Sfx.roomClear();
  }

  protected updateWorld(): void {
    const px = this.player.x;
    const py = this.player.y;

    // 部屋の出入り
    const room = this.rooms.find((r) => r.inner.contains(px, py)) ?? null;
    if (room && room !== this.current) this.enterRoom(room);
    if (room) this.current = room;

    // 宝箱（段階4でアイテムに置き換える。今は回復と弾薬補充）
    for (const c of this.chests) {
      if (c.opened || Phaser.Math.Distance.Between(px, py, c.obj.x, c.obj.y) > 30) continue;
      c.opened = true;
      c.obj.setAlpha(0.35);
      this.heal(FLOOR.chestHeal);
      this.weapons.refillAll();
      Sfx.stock();
      this.presenter.floatText(c.obj.x, c.obj.y - 24, '回復＋弾薬補充', '#ffe08a', 18);
    }

    // 階段
    if (this.stairs && Phaser.Math.Distance.Between(px, py, this.stairs.x, this.stairs.y) < 26) {
      this.stairs = null;
      if (this.run.floor >= FLOOR.count) {
        telemetry.endRun({ cleared: true, died: false });
        this.scene.start('Clear', { stats: { ...this.queue.stats, confirms: { ...this.queue.stats.confirms } }, hp: this.player.hp });
      } else {
        this.run.floor++;
        this.scene.restart({ run: this.run });
      }
      return;
    }

    this.drawMinimap();
  }

  protected onDied(): void {
    telemetry.endRun({ cleared: false, died: true });
  }

  protected restartAfterDeath(): void {
    this.scene.restart({});
  }

  protected infoLines(): string[] {
    return [`フロア ${this.run.floor} / ${FLOOR.count}`];
  }

  // ------------------------------------------------------------ ミニマップ

  private drawMinimap(): void {
    const g = this.minimap;
    g.clear();
    const cw = 18;
    const ch = 13;
    const gw = FLOOR.gen.gridW * cw;
    // タッチ操作では右上の武器ボタンを避ける
    const ox = this.scale.width - gw - (this.controls.touchMode ? 96 : 14);
    const oy = 12;
    const known = (r: RoomState) => r.visited || r.spec.neighbors.some((n) => this.rooms[n].visited);
    const at = (r: RoomState) => ({ x: ox + r.spec.gx * cw, y: oy + r.spec.gy * ch });

    g.lineStyle(2, 0x666688, 0.8);
    for (const r of this.rooms) {
      if (!r.visited) continue;
      for (const n of r.spec.neighbors) {
        const a = at(r);
        const b = at(this.rooms[n]);
        g.lineBetween(a.x + cw / 2 - 2, a.y + ch / 2 - 2, b.x + cw / 2 - 2, b.y + ch / 2 - 2);
      }
    }
    for (const r of this.rooms) {
      if (!known(r)) continue;
      const { x, y } = at(r);
      const col =
        r.spec.type === 'boss' ? 0xff4466 : r.spec.type === 'treasure' ? 0xffd84a : r.spec.type === 'shop' ? 0x7ee07e : r.cleared ? 0x8888aa : 0x44445a;
      g.fillStyle(col, r.visited ? 0.95 : 0.4).fillRect(x, y, cw - 4, ch - 4);
      if (r === this.current) g.lineStyle(2, 0xffffff, 1).strokeRect(x - 1, y - 1, cw - 2, ch - 2);
    }
  }
}
