# FIX-rollback-compatibility: 旧版へ戻せるSnapshot保存

## 概要
新しい並び順・next7を保存したSnapshotを旧版がstrict契約で拒否する問題を、D1 Sessionの可逆codecで解消する。新版での利用と旧版での通常編集を両立し、SQL移行・DB復元なしでWorkerを戻せるようにする。

## 対象範囲
- 対象レイヤー: [service](./service.md)。運用文書は既存deployment.mdを更新する。
- 対象ドメイン: Project表示設定、Recent Search、Saved View、該当Mutation Receipt、Snapshot Session。
- 対象外: 新APIを旧サーバーへ送ることの互換性、旧版のRun bug修正、SQL Migration、Access権限変更、ユーザーデータの本番テスト変更。

## ユニット計画
単一ユニット。

## 受け入れ基準（AC）
- [x] **AC-1**: 旧Snapshotを新版で読み書きしても、業務データ・dueAt・Owner scope・Version CASを保持する。
- [x] **AC-2**: 新版で追加された6種類のProject並び順とnext7を保存しても、15eb0ebの旧StoreがSnapshot全体を読み取れる。
- [x] **AC-3**: 新版→旧版の通常編集→新版で再読込した場合、旧版で追加・編集した業務データと未変更の新設定を両方保持する。
- [x] **AC-4**: 旧版で表示設定・検索・Saved Viewを明示変更した場合、同一ミリ秒かつ同じ旧投影値への再保存を含め、旧版の変更を新版で優先する。
- [x] **AC-5**: 互換メタデータはD1境界だけに存在し、Bootstrap・Mutation応答・Receipt再試行・Run内部rollbackへ露出しない。
- [x] **AC-6**: 壊れた・未知version・Ownerや識別子の異なる互換メタデータは読込を拒否し、Snapshotを上書きしない。
- [x] **AC-7**: 本番反映前に取得したD1バックアップのコピー復元と旧新版読込を確認し、rollback時に更新後データをDB復元で失わない手順を記録する。

## アーキテクチャ / レイヤー間フロー
D1 unknown Snapshot → service decode → OrbitStore.fromSnapshot →既存domain/API → OrbitStore.toSnapshot → service encode → D1 Version CAS。codecはMemory Store・RunのbeforeChunkに関与しない。公開Zod契約とSQLschemaは変更しない。

## エラー・ログ方針（横断サマリ）
| シナリオ | service | data |
|---|---|---|
| 互換meta不正/未対応 | 読込Error。個人データをError文字列に含めない | writeしない |
| CAS不一致 | 既存D1_WRITE_CONFLICTを維持 | versionで拒否 |
| 旧版による設定変更 | legacy値を優先 | 次回正常保存でmetaを再構成 |

## テスト戦略
| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | clone/値保持 | Session既存fixture、実本番コピー読込 |
| AC-2 | 全新enumの旧投影 | Session保存+実15eb0eb Storeによる読込 |
| AC-3 | codec roundtrip | 実旧Store編集往復 |
| AC-4 | anchor/Receipt差分 | 同ms旧Store再保存、View/Recent編集 |
| AC-5 | response/receiptcodec | Session/Bootstrap/Run回帰 |
| AC-6 | 不正meta同値分割 | Session write拒否/Owner分離 |
| AC-7 | — | SQLコピー復元/反映前後read-only検証 |

## 既存実装との関係（再利用 / 差分 / 衝突）
OrbitStoreのMap、Owner検証、Session CAS、shared Zodを再利用。旧15eb0ebはrecord sibling追加属性を保持し、最上位extraを失う。settings/query内部はstrictのため追加属性を入れない。toSnapshotはRun内rollbackにも使用されるのでdomain形状を変えない。codekb/shared.mdのRun/Receipt purge/Session注意事項を照合済み。

## 実装に効く制約
CLAUDE.md既存差分を保持。秘密値・本番Snapshot内容をログ・Git・レビュー資料へ含めない。実データ検証はprivate tmpのコピーのみ。新token/権限追加は別確認。

## 判断根拠 / 未決事項
- 採用: record siblingのversion付き復元情報。旧版が保持する最小単位で、元の新設定を復元できる。top-level metaは旧書込で失われ、settings/query内部metaは旧strictで拒否されるため却下。
- 旧表現は逆順を同属性の既存方向、next7をupcomingへ投影する。rollback中は新表示機能の意味が縮退するが業務データは保持する。旧変更を優先し、古い新設定を復活させない。
- timestampだけでは同msの明示再保存を見分けられないため同record同operationのReceipt key追加も検出する。既知Receiptのpurgeは変更と見なさない。
- bridge Workerのみでは元の旧versionへ直接戻す契約を満たさないため不採用。
- Run実行途中に旧版へ戻すと旧chunk bugが再発しうる。完了/停止したRun境界でrollbackし、旧版中はMaintenance Runを実行せず、DB復元は行わない。根拠Receiptまでpurgeされると同ms同fallback保存と未保存が同一状態になり設定意図を判別できないため、旧変更優先はReceipt残存を前提とする（実旧Storeで情報消失を別のcharacterizationとして確認）。新クライアントが旧APIへnew enumを送る場合は旧validationで失敗するためreloadする。
- 要件・修正・検証・通常commit/push/merge・本番反映は2026-10-02のユーザー『おねがい』と親delegationで承認済み。追加の承認待ちを設けず、契約と証跡を提示する。未決事項なし。

## 検証結果（2026-10-02）
- 全service 32ファイル・378テスト成功、root全品質ゲートGREEN、本番build成功。
- 実旧15eb0eb Storeで66回帰と1情報消失characterization成功。backupコピー復元integrity_check=ok。
- code/spec/test品質の独立レビューとroot監査完了、Must/Should/IMOなし。補助guardの境界テスト52ケースを追加。
- 本番の認証済Bootstrap・主要Route確認とmerge/deployは、ユーザーのCloudflare Accessログイン待ち。
