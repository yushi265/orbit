# LANアクセス拡張（2026-09-12）

ユーザーの「ローカルで実行して、同じネットワークからアクセスできるようにして」に基づく追加契約。従来のLAN公開対象外を、明示的なLAN起動時に限って変更する。認証・アクセス境界に関わるTier 1としてTDDと独立レビューを行う。`feature/local-only`上の既存実装を拡張する。

## 契約

- `pnpm local:start -- --lan`を追加する。通常の`local:start`は従来どおり127.0.0.1:3000。
- LAN起動は0.0.0.0:3000で待ち受ける。外部サービス、トンネル、ルーター・OSのファイアウォール設定は変更しない。
- Node防壁は、listen時に必要なリテラル`0.0.0.0`のlookupだけを許可する（外部DNSを伴わない数値アドレス解決）。TCPの外向き接続先としての`0.0.0.0`やLAN IPは許可しない。
- CLIは起動時の非internal IPv4インターフェースのうちRFC1918（10/8、172.16/12、192.168/16）アドレスだけを列挙する。loopbackを加えた接続URLを表示する。対象アドレスがない場合は起動前にエラー。CGNAT/VPNアドレスやpublic IP、IPv6、任意ホスト名を自動公開対象にしない。
- 許可Originは`ORBIT_LOCAL_ORIGINS`にJSON文字列配列として渡す。CLIが導出し、外部環境からの任意値を継承しない。例: `["http://127.0.0.1:3000","http://192.168.0.180:3000"]`。
- ViteのCloudflare Pluginの`config`でこの値をWorkerのvarsへ渡す。未指定なら従来のloopbackのみ。設定値は厳密なcanonical HTTP Origin・port3000・loopbackまたはRFC1918 IPv4に限定し、不正JSON/空配列/不正値は500で拒否する。
- APIはRequest URLのOriginが許可リストにあること、HostがそのURLのhostと一致することを検査する。MutationのOriginは**そのRequest URLのOriginと完全一致**を要求する（許可リスト内でも別OriginからのMutationは拒否）。X-Requested-With必須を維持する。
- 許可外URL/Host/Originは既存400 VALIDATION_ERROR（Vite手前拒否は403の場合あり）。local固定OwnerとD1永続化、productionのAccess認証は変更しない。
- 新規ログインは設けず、LANの利用者も同じ固定Ownerとして同じデータを読み書きする。接続先IPが変わった場合はサーバーを再起動する。

## ACとテスト

- [x] LAN-1: 通常起動のloopback制限が維持され、`--lan`時だけLAN待受と許可IPリストが設定される。
- [x] LAN-2: 接続可能なLAN IPを検出・表示し、誤った引数・対象IPなしで起動を拒否する。
- [x] LAN-3: LAN OriginへのGETと同一Origin Mutationが成功し、未許可Host/Origin・別許可OriginからのMutationが拒否される。
- [x] LAN-4: LAN向けWorker varsへ許可Originが伝わり、既存Owner・ローカルDBを使って画面とAPIが動作する。
- [x] LAN-5: 型チェック・テスト・lint・format・buildと独立レビューを行い、実LANアドレスでのHTTP/ブラウザ検証後にサーバーを起動したまま接続URLを提示する。

単体/結合: インターフェース同値分割（private/internal/public/CGNAT/IPv6/重複）、CLI引数表、Origin設定の有効/無効表、HostとOrigin組合せ、既存local/production回帰。実動作は一時DBでLAN IPへのAPI/ブラウザ操作を検証した後、通常の保存先で起動する。別端末やWi-Fi側のクライアント分離設定はこのPCだけでは確認できないため、同一PCからLAN IPへアクセスした事実と区別して報告する。

## 担当範囲

- infra: `scripts/local.mjs`、`scripts/local.d.mts`、`scripts/local.test.mjs`、必要なVite配線。LAN許可Originの導出とWorkerへの受け渡し。
- service: `src/server/runtime-config.ts`、`src/server/http.ts`、対応テスト。Origin設定の検証とリクエスト境界。
- 親: 契約・利用文書更新、独立品質検証、LAN起動・接続確認。既存CLAUDE.md差分は対象外。

## 経緯

2026-09-12: 上記ユーザー指示をLAN公開範囲の承認として記録。実装・検証中。

## infra 担当 TDD 証跡（2026-09-12）

