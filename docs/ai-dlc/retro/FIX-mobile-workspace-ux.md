# FIX-mobile-workspace-ux — 2026-10-03

- Base: b7349ca, branch: feature/mobile-workspace-ux。
- Scope: 最新ユーザーの10項目のUI修正。全工程・本番反映は明示承認あり。
- Keep: 既存CRUD/API契約・Storeを再利用し、実データを編集せずfixtureで検証。
- Problem [test-data]: Views結果の日付がnullのみのテストではtimezoneをlocaleへ渡す実装ミスが見逃された。ブラウザで期限付きfixtureを表示して再現。
- Try: formatter/条件実行のテストは非null値と異なる時刻・状態・関連の候補を含める。今回の回帰テストへ反映。
- Problem [scope]: 過去PRのpush/配信状況を最新依頼の成果として回答しかけた。親の訂正で最新範囲に復帰。
- Try: 完了報告は当該差分のcommit/CI/Worker versionを紐付ける。
