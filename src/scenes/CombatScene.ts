// 戦闘の共通部分（自機・弾・敵・相殺・HUD）。
// 部屋の作り方と進行は派生クラス（TestRoomScene / FloorScene）が決める。

import Phaser from 'phaser';
import { CANCEL, CHAIN, CHEST, CONTACT, ENEMIES, ENEMY_BULLET, FX, ITEM_NUM, MORTAR, PLAYER, POINTS, STARTING_WEAPONS, TEST_ROOM_WEAPONS, TOUCH, WEAPONS } from '../config/balance';
import { ITEMS, rollChestChoices, type ChestChoice, type ItemId } from '../core/items';
import { aimAssist, CurseReturn, effectiveRate, killBonus, PerKeyCooldown, pushAway, rawRate } from '../core/rules';
import { DamageQueue } from '../core/DamageQueue';
import type { WeaponDef } from '../core/types';
import { beamRate, bounceRate, erasePoints, holdRate, pointRateAt } from '../core/weaponMath';
import { Bullet, createBulletGroup, spawnBullet, tickBullets } from '../game/Bullets';
import { CancelPresenter } from '../game/CancelPresenter';
import { Controls } from '../game/Controls';
import { Enemy } from '../game/Enemy';
import type { EnemyContext } from '../game/enemyBehaviors';
import { Player } from '../game/Player';
import { Sfx } from '../game/Sfx';
import { WeaponSystem } from '../game/WeaponSystem';
import { bandOf, cancelRate, type DistanceBand } from '../core/Telemetry';
import { telemetry } from '../game/telemetryStore';

/** フロアをまたいで引き継ぐ状態 */
export interface RunState {
  hp: number;
  maxHp: number;
  queue: DamageQueue;
  weapons: WeaponSystem;
  /** 1 始まり */
  floor: number;
  /** この周回の計測を始めたか */
  telemetryStarted: boolean;
  /** 持っているアイテム（1つずつ） */
  items: ItemId[];
  /** 通貨（ショップは段階5） */
  currency: number;
  /** 開けた宝箱の数（最初の宝箱は確定枠あり） */
  chestsOpened: number;
}

export function newRunState(): RunState {
  return {
    hp: PLAYER.maxHp,
    maxHp: PLAYER.maxHp,
    queue: new DamageQueue(CANCEL),
    weapons: new WeaponSystem(STARTING_WEAPONS),
    floor: 1,
    telemetryStarted: false,
    items: [],
    currency: 0,
    chestsOpened: 0,
  };
}

interface SourceInfo {
  x: number;
  y: number;
  name: string;
  alive: boolean;
}

export interface HazardZone {
  kind: 'fire' | 'pit';
  rect: Phaser.Geom.Rectangle;
}

type WallLike = Phaser.Physics.Arcade.StaticGroup | Phaser.Tilemaps.TilemapLayer;

export abstract class CombatScene extends Phaser.Scene {
  protected run!: RunState;
  protected player!: Player;
  protected controls!: Controls;
  protected queue!: DamageQueue;
  protected presenter!: CancelPresenter;
  protected weapons!: WeaponSystem;

  protected enemies!: Phaser.Physics.Arcade.Group;
  protected playerBullets!: Phaser.Physics.Arcade.Group;
  protected enemyBullets!: Phaser.Physics.Arcade.Group;
  private telegraphs!: Phaser.GameObjects.Graphics;
  private beamGfx!: Phaser.GameObjects.Graphics;
  private beamSfxTimer = 0;
  private walls: WallLike[] = [];
  protected hazards: HazardZone[] = [];
  private inFire = false;

  /** 予告元の敵情報（倒された敵も最後の位置を覚えておく） */
  private sources = new Map<number, SourceInfo>();

  private attackBuff = 0;
  private attackBuffTime = 0;
  private hitstopUntil = 0;
  protected dead = false;
  /** 計測するか（本編のみ。テスト部屋では記録しない） */
  protected recordTelemetry = false;
  private unsubscribeQueue: (() => void) | null = null;
  /** 同じ敵からの接触は1秒に1回まで */
  private contactCooldown = new PerKeyCooldown(CONTACT.cooldown);
  /** 迫撃砲の着弾予告 */
  private shells: Array<{ x: number; y: number; t: number; ownerId: number }> = [];

  // アイテムの状態
  /** 最後に撃った時刻（秒）。撃っていない間はポイントが溜まらない */
  private lastShotAt = -Infinity;
  /** 動かずにいる時間（据え撃ちの台座） */
  private stillTime = 0;
  /** 反撃の型: 効果の終わりと、再発動できるようになる時刻 */
  private counterUntil = 0;
  private counterLockUntil = 0;
  /** 弾倉の誓いの再発動時刻 */
  private vowReadyAt = 0;
  /** 集中の照準器の加算 */
  private focusStacks = 0;
  /** 弾撃ち・かすめの、部屋ごとの獲得量と、かすめの直近1秒の記録 */
  private shootdownRoom = 0;
  private grazeRoom = 0;
  private grazeLog: number[] = [];
  private curse = new CurseReturn(ITEM_NUM.curse.damage, ITEM_NUM.curse.cooldown);
  /** 呪詛返しの対象（相殺イベントの中で敵を倒さないよう、次のフレームで処理する） */
  private pendingCurses: Array<number | null> = [];
  /** 宝箱の3択を選んでいる間は止める */
  protected choosing = false;

  // HUD
  private hud!: Phaser.GameObjects.Graphics;
  private ammoText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  protected helpText!: Phaser.GameObjects.Text;
  private reloadBar!: Phaser.GameObjects.Graphics;

  /** ワールドを作る: 境界・壁（addWalls）・床ギミック（addHazard）を用意し、自機の出現位置を返す */
  protected abstract buildWorld(): { x: number; y: number };
  /** 毎フレームの進行（部屋の出入り・ウェーブなど） */
  protected abstract updateWorld(dt: number): void;
  /** 死亡後の再挑戦 */
  protected abstract restartAfterDeath(): void;
  /** 敵が倒されたあと（部屋の全滅判定など） */
  protected onEnemyKilled(_e: Enemy): void {}
  /** HUD 左上に出す追加の行 */
  protected infoLines(): string[] {
    return [];
  }
  /** PC 用の操作説明 */
  protected helpLines(): string[] {
    return ['WASD 移動 / 左クリック 射撃 / 右クリック ダッシュ / R リロード / Q・E 武器切替'];
  }
  protected onDebugKey(_code: string): void {}

  init(data: { run?: RunState }): void {
    this.run = data.run ?? newRunState();
  }