- [同値分割/境界値] RFC1918の3範囲の上下境界・直前直後、internal、public、CGNAT、IPv6、不正IPv4、重複・空インターフェースを検証。RED: `pnpm exec vitest run scripts/local.test.mjs -t LAN接続先` → `lanAddresses is not a function`（1 failed）。
- [デシジョンテーブル] 通常start / start --lan / pnpmの区切り付き起動、許可外引数、重複オプション、対象LANなし、環境変数注入の除外、接続URL表示を検証。RED: `-t 'start --lan'` → `コマンド引数が不正です。`（1 failed）。追加の不正な区切り文字テストは拒否期待にresolveして失敗後、区切り文字を全除去する旧処理を先頭の1個だけ受理する処理へ修正。
- [デシジョンテーブル] ViteのCloudflare config callbackが既存varsを保ったままCLIのORBIT_LOCAL_ORIGINSを渡すこと、未指定のloopback既定値、不正値をWorker検証まで保持することを確認。RED: `-t CLIのOrigin` → `result.cloudflare.config is not a function`（1 failed）。
- GREEN: `pnpm exec vitest run scripts/local.test.mjs scripts/bootstrap-owner.test.mjs` → **2 files / 21 tests passed**。`pnpm typecheck`、担当3ファイルの`oxlint` / `oxfmt --check`もpass。
- 待受先は既存のVite CLI引数経路で通常127.0.0.1、LAN時0.0.0.0へ固定。Nodeの外向き通信防壁は変更なし。実LAN HTTP/ブラウザ・Worker varsの実接続確認は親が担当する。

### infra 実LAN起動の追補修正

- 親の実起動で、`Server.listen('0.0.0.0')`に先行する`dns.lookup`が外部通信扱いで拒否されることを確認。RED: `pnpm exec vitest run scripts/local.test.mjs -t LAN待受用` → 実Node子プロセスの数値lookupが`ORBIT_LOCAL_NETWORK_DENIED`で失敗。
- `dns.lookup` / `dns.promises.lookup`だけ、外部DNS不要のリテラル`0.0.0.0`を例外化。TCP接続の検査は変更なし。実callback/promise lookupと一時ポートの0.0.0.0待受で拒否ログなしを確認し、0.0.0.0 / LAN / public宛TCP、LAN / 外部名のlookup拒否を別子プロセスで検証。
- sandbox内の待受は`EPERM`だったため、許可付き実行でGREEN: CLI/bootstrap **2 files / 22 tests passed**。実待受を含むこのテストはsocket listenが許可された環境で実行する。
- 通常startはViteの起動完了URL表示を既存の結合テストが待つため、CLI独自URL表示をLAN時のみに限定。RED: 通常起動のCLI出力は空という期待にURLが返り失敗、修正後GREEN。担当4ファイルのlint/format pass。

### infra 接続URL案内の整合

- 親の実LAN検証でViteの自動案内に、API許可外のlocalhost / CGNAT VPNアドレスが混ざることを確認。Vite導入版の型と実装で`configureServer`→`listen`で`resolvedUrls`確定→`printUrls`の順序を確認し、local限定Pluginで印字時にCLI許可Originへ案内を置換する。通常起動は127.0.0.1のみ。
- RED: `pnpm exec vitest run scripts/local.test.mjs -t Viteの接続案内` → `Cannot read properties of undefined (reading 'configureServer')`。通常/LANの印字経路を検証し、localhost / 100.83.3.89を含むVite候補から、許可された127.0.0.1 / 192.168.0.180だけがprinterへ渡ることを確認。
- GREEN: CLI/bootstrap **2 files / 23 tests passed**、型チェック、担当5ファイルのlint/format pass。接続可否や待受・ネットワーク制限には変更なし。

### infra 既存実ローカル回帰と更新確認の抑止

- `pnpm test:local`が通信拒否ログ不在の既存assertで失敗（1 passed / 1 failed）。診断時だけWrangler子プロセスの拒否先とstackを観測し、`registry.npmjs.org`へのTLS接続試行と特定した。導入Wranglerの`printWranglerBanner`→`updateCheck`を照合し、`WRANGLER_HIDE_BANNER=true`でこの更新確認前にreturnすることを確認。
- `localEnvironment`で同変数をtrue固定し、外部環境のfalse指定も継承しない。単体RED: true期待にundefined。診断用コードは除去し、`local.integration.mjs`は元のassert・実装のまま維持。
- GREEN: `pnpm test:local` → **2 passed / 0 failed、30.67秒**。初期化・API保存・再起動・backup/restore・復元後書込・通信拒否ログ不在、公開RepositoryのCAS/Owner分離/全モデル保持を再確認。CLI/bootstrap **23 tests passed**、担当lint/format pass。テスト用サーバー停止、3000解放済み。

