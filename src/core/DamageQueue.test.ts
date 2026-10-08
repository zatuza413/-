import { describe, expect, it } from 'vitest';
import { DamageQueue, type DamageQueueConfig, type DamageQueueEvent } from './DamageQueue';

const CFG: DamageQueueConfig = {
  baseTimer: 3,
  maxTimer: 6,
  maxPending: 4,
  stackGuard: 0.3,
  postConfirmInvuln: 0.8,
  confirmDamage: 1,
  baseMaxStock: 1,
  chainWindow: 1.5,
  chainMin: 2,
  chainWindowMax: 2.5,
  rapidChainLimit: { enabled: false, window: 0.1, maxSteps: 2 },
  maxDebt: 1,
  grace: { threshold: 0.8, delay: 0.5 },
};

function setup(cfg: Partial<DamageQueueConfig> = {}, rng?: () => number) {
  const q = new DamageQueue({ ...CFG, ...cfg }, rng);
  const events: DamageQueueEvent[] = [];
  q.on((e) => events.push(e));
  const of = <T extends DamageQueueEvent['type']>(t: T) =>
    events.filter((e): e is Extract<DamageQueueEvent, { type: T }> => e.type === t);
  return { q, events, of };
}

/** 予告無敵を抜けるだけ時間を進めつつ n 回被弾させる */
function hitN(q: DamageQueue, n: number, gap = 0.31) {
  for (let i = 0; i < n; i++) {
    q.hit('bullet', i + 1);
    q.update(gap);
  }
}

describe('積む', () => {
  it('被弾すると予告が1つ積まれ、HPは減らない', () => {
    const { q, of } = setup();
    expect(q.hit('bullet', 7)).toBe('queued');
    expect(q.count).toBe(1);
    expect(q.pending[0].remaining).toBe(3);
    expect(q.pending[0].sourceId).toBe(7);
    expect(of('confirmed')).toHaveLength(0);
    expect(q.stats.hits).toBe(1);
  });

  it('タイマー延長は上限6秒を超えない', () => {
    const { q } = setup();
    q.setModifiers({ timerBonus: 10 });
    q.hit('bullet');
    expect(q.pending[0].duration).toBe(6);
  });
});

describe('時間切れで確定', () => {
  it('タイマーが0になると timeout で確定する', () => {
    const { q, of } = setup();
    q.hit('contact', 3);
    q.update(2.99);
    expect(of('confirmed')).toHaveLength(0);
    q.update(0.02);
    const c = of('confirmed');
    expect(c).toHaveLength(1);
    expect(c[0].reason).toBe('timeout');
    expect(c[0].sourceId).toBe(3);
    expect(c[0].damage).toBe(1);
    expect(q.count).toBe(0);
    expect(q.stats.confirms.timeout).toBe(1);
  });

  it('確定時に足りなかったポイント量を報告する', () => {
    const { q, of } = setup();
    q.hit('bullet');
    q.addPoints(0.75);
    q.update(3.1);
    expect(of('confirmed')[0].pointShort).toBeCloseTo(0.25);
  });

  it('確定直後は無敵になり、被弾が無視される', () => {
    const { q, of } = setup();
    q.hit('bullet');
    q.update(3.01);
    expect(q.isInvulnerable).toBe(true);
    expect(q.hit('bullet')).toBe('ignored');
    expect(of('ignored')[0].reason).toBe('invulnerable');
    q.update(0.8);
    expect(q.hit('bullet')).toBe('queued');
  });
});

describe('上限超過', () => {
  it('予告が4つある状態での被弾は即座に overflow で確定する', () => {
    const { q, of } = setup();
    hitN(q, 4);
    expect(q.count).toBe(4);
    expect(q.hit('bullet', 99)).toBe('overflow');
    const c = of('confirmed');
    expect(c).toHaveLength(1);
    expect(c[0].reason).toBe('overflow');
    expect(c[0].sourceId).toBe(99);
    expect(q.count).toBe(4); // 既存の予告は残る
    expect(q.stats.confirms.overflow).toBe(1);
  });
});

describe('予告無敵（スタックガード）', () => {
  it('予告が積まれた直後0.3秒は次の予告が積まれない', () => {
    const { q, of } = setup();
    q.hit('bullet');
    expect(q.hit('bullet')).toBe('ignored');
    expect(of('ignored')[0].reason).toBe('stackGuard');
    q.update(0.29);
    expect(q.hit('bullet')).toBe('ignored');
    q.update(0.02);
    expect(q.hit('bullet')).toBe('queued');
    expect(q.count).toBe(2);
    expect(q.stats.hits).toBe(2);
  });
});

describe('即時確定', () => {
  it('落とし穴などは予告を経ずに確定する', () => {
    const { q, of } = setup();
    expect(q.instant('pit')).toBe(true);
    expect(of('confirmed')[0].reason).toBe('instant');
    expect(q.count).toBe(0);
  });

  it('無敵中は無視されるが、bypassInvuln なら必ず払う', () => {
    const { q, of } = setup();
    q.instant('pit');
    expect(q.instant('pit')).toBe(false);
    expect(q.instant('sacrifice', { bypassInvuln: true, damage: 2 })).toBe(true);
    const c = of('confirmed');
    expect(c).toHaveLength(2);
    expect(c[1].damage).toBe(2);
  });
});

