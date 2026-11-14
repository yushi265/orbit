# CYC-16: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-5**: Cycles画面のCycle詳細に「バーンダウン」セクションを追加し、日別のRemaining（折れ線）と理想線（開始時scopeから終了日に0へ向かう直線）、Scope change（その日の +added / −removed）を表示する。グラフと同じ値を日別の表（日付・Completed・Remaining・Scope change）でも確認できる。`tracked: false` の日はグラフ上で値を描かず「記録なし」と表示し、進捗が1件もないCycleは「このCycleの日別記録はまだありません」の空状態を表示する。Desktop / Tablet / 390px Mobileで横overflowを発生させず、ライト / ダークテーマで読める。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 変更 | `/cycles`・`/cycles/:cycleId` のCycle詳細 | 既存Bootstrapの `cycleProgress` から該当Cycleを読む | 既存 | バーンダウン表示 |

URL・ルーティングは変更しない。

## 実装配置

- `src/components/cycle-burndown.ts`（新規・純関数）: days → SVG座標、理想線、表の行
- `src/components/OrbitApp.tsx`: Cycle詳細の `CycleBreakdownSection` の前に `CycleBurndownSection` を追加
- `src/styles.css`: セクション・SVG・表のスタイル（ライト / ダーク）

## UI/UX 方針（表示層が関与する場合のみ）

- **画面フロー / 導線**: Cycles → Cycleを選択 → 詳細の進捗（既存metrics）の下に「バーンダウン」。
- **主要操作とフィードバック**: 閲覧のみ。表は `<details>`「日別の数値」で折りたたみ、開くと表を表示。
- **状態設計（出し分け）**: 記録あり → グラフ＋表 / 一部記録なし → `tracked:false` の区間は線を描かず、グラフ下に「M/D以前は記録なし（この機能の導入前）」/ 記録0件・Upcoming → 「このCycleの日別記録はまだありません」/ 読込中・エラー → 既存Bootstrapの導線に従う。
- **グラフ**: 横軸=日付（開始〜終了日まで目盛り、終端日以降は空）、縦軸=件数。Remainingの折れ線、理想線（`trackedFrom` 日のscopeから終了日に0へ向かう破線）、Scope changeは各日の上向き（+added）/下向き（−removed）の小さな棒。凡例を付ける。
- **既存デザインシステムとの整合**: `detail-section` / `detail-section-heading` / `eyebrow` を再利用。色は既存のアクセント・muted変数を使い、新しい色トークンは足さない。チャートライブラリは追加しない。

### レスポンシブ / アクセシビリティ（表示層は必須・空通過禁止）

- SVGは `viewBox` で幅100%に伸縮し、390pxでも横overflowしない。表は横スクロール可能なラッパーに入れる。
- SVGに `role="img"` と `aria-label`（例:「Cycle 3のバーンダウン。残り5件、開始時12件」）を付け、数値は表で読める。
- 色だけで区別しない（理想線は破線、Remainingは実線、Scope changeは＋/−表記）。ダークテーマで既存のコントラスト基準を満たす。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| `cycleProgress` に該当Cycleなし | 空状態の文言 |
| 全日 tracked:false | 空状態ではなく「記録なし」の注記のみ表示 |
| Bootstrap取得失敗 | 既存のエラー・再試行導線 |

## テストケース（技法注記付き）

- [代表値] days → Remaining折れ線の点列（tracked:falseの日は線を分断）
- [境界値] days 1件 → 点1つで描画できる / scope 0 → 縦軸最小1でゼロ除算しない
- [代表値] 理想線: trackedFrom日のscope → 終了日0
- [代表値] 表の行: 日付・Completed・Remaining・Scope change（"+2 / −1"、0なら"—"）
- [同値分割] 記録あり / 一部記録なし / 記録なし の3状態の表示（runtime）
- [代表値] Upcoming Cycleを選ぶと空状態
- [代表値] 390px でセクション内に横overflowを起こすスタイルがない（CSSルール検証）
- [代表値] SVGに role="img" と件数入りのaria-label
