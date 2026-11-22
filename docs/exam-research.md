# Claude 認定資格 調査メモ（現行版）

調査日：2026-11-20
対象：**CCDV-F（Claude Certified Developer – Foundations）**。試験ガイド v1.0（2026年7月発効）にもとづく現行版。
12月7日の改訂（新しい試験ガイドは 11月17日公開）は、ここではまだ扱わない。

> 情報の確かさ
> - ◎ 公式試験ガイド v1.0 の PDF（第三者の GitHub リポジトリにあったミラー。Anthropic の配布元から直接は取得できていない）
> - ○ Pearson VUE の Anthropic ページ（2026-11-12 更新）、claude.com の公式記事
> - △ 第三者の解説記事・受験記

---

## 1. Claude 認定資格の全体像（○）

| 資格 | コード | 対象 | 問題数 | 受験料 |
|---|---|---|---|---|
| Associate – Foundations | CCAO-F | Claude を日常業務で使う人（コンサル、PM など） | 60 | $99（△） |
| Developer – Foundations | **CCDV-F** | Claude でアプリ・エージェントを作るエンジニア | 53 | $125 |
| Architect – Foundations | CCAR-F | エージェントシステムを設計するソリューションアーキテクト | 60 | $125 |
| Architect – Professional | CCAR-P | エンタープライズ規模の設計・ガバナンスを担う上級アーキテクト | 63 | $175（△） |

- 受験できるのは **Claude Partner Network の加盟企業に所属する人**（加盟は無料）。
- 申し込みは Anthropic Partner Academy から行い、試験は Pearson VUE で受ける。
- 合格すると Credly のデジタルバッジがもらえる。
- 12月7日に内容が変わるのは CCAO-F・CCDV-F・CCAR-P の3つ。CCAR-F は対象外（○ Pearson VUE）。

---

## 2. CCDV-F の試験概要（◎）

| 項目 | 内容 |
|---|---|
| 問題数 | 53問 |
| 形式 | 単一選択と複数選択。複数選択では、選ぶ数が問題文に書いてある |
| 時間 | 120分（着席時間は約135分 △） |
| 合格点 | スケールスコア 720（100〜1,000）。正答率72%という意味ではない |
| 受験料 | $125（パートナーのティアによって割引あり） |
| 受験方法 | 監督つき。オンライン（自宅）または Pearson VUE のテストセンター |
| 結果 | 合否、スケールスコア、分野ごとの正答率 |
| 有効期間 | 合格日から12か月 |
| 更新 | 期限内なら、Partner Academy で無料・監督なしの更新テストを受ける。期限が切れたら本試験を正規料金で受け直す |
| 前提条件 | なし（推奨経験は下記） |
| 再受験 | 不合格の後、1回目は14日、2回目は30日、3回目は90日待つ。12か月で最大4回。毎回受験料がかかる |
| キャンセル・変更 | ガイドでは予約の24時間前まで。Pearson VUE のページではテストセンターは48時間前まで（△ オンラインは1時間前まで）。**申し込み時に最新の規定を確認する** |
| 言語 | 英語。日本語にも対応しているという情報があるが、公式の資料では未確認（△） |
| 練習試験 | 公式の練習試験は 2026年6月30日に廃止（△）。ガイドにサンプル問題が3問ある |

### 想定している受験者（◎）
- AI/ML エンジニア、テックリード、シニアソフトウェアエンジニア
- ソフトウェア開発の経験が1〜5年、Claude などの LLM を実際に使った経験が6か月以上
- Python か TypeScript を使える。REST API と CLI に慣れている
- LLM の基本、エージェント、コンテキスト管理、MCP をひと通り理解している
- 対象外：開発経験がない人、プロンプトを書くだけの役割の人

---

## 3. 出題範囲（ブループリント）（◎）

8分野・25スキル。％は試験全体に占める割合。問題数の目安は「割合 × 53問」で計算した値（公式の数字ではない）。

| # | 分野 | 配点 | 問題数の目安 |
|---|---|---|---|
| 2 | Applications and Integration（アプリケーションと統合） | **33.1%** | 約17〜18問 |
| 5 | Model Selection and Optimization（モデル選択と最適化） | 16.8% | 約9問 |
| 1 | Agents and Workflows（エージェントとワークフロー） | 14.7% | 約8問 |
| 6 | Prompt and Context Engineering（プロンプトとコンテキスト） | 11.0% | 約6問 |
| 8 | Tools and MCPs（ツールと MCP） | 10.6% | 約5〜6問 |
| 7 | Security and Safety（セキュリティと安全） | 8.1% | 約4問 |
| 3 | Claude Code | 3.1% | 約1〜2問 |
| 4 | Eval, Testing, and Debugging（評価・テスト・デバッグ） | 2.6% | 約1〜2問 |

