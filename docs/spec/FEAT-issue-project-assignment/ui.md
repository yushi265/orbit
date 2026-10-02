# FEAT-issue-project-assignment: UI 詳細設計

> 2026-10-02の追加依頼で、詳細の手動保存は[FEAT-review-followup AC-4](../FEAT-review-followup/index.md)の選択時自動保存へ置き換える。保存失敗の選択値保持・Retryは新契約に従う。以下は初回実装時の記録。

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人がIssue一覧またはIssue詳細で、Bootstrapに含まれる本人所有Projectを選択して保存でき、Projectなしを選ぶと`projectId: null`で解除できる。成功後はIssueのversionと一覧・詳細の表示が更新される。
- **AC-2**: 新規Issue作成時にProjectを選択できる。指定Projectが存在しない、削除済み、または他Ownerの場合はサーバーが404で拒否し、Issueを作成しない。
- **AC-3**: Project保存が409またはその他の失敗になった場合、最新値との整合を保ち、入力をロールバックし、Project専用の再試行導線を表示する。
- **AC-4**: Desktop / Tablet / MobileでProject割り当て導線を利用でき、選択要素にラベルを付け、既存のIssue画面レイアウトとキーボード操作を維持する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| Bootstrap利用 | `/api/v1/bootstrap` | `projects: ProjectViewModel[]` | API側Owner scoped | 選択肢を表示 |
| 新規作成 | `/api/v1/issues` | `projectId: string \| null` | API側Owner / existence validation | 選択したProjectで作成 |
| 既存更新 | `/api/v1/issues/:issueId` | `version` + `patch.projectId: string \| null` | API側Owner / CAS | 選択・解除 |

## 実装配置

- `src/components/OrbitApp.tsx`: IssuesView、IssueRow、IssueDetailPanel、IssueComposer
- `src/components/issue-project.ts`: UI選択値の`string | null`正規化
- `src/styles.css`: Project selectと詳細Project editorのレイアウト

## UI/UX 方針

- **画面フロー / 導線**: Issues一覧のProject select、Issue詳細のProject select + 保存、新規Issue composerのProject selectを提供する。既存Bulk操作も残す。
- **主要操作とフィードバック**: 一覧は選択変更を即時Mutation、詳細は「Projectを保存」で確定、新規作成は作成時に確定する。成功は既存Toast、失敗はrollback + エラー + 詳細の再試行で知らせる。
- **状態設計（出し分け）**: Bootstrap loadingは既存画面、Project 0件は「Projectなし」のみ、保存中はselect/buttonをdisable、409は最新値を読み直し、その他のエラーは選択を戻して再試行を表示する。
- **既存デザインシステムとの整合**: 既存`button secondary`、`field-label`、`text-input`、`detail-live-error`を再利用する。

### レスポンシブ / アクセシビリティ

- Desktop 1200pxでは一覧インラインselectと詳細editorを表示する。Tablet / Mobileでは横overflowを避け、詳細editorを主導線として利用できるようにする。
- selectにはIssue識別子を含む`aria-label`を付け、詳細・新規作成には可視labelとラベル関連付けを付ける。キーボードのTab / Enterで操作できる標準selectを使う。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| Project保存失敗 | draftを既存Issue値へ戻し、`detail-live-error`と「Projectを再試行」を表示 |
| version競合 | 最新Issueを再取得して一覧・詳細cacheを同期し、再試行対象を保持 |
| 保存中 | Project selectと保存ボタンをdisable |

## テストケース（技法注記付き）

- [代表値] Project ID選択は同じIDを送る
- [境界値] 空文字 / Projectなしは`null`を送る
- [状態遷移] 詳細の未保存変更 → 保存成功で表示とversionを更新する
- [状態遷移/禁止] 保存失敗で選択値を戻し、再試行導線を出す
- [代表値] 新規作成時にProject selectを指定して作成Mutationへ渡す
- [Browser smoke] 390 / 768 / 1200px、Tab / Enter、一覧・詳細・新規作成のProject操作

Browser smokeとReact componentの表示・rollback結合確認は、既存のtesting ruleとプロジェクトのテスト構成に合わせ、実ブラウザ固有の確認としてRelease hardeningへ延期する。本ボルトでは標準selectのアクセシビリティ属性、型チェック、Lint、サービス境界テストをGate 3の証跡とする。
