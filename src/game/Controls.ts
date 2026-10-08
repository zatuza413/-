// 入力をまとめる。PC（キーボード＋マウス）とスマホ（タッチの仮想スティック）の両対応。
// タッチ操作:
//   画面左半分をドラッグ → 移動スティック（触れた場所に出る）
//   画面右半分をドラッグ → 照準スティック。倒している間は射撃
//   右下のボタン → ダッシュ / リロード、右上 → 武器切替
// 最後に触った入力（タッチかマウスか）で表示を切り替える。
// タッチは Phaser を通さず DOM の touch イベントをページ全体で直接読む。
// （Phaser はキャンバス外の指の移動を無視するため、横長スマホの左右の黒帯に
//   親指を置くとスティックが効かなくなる）

import Phaser from 'phaser';
import { TOUCH } from '../config/balance';

interface Stick {
  /** Touch.identifier */
  touchId: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

type ButtonId = 'dash' | 'reload' | 'switch';

interface Button {
  id: ButtonId;
  x: number;
  y: number;
  r: number;
  label: string;
}

export interface ControlHandlers {
  dash(): void;
  reload(): void;
  switchWeapon(delta: number): void;
  /** テスト用キー（PCのみ） */
  debugKey?(key: string): void;
}

export class Controls {
  /** タッチ操作で遊んでいるか（最後の入力で切り替わる） */
  touchMode: boolean;
  /** 移動入力（長さ 0〜1） */
  readonly move = new Phaser.Math.Vector2();
  /** 照準角 */
  aim = 0;
  /** 射撃ボタンを押しているか */
  fireHeld = false;
  /** ダッシュボタンのクールダウン表示用 (0〜1、1 で使用可) */
  dashReady = 1;

  private readonly scene: Phaser.Scene;
  private readonly handlers: ControlHandlers;
  private readonly keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  private readonly buttons: Button[];
  /** ボタンを押している指（Touch.identifier → ボタン） */
  private pressed = new Map<number, ButtonId>();
  /** 押している指の最新のページ座標（Touch.identifier → 座標） */
  private touches = new Map<number, { pageX: number; pageY: number }>();
  private readonly domListeners: Array<[string, (e: TouchEvent) => void]> = [];
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];
  /** タッチモードの表示が変わったとき */
  onModeChange?: (touch: boolean) => void;

  constructor(scene: Phaser.Scene, handlers: ControlHandlers) {
    this.scene = scene;
    this.handlers = handlers;
    this.touchMode = scene.sys.game.device.input.touch && !scene.sys.game.device.os.desktop;

    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D') as Controls['keys'];
    kb.on('keydown', (e: KeyboardEvent) => {
      this.setTouchMode(false);
      switch (e.code) {
        case 'KeyR':
          handlers.reload();
          break;
        case 'KeyQ':
          handlers.switchWeapon(-1);
          break;
        case 'KeyE':
          handlers.switchWeapon(1);
          break;
        default:
          handlers.debugKey?.(e.code);
      }
    });

    const { width, height } = scene.scale;
    const T = TOUCH;
    this.buttons = [
      { id: 'dash', x: width - T.dashButton.right, y: height - T.dashButton.bottom, r: T.dashButton.radius, label: 'ダッシュ' },
      { id: 'reload', x: width - T.reloadButton.right, y: height - T.reloadButton.bottom, r: T.reloadButton.radius, label: 'リロード' },
      { id: 'switch', x: width - T.switchButton.right, y: T.switchButton.top, r: T.switchButton.radius, label: '武器' },
    ];

    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(160);
    for (const b of this.buttons) {
      this.labels.push(
        scene.add
          .text(b.x, b.y, b.label, { fontFamily: 'sans-serif', fontSize: b.r > 40 ? '17px' : '13px', fontStyle: 'bold', color: '#ffffff' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(161),
      );
    }

    // マウス（右クリックでダッシュ）
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) return;
      this.setTouchMode(false);
      if (p.rightButtonDown()) this.handlers.dash();
    });

    // タッチ（ページ全体）
    const add = (type: string, fn: (e: TouchEvent) => void) => {
      window.addEventListener(type, fn as EventListener, { passive: false });
      this.domListeners.push([type, fn]);
    };
    add('touchstart', (e) => this.onTouchStart(e));
    add('touchend', (e) => this.onTouchEnd(e));
    add('touchcancel', (e) => this.onTouchEnd(e));
    add('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.touches.has(t.identifier)) this.touches.set(t.identifier, { pageX: t.pageX, pageY: t.pageY });
      }
      // スクロールやズームを止める
      if (e.cancelable) e.preventDefault();
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  destroy(): void {
    for (const [type, fn] of this.domListeners) window.removeEventListener(type, fn as EventListener);
    this.domListeners.length = 0;
  }

  /** ページ座標 → ゲーム画面座標 */
  private toGame(t: { pageX: number; pageY: number }): { x: number; y: number } {
    return { x: this.scene.scale.transformX(t.pageX), y: this.scene.scale.transformY(t.pageY) };
  }

  private setTouchMode(touch: boolean): void {
    if (this.touchMode === touch) return;
    this.touchMode = touch;
    if (!touch) {
      this.moveStick = null;
      this.aimStick = null;
      this.pressed.clear();
      this.touches.clear();
    }
    this.onModeChange?.(touch);
  }

