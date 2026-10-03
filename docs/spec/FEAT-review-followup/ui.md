# UI

## 担保AC

- **AC-1**: HomeのOpen Issues、Active Projects、期限区分、Current Cycleから、表示件数に対応する一覧または詳細へ遷移できる。個別Issue/Projectのリンクも維持する。
- **AC-2**: Issue詳細で本人のLabelを付け外しでき、保存・再読込・一覧へ反映する。保存失敗と競合を表示し、他Ownerの参照を受け入れない。
- **AC-3**: Issue詳細はDesktopで画面幅の約90%を使い、Mobileの余白・内部スクロール・Dialog操作を維持する。
- **AC-4**: Issue詳細のProject選択で自動保存し、Project保存ボタンを除去する。説明の未保存変更と直列化し、連打で重複送信しない。失敗時はRetryできる。
- **AC-5**: Due date入力は枠線・padding・focus・themeを他の入力と揃える。
- **AC-6**: Issue一覧のDue dateをDesktop/Mobileで表示・編集でき、入力幅による横はみ出しがない。
- **AC-7**: 更新日・作成日・タイトル・Status・Priority・期限それぞれの昇順/降順を選択し、URLとProject表示設定へ保存できる。
- **AC-8**: Homeの挨拶を除去し、各ページの過大な見出しを小さくする。
- **AC-9**: 初回遷移の二重表示を調査し、正常な開発StrictModeを維持したまま重複通信・副作用の有無を確認する。ページ全体の再登場アニメーションによるちらつきを抑える。
- **AC-10**: SidebarのMVP表示を除去する。
- **AC-11**: Desktop Sidebarをviewport内に固定し、短い画面でも全項目へ到達できる。Mobileのナビゲーションを維持する。
- **AC-12**: 手動順の上下ボタンを除去する。DnDとキーボードでの並べ替え、保存中・競合表示は維持する。キーボード移動の完了後は元ハンドルへFocusを戻し、他の入力へ移動した場合は奪わない。
- **AC-13**: メモと説明のhttp/https URLを安全なリンクとして開ける。編集と改行・日本語を維持し、HTMLやjavascript/data URLを実行しない。
## 実装契約

OrbitApp既存のBootstrap/URL/Mutation/Cache/Toast/Dialog境界を再利用する。Homeのopen=trueはUIの一覧FilterでCompleted/Canceledを除外する追加条件とし、詳細往復で維持する。active=trueはProjects route validatorで復元する。既存GETのOwner/scope契約を変えない。

Labelは利用可能な全Labelのcheckbox群と保存pending・失敗表示を提供する。属性変更は説明flushと直列化し、保存中の再操作をguard/disabledで抑止する。Project選択は直接同じ保存関数へ渡し、保存失敗時に選択値を保持してRetryする。

LinkifiedTextの公開IFは`({text: string, className?: string})`。説明textareaは維持し、説明に安全なURLがある場合にPreviewを併設する。文字列にHTMLを適用しない。

## テスト戦略・UI/UX

Settingsの最後の実行は、controllerの復旧対象pending/running/paused/failedを優先する。controllerとBootstrap lastRunが両方終端ならrequested_atが新しいものを表示し、同ms・別IDはBootstrapのServer truthを優先する。新しく完了したcontroller結果が古いBootstrapを上回る場合はcontrollerを維持する。

current APIがnullでも既知の終端controller結果を忘れない。Bootstrap再取得が失敗してもCacheがあれば表示を維持する。初回のCacheなしエラーとRetry、ApiClientの401/403再認証redirectは維持する。

index.mdのviewport・状態・セキュリティ表に従う。Label/Projectは実App+DOM+strict HTTP fake、URL/Sort/Keyboardは入力と保存要求/復帰値を検証する。初回表示はStrictModeでBootstrap/currentの回数と副作用を観測し、正常なrender自体を不具合扱いしない。
