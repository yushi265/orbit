# FEAT-cycle-workspace: ui契約

## 担保AC

- **AC-1**: 本人がCyclesを開くと、Current / Upcoming / Pastを切り替えられ、各タブはOwner scopedなCycleだけを表示し、Cycleがない場合は空状態と次の導線を表示する。
- **AC-2**: Cycle詳細でnameOverride（nullまたはUnicode 1〜100文字）とdescription（0〜2,000文字）を保存でき、成功時は同じCycleの再表示に反映され、同じidempotencyKeyの再送はNo-op、異なるRequestは409になる。Runtime lock中は423で副作用がない。
- **AC-3**: Current / Upcoming Cycleの詳細で、Cycle未所属の本人所有Issueを追加し、所属Issueを解除できる。Issue version CAS、Owner境界、Runtime lock、409 / 423の既存契約を維持する。
- **AC-4**: Cycle詳細にIssue総数、Completed数、進捗率、Canceledを除外したEstimate合計を表示し、Canceled Issueは完了率の分母から除外する。Active Cycleの完了操作は既存の繰越処理を呼び出し、処理中は画面をブロックする。
- **AC-5**: Desktop / Tablet / Mobileでタブ、編集、Issue追加・解除、完了操作がPointerとKeyboardで実行でき、390pxで横overflowがなく、Status / Progress / Errorを色だけに依存しない。

## UI/UX方針

- Current / Upcoming / PastタブはURL queryではなく画面内状態として保持し、初期値はCurrent。
- Cycleカードを選ぶと詳細ワークスペースを同画面に表示し、metadata編集はSave / Cancelを持つ。
- Current / Upcomingでは「Issueを追加」selectと、所属Issueごとの「解除」を表示する。Completedは読み取り専用。
- Loading / 空 / Error / 保存中 / 成功を明示し、409はBootstrap再取得、423は操作を確定しない。
- 既存の`cycle-detail`, `cycle-tabs`, `detail-card`, `button`, `status-pill`を再利用する。

### レスポンシブ / アクセシビリティ

- Desktop >=1200pxはカードとIssue一覧を横配置、Tablet 768..1199pxは1カラム寄り、Mobile <=767pxはタブと詳細を縦積みにする。
- 390pxで横overflowを出さず、select / textarea / buttonにlabelまたは可視テキストを付ける。
- Progressは割合テキストを併記し、statusは名前を併記する。Keyboard Tab / Enter / Escapeで編集操作を完了・取消できる。

## 異常系挙動

| シナリオ | UI挙動 |
|---|---|
| Loading | Cycle skeletonを表示 |
| 空タブ | 次のCycle作成 / Issuesへ戻る導線 |
| 400 | 入力値を保持してfield error |
| 409 | 最新Bootstrapを取得してConflict表示 |
| 423 | 保存 / assignment / closeを確定せずRetry表示 |

## テストケース

- [状態遷移] Current / Upcoming / Pastタブ切替と空状態。
- [状態遷移] metadata編集 → 成功 / 400 / 409 / 423。
- [代表値] Issue追加 / 解除後の件数と表示。
- [境界値] completed / canceled / estimate未設定のmetrics。
- [アクセシビリティ] Keyboard操作、390 / 768 / 1200px横overflowなし。
