// 入力をまとめる。PC（キーボード＋マウス）とスマホ（タッチの仮想スティック）の両対応。
// タッチ操作:
//   画面左半分をドラッグ → 移動スティック（触れた場所に出る）
//   画面右半分をドラッグ → 照準スティック。倒している間は射撃
//   ボタン（ダッシュ / リロード / 武器切替）→ 右の黒帯。黒帯が狭い機種では画面の右端
//   ボタンは DOM 要素（キャンバスの外の黒帯にも置けるように）
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

const BUTTON_LABEL: Record<ButtonId, string> = { dash: 'ダッシュ', reload: 'リロード', switch: '武器' };

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
  /** ボタンが黒帯に置かれているか（false なら画面の中に重なっている） */
  buttonsInBar = false;

  private readonly scene: Phaser.Scene;
  private readonly handlers: ControlHandlers;
  private readonly keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  /** ボタン（DOM）と、その中心のページ座標・直径 */
  private readonly buttons = new Map<ButtonId, { el: HTMLDivElement; x: number; y: number; size: number }>();
  private readonly buttonLayer: HTMLDivElement;
  /** ボタンを押している指（Touch.identifier → ボタン） */
  private pressed = new Map<number, ButtonId>();
  /** 押している指の最新のページ座標（Touch.identifier → 座標） */
  private touches = new Map<number, { pageX: number; pageY: number }>();
  private readonly domListeners: Array<[string, (e: TouchEvent) => void]> = [];
  private readonly gfx: Phaser.GameObjects.Graphics;
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

    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(160);

    // ボタン（DOM）。タッチはページ全体の touch イベントで判定するので、要素自体は触れない
    this.buttonLayer = document.createElement('div');
    this.buttonLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;';
    for (const id of ['dash', 'reload', 'switch'] as ButtonId[]) {
      const size = TOUCH.buttonSize[id];
      const el = document.createElement('div');
      el.textContent = BUTTON_LABEL[id];
      el.style.cssText = [
        'position:absolute',
        `width:${size}px`,
        `height:${size}px`,
        'margin-left:' + -size / 2 + 'px',
        'margin-top:' + -size / 2 + 'px',
        'border-radius:50%',
        'border:2px solid rgba(255,255,255,0.45)',
        'background:rgba(255,255,255,0.12)',
        'color:#fff',
        `font:bold ${id === 'dash' ? 13 : 11}px sans-serif`,
        'white-space:nowrap',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'user-select:none',
      ].join(';');
      this.buttonLayer.appendChild(el);
      this.buttons.set(id, { el, x: 0, y: 0, size });
    }
    document.body.appendChild(this.buttonLayer);

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
    this.buttonLayer.remove();
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
    this.layoutButtons();
    for (const t of Array.from(e.changedTouches)) {
      this.touches.set(t.identifier, { pageX: t.pageX, pageY: t.pageY });
      this.onFingerDown(t.identifier, t.clientX, t.clientY, this.toGame(t));
    }
  }

  private onFingerDown(id: number, cx: number, cy: number, p: { x: number; y: number }): void {
    for (const [bid, b] of this.buttons) {
      if (Math.hypot(cx - b.x, cy - b.y) > b.size / 2 + 8) continue;
      this.pressed.set(id, bid);
      if (bid === 'dash') this.handlers.dash();
      else if (bid === 'reload') this.handlers.reload();
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

  /**
   * ボタンの位置を決める。右の黒帯が十分広ければ黒帯に、狭ければ画面の右端の内側に置く。
   * 座標はページ（CSS px）。
   */
  private layoutButtons(): void {
    const rect = this.scene.game.canvas.getBoundingClientRect();
    const bar = window.innerWidth - rect.right;
    const S = TOUCH.buttonSize;
    const m = TOUCH.inCanvasMargin;
    const place = (id: ButtonId, x: number, y: number) => {
      const b = this.buttons.get(id)!;
      b.x = x;
      b.y = y;
      b.el.style.left = `${x}px`;
      b.el.style.top = `${y}px`;
    };
    this.buttonsInBar = bar >= S.dash + TOUCH.barPadding * 2;
    if (this.buttonsInBar) {
      const cx = rect.right + bar / 2;
      place('dash', cx, rect.bottom - m - S.dash / 2);
      place('reload', cx, rect.bottom - m * 2 - S.dash - S.reload / 2);
      place('switch', cx, rect.top + m + S.switch / 2);
    } else {
      place('dash', rect.right - m - S.dash / 2, rect.bottom - m - S.dash / 2);
      place('reload', rect.right - m * 2 - S.dash - S.reload / 2, rect.bottom - m - S.reload / 2);
      place('switch', rect.right - m - S.switch / 2, rect.top + m + S.switch / 2);
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
    this.buttonLayer.style.display = this.touchMode ? 'block' : 'none';
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

    this.layoutButtons();
    const pressedIds = new Set(this.pressed.values());
    for (const [id, b] of this.buttons) {
      b.el.style.background = pressedIds.has(id) ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)';
      if (id === 'dash' && this.dashReady < 1) {
        // クールダウン中は時計回りに埋まる
        const deg = Math.round(this.dashReady * 360);
        b.el.style.background = `conic-gradient(rgba(159,232,255,0.55) ${deg}deg, rgba(255,255,255,0.08) ${deg}deg)`;
      }
    }
  }
}