### Domain 1：Agents and Workflows（14.7%）
| スキル | 配点 | 主な内容 |
|---|---|---|
| Agent Architecture | 4.5% | ワークフローとエージェントの使い分け、マネージャー／スーパーバイザー型の階層、サブエージェントの役割 |
| Agent Construction with Claude | 5.3% | Claude Agent SDK、独自のエージェントループとハーネス、自前ホストか Anthropic ホストか、決まった処理を確実に行うためのフック |
| Agent Patterns and Frameworks | 4.9% | ツール利用ループ、サブエージェント、メモリ、コンテキストウィンドウ管理。Strands・LangGraph・PydanticAI などのフレームワーク |

### Domain 2：Applications and Integration（33.1%）
| スキル | 配点 | 主な内容 |
|---|---|---|
| Understanding Requirements | 3.4% | ビジネス要件とソリューション設計から、機能要件・インフラ要件を導く |
| Systems Life Cycle | 2.8% | IT システムの開発・導入・運用・保守のライフサイクル管理 |
| Claude API Mechanics | 6.8% | messages、tools、ストリーミング、画像入力、thinking、キャッシュ、他社クラウド経由での利用、Messages API のデータの扱い方、Batch API、リアルタイムとバッチの使い分け |
| Software Engineering Foundations | 7.4% | REST API、JSON、非同期処理、バージョン管理、SDLC への組み込み、コードレビュー、小規模・大規模なリファクタリング |
| Claude Application Design | **8.6%** | インターフェース（Claude Code、Desktop、claude.ai、API、SDK）ごとの指示の解釈のされ方、コンテンツの境界、スキーマ設計、セッションの衛生管理、プラグイン管理 |
| Configuration Management | 4.1% | CLAUDE.md、settings.json、モデルバージョンの固定、プロンプトのバージョン管理、プラグインの依存関係 |

### Domain 3：Claude Code（3.1%）
| スキル | 配点 | 主な内容 |
|---|---|---|
| Claude Code Operation | 3.1% | 構成要素（Rules、Skills、Commands、Agents、Agent Memory）、セッション管理、組み込み／カスタムのスラッシュコマンド、ヘッドレスモード、ストリーミングモード、auto モード、CLAUDE.md の階層、リポジトリの初期化、settings.json |

### Domain 4：Eval, Testing, and Debugging（2.6%）
| スキル | 配点 | 主な内容 |
|---|---|---|
| Debugging and Error Handling | 2.6% | エラーの種類の見分け方、回復方法の選び方、トレースから失敗のパターンを見つける、原因が統合部分かモデルの出力かを切り分ける |

### Domain 5：Model Selection and Optimization（16.8%）
| スキル | 配点 | 主な内容 |
|---|---|---|
| LLM Fundamentals | 5.2% | トークン、コンテキストウィンドウ、サンプリング、非決定性、次トークン生成。fast モード、extended thinking、adaptive thinking、effort レベル。zero-shot／single-shot／multi-shot |
| Technical Fundamentals | 6.1% | REST API をラップした SDK との統合、WebSocket |
| Model Selection and Tradeoffs | 2.7% | Opus・Sonnet・Haiku の使い分け、adaptive thinking への対応、品質・速度・コストのバランス、モデル更新による挙動の変化 |
| Cost and Token Management | 2.8% | トークン使用量の記録、コストの見積もり、プロンプトキャッシュとキャッシュのチェックポイント |

### Domain 6：Prompt and Context Engineering（11.0%）
| スキル | 配点 | 主な内容 |
|---|---|---|
| Context Engineering | 3.8% | コンテキストウィンドウの管理、ドリフトと肥大化の防止（ツール出力の削減、コンパクション）、サブエージェントや多段ワークフローによるコンテキストの分離 |
| Prompt Engineering | 4.6% | 指示の明確さ、few-shot の例、system と user の使い分け、出力の制約、構成要素ごとの指示の置き場所、繰り返しの改善、入力のサニタイズ |
| Output Handling | 2.6% | 構造化出力、応答の検証、防御的なパース、自信ありげな出力をうのみにしない |

### Domain 7：Security and Safety（8.1%）
| スキル | 配点 | 主な内容 |
|---|---|---|
| AI Application Security | 3.2% | プロンプトインジェクション対策、ジェイルブレイク対策、信頼できない入力の扱い、データ漏えいの防止、個人情報の扱い、認証・認可・機密性・完全性 |
| Guardrails and Safe Deployment | 2.3% | コンテンツポリシー、ガードレールの多層化、セキュア・バイ・デザイン（プライバシー、ID とアクセス管理、最小権限） |
| Claude Hooks | 1.0% | フックを使ったガードレールで破壊的な操作を防ぐ |
| Identity, Secrets, and Key Management | 1.6% | 開発環境と本番環境でのシークレット・認証情報・API キーの管理、本人確認、アクセスの承認、アクセスの監視 |

