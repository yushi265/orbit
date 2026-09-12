# ローカル専用動作: service計画

本書は2026-09-08の実装指示に基づく契約。判断根拠と未決事項は[index.md](./index.md)を参照。

2026-09-12追加の`--lan`起動時の許可Originは[LAN拡張契約](./lan.md)を優先する。以下の固定loopback契約は通常起動に適用する。

## 担保 AC（引用文）

- **AC-2**: Issue・Project・Label・Cycle・View・Notification・PreferenceとRun内部状態が、保存成功後のサーバー再起動でも保持される。
- **AC-3**: ローカルモードは固定Ownerだけを扱い、外部Host・異なるOriginのMutationを拒否し、productionではローカル認証へフォールバックしない。
- **AC-4**: ローカル初期化は再実行しても既存データを変更せず、DB欠落・破損・書込失敗でMemory Storeへフォールバックしない。
- **AC-5**: 競合更新は409 D1_WRITE_CONFLICTとなり、失敗したRequestはSnapshotを保存せず、Owner間のデータが混在しない。
- **AC-8**: ローカル用コマンドは明示した同一保存先だけを使い、remote操作を含まず、既存の開発Memory Storeとproduction認証・保存のテストが通る。

## 公開する契約案

新規の業務API / Response項目は追加しない。内部の設定解決を一箇所に集め、認証とStoreが同じ解決結果を使う。

| APP_ENV | ORBIT_STORAGE | 認証 | 保存 |
|---|---|---|---|
| 未設定 / development | 未設定 / memory | 既存開発Owner・既存Accessヘッダー処理 | 既存Memory Store |
| local | d1必須 | data定義の固定Owner、Access処理を呼ばない | DB Binding必須、ローカルSnapshot |
| production | 未設定 / d1 | 既存Access JWT + DB Owner照合 | 既存D1 Snapshot |
| その他の値・組み合わせ | 任意 | 設定エラー | 起動拒否、Request時は500 |

localでDBがクラウドへ接続しないことはinfraの専用設定と起動検証で保証する。D1 Bindingの型だけでremoteかどうか判別できるとは扱わない。production + memoryは必ず拒否する。固定OwnerはRequestのパラメータやヘッダーで変更できない。

localではAccessヘッダーが付いていても外部JWKS取得を行わず、ヘッダー値をOwner決定に使わない。接続先は`http://127.0.0.1:3000`を正規Originとし、全APIでURL / Hostを許可値と照合する。Mutationは既存`X-Requested-With`検査に加えてOrigin完全一致を必須とし、Originなし・`null`・別port・外部Originを400にする。CLIによるMutationも正規Originヘッダーを送る。CORSによる外部Origin許可は追加しない。開発サーバーと補助ポートの待受制限はinfraが担当する。

## 保存フローと下位契約

1. 実行設定とローカルアクセス境界を検査し、Ownerを解決する。
2. [data.md](./data.md)のOwner初期登録が存在することを確認する。
3. local / productionは既存のD1 Request Sessionを使用する。Snapshotなしの場合は空のOrbitStoreから既定設定を生成し、成功した初期Requestで保存する。
4. 成功Mutationと初期化・既存の背景状態変更だけを保存する。既存CAS、失敗Requestの保存抑止、Lease復旧を維持する。

## 実装配置

- `src/server/runtime-config.ts`（追加予定）: 設定の検証と解決。
- `src/server/auth.ts`: local固定Owner分岐とDB Owner確認。
- `src/server/store-session.ts`: 保存先設定による選択。既存Snapshot経路を共用。
- `src/server/http.ts`: localのHost / Origin検証。
- `src/server/auth*.test.ts`、`store-session.test.ts`、`store-persistence.test.ts`: 回帰・追加ケース。

## 異常系挙動

- Host / Origin拒否: 400 `VALIDATION_ERROR`、既存Envelopeで「ローカル接続元を確認してください。」。既存Mutationガードと同じエラー分類を使用し、共有ErrorCodeを追加しない。
- HTTP表層のVite `allowedHosts`は、APIへ到達する前に外部Hostを403 textで拒否する。API内部400のテストと、実サーバー403のテストを分ける（2026-09-08実測）。
- DB / Owner未初期化、設定矛盾、Snapshot破損、書込失敗: 500 `INTERNAL_ERROR`。Memoryへの切り替え・データ再生成・上書き修復をしない。
- CAS競合: 409 `D1_WRITE_CONFLICT`。既存の先行更新を維持。
- productionの未認証: 既存401を維持。localの既定値を利用しない。
- SnapshotやJWTをログに出さず、既存requestIdとエラー分類を使う。

## テストケース

- [デシジョンテーブル] 設定表の全行と矛盾値を検証し、未設定の従来開発挙動を維持する。
- [デシジョンテーブル] localでAccessヘッダー有無の両方でJWKSを取得しない。productionは有効JWTだけを許可し、未設定・不正・他Ownerを拒否する。
- [同値分割] 正規Host / 外部Host、正規Origin / 別port / null / 欠落を実HTTP Requestで検証する。
- [状態遷移] 保存→Store再生成→再取得で全状態が一致。Run中断→再起動→Lease期限切れ→resumeで二重処理しない。
- [同値分割] DBなし・Ownerなし・不正JSON・Snapshot形式不正・書込例外で保存成功を返さない。
- [状態遷移] 同一Versionからの2更新で1件だけ成功。handlerの4xx / 5xx / throwで保存しない。
- [同値分割] 別OwnerのIssue / Run IDを使ったRequestで業務データへアクセスできない。