describe('相殺の順番', () => {
  it('タイマー残りの少ないものから消す', () => {
    const { q, of } = setup();
    q.hit('bullet', 1);
    q.update(1.0);
    q.hit('bullet', 2);
    q.update(0.5);
    q.hit('bullet', 3);
    q.addPoints(1);
    expect(of('cancelled')[0].pending.sourceId).toBe(1);
    q.addPoints(1);
    expect(of('cancelled')[1].pending.sourceId).toBe(2);
    expect(q.pending.map((p) => p.sourceId)).toEqual([3]);
  });

  it('タイマー長が違っても残りの少ない順に並ぶ', () => {
    const { q } = setup();
    q.setModifiers({ timerBonus: 2 }); // 5秒
    q.hit('bullet', 1);
    q.update(0.5); // 残り 4.5
    q.setModifiers({ timerBonus: 0 });
    q.hit('bullet', 2); // 残り 3
    expect(q.pending.map((p) => p.sourceId)).toEqual([2, 1]);
  });

  it('端数のポイントが溜まって1になったら相殺する', () => {
    const { q, of } = setup();
    q.hit('bullet');
    q.addPoints(0.4);
    q.addPoints(0.4);
    expect(of('cancelled')).toHaveLength(0);
    q.addPoints(0.3);
    expect(of('cancelled')).toHaveLength(1);
    expect(q.partial).toBeCloseTo(0.1);
  });
});

describe('ストック', () => {
  it('予告が無いときのポイントは最大1までストックされる', () => {
    const { q } = setup();
    q.addPoints(1);
    q.addPoints(1);
    expect(q.stock).toBe(1);
  });

  it('ストックは次の被弾を即座に相殺する', () => {
    const { q, of } = setup();
    q.addPoints(1);
    expect(q.hit('bullet', 5)).toBe('cancelledByStock');
    expect(q.count).toBe(0);
    expect(q.stock).toBe(0);
    expect(of('cancelled')[0].viaStock).toBe(true);
    // ストックで消してもスタックガードは働く
    expect(q.hit('bullet')).toBe('ignored');
  });

  it('ストック上限はアイテムで増やせ、下がれば切り詰める', () => {
    const { q } = setup();
    q.setModifiers({ stockBonus: 1 });
    q.addPoints(3);
    expect(q.stock).toBe(2);
    q.setModifiers({ stockBonus: 0 });
    expect(q.stock).toBe(1);
  });

  it('二重相殺: 確率でポイントが2倍になる', () => {
    const { q, of } = setup({}, () => 0); // 必ず当たる
    q.setModifiers({ doublePointChance: 0.5 });
    hitN(q, 2);
    q.addPoints(1);
    expect(of('cancelled')).toHaveLength(2);
    expect(of('pointGained')[0].doubled).toBe(true);
  });
});

describe('連鎖判定', () => {
  it('1.5秒以内に2つ相殺すると連鎖', () => {
    const { q, of } = setup();
    hitN(q, 3);
    q.addPoints(1);
    expect(of('chain')).toHaveLength(0);
    q.update(1.4);
    q.addPoints(1);
    expect(of('chain').map((e) => e.count)).toEqual([2]);
    q.update(1.0);
    q.addPoints(1);
    expect(of('chain').map((e) => e.count)).toEqual([2, 3]);
    expect(q.stats.chains).toBe(1);
    expect(q.stats.bestChain).toBe(3);
  });

  it('一度に2ポイント入っても連鎖になる', () => {
    const { q, of } = setup();
    hitN(q, 2);
    q.addPoints(2);
    expect(of('chain').map((e) => e.count)).toEqual([2]);
  });

  it('間隔が1.5秒を超えると連鎖は途切れる', () => {
    const { q, of } = setup();
    hitN(q, 3);
    q.addPoints(1);
    q.update(1.6);
    q.addPoints(1);
    expect(of('chain')).toHaveLength(0);
  });

  it('連鎖が終わると chainEnded が出る', () => {
    const { q, of } = setup();
    hitN(q, 2);
    q.addPoints(2);
    q.update(1.6);
    expect(of('chainEnded').map((e) => e.count)).toEqual([2]);
    expect(q.chainCount).toBe(0);
  });

  it('連鎖の鐘: 受付時間 ×1.5（1.5秒 → 2.25秒）', () => {
    const { q, of } = setup();
    q.setModifiers({ chainWindowMult: 1.5 });
    expect(q.chainWindow).toBeCloseTo(2.25);
    expect(q.chainMin).toBe(2);
    hitN(q, 2);
    q.addPoints(1);
    q.update(2.2);
    q.addPoints(1);
    expect(of('chain').map((e) => e.count)).toEqual([2]);
  });

  it('連鎖の受付時間は上限2.5秒を超えない', () => {
    const { q } = setup();
    q.setModifiers({ chainWindowMult: 3 });
    expect(q.chainWindow).toBeCloseTo(2.5);
  });

  it('同時撃破の連鎖は残す（制限フラグはオフが初期状態）', () => {
    const { q, of } = setup();
    hitN(q, 3);
    q.addPoints(3);
    expect(of('chain').map((e) => e.count)).toEqual([2, 3]);
  });

  it('制限フラグをオンにすると、0.1秒以内の連続相殺は2段まで', () => {
    const { q, of } = setup({ rapidChainLimit: { enabled: true, window: 0.1, maxSteps: 2 } });
    hitN(q, 4);
    q.addPoints(3); // 同時に3つ
    expect(of('chain').map((e) => e.count)).toEqual([2]);
    expect(q.stats.cancels).toBe(3);
    q.update(0.5);
    q.addPoints(1); // 間を空ければまた伸びる
    expect(of('chain').map((e) => e.count)).toEqual([2, 3]);
  });

  it('ポイントが無駄になったものは連鎖に数えない', () => {
    const { q, of } = setup();
    q.addPoints(5); // ストック1、残りは捨てられる
    expect(of('chain')).toHaveLength(0);
    expect(q.stats.cancels).toBe(0);
  });
});

