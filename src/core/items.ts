// アイテムの定義と宝箱の抽選（描画から独立）。効果の数値は balance.ts の ITEM_NUM。

import type { Rng } from './rng';
import type { WeaponId } from './types';

export type ItemId =
  // 相殺系（既存）
  | 'hourglass'
  | 'doubleCancel'
  | 'savingsRing'
  | 'wrath'
  | 'chainBell'
  // 相殺系（新規）
  | 'curseReturn'
  | 'debtNote'
  | 'graceScale'
  | 'riskWallet'
  | 'magazineVow'
  // レリック
  | 'backwater'
  | 'focusScope'
  | 'shootdownBarrel'
  | 'counterForm'
  | 'stanceMount'
  | 'grazeCharm'
  | 'quickdrawBelt';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** 宝箱の候補に出す短い説明 */
  desc: string;
  category: 'cancel' | 'relic';
}

export const ITEMS: Record<ItemId, ItemDef> = {
  hourglass: { id: 'hourglass', name: '砂時計', desc: '予告のタイマー +1秒（上限6秒）', category: 'cancel' },
  doubleCancel: { id: 'doubleCancel', name: '二重相殺', desc: '15%の確率で相殺ポイントが2倍', category: 'cancel' },
  savingsRing: { id: 'savingsRing', name: '貯蓄の指輪', desc: 'ストックの上限 +1', category: 'cancel' },
  wrath: { id: 'wrath', name: '怒りの予告', desc: '予告が2つ以上ある間、攻撃力 +25%', category: 'cancel' },
  chainBell: { id: 'chainBell', name: '連鎖の鐘', desc: '連鎖の受付時間 ×1.5（上限2.5秒）', category: 'cancel' },
  curseReturn: { id: 'curseReturn', name: '呪詛返し', desc: '相殺すると、その予告を作った敵に20ダメージ', category: 'cancel' },
  debtNote: { id: 'debtNote', name: '前借りの証文', desc: '時間切れの予告を1つ借金で消す。次のポイントは返済へ', category: 'cancel' },
  graceScale: { id: 'graceScale', name: '猶予の天秤', desc: 'あと少しで相殺できるなら、確定を0.5秒延ばす', category: 'cancel' },
  riskWallet: { id: 'riskWallet', name: '危険報酬の財布', desc: '予告がある間に倒すと通貨 +1', category: 'cancel' },
  magazineVow: { id: 'magazineVow', name: '弾倉の誓い', desc: '予告が積まれるたびに弾を2発補充', category: 'cancel' },
  backwater: { id: 'backwater', name: '背水の札', desc: '予告がある間、ポイント倍率 +0.3', category: 'relic' },
  focusScope: { id: 'focusScope', name: '集中の照準器', desc: '200px以上の命中が続くと倍率が上がる（外すと下がる）', category: 'relic' },
  shootdownBarrel: { id: 'shootdownBarrel', name: '弾撃ちの銃身', desc: '大きな敵弾を撃ち落とせる（1発 +0.1）', category: 'relic' },
  counterForm: { id: 'counterForm', name: '反撃の型', desc: '予告が積まれてから1秒間、ポイント倍率 +0.5', category: 'relic' },
  stanceMount: { id: 'stanceMount', name: '据え撃ちの台座', desc: '1秒以上動かずに撃ち続けるとポイント倍率 +0.5', category: 'relic' },
  grazeCharm: { id: 'grazeCharm', name: 'かすめの護符', desc: '敵弾がすぐ近くを通ると +0.05', category: 'relic' },
  quickdrawBelt: { id: 'quickdrawBelt', name: '早撃ちの弾帯', desc: 'リロード中にタイミングよく再入力で即完了＋次の弾倉の倍率 +0.3', category: 'relic' },
};

/** 宝箱の候補: アイテムか武器 */
export type ChestChoice = { kind: 'item'; id: ItemId } | { kind: 'weapon'; id: WeaponId };

/**
 * 宝箱の候補を n 個選ぶ。持っているものは出さない（アイテムは1つずつしか持てない）。
 * guaranteed を持っていなければ、それを必ず候補に入れる（最初の宝箱）。
 */
export function rollChestChoices(
  rng: Rng,
  args: { ownedItems: readonly ItemId[]; ownedWeapons: readonly WeaponId[]; allWeapons: readonly WeaponId[]; n: number; guaranteed?: ItemId | null },
): ChestChoice[] {
  const pool: ChestChoice[] = [
    ...(Object.keys(ITEMS) as ItemId[]).filter((id) => !args.ownedItems.includes(id)).map((id) => ({ kind: 'item' as const, id })),
    ...args.allWeapons.filter((id) => !args.ownedWeapons.includes(id)).map((id) => ({ kind: 'weapon' as const, id })),
  ];
  const out: ChestChoice[] = [];
  const g = args.guaranteed;
  if (g && !args.ownedItems.includes(g)) {
    out.push({ kind: 'item', id: g });
  }
  const rest = pool.filter((c) => !(c.kind === 'item' && c.id === g));
  while (out.length < args.n && rest.length > 0) {
    const i = Math.floor(rng() * rest.length);
    out.push(rest.splice(i, 1)[0]);
  }
  // 確定枠が常に先頭だと分かりやすすぎるので並べ替える
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
