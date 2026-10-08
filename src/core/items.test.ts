import { describe, expect, it } from 'vitest';
import { ITEMS, rollChestChoices, type ItemId } from './items';
import { createRng } from './rng';

const ALL_W = ['handgun', 'shotgun', 'machinegun', 'laser', 'ricochet', 'rocket'] as const;

describe('宝箱の3択', () => {
  it('候補は3つで、重複しない', () => {
    for (let seed = 1; seed < 200; seed++) {
      const c = rollChestChoices(createRng(seed), { ownedItems: [], ownedWeapons: ['handgun'], allWeapons: ALL_W, n: 3 });
      expect(c).toHaveLength(3);
      expect(new Set(c.map((x) => `${x.kind}:${x.id}`)).size).toBe(3);
    }
  });

  it('最初の宝箱では、予告中のポイント倍率レリックが必ず候補に入る', () => {
    for (let seed = 1; seed < 200; seed++) {
      const c = rollChestChoices(createRng(seed), { ownedItems: [], ownedWeapons: ['handgun'], allWeapons: ALL_W, n: 3, guaranteed: 'backwater' });
      expect(c.some((x) => x.kind === 'item' && x.id === 'backwater')).toBe(true);
    }
  });

  it('持っているアイテム・武器は候補に出さない', () => {
    const owned = (Object.keys(ITEMS) as ItemId[]).filter((id) => id !== 'hourglass');
    const c = rollChestChoices(createRng(3), { ownedItems: owned, ownedWeapons: [...ALL_W].filter((w) => w !== 'laser'), allWeapons: ALL_W, n: 3 });
    expect(c.map((x) => x.id).sort()).toEqual(['hourglass', 'laser']);
  });
});
