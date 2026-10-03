# service: Snapshot互換codec

## 担保 AC（引用文）
- **AC-1**: 旧Snapshotを新版で読み書きしても、業務データ・dueAt・Owner scope・Version CASを保持する。
- **AC-2**: 新版で追加された6種類のProject並び順とnext7を保存しても、15eb0ebの旧StoreがSnapshot全体を読み取れる。
- **AC-3**: 新版→旧版の通常編集→新版で再読込した場合、旧版で追加・編集した業務データと未変更の新設定を両方保持する。
- **AC-4**: 旧版で表示設定・検索・Saved Viewを明示変更した場合、同一ミリ秒かつ同じ旧投影値への再保存を含め、旧版の変更を新版で優先する。
- **AC-5**: 互換メタデータはD1境界だけに存在し、Bootstrap・Mutation応答・Receipt再試行・Run内部rollbackへ露出しない。
- **AC-6**: 壊れた・未知version・Ownerや識別子の異なる互換メタデータは読込を拒否し、Snapshotを上書きしない。
- **AC-7**: 本番反映前に取得したD1バックアップのコピー復元と旧新版読込を確認し、rollback時に更新後データをDB復元で失わない手順を記録する。

## 実装契約
- src/server/store-snapshot-compat.tsにpure decodeStoreSnapshot(snapshot: unknown): unknown / encodeStoreSnapshot(snapshot: OrbitStoreSnapshot): unknownを追加。SessionのfromSnapshot直前とwrite直前だけで呼ぶ。inputを変更しない。decode後runtimeはmeta無し。
- projectDisplayPreferences.settings: updated_asc→updated_desc、created_asc→created_desc、title_desc→title_asc、status_desc→status_asc、priority_asc→priority_desc、due_desc→due_asc。dueFilter next7→upcoming。他field不変。
- recentSearches.query.filter.dueとviews.query.filter.due: next7→upcoming。queryの他field/layout等は不変。
- 該当record siblingに__orbitRollbackを持たせる。version=1、kind（collection名）、userId、recordId、value（元settings/query）、anchor（旧投影record全体、meta無し）、receiptKeys（同Owner/record/operationの既存Receipt idempotencyKey集合）。最上位metaは禁止。
- metadataは新値が旧投影と異なる場合だけ付ける。decodeはversion/kind/Owner/id/anchor/元valueの現行schemaと投影一致を検証する。Project/Recentはanchor全体が現在recordと一致し、現在の同種Receipt keyにreceiptKeys未登録のkeyが無い場合だけvalueを復元する。SavedViewはquery.layoutを除くqueryのanchor一致で判断し、rename/layout更新/updatedAtだけの変更では新queryを保持する。復元時は元queryへ現在のquery.layoutを合成し、旧layout変更を保持する。queryを含むview.updateの新Receiptだけを旧明示query変更として扱う。anchor不一致または追加keyなら旧値を優先しmetaをstrip。既存keyの削除はpurgeなので不一致扱いしない。
- Project operationはproject.displayPreferences.update（Receipt requestHash内projectIdまたはresponse.id）、Recentはrecent.search（response.id）、Viewはview.create/view.update（response.id）。SavedViewのquery更新の有無はrequestHashのoperation＋改行＋canonicalJSONから判定し、既存Storeでoperation名を照合する。Owner/idを含む関連付けを必須にし、他recordのreceiptで復元を消さない。
- 同種Receipt.responseに新値がある場合も旧互換投影し、Receipt sibling __orbitRollback（kind=receipts、recordId=idempotencyKey、value=元response、anchor=meta無しreceipt、receiptKeys=[]）へ保存する。requestHash/createdAt/expiresAtを変更しない。decodeでimmutable anchor一致時に元responseへ復元する。旧作成Receipt.response内に既存recordの__orbitRollbackがcloneされる場合は、同operationのrecord kindで内側metaのversion/Owner/id/value/anchorを検証した後、復元根拠にせずstripしlegacy responseを公開する。不正/未知の内側metaもAC-6に従い拒否する。Receipt直下metaだけをresponse復元根拠にする。古い新request keyを旧fallback内容で再利用した場合は既存409を維持する。
- 壊れた/未知version/owner,id,kind不一致metaはError('Invalid OrbitStore rollback metadata')で拒否。内容・秘密をError/logへ含めない。meta無し既存Snapshotは従来Store validationへ委ねる。
- 公開shared型、SQL、OrbitStore.toSnapshot/fromSnapshot、Run内部復元は変更しない。型の検証/collection処理は必要な4種類のみ、汎用migration frameworkを作らない。
- docs/deployment.mdに現在の確認済構成・バックアップコピー検証・Run完了境界・旧版表示縮退・refresh・DB復元しないrollbackを記載。Secret/Owner設定済は確認済names/bindingとDBの存在だけを根拠に記載し値は含めない。

## 異常系挙動
| シナリオ | 挙動 |
|---|---|
| metadata不正/未知 | sessionを開かずwriteなし、Error文字列固定 |
| metadata無し旧snapshot | 従来validation/Owner isolationを維持 |
| stale anchor/新しい旧receipt | legacy値優先、業務dataそのまま |
| CAS競合/DB故障 | 既存挙動維持、巻戻し/再試行上書きをしない |

## テストケース（技法注記付き）
- [同値分割] meta無し旧snapshotの無変更/普通Issue mutationを保存、値/Owner/CAS保持。
- [同値分割] 6 reverse sort全件、next7 Project/Recent/View各経路は旧enumへ投影され、新版decodeで元値復元。
- [状態遷移] 新保存→旧serialization→旧Issue/Project/Note編集→新decode、両方保持。実旧Store検証はroot独立harnessで行う。
- [デシジョンテーブル] anchor一致/不一致 × same-operation Receipt新key有/無、他Owner/他record/他operationのkey、Receipt purgeを含む全列。
- [境界値] 同msでfallback値へ旧再保存→新値を復活させない。
- [状態遷移] Recent/View削除・query更新、旧View renameだけで新queryを保持、旧Receipt response内の古いmetaをstrip、元record無しのReceipt再試行、receipt永続projection後の新再試行応答を復元。
- [同値分割] 不正version/kind/owner/id/value/anchor/receiptKeys、meta input mutationなし、Sessionが上書きしない。
- [レイヤー内結合] 本番/ローカルD1 Sessionにcodec配線、Bootstrapとdomain Snapshotにmeta無し、Run失敗chunk rollback既存回帰維持。
- [代表値] private copy backupをSQLite復元、integrity_check ok、実旧新版読込、数値dueAt/配列件数保持。

## Rollback運用の前提
旧版中はMaintenance Runを実行しない。旧chunk bugとReceipt情報の破棄を避ける。実旧Storeのcharacterizationで、同ms同fallback保存後に新Receiptまでpurgeすると保存無し側とSnapshot全体が一致し、保存意図が判別不能と実証済み。旧変更優先の判定は根拠Receipt残存中に成立し、旧版中にManual Runを行わない運用で維持する。通常Issue/Project/Note編集とVersion切替のみの復旧を対象とする。