describe('部屋クリアで全消去', () => {
  it('残っている予告をすべて消し、確定させない', () => {
    const { q, of } = setup();
    hitN(q, 3);
    expect(q.clearAll()).toBe(3);
    expect(q.count).toBe(0);
    q.update(10);
    expect(of('confirmed')).toHaveLength(0);
    expect(of('roomCleared')[0].count).toBe(3);
    // 相殺扱いではない
    expect(q.stats.cancels).toBe(0);
    expect(q.stats.roomClearWipes).toBe(3);
  });

  it('ストックは部屋をまたいで残る', () => {
    const { q } = setup();
    q.addPoints(1);
    q.clearAll();
    expect(q.stock).toBe(1);
  });
});

describe('前借りの証文', () => {
  it('時間切れの瞬間に確定せず消し、借金を1負う', () => {
    const { q, of } = setup();
    q.setModifiers({ canBorrow: true });
    q.hit('bullet');
    q.update(3.01);
    expect(of('confirmed')).toHaveLength(0);
    expect(of('borrowed')).toHaveLength(1);
    expect(q.debt).toBe(1);
    expect(q.count).toBe(0);
  });

  it('借金は1まで（2つ目は確定する）', () => {
    const { q, of } = setup();
    q.setModifiers({ canBorrow: true });
    hitN(q, 2, 0.31);
    q.update(3);
    expect(of('borrowed')).toHaveLength(1);
    expect(of('confirmed')).toHaveLength(1);
    expect(q.debt).toBe(1);
  });

  it('次に得たポイントは返済が先', () => {
    const { q, of } = setup();
    q.setModifiers({ canBorrow: true });
    q.hit('bullet');
    q.update(3.01);
    q.update(1);
    q.hit('bullet');
    q.addPoints(1);
    expect(q.debt).toBe(0);
    expect(of('debtRepaid')).toHaveLength(1);
    expect(q.count).toBe(1); // 返済に回ったので予告は残る
    q.addPoints(1);
    expect(q.count).toBe(0);
  });
});

describe('猶予の天秤', () => {
  it('80%以上溜まっていれば確定を0.5秒延ばす', () => {
    const { q, of } = setup();
    q.setModifiers({ hasGrace: true });
    q.hit('bullet');
    q.addPoints(0.85);
    q.update(3.01);
    expect(of('graced')).toHaveLength(1);
    expect(of('confirmed')).toHaveLength(0);
    q.addPoints(0.2);
    expect(of('cancelled')).toHaveLength(1);
  });

  it('1つの予告につき1回まで', () => {
    const { q, of } = setup();
    q.setModifiers({ hasGrace: true });
    q.hit('bullet');
    q.addPoints(0.9);
    q.update(3.01);
    q.update(0.5);
    expect(of('graced')).toHaveLength(1);
    expect(of('confirmed')).toHaveLength(1);
  });

  it('80%未満なら延ばさない', () => {
    const { q, of } = setup();
    q.setModifiers({ hasGrace: true });
    q.hit('bullet');
    q.addPoints(0.79);
    q.update(3.01);
    expect(of('graced')).toHaveLength(0);
    expect(of('confirmed')).toHaveLength(1);
  });
});

describe('必ず残すもの', () => {
  it('どの補正を最大にしても、予告の上限4と予告無敵0.3秒、即時確定は変わらない', () => {
    const { q, of } = setup({}, () => 0);
    q.setModifiers({ timerBonus: 99, stockBonus: 99, chainWindowMult: 99, doublePointChance: 1, canBorrow: true, hasGrace: true });
    expect(q.maxPending).toBe(4);
    q.hit('bullet');
    expect(q.hit('bullet')).toBe('ignored');
    q.update(0.31);
    hitN(q, 3);
    expect(q.count).toBe(4);
    expect(q.hit('bullet')).toBe('overflow');
    q.update(1);
    expect(q.instant('pit')).toBe(true);
    expect(of('confirmed').map((e) => e.reason)).toEqual(['overflow', 'instant']);
  });
});