## service担当 TDD・品質証跡（2026-09-12）

- [同値分割・境界値] 未指定の127.0.0.1、RFC1918各範囲の上下端を許可。範囲直外、public/CGNAT/link-local、別loopback、domain/IPv6、JSON型・空配列、資格情報/path/query/fragment/末尾slash、非canonical数値IP・port・空白を拒否する設定表を追加。
- [デシジョンテーブル] 許可URL 2件/未許可URL、Host一致/別許可Host/未許可Host/空、GET/HEAD/OPTIONS/POST/PATCH/DELETE、Origin欠落/同一/別許可/未許可/null/slash、X-Requested-With有無の1080組合せを検証。拒否時はOwner・DB・handler・persistが未実行、成功Mutationだけpersistを呼ぶ。
- RED: `pnpm exec vitest run src/server/runtime-config.test.ts` → `resolveLocalOrigins is not a function`（1 failed / 1 passed）。設定拒否追加でSyntaxErrorとServiceErrorの相違（1 failed / 2 passed）、文字列以外の配列がJSON.parseで暗黙変換されるケースも1 failed / 2 passedを確認後、厳密検証を追加。
- RED: `pnpm exec vitest run src/server/http-local.test.ts` → LAN GETの200期待に400（1 failed / 3 passed）。許可Origin・URL.host・Mutation同一Origin照合へ変更。
- GREEN: `pnpm exec vitest run src/server` → **26 files / 200 tests passed**。既存local固定Owner・DB永続化・production認証回帰を含む。LAN設定不正のHTTP 500、productionでlocal設定を認証迂回に使えない401も確認。
- 品質: `pnpm typecheck`、担当5ファイルの`oxlint` / `oxfmt --check`はpass。auth.tsはRuntimeEnv型のORBIT_LOCAL_ORIGINS追記のみ。設定解決helperを独立させ、既存resolveRuntimeConfigの返り値と共有API契約を維持。
- 申し送り: 実Worker vars・CLI連携・LANのHTTP/ブラウザ・build・独立レビューは他担当/親の検証。stage/commitなし。


## 親の独立検証・最終状態（2026-09-12）

- `referee --layer all`（node --import tsx経由）: app（型チェック・全テスト・lint）とformat-checkがGREEN。実ソケット待受テストのためsocket権限付きで実行した。
- `pnpm test:local`: 2 passed / 0 failed（33.14秒）。既存データの再起動・バックアップ復元・実Repositoryの競合/Owner分離/Run再開、Node拒否ログ不在を維持。
- `pnpm build`: 成功。検証ログ先とメトリクス/バナー抑止だけを環境指定。
- 一時DBで実LAN IPのトップページ/Bootstrapが200。ChromeのHTTP非secure contextでIssue作成201、更新200、再読込後の一致を確認。ブラウザの外部Request/JavaScript例外は0。PC幅と390pxの画面を取得した。
- 独立code / spec-conformance / test-qualityレビュー: LAN差分にMust / Should / IMOなし。親がCLI引数・Worker vars・Host/Origin比較・DNS/TCPの別制御を抜き取り確認した。
- 通常保存先`.orbit/local`を冪等初期化し、`pnpm local:start -- --lan`で起動。動作確認後、ユーザーの指示で停止した。接続URLは`http://192.168.0.180:3000`（検証時）。LAN画面200、LAN Bootstrap200、loopback200、別許可OriginからのMutation400を実測。IPv4の`*:3000`待受を確認した。
- Viteの案内は127.0.0.1と192.168.0.180だけで、localhost/100.83.3.89は表示しない。
- 別端末・Wi-Fi側からの到達性は未実測。このPCからLAN IPへのHTTP/ブラウザ接続を確認した結果として報告する。ファイアウォールやルーター設定は変更していない。
- CLAUDE.mdの既存ユーザー差分は維持し、今回のコミット対象には含めない。元のAC-7 native通信監査の制約は変更しない。