  create(): void {
    this.sources.clear();
    this.walls = [];
    this.hazards = [];
    this.inFire = false;
    this.dead = false;
    this.attackBuff = 0;
    this.attackBuffTime = 0;
    this.hitstopUntil = 0;
    this.contactCooldown.clear();
    this.shells = [];
    this.lastShotAt = -Infinity;
    this.stillTime = 0;
    this.counterUntil = 0;
    this.counterLockUntil = 0;
    this.vowReadyAt = 0;
    this.focusStacks = 0;
    this.grazeLog = [];
    this.pendingCurses = [];
    this.curse.clear();
    this.choosing = false;
    this.resetRoomCounters();

    this.queue = this.run.queue;
    this.weapons = this.run.weapons;
    this.input.mouse?.disableContextMenu();

    this.enemies = this.physics.add.group();
    this.playerBullets = createBulletGroup(this, 'pbullet', 200);
    this.enemyBullets = createBulletGroup(this, 'ebullet', 400);
    this.telegraphs = this.add.graphics().setDepth(4);
    this.beamGfx = this.add.graphics().setDepth(9);

    const spawn = this.buildWorld();
    this.player = new Player(this, spawn.x, spawn.y);
    this.player.hp = this.run.hp;
    this.player.maxHp = this.run.maxHp;
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    // 衝突
    for (const w of this.walls) {
      this.physics.add.collider(this.player, w);
      this.physics.add.collider(this.enemies, w);
      this.physics.add.collider(this.playerBullets, w, (b) => this.onPlayerBulletWall(b as Bullet));
      this.physics.add.collider(this.enemyBullets, w, (b) => (b as Bullet).kill());
    }
    this.physics.add.collider(this.enemies, this.enemies);
    this.physics.add.overlap(this.playerBullets, this.enemies, (b, e) => this.onPlayerBulletHit(b as Bullet, e as Enemy));
    this.physics.add.overlap(this.player, this.enemyBullets, (_p, b) => this.onEnemyBulletHit(b as Bullet));
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => this.onEnemyContact(e as Enemy));
    // 弾撃ちの銃身: 自機弾で大きな敵弾を撃ち落とす
    this.physics.add.overlap(
      this.playerBullets,
      this.enemyBullets,
      (pb, eb) => this.onShootdown(pb as Bullet, eb as Bullet),
      (pb, eb) => this.has('shootdownBarrel') && (eb as Bullet).big && (pb as Bullet).weapon?.kind !== 'rocket',
    );
    this.applyItemModifiers();

    // 相殺の演出
    this.presenter = new CancelPresenter({
      scene: this,
      queue: this.queue,
      getPlayerPos: () => ({ x: this.player.x, y: this.player.y }),
      getSourceInfo: (id) => this.sources.get(id) ?? null,
      hitstop: (ms) => this.hitstop(ms),
      applyChainBonus: (n) => this.applyChainBonus(n),
    });
    this.unsubscribeQueue = this.queue.on((e) => {
      if (e.type === 'confirmed') this.onConfirmed(e.damage);
      if (e.type === 'queued') this.onPendingQueued();
      if (e.type === 'cancelled' && this.has('curseReturn')) this.pendingCurses.push(e.pending.sourceId);
      if (!this.recordTelemetry) return;
      if (e.type === 'cancelled') telemetry.cancel();
      else if (e.type === 'confirmed') telemetry.confirm(e.reason);
      else if (e.type === 'chain' && e.count === this.queue.chainMin) telemetry.chain();
      else if (e.type === 'roomCleared') telemetry.wipe(e.count);
    });