  // ------------------------------------------------------------ タッチ

  private onTouchStart(e: TouchEvent): void {
    if (!this.scene.sys.isActive()) return;
    this.setTouchMode(true);
    for (const t of Array.from(e.changedTouches)) {
      this.touches.set(t.identifier, { pageX: t.pageX, pageY: t.pageY });
      this.onFingerDown(t.identifier, this.toGame(t));
    }
  }

  private onFingerDown(id: number, p: { x: number; y: number }): void {
    const btn = this.buttons.find((b) => Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) <= b.r + 8);
    if (btn) {
      this.pressed.set(id, btn.id);
      if (btn.id === 'dash') this.handlers.dash();
      else if (btn.id === 'reload') this.handlers.reload();
      else this.handlers.switchWeapon(1);
      return;
    }
    const stick: Stick = { touchId: id, ox: p.x, oy: p.y, x: p.x, y: p.y };
    if (p.x < this.scene.scale.width / 2) {
      if (!this.moveStick) this.moveStick = stick;
    } else if (!this.aimStick) {
      this.aimStick = stick;
    }
  }

  /** 指の現在位置をスティックに反映する */
  private trackSticks(): void {
    for (const s of [this.moveStick, this.aimStick]) {
      if (!s) continue;
      const t = this.touches.get(s.touchId);
      if (!t) continue;
      const p = this.toGame(t);
      s.x = p.x;
      s.y = p.y;
      // 指が大きく離れたら土台もついてくる（端まで行っても操作し続けられる）
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const d = Math.hypot(dx, dy);
      const max = TOUCH.stickRadius * 1.6;
      if (d > max) {
        s.ox = s.x - (dx / d) * max;
        s.oy = s.y - (dy / d) * max;
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      const id = t.identifier;
      this.touches.delete(id);
      if (this.moveStick?.touchId === id) this.moveStick = null;
      if (this.aimStick?.touchId === id) this.aimStick = null;
      this.pressed.delete(id);
    }
  }

  // ------------------------------------------------------------ 毎フレーム

  /** 入力を読む。playerX/Y はワールド座標（マウス照準用） */
  update(camera: Phaser.Cameras.Scene2D.Camera, playerX: number, playerY: number): void {
    if (!this.touchMode) {
      this.move.set((this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0), (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0));
      if (this.move.lengthSq() > 0) this.move.normalize();
      const p = this.scene.input.activePointer;
      const w = p.positionToCamera(camera) as Phaser.Math.Vector2;
      this.aim = Phaser.Math.Angle.Between(playerX, playerY, w.x, w.y);
      this.fireHeld = p.leftButtonDown() && !p.wasTouch;
      return;
    }

    this.trackSticks();
    this.move.set(0, 0);
    const m = this.stickVector(this.moveStick);
    if (m) this.move.copy(m);

    const a = this.stickVector(this.aimStick);
    if (a) {
      this.aim = Math.atan2(a.y, a.x);
      this.fireHeld = true;
    } else {
      this.fireHeld = false;
    }
  }

  /** スティックの倒し具合（長さ 0〜1）。デッドゾーン内なら null */
  private stickVector(s: Stick | null): Phaser.Math.Vector2 | null {
    if (!s) return null;
    const v = new Phaser.Math.Vector2(s.x - s.ox, s.y - s.oy);
    const d = v.length();
    if (d < TOUCH.deadZone) return null;
    return v.scale(Math.min(1, d / TOUCH.stickRadius) / d);
  }

  /** タッチ操作の UI を描く */
  draw(): void {
    const g = this.gfx;
    g.clear();
    for (const l of this.labels) l.setVisible(this.touchMode);
    if (!this.touchMode) return;

    for (const [s, col] of [
      [this.moveStick, 0x9fe8ff],
      [this.aimStick, 0xffd84a],
    ] as const) {
      if (!s) continue;
      // 黒帯（画面外）で触れていても見えるよう、描く位置だけ画面内に寄せる
      const m = TOUCH.stickRadius + 8;
      const bx = Phaser.Math.Clamp(s.ox, m, this.scene.scale.width - m);
      const by = Phaser.Math.Clamp(s.oy, m, this.scene.scale.height - m);
      g.lineStyle(2, col, 0.5).strokeCircle(bx, by, TOUCH.stickRadius);
      g.fillStyle(col, 0.08).fillCircle(bx, by, TOUCH.stickRadius);
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const d = Math.hypot(dx, dy);
      const k = d > TOUCH.stickRadius ? TOUCH.stickRadius / d : 1;
      g.fillStyle(col, 0.5).fillCircle(bx + dx * k, by + dy * k, 24);
    }

    const pressedIds = new Set(this.pressed.values());
    for (const b of this.buttons) {
      const down = pressedIds.has(b.id);
      g.fillStyle(0xffffff, down ? 0.3 : 0.12).fillCircle(b.x, b.y, b.r);
      g.lineStyle(2, 0xffffff, 0.45).strokeCircle(b.x, b.y, b.r);
      if (b.id === 'dash' && this.dashReady < 1) {
        // クールダウン中は時計回りに埋まる
        g.lineStyle(5, 0x9fe8ff, 0.9);
        g.beginPath();
        g.arc(b.x, b.y, b.r - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.dashReady);
        g.strokePath();
      }
    }
  }
}