### Domain 8：Tools and MCPs（10.6%）
| スキル | 配点 | 主な内容 |
|---|---|---|
| Tool Implementation | 4.4% | tool use と関数呼び出し、外部システムとの連携設定、ツールの説明文の書き方、エラー処理、使い方のパターン（ハーネスでの振り分け、クライアント側とサーバー側のツール、承認のパターン）、ツール群の作り方 |
| MCP Server Development | 2.1% | MCP サーバーの作成・デプロイ・Claude アプリとの統合、MCP の resources・tools・prompts、通信方式（stdio、ソケット、クライアントとサーバー） |
| Agentic Customization | 4.1% | 組み込みツール、カスタムツール、Skills、MCP のどれを使うかの判断 |

### 配点が大きいスキル（上位6つで全体の約40%）
1. Claude Application Design 8.6%
2. Software Engineering Foundations 7.4%
3. Claude API Mechanics 6.8%
4. Technical Fundamentals 6.1%
5. Agent Construction with Claude 5.3%
6. LLM Fundamentals 5.2%

---

## 4. 公式サンプル問題から分かる出題スタイル（◎）

ガイドにある3問は、どれも **「状況（要件・制約）→ 最も適した方法を選ぶ」** 形式。

| # | 分野 | テーマ | 正解の考え方 |
|---|---|---|---|
| 1 | Domain 2 | 急がない大量処理で、コストを最優先したい | Message Batches API（24時間以内に非同期で処理、割安） |
| 2 | Domain 7 | 要約対象の Web ページにプロンプトインジェクションが隠れている | 外部コンテンツを信頼できない入力として指示と分け、ガードレールやフックで重要な操作を防ぐ |
| 3 | Domain 8 | 社内 REST API を複数の Claude アプリで共通して使いたい | MCP サーバーとしてツールを公開する |

誤答の選択肢の傾向：
- 要件の一部しか満たさない（並列化しても単価は下がらない、max_tokens を減らしても問題の本質は変わらない）
- 強制力がない対策（system プロンプトに「やめてください」と書く）
- 関係のない調整（temperature を上げる、もっと大きいモデルに替える）
- 機能の範囲を誤解している（組み込みツールなら社内 API に自由にアクセスできる）

→ 問題集では、**要件の中の決め手になる語（「コスト最優先」「再利用」「信頼できない入力」など）** と、**もっともらしいが的を外した選択肢** を意識して作る。

---

## 5. 準備の進め方（◎ ガイド第7章の要約）

- ブループリントの各スキルを自分で評価する
- 公式ドキュメント（Claude API、モデル、プロンプトエンジニアリング、Claude Code、Skills、MCP）を読む
- API、ツール連携、プロンプト／コンテキストの工夫、簡単なセキュリティと評価を含むアプリを1つ作って動かす
- system 指示の作成、エージェント構築、Claude Code の設定、トークンとコストの管理、ガードレール、カスタムツールや MCP サーバーの作成を練習する

---

## 6. 未確認の点

- 試験の言語（日本語対応）が公式に明記されているか
- 今回のガイドは第三者のリポジトリにあったミラーで、Partner Academy の配布版と同じものかは未照合（Partner Academy のページは外部から取得できなかった）
- キャンセル期限（ガイドは24時間前、Pearson VUE は48時間前／1時間前）。11月12日に Pearson 側で手続きが変わったという情報がある（△）
- 対象技術の一覧・対象外のトピックは、CCDV-F のガイドには書かれていない

---

## 出典

- 公式試験ガイド v1.0（ミラー）：https://github.com/Amey-Thakur/CLAUDE-CERTIFICATIONS （developer-foundations/exam-guide.pdf）
- Pearson VUE「Anthropic」：https://www.pearsonvue.com/us/en/anthropic.html
- claude.com「Four role-based certifications…」（2026-07-23）：https://claude.com/resources/articles/four-role-based-claude-certifications
- サーバーワークス「Claude認定資格が4種類に拡大」（2026-07-09）：https://blog.serverworks.co.jp/anthropic-claude-certification-overview-2026-07-09
- サーバーワークス「CCA-F 受験ガイド最新版」（2026-07-02）：https://blog.serverworks.co.jp/cca-f-certification-guide-2026-07
- Amey Thakur「Claude Certified Developer」学習ガイド：https://amey-thakur.github.io/CLAUDE-CERTIFICATIONS/developer-foundations/index.html
- DEV Community「CCDV-F: Exam Domains, Weights and Topics」：https://dev.to/poorna_reddy/claude-certified-developer-foundations-ccdv-f-exam-domains-weights-and-topics-26n
- AI Cert Guides「CCDV-F Exam Guide and Blueprint」：https://aicertguides.com/blog/claude-certified-developer-foundations-exam-guide
