// 戦闘の共通部分（自機・弾・敵・相殺・HUD）。
// 部屋の作り方と進行は派生クラス（TestRoomScene / FloorScene）が決める。

import Phaser from 'phaser';
import { CANCEL, CHAIN, CONTACT, ENEMIES, ENEMY_BULLET, FX, PLAYER, POINTS, STARTING_WEAPONS, TOUCH } from '../config/balance';
import { aimAssist, effectiveRate, killBonus, PerKeyCooldown, pushAway, rawRate } from '../core/rules';
import { DamageQueue } from '../core/DamageQueue';
import type { WeaponDef } from '../core/types';
import { pointRateAt } from '../core/weaponMath';
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
}

export function newRunState(): RunState {
  return {
    hp: PLAYER.maxHp,
    maxHp: PLAYER.maxHp,
    queue: new DamageQueue(CANCEL),
    weapons: new WeaponSystem(STARTING_WEAPONS),
    floor: 1,
    telemetryStarted: false,
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

    this.queue = this.run.queue;
    this.weapons = this.run.weapons;
    this.input.mouse?.disableContextMenu();

    this.enemies = this.physics.add.group();
    this.playerBullets = createBulletGroup(this, 'pbullet', 200);
    this.enemyBullets = createBulletGroup(this, 'ebullet', 400);
    this.telegraphs = this.add.graphics().setDepth(4);

    const spawn = this.buildWorld();
    this.player = new Player(this, spawn.x, spawn.y);
    this.player.hp = this.run.hp;
    this.player.maxHp = this.run.maxHp;
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    // 衝突
    for (const w of this.walls) {
      this.physics.add.collider(this.player, w);
      this.physics.add.collider(this.enemies, w);
      this.physics.add.collider(this.playerBullets, w, (b) => (b as Bullet).kill());
      this.physics.add.collider(this.enemyBullets, w, (b) => (b as Bullet).kill());
    }
    this.physics.add.collider(this.enemies, this.enemies);
    this.physics.add.overlap(this.playerBullets, this.enemies, (b, e) => this.onPlayerBulletHit(b as Bullet, e as Enemy));
    this.physics.add.overlap(this.player, this.enemyBullets, (_p, b) => this.onEnemyBulletHit(b as Bullet));
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => this.onEnemyContact(e as Enemy));

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
        if (!this.dead && this.weapons.startReload()) Sfx.reload();
      },
      switchWeapon: (d) => this.weapons.switch(d),
      debugKey: (code) => {
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
    b.kill();
    Sfx.enemyHit();
    // 与ダメージ由来のポイント（倒しきれなくても少し溜まる）。距離で倍率が変わる武器もある
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
    const dealt = Math.min(b.damage, Math.max(0, e.hp));
    const rate = this.pointRate(weapon ? pointRateAt(weapon, dist) : 1);
    this.gainPoints((dealt / CANCEL.damagePerPoint) * rate, dist, false);
    if (e.damage(b.damage)) this.killEnemy(e, weapon, dist);
  }

  protected killEnemy(e: Enemy, weapon: WeaponDef | null = null, dist = Infinity): void {
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
    const bonus = kb.bonus;
    if (kb.kind) {
      const label = kb.kind === 'close' ? '至近' : kb.kind === 'nemesis' ? '仇討ち' : '狙撃';
      this.presenter.floatText(e.x, e.y - 18, `${label} +${bonus}`, kb.kind === 'close' ? '#ffb35a' : '#9fe8ff', 15);
    }
    if (this.recordTelemetry && (kb.kind === 'snipe' || kb.kind === 'nemesis')) telemetry.snipeKill();
    e.destroy();
    this.gainPoints((e.def.elite ? CANCEL.killPoints.elite : CANCEL.killPoints.normal) + bonus, dist, true);
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

  /** レリックによるポイント倍率の加算（+0.5 なら 0.5）。派生クラス・アイテムが上書きする */
  protected relicAdds(): number[] {
    return [];
  }

  /** 与ダメージ由来のポイント倍率: 武器の倍率 × (1 + レリック加算) を上限つきで */
  protected pointRate(weaponRate: number): number {
    return effectiveRate(rawRate(weaponRate, this.relicAdds()), POINTS.softcap);
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
    return 1 + (this.attackBuffTime > 0 ? this.attackBuff : 0);
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
    if (this.dead) return;
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
    for (const shot of fire.shots) {
      const b = spawnBullet(this.playerBullets, 'pbullet');
      if (!b) continue;
      const ox = this.player.x + Math.cos(shot.angle) * (PLAYER.radius + 6);
      const oy = this.player.y + Math.sin(shot.angle) * (PLAYER.radius + 6);
      b.fire(ox, oy, shot.angle, shot.def.bulletSpeed, {
        damage: shot.def.damage * this.attackMult,
        life: shot.def.range / shot.def.bulletSpeed,
        weapon: shot.def,
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
      fire: (e, angle, speed) => {
        const b = spawnBullet(this.enemyBullets, 'ebullet');
        if (!b) return;
        b.fire(e.x, e.y, angle, speed, { damage: 1, life: ENEMY_BULLET.lifetime, ownerId: e.uid, hitRadius: ENEMY_BULLET.hitRadius });
        Sfx.enemyShoot();
      },
    };
    const killable: Array<{ x: number; y: number; r: number }> = [];
    const w = this.weapons.current.def;
    const killDamage = w.damage * w.pellets * this.attackMult * FX.killableShots;
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

    tickBullets(this.playerBullets, dt);
    tickBullets(this.enemyBullets, dt);

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

  private drawTelegraphs(): void {
    const g = this.telegraphs;
    g.clear();
    for (const obj of this.enemies.getChildren()) {
      const e = obj as Enemy;
      const t = e.telegraph;
      if (!e.active || !t) continue;
      if (t.type === 'line') {
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
    this.ammoText.setText(`${w.def.name}   ${w.mag} / ${w.def.magazine}   (${reserve})`);
    const lines = this.infoLines();
    if (this.attackBuffTime > 0) lines.push(`攻撃力 +${Math.round(this.attackBuff * 100)}%  ${this.attackBuffTime.toFixed(1)}s`);
    this.infoText.setText(lines.join('\n'));

    // リロード中は自機の下にバー
    this.reloadBar.clear();
    if (this.weapons.reloading > 0) {
      const ratio = 1 - this.weapons.reloading / w.def.reloadTime;
      const x = this.player.x - 18;
      const y = this.player.y + FX.ringRadius + 18;
      this.reloadBar.fillStyle(0x222222, 0.8).fillRect(x, y, 36, 4);
      this.reloadBar.fillStyle(0xffffff, 1).fillRect(x, y, 36 * ratio, 4);
    }
  }
}
