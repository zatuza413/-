// ゲーム本編（段階2: 相殺を試すためのテスト部屋）
// 段階3でフロア生成に置き換える。部屋の中身（ウェーブ・床ギミック）は TEST_ROOM で調整する。

import Phaser from 'phaser';
import { CANCEL, CHAIN, ENEMIES, ENEMY_BULLET, FX, PLAYER, STARTING_WEAPONS, TEST_ROOM } from '../config/balance';
import { DamageQueue } from '../core/DamageQueue';
import { Bullet, createBulletGroup, spawnBullet, tickBullets } from '../game/Bullets';
import { CancelPresenter } from '../game/CancelPresenter';
import { Enemy } from '../game/Enemy';
import type { EnemyContext } from '../game/enemyBehaviors';
import { Player } from '../game/Player';
import { Controls } from '../game/Controls';
import { Sfx } from '../game/Sfx';
import { WeaponSystem } from '../game/WeaponSystem';

interface SourceInfo {
  x: number;
  y: number;
  name: string;
  alive: boolean;
}

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private controls!: Controls;
  private queue!: DamageQueue;
  private presenter!: CancelPresenter;
  private weapons!: WeaponSystem;

  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private enemies!: Phaser.Physics.Arcade.Group;
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private telegraphs!: Phaser.GameObjects.Graphics;

  /** 予告元の敵情報（倒された敵も最後の位置を覚えておく） */
  private sources = new Map<number, SourceInfo>();

  private fireZone = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  private pitZone = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  private wasInFire = false;

  private waveIndex = 0;
  private waveTimer = 0;
  private waveActive = false;

  private attackBuff = 0;
  private attackBuffTime = 0;
  private hitstopUntil = 0;
  private dead = false;

  // HUD
  private hud!: Phaser.GameObjects.Graphics;
  private ammoText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private helpText!: Phaser.GameObjects.Text;
  private reloadBar!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Game');
  }

  create(): void {
    this.sources.clear();
    this.dead = false;
    this.waveIndex = 0;
    this.waveTimer = 1.0;
    this.waveActive = false;
    this.attackBuff = 0;
    this.attackBuffTime = 0;
    this.hitstopUntil = 0;
    this.wasInFire = false;

    const W = TEST_ROOM.width;
    const H = TEST_ROOM.height;
    this.physics.world.setBounds(0, 0, W, H);
    this.cameras.main.setBounds(0, 0, W, H);
    this.input.mouse?.disableContextMenu();

    this.buildRoom(W, H);

    this.player = new Player(this, W / 2, H / 2 + 120);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    this.queue = new DamageQueue(CANCEL);
    this.weapons = new WeaponSystem(STARTING_WEAPONS);

    this.enemies = this.physics.add.group();
    this.playerBullets = createBulletGroup(this, 'pbullet', 200);
    this.enemyBullets = createBulletGroup(this, 'ebullet', 400);
    this.telegraphs = this.add.graphics().setDepth(4);

    // 衝突
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    this.physics.add.collider(this.enemies, this.enemies);
    this.physics.add.collider(this.playerBullets, this.walls, (b) => (b as Bullet).kill());
    this.physics.add.collider(this.enemyBullets, this.walls, (b) => (b as Bullet).kill());
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

    this.queue.on((e) => {
      if (e.type === 'confirmed') this.onConfirmed(e.damage);
    });

    this.createHud();
    this.bindInput();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.presenter.destroy());
  }

  // ------------------------------------------------------------ 部屋

  private buildRoom(W: number, H: number): void {
    this.add.grid(W / 2, H / 2, W, H, 64, 64, 0x191926, 1, 0x222233, 1).setDepth(-10);
    this.walls = this.physics.add.staticGroup();
    const T = 32;
    const wall = (x: number, y: number, w: number, h: number) => {
      const r = this.add.tileSprite(x + w / 2, y + h / 2, w, h, 'wall');
      this.physics.add.existing(r, true);
      this.walls.add(r);
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

    // 火の床（入った時に1回だけ予告）と落とし穴（即時確定）
    this.fireZone.setTo(W * 0.5 - 300, H * 0.5 - 40, 140, 80);
    this.pitZone.setTo(W * 0.5 + 160, H * 0.5 - 40, 120, 80);
    const fz = this.add.rectangle(this.fireZone.centerX, this.fireZone.centerY, this.fireZone.width, this.fireZone.height, 0xff5a1f, 0.28).setDepth(-5);
    fz.setStrokeStyle(2, 0xff8a3f, 0.8);
    this.tweens.add({ targets: fz, fillAlpha: 0.4, duration: 400, yoyo: true, repeat: -1 });
    this.add.text(this.fireZone.centerX, this.fireZone.centerY, '火の床', { fontFamily: 'sans-serif', fontSize: '14px', color: '#ffb080' }).setOrigin(0.5).setDepth(-4);
    this.add.rectangle(this.pitZone.centerX, this.pitZone.centerY, this.pitZone.width, this.pitZone.height, 0x000000, 1).setDepth(-5).setStrokeStyle(2, 0x444466);
    this.add.text(this.pitZone.centerX, this.pitZone.centerY, '落とし穴', { fontFamily: 'sans-serif', fontSize: '14px', color: '#7777aa' }).setOrigin(0.5).setDepth(-4);
  }

  private spawnEnemy(id: string, x?: number, y?: number): Enemy {
    const def = ENEMIES[id];
    const W = TEST_ROOM.width;
    const H = TEST_ROOM.height;
    // 自機から離れた位置に出す
    let px = x ?? 0;
    let py = y ?? 0;
    if (x === undefined || y === undefined) {
      for (let i = 0; i < 30; i++) {
        px = Phaser.Math.Between(80, W - 80);
        py = Phaser.Math.Between(80, H - 80);
        const inHazard = this.fireZone.contains(px, py) || this.pitZone.contains(px, py);
        if (!inHazard && Phaser.Math.Distance.Between(px, py, this.player.x, this.player.y) > 300) break;
      }
    }
    const e = new Enemy(this, px, py, def);
    this.enemies.add(e);
    // add で body 設定が上書きされるので再設定
    (e.body as Phaser.Physics.Arcade.Body).setCircle(def.radius, e.width / 2 - def.radius, e.height / 2 - def.radius).setCollideWorldBounds(true);
    this.sources.set(e.uid, { x: e.x, y: e.y, name: def.name, alive: true });
    return e;
  }

  private startWave(): void {
    const wave = TEST_ROOM.waves[this.waveIndex % TEST_ROOM.waves.length];
    this.waveIndex++;
    for (const id of wave) this.spawnEnemy(id);
    this.waveActive = true;
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
        // テスト用
        if (this.dead) return;
        if (code === 'Digit1') this.spawnEnemy('shooter');
        else if (code === 'Digit2') this.spawnEnemy('charger');
        else if (code === 'KeyH') this.helpText.setVisible(!this.helpText.visible);
      },
    });
    this.controls.onModeChange = () => this.layoutHud();
    this.layoutHud();
  }

  // ------------------------------------------------------------ 当たり

  private onPlayerBulletHit(b: Bullet, e: Enemy): void {
    if (!b.active || !e.active || e.isSpawning) return;
    b.kill();
    Sfx.enemyHit();
    // 与ダメージ由来のポイント（倒しきれなくても少し溜まる）
    const dealt = Math.min(b.damage, Math.max(0, e.hp));
    this.queue.addPoints((dealt / CANCEL.damagePerPoint) * b.pointRate, { canDouble: false });
    if (e.damage(b.damage)) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
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
    e.destroy();
    this.queue.addPoints(e.def.elite ? CANCEL.killPoints.elite : CANCEL.killPoints.normal);

    // 部屋（ウェーブ）の全滅: 残った予告はすべて消える
    if (this.waveActive && this.enemies.countActive(true) === 0) {
      this.waveActive = false;
      this.waveTimer = TEST_ROOM.waveDelay;
      this.queue.clearAll();
    }
  }

  private onEnemyBulletHit(b: Bullet): void {
    if (!b.active || this.dead) return;
    b.kill();
    this.queue.hit('bullet', b.ownerId);
  }

  private onEnemyContact(e: Enemy): void {
    if (this.dead || e.isSpawning || e.stun > 0 || !e.contactActive) return;
    this.queue.hit('contact', e.uid);
  }

  private onConfirmed(damage: number): void {
    this.player.hp = Math.max(0, this.player.hp - damage);
    this.player.setTintFill(0xffffff);
    this.time.delayedCall(FX.hitstopMs + 60, () => this.player.clearTint());
    if (this.player.hp <= 0) this.die();
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

  private die(): void {
    this.dead = true;
    Sfx.death();
    this.physics.world.pause();
    const s = this.queue.stats;
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.7).setOrigin(0).setScrollFactor(0).setDepth(200);
    const lines = [
      '相殺に失敗した',
      '',
      `被弾 ${s.hits}   相殺 ${s.cancels}   連鎖 ${s.chains}（最大 ×${s.bestChain}）`,
      `確定  時間切れ ${s.confirms.timeout} / 上限超過 ${s.confirms.overflow} / 即時 ${s.confirms.instant}`,
      `部屋クリアで消えた予告 ${s.roomClearWipes}`,
      '',
      this.controls.touchMode ? 'タップで再挑戦' : 'クリックで再挑戦',
    ];
    this.add
      .text(width / 2, height / 2, lines.join('\n'), { fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff', align: 'center', lineSpacing: 8 })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    this.time.delayedCall(600, () => this.input.once('pointerdown', () => this.scene.restart()));
  }

  update(time: number, deltaMs: number): void {
    if (this.dead) return;
    if (time < this.hitstopUntil) return;
    if (this.physics.world.isPaused) this.physics.world.resume();

    const dt = Math.min(deltaMs, 50) / 1000;
    this.controls.update(this.cameras.main, this.player.x, this.player.y);

    // 自機
    this.player.tick(dt, this.controls.move, this.controls.aim);
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
        pointRate: shot.def.pointRate,
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
    const killDamage = this.weapons.current.def.damage * this.attackMult * FX.killableShots;
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
    this.presenter.drawKillMarks(killable);

    // ウェーブ
    if (!this.waveActive) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.startWave();
    }

    this.updateHud();
  }

  private updateHazards(): void {
    const { x, y } = this.player;
    // 火の床: 入った瞬間に1回だけ予告を積む
    const inFire = this.fireZone.contains(x, y);
    if (inFire && !this.wasInFire) this.queue.hit('hazard', null);
    this.wasInFire = inFire;

    // 落とし穴: ダッシュ中は飛び越せる。止まった位置が穴なら即時確定
    const inPit = this.pitZone.contains(x, y);
    if (inPit && !this.player.isDashing) {
      this.queue.instant('pit');
      this.player.setPosition(this.player.safeX, this.player.safeY);
      (this.player.body as Phaser.Physics.Arcade.Body).reset(this.player.safeX, this.player.safeY);
    } else {
      const margin = new Phaser.Geom.Rectangle(this.pitZone.x - 24, this.pitZone.y - 24, this.pitZone.width + 48, this.pitZone.height + 48);
      if (!margin.contains(x, y)) {
        this.player.safeX = x;
        this.player.safeY = y;
      }
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
    this.infoText = this.add.text(16, 48, '', { ...style, fontSize: '14px' }).setScrollFactor(0).setDepth(150);
    this.helpText = this.add
      .text(
        16,
        this.scale.height - 16,
        [
          'WASD 移動 / 左クリック 射撃 / 右クリック ダッシュ / R リロード / Q・E 武器切替',
          'テスト用: 1 直進撃ち出現 / 2 突進出現 / H この表示を切替',
        ].join('\n'),
        { ...style, fontSize: '13px', color: '#aaaacc' },
      )
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(150);
  }

  /** PC とタッチで HUD の配置を変える（タッチではボタンと重ならないように） */
  private layoutHud(): void {
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
    this.infoText.setText(
      [`ウェーブ ${this.waveIndex}`, this.attackBuffTime > 0 ? `攻撃力 +${Math.round(this.attackBuff * 100)}%  ${this.attackBuffTime.toFixed(1)}s` : '']
        .filter(Boolean)
        .join('\n'),
    );
    this.infoText.setY(54);

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
