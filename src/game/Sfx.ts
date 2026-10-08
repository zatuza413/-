// 仮の効果音。音声ファイルを使わず WebAudio で合成する（後で差し替える前提）。

type Wave = OscillatorType;

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.5;

  /** ユーザー操作のタイミングで呼ぶ（ブラウザの自動再生制限対策） */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; slideTo?: number; delay?: number; attack?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
    const peak = opts.gain ?? 0.3;
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, opts: { gain?: number; freq?: number; q?: number; type?: BiquadFilterType; delay?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.value = opts.freq ?? 1200;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  // ------------------------------------------------------------ 個別の音

  shoot(): void {
    this.tone(880, 0.05, { type: 'square', gain: 0.05, slideTo: 440 });
  }
  enemyShoot(): void {
    this.tone(520, 0.08, { type: 'triangle', gain: 0.05, slideTo: 300 });
  }
  enemyHit(): void {
    this.noise(0.04, { gain: 0.08, freq: 3000, type: 'highpass' });
  }
  enemyDie(): void {
    this.noise(0.18, { gain: 0.2, freq: 900 });
    this.tone(300, 0.15, { type: 'square', gain: 0.06, slideTo: 80 });
  }
  dash(): void {
    this.noise(0.12, { gain: 0.08, freq: 2500, type: 'bandpass', q: 0.7 });
  }
  reload(): void {
    this.tone(1200, 0.03, { type: 'square', gain: 0.04 });
    this.tone(900, 0.03, { type: 'square', gain: 0.04, delay: 0.08 });
  }
  /** 被弾（予告が積まれた）: 軽い音 */
  pendingHit(): void {
    this.tone(1400, 0.06, { type: 'triangle', gain: 0.09, slideTo: 1000 });
  }
  /** 予告無敵などで弾を吸った */
  absorb(): void {
    this.tone(2000, 0.03, { type: 'sine', gain: 0.03 });
  }
  /** 相殺: 連鎖数が増えるほど音程が上がる */
  cancel(chainCount: number): void {
    const base = 660 * Math.pow(2, Math.min(chainCount - 1, 8) / 12 * 2);
    this.tone(base, 0.18, { type: 'triangle', gain: 0.16 });
    this.tone(base * 1.5, 0.22, { type: 'sine', gain: 0.1, delay: 0.04 });
  }
  /** 連鎖成立: 和音 + 衝撃音 */
  chain(count: number): void {
    const root = 523 * Math.pow(2, Math.min(count - 2, 6) / 12 * 2);
    [1, 1.26, 1.5, 2].forEach((m, i) => this.tone(root * m, 0.45, { type: 'triangle', gain: 0.12, delay: i * 0.035 }));
    this.noise(0.35, { gain: 0.18, freq: 600 });
    this.tone(120, 0.3, { type: 'sine', gain: 0.25, slideTo: 50 });
  }
  stock(): void {
    this.tone(990, 0.12, { type: 'sine', gain: 0.08 });
    this.tone(1320, 0.15, { type: 'sine', gain: 0.06, delay: 0.06 });
  }
  /** 部屋クリアで予告が消えた */
  roomClear(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.1, delay: i * 0.07 }));
  }
  /** 確定: 理由ごとに音を変える。どれも重い */
  confirm(reason: 'timeout' | 'overflow' | 'instant'): void {
    switch (reason) {
      case 'timeout': // 時間切れ: 重く沈む低音
        this.tone(160, 0.5, { type: 'sine', gain: 0.5, slideTo: 40 });
        this.noise(0.3, { gain: 0.35, freq: 400 });
        this.tone(220, 0.35, { type: 'sawtooth', gain: 0.08, slideTo: 60 });
        break;
      case 'overflow': // 上限超過: 不協和のブザー
        this.tone(140, 0.45, { type: 'sawtooth', gain: 0.18 });
        this.tone(149, 0.45, { type: 'sawtooth', gain: 0.18 });
        this.tone(90, 0.4, { type: 'sine', gain: 0.4, slideTo: 40 });
        break;
      case 'instant': // 即時確定: 割れるような破砕音
        this.noise(0.4, { gain: 0.45, freq: 1800, type: 'bandpass', q: 0.5 });
        this.tone(200, 0.3, { type: 'square', gain: 0.12, slideTo: 50 });
        break;
    }
  }
  /** 心音（ドクン） */
  heartbeat(intensity: number): void {
    const g = 0.18 + 0.25 * intensity;
    this.tone(70, 0.12, { type: 'sine', gain: g, slideTo: 45 });
    this.tone(62, 0.12, { type: 'sine', gain: g * 0.7, slideTo: 40, delay: 0.14 });
  }
  death(): void {
    this.tone(200, 1.2, { type: 'sawtooth', gain: 0.15, slideTo: 30 });
    this.noise(0.8, { gain: 0.3, freq: 300 });
  }
}

export const Sfx = new SfxEngine();
