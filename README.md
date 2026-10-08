# 相殺シューター（試作）

「被弾上等。撃ち続けて生き残れ」— ドッジロールもブランクも無く、守りの手段は「相殺」だけの見下ろし型ローグライトシューター。

## 動かし方

```bash
npm install
npm run dev      # http://localhost:5173 を開く
npm test         # DamageQueue の単体テスト（Vitest）
npm run build    # 型チェック + 本番ビルド
```

## 操作

| 入力 | 動作 |
| --- | --- |
| WASD | 移動 |
| マウス / 左クリック | 照準 / 射撃 |
| 右クリック | ダッシュ（無敵なし・硬直なし・射撃可、CD 0.8秒） |
| R / Q・E / Space | リロード / 武器切替 / アクティブアイテム（段階4） |
| 1 / 2 / H | テスト部屋専用: 直進撃ち出現 / 突進出現 / 操作説明の表示切替 |

### スマホ（横向き）

https://zatuza413.github.io/-/ を開く（push するたびに GitHub Actions が自動で公開し直す）

| 操作 | 動作 |
| --- | --- |
| 画面左半分をドラッグ | 移動スティック（触れた場所に出る。左右の黒帯でも可） |
| 画面右半分をドラッグ | 照準スティック。倒している間は射撃 |
| 右下のボタン | ダッシュ / リロード |
| 右上のボタン | 武器切替 |

## 構成

- `src/config/balance.ts` — 調整用の数値すべて（武器・敵の定義も含む）
- `src/core/DamageQueue.ts` — 相殺ロジック（描画から独立。`DamageQueue.test.ts` でテスト）
- `src/game/CancelPresenter.ts` — 相殺の演出（予告リング、確定の線、心音、倒せそう印など）
- `src/game/Controls.ts` — 入力（PC のキーボード＋マウスと、スマホの仮想スティック）
- `src/game/enemyBehaviors.ts` — 敵の行動。敵の追加は「行動関数 + balance.ts の定義」
- `src/scenes/` — Boot（仮素材生成）/ Title / Game（現在はテスト部屋）