    this.createHud();
    this.bindInput();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.presenter.destroy();
      this.unsubscribeQueue?.();
      this.unsubscribeQueue = null;
      this.run.hp = this.player.hp;
    });
  }

  // ------------------------------------------------------------ ワールド

  protected addWalls(w: WallLike): void {
    this.walls.push(w);
  }

  /** 床ギミックを置く（火の床: 入った時に1回だけ予告 / 落とし穴: 即時確定） */
  protected addHazard(kind: HazardZone['kind'], rect: Phaser.Geom.Rectangle): void {
    this.hazards.push({ kind, rect });
    if (kind === 'fire') {
      const fz = this.add.rectangle(rect.centerX, rect.centerY, rect.width, rect.height, 0xff5a1f, 0.28).setDepth(-5);
      fz.setStrokeStyle(2, 0xff8a3f, 0.8);
      this.tweens.add({ targets: fz, fillAlpha: 0.4, duration: 400, yoyo: true, repeat: -1 });
      this.add.text(rect.centerX, rect.centerY, '火の床', { fontFamily: 'sans-serif', fontSize: '14px', color: '#ffb080' }).setOrigin(0.5).setDepth(-4);
    } else {
      this.add.rectangle(rect.centerX, rect.centerY, rect.width, rect.height, 0x000000, 1).setDepth(-5).setStrokeStyle(2, 0x444466);
      this.add.text(rect.centerX, rect.centerY, '落とし穴', { fontFamily: 'sans-serif', fontSize: '14px', color: '#7777aa' }).setOrigin(0.5).setDepth(-4);
    }
  }

  protected inHazard(x: number, y: number, margin = 0): boolean {
    return this.hazards.some((h) => Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(h.rect), margin, margin).contains(x, y));
  }

  /** area の中で、自機から minDist 以上離れていて床ギミックの外の場所 */
  protected randomSpawnPoint(area: Phaser.Geom.Rectangle, minDist: number): { x: number; y: number } {
    let p = { x: area.centerX, y: area.centerY };
    for (let i = 0; i < 40; i++) {
      p = { x: Phaser.Math.Between(area.x, area.right), y: Phaser.Math.Between(area.y, area.bottom) };
      if (this.isOpenAt(p.x, p.y) && !this.inHazard(p.x, p.y, 24) && Phaser.Math.Distance.Between(p.x, p.y, this.player.x, this.player.y) >= minDist) break;
    }
    return p;
  }

  /** (x, y) が壁・柱でない（敵を出せる）か。派生クラスが地形に合わせて上書きする */
  protected isOpenAt(_x: number, _y: number): boolean {
    return true;
  }

  /** (x, y) が視線を遮るか（壁・柱） */
  protected blocksSight(_x: number, _y: number): boolean {
    return false;
  }

  /** 2点の間に壁・柱が無いか */
  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(d / 12);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.blocksSight(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  }

  protected spawnEnemy(id: string, x: number, y: number): Enemy {
    const def = ENEMIES[id];
    const e = new Enemy(this, x, y, def);
    this.enemies.add(e);
    // add で body 設定が上書きされるので再設定
    (e.body as Phaser.Physics.Arcade.Body).setCircle(def.radius, e.width / 2 - def.radius, e.height / 2 - def.radius).setCollideWorldBounds(true);
    this.sources.set(e.uid, { x: e.x, y: e.y, name: def.name, alive: true });
    return e;
  }

  protected get enemiesAlive(): number {
    return this.enemies.countActive(true);
  }

  // ------------------------------------------------------------ 入力

  private bindInput(): void {
    // Space（アクティブアイテム）は段階4で実装
    this.controls = new Controls(this, {
      dash: () => {
        if (!this.dead && this.player.tryDash(this.controls.move)) Sfx.dash();
      },
      reload: () => {
        if (this.dead || this.choosing) return;
        const r = this.weapons.startReload();
        if (r) Sfx.reload();
        if (r === 'fast') {
          Sfx.stock();
          this.presenter.floatText(this.player.x, this.player.y - 40, '早撃ち！', '#ffe066', 16);
        }
      },
      switchWeapon: (d) => this.weapons.switch(d),
      debugKey: (code) => {
        if (this.choosing) {
          const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(code);
          if (i >= 0) this.chooseChest(i);
          return;
        }
        if (this.dead) return;
        if (code === 'KeyH') this.helpText.setVisible(!this.helpText.visible);
        else this.onDebugKey(code);
      },
    });
    this.controls.onModeChange = () => this.layoutHud();
    this.layoutHud();
  }

  // ------------------------------------------------------------ 当たり

  private onPlayerBulletHit(b: Bullet, e: Enemy): void {
    if (!b.active || !e.active || e.isSpawning) return;
    const weapon = b.weapon;
    if (weapon?.explosion) {
      this.explodeRocket(b);
      return;
    }
    const bounces = b.bounces;
    const extraAdds = b.boosted ? [ITEM_NUM.quickdrawBoost] : [];
    b.kill();
    Sfx.enemyHit();
    // 与ダメージ由来のポイント（倒しきれなくても少し溜まる）。武器ごとの倍率 × レリック加算、上限つき
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
    const weaponRate = weapon ? pointRateAt(weapon, dist) * b.rateMult * bounceRate(weapon, bounces) : 1;
    // 集中の照準器: 遠くの命中が続くほど倍率が上がる（400px以上は2回分）
    if (this.has('focusScope')) {
      const F = ITEM_NUM.focus;
      if (dist >= F.minDist) this.focusStacks = Math.min(F.max, this.focusStacks + F.perHit * (dist >= F.farDist ? 2 : 1));
    }
    this.damageEnemy(e, b.damage, weaponRate, dist, weapon, extraAdds, weapon?.ricochet && bounces > 0 ? weapon.ricochet.killBonus : 0);
  }

  /** 敵にダメージを与え、与ダメージ由来のポイントを得る。倒れたら撃破処理 */
  protected damageEnemy(e: Enemy, amount: number, weaponRate: number, dist: number, weapon: WeaponDef | null, extraAdds: number[] = [], extraKillBonus = 0, givePoints = true): void {
    const dealt = Math.min(amount, Math.max(0, e.hp));
    if (givePoints) this.gainPoints((dealt / CANCEL.damagePerPoint) * this.pointRate(weaponRate, extraAdds), dist, false);
    if (e.damage(amount)) this.killEnemy(e, weapon, dist, extraKillBonus, !givePoints);
  }

  /** 自機弾が壁に当たった: 跳弾は跳ね、ロケットは爆発、それ以外は消える */
  private onPlayerBulletWall(b: Bullet): void {
    if (!b.active) return;
    if (b.weapon?.explosion) {
      this.explodeRocket(b);
      return;
    }
    if (b.bounces < b.maxBounces) {
      b.bounces++;
      return;
    }
    this.onPlayerBulletMiss(b);
    b.kill();
  }

  /** 自機弾が敵に当たらずに消えた（集中の照準器が下がる） */
  private onPlayerBulletMiss(b: Bullet): void {
    if (this.has('focusScope') && b.weapon && b.weapon.kind !== 'rocket') {
      this.focusStacks = Math.max(0, this.focusStacks - ITEM_NUM.focus.missPenalty);
    }
  }

  /** ロケットの爆風: 敵にダメージ、敵弾を消してポイント、自分が近いと即確定 */
  private explodeRocket(b: Bullet): void {
    const x = b.x;
    const y = b.y;
    const weapon = b.weapon!;
    const ex = weapon.explosion!;
    const extraAdds = b.boosted ? [ITEM_NUM.quickdrawBoost] : [];
    b.kill();
    Sfx.enemyDie();
    const boom = this.add.circle(x, y, ex.radius, 0xff9a3f, 0.45).setDepth(8);
    this.tweens.add({ targets: boom, scale: 1.2, alpha: 0, duration: 280, onComplete: () => boom.destroy() });
    this.cameras.main.shake(100, 0.004);

    for (const obj of [...this.enemies.getChildren()]) {
      const e = obj as Enemy;
      if (!e.active || e.isSpawning) continue;
      if (Phaser.Math.Distance.Between(x, y, e.x, e.y) > ex.radius + e.def.radius) continue;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
      this.damageEnemy(e, ex.damage * this.attackMult, pointRateAt(weapon, dist), dist, weapon, extraAdds);
    }
    // 爆風で敵弾を消す（1発ごとにポイント、1発のロケットにつき上限あり）
    let erased = 0;
    for (const obj of this.enemyBullets.getChildren()) {
      const eb = obj as Bullet;
      if (eb.active && Phaser.Math.Distance.Between(x, y, eb.x, eb.y) <= ex.radius) {
        eb.kill();
        erased++;
      }
    }
    if (erased > 0) {
      const pts = erasePoints(weapon, erased);
      this.gainPoints(pts, Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y), false);
      this.presenter.floatText(x, y - 20, `弾消し +${pts.toFixed(2)}`, '#ffb35a', 14);
    }
    // 自分の武器の爆風は即確定
    if (!this.dead && Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y) <= ex.selfRadius) {
      this.queue.instant('selfExplosion');
    }
  }

  /** レーザー: 照準方向へ壁まで伸び、当たっている敵すべてにダメージ。同時に当たる数で倍率が上がる */
  private updateBeam(dt: number, active: boolean): void {
    const g = this.beamGfx;
    g.clear();
    if (!active) return;
    const weapon = this.weapons.current.def;
    const a = this.player.aim;
    const sx = this.player.x + Math.cos(a) * (PLAYER.radius + 4);
    const sy = this.player.y + Math.sin(a) * (PLAYER.radius + 4);
    // 壁・柱で止まる
    let len = weapon.range;
    for (let d = 8; d <= weapon.range; d += 8) {
      if (this.blocksSight(sx + Math.cos(a) * d, sy + Math.sin(a) * d)) {
        len = d;
        break;
      }
    }
    const exX = sx + Math.cos(a) * len;
    const exY = sy + Math.sin(a) * len;
    const line = new Phaser.Geom.Line(sx, sy, exX, exY);
    const hits = (this.enemies.getChildren() as Enemy[]).filter(
      (e) => e.active && !e.isSpawning && Phaser.Geom.Intersects.LineToCircle(line, new Phaser.Geom.Circle(e.x, e.y, e.def.radius)),
    );
    const rate = beamRate(weapon, hits.length);
    for (const e of hits) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
      this.damageEnemy(e, weapon.damage * this.attackMult * dt, rate, dist, weapon);
    }
    const w = 3 + Math.min(hits.length, 4) * 1.5;
    g.lineStyle(w + 6, weapon.bulletColor, 0.18).lineBetween(sx, sy, exX, exY);
    g.lineStyle(w, weapon.bulletColor, 0.9).lineBetween(sx, sy, exX, exY);
    g.lineStyle(1.5, 0xffffff, 1).lineBetween(sx, sy, exX, exY);
    this.beamSfxTimer -= dt;
    if (this.beamSfxTimer <= 0) {
      Sfx.shoot();
      this.beamSfxTimer = 0.12;
    }
  }

  protected killEnemy(e: Enemy, weapon: WeaponDef | null = null, dist = Infinity, extraBonus = 0, noPoints = false): void {
    const hadPending = this.queue.count > 0;
    const src = this.sources.get(e.uid);
    if (src) {
      src.x = e.x;
      src.y = e.y;
      src.alive = false;
    }
    Sfx.enemyDie();
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const c = this.add.circle(e.x, e.y, 3, e.def.color).setDepth(6);
      this.tweens.add({ targets: c, x: e.x + Math.cos(a) * 40, y: e.y + Math.sin(a) * 40, alpha: 0, duration: 300, onComplete: () => c.destroy() });
    }
    // 撃破ボーナス（倍率はかけない）: 至近 / 狙撃 / 仇の狙撃
    const isNemesis = this.queue.pending.some((p) => p.sourceId === e.uid);
    const kb = killBonus({ dist, weapon, isNemesis }, POINTS.snipe);
    const bonus = kb.bonus + extraBonus;
    if (extraBonus > 0) this.presenter.floatText(e.x, e.y - 34, `跳弾 +${extraBonus}`, '#a0ffa0', 15);
    if (kb.kind) {
      const label = kb.kind === 'close' ? '至近' : kb.kind === 'nemesis' ? '仇討ち' : '狙撃';
      this.presenter.floatText(e.x, e.y - 18, `${label} +${bonus}`, kb.kind === 'close' ? '#ffb35a' : '#9fe8ff', 15);
    }
    if (this.recordTelemetry && (kb.kind === 'snipe' || kb.kind === 'nemesis')) telemetry.snipeKill();
    // 自爆型: 倒すと全方位に弾をばらまき、少し遅れて隙間を埋めるようにもう一度
    const p = e.def.params;
    if (p.burst1) {
      const { x, y } = e;
      const ring = (n: number, offset: number) => {
        for (let i = 0; i < n; i++) this.fireEnemyBullet(e.uid, x, y, offset + (i / n) * Math.PI * 2, p.bulletSpeed);
      };
      ring(p.burst1, Math.random() * Math.PI * 2);
      this.time.delayedCall(p.burstDelay * 1000, () => {
        if (this.sys.isActive() && !this.dead) ring(p.burst2, Math.random() * Math.PI * 2);
      });
    }
    e.destroy();
    // 通貨: 1体ごとに +1。危険報酬の財布は、予告がある間に倒すとさらに +1
    this.run.currency += 1 + (this.has('riskWallet') && hadPending ? ITEM_NUM.walletCurrency : 0);
    // 呪詛返しで倒した場合はポイントが入らない
    if (!noPoints) this.gainPoints((e.def.elite ? CANCEL.killPoints.elite : CANCEL.killPoints.normal) + bonus, dist, true);
    this.onEnemyKilled(e);
  }

  private onEnemyBulletHit(b: Bullet): void {
    if (!b.active || this.dead) return;
    b.kill();
    const r = this.queue.hit('bullet', b.ownerId);
    if (r !== 'ignored') this.recordHit(b.ownerId);
  }

  private onEnemyContact(e: Enemy): void {
    if (this.dead || e.isSpawning || e.stun > 0 || !e.contactActive) return;
    // 同じ敵からは1秒に1回まで。接触したら自機を押し返す
    if (!this.contactCooldown.tryUse(e.uid, this.time.now / 1000)) return;
    const v = pushAway(this.player.x, this.player.y, e.x, e.y, CONTACT.push);
    this.player.push(v.x, v.y, CONTACT.pushTime);
    if (e.def.noContactDamage) return;
    const r = this.queue.hit('contact', e.uid);
    if (r !== 'ignored') this.recordHit(e.uid);
  }

  /** レリックによるポイント倍率の加算（+0.5 なら 0.5）。足し合わせて使う */
  protected relicAdds(): number[] {
    const adds: number[] = [];
    const now = this.time.now / 1000;
    if (this.has('backwater') && this.queue.count > 0) adds.push(ITEM_NUM.backwater);
    if (this.has('counterForm') && now < this.counterUntil) adds.push(ITEM_NUM.counter.bonus);
    if (this.has('stanceMount') && this.stillTime >= ITEM_NUM.stance.stillTime && this.isShooting) adds.push(ITEM_NUM.stance.bonus);
    if (this.has('focusScope') && this.focusStacks > 0) adds.push(this.focusStacks);
    return adds;
  }

  // ------------------------------------------------------------ アイテム

  protected has(id: ItemId): boolean {
    return this.run.items.includes(id);
  }

  /** 撃っている間か（最後に撃ってから少しの間を含む） */
  protected get isShooting(): boolean {
    return this.time.now / 1000 - this.lastShotAt <= ITEM_NUM.shootingGrace;
  }

  /** 部屋ごとの上限を戻す（部屋に入ったとき） */
  protected resetRoomCounters(): void {
    this.shootdownRoom = 0;
    this.grazeRoom = 0;
  }

  /** 持っているアイテムを相殺ロジックと武器に反映する。上限は相殺ロジック側でも強制する */
  protected applyItemModifiers(): void {
    this.queue.setModifiers({
      timerBonus: this.has('hourglass') ? ITEM_NUM.hourglassTimer : 0,
      doublePointChance: this.has('doubleCancel') ? ITEM_NUM.doubleChance : 0,
      stockBonus: this.has('savingsRing') ? ITEM_NUM.ringStock : 0,
      chainWindowMult: this.has('chainBell') ? ITEM_NUM.bellWindowMult : 1,
      canBorrow: this.has('debtNote'),
      hasGrace: this.has('graceScale'),
    });
    this.weapons.activeReload = this.has('quickdrawBelt') ? { ...ITEM_NUM.quickdraw } : null;
  }

  /** 宝箱の中身を受け取る */
  protected acquire(c: ChestChoice): void {
    if (c.kind === 'item') {
      if (!this.run.items.includes(c.id)) this.run.items.push(c.id);
      this.applyItemModifiers();
    } else {
      this.weapons.add(c.id);
      this.weapons.index = this.weapons.slots.findIndex((s) => s.def.id === c.id);
    }
    if (this.recordTelemetry) telemetry.item(c.kind === 'item' ? c.id : `weapon:${c.id}`);
    Sfx.stock();
    this.presenter.floatText(this.player.x, this.player.y - 44, c.kind === 'item' ? ITEMS[c.id].name : WEAPONS[c.id].name, '#ffe08a', 18);
  }

  /** 予告が積まれた: 弾倉の誓い・反撃の型 */
  private onPendingQueued(): void {
    const now = this.time.now / 1000;
    if (this.has('magazineVow') && now >= this.vowReadyAt && this.weapons.current.def.id !== 'handgun') {
      this.weapons.addRounds(ITEM_NUM.magazineVow.rounds);
      this.vowReadyAt = now + ITEM_NUM.magazineVow.cooldown;
    }
    if (this.has('counterForm') && now >= this.counterLockUntil) {
      this.counterUntil = now + ITEM_NUM.counter.duration;
      this.counterLockUntil = now + ITEM_NUM.counter.lockout;
    }
  }

  /** 呪詛返し: 相殺した予告を作った敵へダメージ（ポイントなし） */
  private processCurses(): void {
    const now = this.time.now / 1000;
    for (const id of this.pendingCurses) {
      const e = (this.enemies.getChildren() as Enemy[]).find((x) => x.active && x.uid === id);
      if (!e) continue;
      const r = this.curse.trigger(id, now);
      if (r.damage <= 0) continue;
      const line = this.add.graphics().setDepth(8);
      line.lineStyle(3, 0xc04bff, 0.9).lineBetween(this.player.x, this.player.y, e.x, e.y);
      this.tweens.add({ targets: line, alpha: 0, duration: 300, onComplete: () => line.destroy() });
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
      this.damageEnemy(e, r.damage, 0, dist, null, [], 0, r.givesPoints);
    }
    this.pendingCurses = [];
  }

  /** 弾撃ちの銃身: 大きな敵弾を撃ち落とした */
  private onShootdown(pb: Bullet, eb: Bullet): void {
    if (!pb.active || !eb.active) return;
    eb.kill();
    pb.kill();
    const pop = this.add.circle(eb.x, eb.y, 8, 0xffe066).setDepth(54);
    this.tweens.add({ targets: pop, scale: 2, alpha: 0, duration: 200, onComplete: () => pop.destroy() });
    const S = ITEM_NUM.shootdown;
    const gain = Math.min(S.perBullet, S.roomMax - this.shootdownRoom);
    if (gain > 0) {
      this.shootdownRoom += gain;
      this.gainPoints(gain, Phaser.Math.Distance.Between(this.player.x, this.player.y, eb.x, eb.y), false);
    }
  }

  /** かすめの護符: 敵弾が近くを通り抜けたら少しポイント（撃っている間だけ。毎秒・部屋ごとに上限） */
  private updateGraze(): void {
    if (!this.has('grazeCharm')) return;
    const G = ITEM_NUM.graze;
    const now = this.time.now / 1000;
    this.grazeLog = this.grazeLog.filter((t) => now - t < 1);
    for (const obj of this.enemyBullets.getChildren()) {
      const b = obj as Bullet;
      if (!b.active || b.graze === 2) continue;
      const d = Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y);
      if (d <= G.radius) {
        b.graze = 1;
        continue;
      }
      if (b.graze !== 1) continue;
      b.graze = 2; // 当たらずに通り抜けた
      if (!this.isShooting || this.grazeRoom >= G.roomMax || (this.grazeLog.length + 1) * G.perGraze > G.perSecond + 1e-9) continue;
      const gain = Math.min(G.perGraze, G.roomMax - this.grazeRoom);
      this.grazeRoom += gain;
      this.grazeLog.push(now);
      this.gainPoints(gain, d, false);
    }
  }

  // ------------------------------------------------------------ 宝箱の3択

  private chestCards: Phaser.GameObjects.GameObject[] = [];
  private chestChoices: ChestChoice[] = [];
  private chestDone: (() => void) | null = null;

  /** 宝箱を開ける: 3つの候補から1つ選ぶ。選ぶまでゲームは止まる */
  protected openChest(onDone?: () => void): void {
    const choices = rollChestChoices(Math.random, {
      ownedItems: this.run.items,
      ownedWeapons: this.weapons.slots.map((s) => s.def.id),
      allWeapons: TEST_ROOM_WEAPONS,
      n: CHEST.choices,
      guaranteed: this.run.chestsOpened === 0 ? (CHEST.firstGuaranteed as ItemId) : null,
    });
    this.run.chestsOpened++;
    if (choices.length === 0) {
      onDone?.();
      return;
    }
    this.choosing = true;
    this.chestChoices = choices;
    this.chestDone = onDone ?? null;
    this.physics.world.pause();
    const { width, height } = this.scale;
    const bg = this.add.rectangle(0, 0, width, height, 0x000000, 0.72).setOrigin(0).setScrollFactor(0).setDepth(300);
    const title = this.add
      .text(width / 2, 70, '宝箱: 1つ選ぶ', { fontFamily: 'sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#ffe08a' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(301);
    this.chestCards = [bg, title];
    const cw = 250;
    const gap = 24;
    const x0 = width / 2 - (cw * choices.length + gap * (choices.length - 1)) / 2 + cw / 2;
    choices.forEach((c, i) => {
      const x = x0 + i * (cw + gap);
      const y = height / 2 + 10;
      const isItem = c.kind === 'item';
      const name = isItem ? ITEMS[c.id].name : WEAPONS[c.id].name;
      const kind = isItem ? (ITEMS[c.id].category === 'relic' ? 'レリック' : '相殺') : '武器';
      const desc = isItem ? ITEMS[c.id].desc : this.weaponDesc(c.id);
      const card = this.add.rectangle(x, y, cw, 260, 0x1c1c2c, 1).setStrokeStyle(2, isItem ? 0xffe08a : 0x9fe8ff).setScrollFactor(0).setDepth(301);
      card.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.chooseChest(i));
      const t1 = this.add.text(x, y - 100, `${i + 1}  ${kind}`, { fontFamily: 'sans-serif', fontSize: '13px', color: '#8888aa' }).setOrigin(0.5).setScrollFactor(0).setDepth(302);
      const t2 = this.add.text(x, y - 66, name, { fontFamily: 'sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0).setDepth(302);
      const t3 = this.add
        .text(x, y - 30, desc, { fontFamily: 'sans-serif', fontSize: '14px', color: '#d0d0e0', align: 'center', wordWrap: { width: cw - 30, useAdvancedWrap: true } })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(302);
      this.chestCards.push(card, t1, t2, t3);
    });
  }

  private weaponDesc(id: keyof typeof WEAPONS): string {
    const d: Record<string, string> = {
      shotgun: '近いほどポイントが溜まる。至近で倒すと+0.5',
      machinegun: '押しっぱなしで倍率が×0.5→×1.5に上がる',
      laser: '貫通する照射。同時に当てた数で倍率が上がる',
      ricochet: '壁で跳ねる。跳ねてから当てるほど高倍率',
      rocket: '爆風で敵弾を消すとポイント。近いと自爆',
    };
    return d[id] ?? '';
  }

  private chooseChest(i: number): void {
    if (!this.choosing || i < 0 || i >= this.chestChoices.length) return;
    const c = this.chestChoices[i];
    for (const o of this.chestCards) o.destroy();
    this.chestCards = [];
    this.choosing = false;
    this.physics.world.resume();
    this.acquire(c);
    this.chestDone?.();
    this.chestDone = null;
  }

  /** 与ダメージ由来のポイント倍率: 武器の倍率 × (1 + レリック加算) を上限つきで */
  protected pointRate(weaponRate: number, extraAdds: number[] = []): number {
    return effectiveRate(rawRate(weaponRate, [...this.relicAdds(), ...extraAdds]), POINTS.softcap);
  }

  /** 相殺ポイントを得る（計測の距離帯も記録） */
  protected gainPoints(amount: number, dist: number, canDouble: boolean): void {
    this.queue.addPoints(amount, { canDouble });
    if (this.recordTelemetry) telemetry.points(amount, Number.isFinite(dist) ? bandOf(dist) : null);
  }

  /** 被弾の計測。距離帯は、その被弾を作った敵との距離 */
  private recordHit(sourceId: number | null): void {
    if (!this.recordTelemetry) return;
    const src = sourceId !== null ? this.sources.get(sourceId) : undefined;
    const band: DistanceBand | null = src ? bandOf(Phaser.Math.Distance.Between(this.player.x, this.player.y, src.x, src.y)) : null;
    telemetry.hit(band);
  }

  /** 死亡したとき（計測の締めなど） */
  protected onDied(): void {}

  private onConfirmed(damage: number): void {
    if (this.dead) return;
    this.player.hp = Math.max(0, this.player.hp - damage);
    this.player.setTintFill(0xffffff);
    this.time.delayedCall(FX.hitstopMs + 60, () => this.player.clearTint());
    if (this.player.hp <= 0) this.die();
  }

  /** 回復（宝箱など） */
  protected heal(amount: number): void {
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
  }

  // ------------------------------------------------------------ 連鎖ボーナス

  private applyChainBonus(count: number): void {
    const px = this.player.x;
    const py = this.player.y;
    // 衝撃波: 周囲の敵弾を消し、敵を押し返す
    const r = Math.min(CHAIN.shockwave.base + CHAIN.shockwave.perChain * (count - this.queue.chainMin), CHAIN.shockwave.max);
    for (const obj of this.enemyBullets.getChildren()) {
      const b = obj as Bullet;
      if (b.active && Phaser.Math.Distance.Between(px, py, b.x, b.y) <= r) {
        const pop = this.add.circle(b.x, b.y, 5, 0xffe066).setDepth(54);
        this.tweens.add({ targets: pop, scale: 2.2, alpha: 0, duration: 200, onComplete: () => pop.destroy() });
        b.kill();
      }
    }
    for (const obj of this.enemies.getChildren()) {
      const e = obj as Enemy;
      if (e.active && Phaser.Math.Distance.Between(px, py, e.x, e.y) <= r) e.knockback(px, py, CHAIN.knockback);
    }
    // 弾薬回復
    this.weapons.refill(CHAIN.ammoRefillRatioPerChain * (count - 1));
    // 攻撃力アップ（伸びた連鎖で上書き）
    this.attackBuff = Math.max(this.attackBuff, Math.min(CHAIN.attackBuff.perChain * (count - 1), CHAIN.attackBuff.max));
    this.attackBuffTime = CHAIN.attackBuff.duration;
  }

  private get attackMult(): number {
    // 怒りの予告: 予告が2つ以上ある間、攻撃力アップ
    const wrath = this.has('wrath') && this.queue.count >= ITEM_NUM.wrath.minPending ? ITEM_NUM.wrath.attack : 0;
    return 1 + (this.attackBuffTime > 0 ? this.attackBuff : 0) + wrath;
  }

  // ------------------------------------------------------------ 進行

  private hitstop(ms: number): void {
    this.hitstopUntil = Math.max(this.hitstopUntil, this.time.now + ms);
    this.physics.world.pause();
  }

  /** 画面中央に重ねる案内（死亡・クリアなど） */
  protected showOverlay(lines: string[], onTap: () => void): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.7).setOrigin(0).setScrollFactor(0).setDepth(200);
    this.add
      .text(width / 2, height / 2, lines.join('\n'), { fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff', align: 'center', lineSpacing: 8 })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    this.time.delayedCall(600, () => this.input.once('pointerdown', onTap));
  }

  private die(): void {
    this.dead = true;
    Sfx.death();
    this.physics.world.pause();
    this.onDied();
    const s = this.queue.stats;
    const rate = cancelRate(s.cancels, s.confirms);
    this.showOverlay(
      [
        '相殺に失敗した',
        '',
        `被弾 ${s.hits}   相殺 ${s.cancels}   連鎖 ${s.chains}（最大 ×${s.bestChain}）`,
        `確定  時間切れ ${s.confirms.timeout} / 上限超過 ${s.confirms.overflow} / 即時 ${s.confirms.instant}`,
        `相殺成功率 ${rate === null ? '—' : Math.round(rate * 100) + '%'}`,
        '',
        `部屋全滅で消えた予告 ${s.roomClearWipes}（相殺・成功率には数えない）`,
        '',
        this.controls.touchMode ? 'タップで再挑戦' : 'クリックで再挑戦',
      ],
      () => this.restartAfterDeath(),
    );
  }

  update(time: number, deltaMs: number): void {
    if (this.dead || this.choosing) return;
    if (time < this.hitstopUntil) return;
    if (this.physics.world.isPaused) this.physics.world.resume();

    const dt = Math.min(deltaMs, 50) / 1000;
    if (this.recordTelemetry) telemetry.tick(dt);
    this.controls.update(this.cameras.main, this.player.x, this.player.y);

    // スマホだけ照準補正（遠くの敵に少し吸い付く）
    let aim = this.controls.aim;
    if (this.controls.touchMode && TOUCH.aimAssist.enabled) {
      const targets = (this.enemies.getChildren() as Enemy[]).filter((e) => e.active && !e.isSpawning);
      aim = aimAssist(aim, this.player.x, this.player.y, targets, TOUCH.aimAssist.minDist, (TOUCH.aimAssist.maxAngleDeg * Math.PI) / 180);
    }

    // 自機
    this.player.tick(dt, this.controls.move, aim);
    this.updateHazards();

    // 射撃（ダッシュ中も可能）
    const fire = this.weapons.tick(dt, this.controls.fireHeld, this.player.aim);
    if (fire.autoReload) Sfx.reload();
    if (fire.shots.length > 0 || fire.beam) this.lastShotAt = time / 1000;
    // 据え撃ちの台座: 動いたら（ダッシュも）解除
    const moving = this.controls.move.lengthSq() > 0.01 || this.player.isDashing;
    this.stillTime = moving ? 0 : this.stillTime + dt;
    this.updateBeam(dt, fire.beam);
    for (const shot of fire.shots) {
      const b = spawnBullet(this.playerBullets, shot.def.kind === 'rocket' ? 'rocket' : 'pbullet');
      if (!b) continue;
      const ox = this.player.x + Math.cos(shot.angle) * (PLAYER.radius + 6);
      const oy = this.player.y + Math.sin(shot.angle) * (PLAYER.radius + 6);
      b.fire(ox, oy, shot.angle, shot.def.bulletSpeed, {
        damage: shot.def.damage * this.attackMult,
        life: shot.def.range / shot.def.bulletSpeed,
        weapon: shot.def,
        rateMult: shot.rateMult,
        boosted: shot.boosted,
        maxBounces: shot.def.ricochet?.bounces ?? 0,
        tint: this.attackBuffTime > 0 ? 0xff9a3f : shot.def.bulletColor,
        scale: (shot.def.bulletRadius / 4) * (this.attackBuffTime > 0 ? 1.3 : 1),
        hitRadius: shot.def.bulletRadius,
      });
    }
    if (fire.shots.length > 0) Sfx.shoot();
    this.attackBuffTime = Math.max(0, this.attackBuffTime - dt);

    // 敵
    const ctx: EnemyContext = {
      playerX: this.player.x,
      playerY: this.player.y,
      fire: (e, angle, speed, opts) => {
        this.fireEnemyBullet(e.uid, e.x, e.y, angle, speed, opts?.big ?? false);
        Sfx.enemyShoot();
      },
      lobShell: (e, x, y) => {
        this.shells.push({ x, y, t: MORTAR.warn, ownerId: e.uid });
        Sfx.enemyShoot();
      },
      hasLineOfSight: (x1, y1, x2, y2) => this.hasLineOfSight(x1, y1, x2, y2),
    };
    const killable: Array<{ x: number; y: number; r: number }> = [];
    const w = this.weapons.current.def;
    const killDamage = (w.explosion ? w.explosion.damage : w.kind === 'beam' ? w.damage * 0.5 : w.damage * w.pellets) * this.attackMult * FX.killableShots;
    for (const obj of this.enemies.getChildren()) {
      const e = obj as Enemy;
      if (!e.active) continue;
      e.tick(dt, ctx);
      const src = this.sources.get(e.uid);
      if (src) {
        src.x = e.x;
        src.y = e.y;
      }
      if (!e.isSpawning && e.hp <= killDamage) killable.push({ x: e.x, y: e.y, r: e.def.radius });
    }
    this.drawTelegraphs();
    this.updateShells(dt);

    tickBullets(this.playerBullets, dt, (b) => this.onPlayerBulletMiss(b));
    tickBullets(this.enemyBullets, dt);
    this.updateGraze();
    this.processCurses();

    // 相殺
    this.queue.update(dt);
    if (this.dead) return;
    this.presenter.update(dt);
    const nemesisIds = new Set(this.queue.pending.map((p) => p.sourceId));
    const nemesis = (this.enemies.getChildren() as Enemy[]).filter((e) => e.active && nemesisIds.has(e.uid)).map((e) => ({ x: e.x, y: e.y, r: e.def.radius }));
    this.presenter.drawKillMarks(killable, nemesis);

    this.updateWorld(dt);
    if (this.dead || !this.sys.isActive()) return;
    this.updateHud();
  }

  private updateHazards(): void {
    const { x, y } = this.player;
    // 火の床: 入った瞬間に1回だけ予告を積む（継続ダメージで埋まらないように）
    const nowInFire = this.hazards.some((h) => h.kind === 'fire' && h.rect.contains(x, y));
    if (nowInFire && !this.inFire && this.queue.hit('hazard', null) !== 'ignored') this.recordHit(null);
    this.inFire = nowInFire;

    // 落とし穴: ダッシュ中は飛び越せる。止まった位置が穴なら即時確定
    const pit = this.hazards.find((h) => h.kind === 'pit' && h.rect.contains(x, y));
    if (pit && !this.player.isDashing) {
      this.queue.instant('pit');
      this.player.setPosition(this.player.safeX, this.player.safeY);
      (this.player.body as Phaser.Physics.Arcade.Body).reset(this.player.safeX, this.player.safeY);
    } else if (!this.hazards.some((h) => h.kind === 'pit') || !this.inHazard(x, y, 24)) {
      this.player.safeX = x;
      this.player.safeY = y;
    }
  }

  protected fireEnemyBullet(ownerId: number, x: number, y: number, angle: number, speed: number, big = false): void {
    const b = spawnBullet(this.enemyBullets, big ? 'ebullet_big' : 'ebullet');
    if (!b) return;
    b.fire(x, y, angle, speed, {
      damage: 1,
      life: ENEMY_BULLET.lifetime,
      ownerId,
      big,
      hitRadius: big ? ENEMY_BULLET.big.hitRadius : ENEMY_BULLET.hitRadius,
    });
  }

  /** 迫撃砲: 予告の輪が縮み、0になったら爆発。爆風は予告になる（即確定にはしない） */
  private updateShells(dt: number): void {
    const g = this.telegraphs;
    for (const sh of this.shells) {
      sh.t -= dt;
      const k = Phaser.Math.Clamp(sh.t / MORTAR.warn, 0, 1);
      g.fillStyle(0xff5050, 0.12 + 0.18 * (1 - k)).fillCircle(sh.x, sh.y, MORTAR.radius);
      g.lineStyle(2, 0xff5050, 0.9).strokeCircle(sh.x, sh.y, MORTAR.radius);
      g.lineStyle(2, 0xffb0b0, 0.9).strokeCircle(sh.x, sh.y, Math.max(2, MORTAR.radius * k));
      if (sh.t > 0) continue;
      // 着弾
      const boom = this.add.circle(sh.x, sh.y, MORTAR.radius, 0xffb060, 0.6).setDepth(7);
      this.tweens.add({ targets: boom, scale: 1.25, alpha: 0, duration: 260, onComplete: () => boom.destroy() });
      Sfx.enemyDie();
      if (!this.dead && Phaser.Math.Distance.Between(sh.x, sh.y, this.player.x, this.player.y) <= MORTAR.radius + PLAYER.hitRadius) {
        const r = this.queue.hit('explosion', sh.ownerId);
        if (r !== 'ignored') this.recordHit(sh.ownerId);
      }
    }
    this.shells = this.shells.filter((sh) => sh.t > 0);
  }

  private drawTelegraphs(): void {
    const g = this.telegraphs;
    g.clear();
    for (const obj of this.enemies.getChildren()) {
      const e = obj as Enemy;
      const t = e.telegraph;
      if (!e.active || !t) continue;
      if (t.type === 'line' && t.sniper) {
        // 狙撃の照準線: 細く、固定されると濃くなる
        g.lineStyle(1 + t.progress * 2, 0xff3030, 0.3 + 0.6 * t.progress);
        g.lineBetween(e.x, e.y, e.x + Math.cos(t.angle) * t.length, e.y + Math.sin(t.angle) * t.length);
      } else if (t.type === 'line') {
        g.lineStyle(2 + t.progress * 6, 0xff5050, 0.15 + 0.35 * t.progress);
        g.lineBetween(e.x, e.y, e.x + Math.cos(t.angle) * t.length, e.y + Math.sin(t.angle) * t.length);
      } else {
        g.lineStyle(2, 0xff8ac8, 0.8);
        g.strokeCircle(e.x, e.y, e.def.radius + 10 * (1 - t.progress) + 2);
      }
    }
  }

  // ------------------------------------------------------------ HUD

  private createHud(): void {
    this.hud = this.add.graphics().setScrollFactor(0).setDepth(150);
    this.reloadBar = this.add.graphics().setDepth(21);
    const style = { fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff', stroke: '#000', strokeThickness: 3 };
    this.ammoText = this.add.text(this.scale.width - 16, this.scale.height - 16, '', style).setOrigin(1, 1).setScrollFactor(0).setDepth(150);
    this.infoText = this.add.text(16, 54, '', { ...style, fontSize: '14px' }).setScrollFactor(0).setDepth(150);
    this.helpText = this.add
      .text(16, this.scale.height - 16, this.helpLines().join('\n'), { ...style, fontSize: '13px', color: '#aaaacc' })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(150);
  }

  /** PC とタッチで HUD の配置を変える（タッチではボタンと重ならないように） */
  protected layoutHud(): void {
    const touch = this.controls.touchMode;
    const { width, height } = this.scale;
    if (touch) this.ammoText.setPosition(width / 2, 12).setOrigin(0.5, 0);
    else this.ammoText.setPosition(width - 16, height - 16).setOrigin(1, 1);
    this.helpText.setVisible(!touch);
  }

  private updateHud(): void {
    this.controls.dashReady = 1 - this.player.dashCooldown / PLAYER.dash.cooldown;
    this.controls.draw();
    const g = this.hud;
    g.clear();
    // ハート（半分単位）
    const hearts = Math.ceil(this.player.maxHp / 2);
    for (let i = 0; i < hearts; i++) {
      const x = 24 + i * 30;
      const y = 24;
      const hpHere = Phaser.Math.Clamp(this.player.hp - i * 2, 0, 2);
      g.fillStyle(0x442222, 1).fillCircle(x, y, 11);
      if (hpHere >= 2) g.fillStyle(0xff4466, 1).fillCircle(x, y, 11);
      else if (hpHere === 1) {
        g.fillStyle(0xff4466, 1);
        g.slice(x, y, 11, Math.PI / 2, (Math.PI * 3) / 2, false).fillPath();
      }
      g.lineStyle(2, 0xffffff, 0.8).strokeCircle(x, y, 11);
    }
    // ダッシュのクールダウン
    const cd = this.player.dashCooldown / PLAYER.dash.cooldown;
    g.fillStyle(0x333344, 1).fillRect(16, 42, 80, 4);
    g.fillStyle(cd > 0 ? 0x666688 : 0x9fe8ff, 1).fillRect(16, 42, 80 * (1 - cd), 4);

    const w = this.weapons.current;
    const reserve = w.reserve === null ? '∞' : String(w.reserve);
    if (w.def.kind === 'beam') {
      const heat = this.weapons.overheated > 0 ? '過熱' : `熱 ${Math.round((this.weapons.heat / w.def.heat!.max) * 100)}%`;
      this.ammoText.setText(`${w.def.name}   ${heat}`);
    } else {
      const ramp = w.def.holdRamp && this.weapons.holdTime > 0 ? `  ×${holdRate(w.def, this.weapons.holdTime).toFixed(1)}` : '';
      this.ammoText.setText(`${w.def.name}   ${w.mag} / ${w.def.magazine}   (${reserve})${ramp}${this.weapons.boosted ? '  早撃ち+' : ''}`);
    }
    const lines = this.infoLines();
    if (this.run.items.length > 0) lines.push(this.run.items.map((id) => ITEMS[id].name).join('・'));
    if (this.has('focusScope') && this.focusStacks > 0) lines.push(`集中 +${this.focusStacks.toFixed(1)}`);
    if (this.queue.debt > 0) lines.push(`借金 ${this.queue.debt}`);
    if (this.attackBuffTime > 0) lines.push(`攻撃力 +${Math.round(this.attackBuff * 100)}%  ${this.attackBuffTime.toFixed(1)}s`);
    this.infoText.setText(lines.join('\n'));

    // リロード中は自機の下にバー
    this.reloadBar.clear();
    if (this.weapons.reloading > 0) {
      const ratio = 1 - this.weapons.reloading / w.def.reloadTime;
      const x = this.player.x - 18;
      const y = this.player.y + FX.ringRadius + 18;
      this.reloadBar.fillStyle(0x222222, 0.8).fillRect(x, y, 36, 4);
      // 早撃ちの弾帯: 再入力の判定の幅を黄色で示す
      const span = this.weapons.activeReloadSpan;
      if (span) this.reloadBar.fillStyle(0xffe066, 0.9).fillRect(x + 36 * span[0], y - 2, 36 * (span[1] - span[0]), 8);
      this.reloadBar.fillStyle(0xffffff, 1).fillRect(x, y, 36 * ratio, 4);
    }
  }
}
