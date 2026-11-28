# Claude Code 仕様メモ

確認日：2026-11-22
出典：公式ドキュメント（code.claude.com/docs/en/…）。最難関の問題はこのメモを根拠にする（`src: cc-notes#節番号`）。
「（未確認）」の項目は問題の根拠にしない。

---

## 1. CLAUDE.md（memory）
| 種類 | 場所 | 範囲 |
|---|---|---|
| 組織の管理ポリシー | macOS `/Library/Application Support/ClaudeCode/CLAUDE.md` など | 組織全体。利用者は除外できない |
| ユーザー | `~/.claude/CLAUDE.md` | 自分のすべてのプロジェクト |
| プロジェクト | `./CLAUDE.md` または `./.claude/CLAUDE.md` | チームで共有（Git に入れる） |
| ローカル | `./CLAUDE.local.md` | 自分だけ。`.gitignore` に自分で追加する |

- 作業ディレクトリと、その**上位**のディレクトリの CLAUDE.md は起動時に読み込まれ、**上書きではなく連結**される。
- **サブディレクトリ**の CLAUDE.md は起動時ではなく、そのディレクトリのファイルを読み書きしたときに読み込まれる。
- `@path/to/file` で他のファイルを取り込める（最大4段）。
- 1ファイル 200 行未満が目安。
- `/init` でプロジェクトの CLAUDE.md を作る。`/memory` で CLAUDE.md の編集や自動メモリの設定を行う。
- CLAUDE.md は**文脈であって強制ではない**。強制したいものはフックや権限の deny ルールで行う。
- CLAUDE.md がないときは AGENTS.md を読む（既定）。

## 2. settings.json と権限
- 優先順位（高い順）：**組織の管理設定 ＞ コマンドラインの引数 ＞ ローカル（`.claude/settings.local.json`）＞ プロジェクト共有（`.claude/settings.json`）＞ ユーザー（`~/.claude/settings.json`）**
- `.claude/settings.json` は Git で共有する。`.claude/settings.local.json` は個人用（Claude Code が作るときは Git の除外設定に加える）。
- `permissions.allow`／`permissions.ask`／`permissions.deny` の配列はスコープをまたいで**合算**される。
- 書き方：`Bash`（すべて）、`Bash(npm run test *)`（前方一致）、`Bash(npm run build)`（完全一致）、`Read(./.env)`、`WebFetch(domain:example.com)`、`mcp__サーバー名__*`。
- 評価の順：**deny → ask → allow**。最初に一致したものが決める。**deny が常に優先**し、allow で deny の例外は作れない。
- `permissions.defaultMode`：`default`（別名 manual）、`acceptEdits`、`plan`、`auto`、`dontAsk`、`bypassPermissions`。`auto` と `bypassPermissions` は、プロジェクトやローカルの設定ファイルに書いても効かない（ユーザー・組織の設定か `--permission-mode` で指定）。

## 3. フック
- 設定場所：ユーザー・プロジェクト・ローカルの settings.json、組織の管理設定、プラグイン、スキルやサブエージェントのフロントマター。
- 主なイベント：SessionStart、UserPromptSubmit、**PreToolUse**、PermissionRequest、**PostToolUse**、PostToolUseFailure、Notification、SubagentStop、Stop、PreCompact、PostCompact、SessionEnd など（以前より大幅に増えている）。
- matcher：`Edit|Write` のような名前の列挙、または正規表現。ツールのイベントは tool_name に対して照合する。
- **PreToolUse でツールを止める方法**：終了コード **2**（理由は標準エラー）、または終了コード 0 で JSON の `hookSpecificOutput.permissionDecision: "deny"`。
- フックの "allow" は deny ルールを上書きしない。終了コード 2 は allow ルールがあっても止める。

## 4. スラッシュコマンドとスキル
- 主な組み込み：`/clear`（新しい空の会話。CLAUDE.md は残る）、`/compact [指示]`（要約して文脈を空ける）、`/init`、`/memory`、`/resume`、`/agents`、`/permissions`、`/hooks`、`/model`、`/context`、`/usage`（`/cost` は別名）、`/plugin`、`/mcp`、`/skills`。
- **カスタムコマンドはスキルに統合された**。`.claude/commands/deploy.md` は今も動き `/deploy` になる。新しく作るならスキル（`.claude/skills/<名前>/SKILL.md`）が推奨。
- スキルの場所：個人 `~/.claude/skills/<名前>/SKILL.md`、プロジェクト `.claude/skills/<名前>/SKILL.md`、プラグイン内。
- フロントマター：`name`、`description`（推奨）、`allowed-tools`、`model`、`disable-model-invocation` など。
- **段階的な読み込み**：名前と説明は常に一覧に載る → 本文は使うときに読み込む → 補助ファイルは本文が参照したときだけ読む。
- 引数：`$ARGUMENTS`、`$0` など。

## 5. サブエージェント
- 場所：`.claude/agents/`（プロジェクト）、`~/.claude/agents/`（ユーザー）、プラグイン、組織の管理設定。
- フロントマター：`name` と `description` が必須。`tools`（省略するとすべて継承）、`model`、`permissionMode` など。
- **それぞれ独自の新しいコンテキスト**で動き、親には最終的な要約だけが返る。
- 組み込み：Explore（読み取り専用の検索）、Plan、general-purpose など。

## 6. ヘッドレス（非対話）
- `claude -p "…"`（`--print`）。成功で終了コード 0。
- `--output-format`：`text`（既定）、`json`（result、session_id、total_cost_usd を含む）、`stream-json`。
- `--allowedTools`：確認なしで使えるツール。`--disallowedTools`。`--permission-mode`。
- `--max-turns N`（print モードのみ）、`--continue`（直前の会話）、`--resume <ID>`、`--json-schema`（構造化出力）。

## 7. セッション
- `/clear`：会話を空にする（メモリは残る）。`/compact`：会話を要約して文脈を空ける。自動のコンパクションもある。
- `claude --continue`（`-c`）：最新の会話を再開。`claude --resume`（`-r`）：ID や一覧から再開。

## 8. プラグイン
- 中身：スキル、エージェント、フック、MCP サーバー、出力スタイルなど（コマンドはスキルに統合）。
- `.claude-plugin/plugin.json` が目印。マーケットプレイスから `/plugin` で導入する。プラグインのスキルは `/プラグイン名:スキル名`。

## 9. auto モード
- **権限モードの1つ**（`auto`）。確認を出す代わりに、別の分類用モデルが実行前に操作を審査する。明示的な ask ルールは確認を出す。
- 新しいバージョンでは、対話セッションの既定の開始モード。管理者は無効にできる。
- 他のモード：plan（読み取り中心の調査）、dontAsk（確認が必要なものは拒否）、bypassPermissions（確認を省略。隔離環境でのみ）。

## 未確認
- フックの Stop・SubagentStop の詳しい判定方法。
- 自動コンパクションの詳しい条件。

## 10. 対話の操作・チェックポイント・MCP（確認日：2026-11-28）
出典：code.claude.com/docs/en/interactive-mode、/checkpointing、/mcp
- Esc：作業を途中で止める（そこまでの作業は残る）。確認の画面では拒否。Esc 2回：入力が空なら巻き戻しのメニュー（入力があれば入力を消して履歴に保存）。
- Shift+Tab：権限モードの切り替え（default〔表示は Manual〕→ acceptEdits → plan → 使える場合は bypassPermissions・auto）。
- Ctrl+C：実行中の処理を止める。何も動いていなければ1回目で入力を消し、2回目で終了。
- 複数行：`\`＋Enter、Ctrl+J（どのターミナルでも）、Option+Enter、Shift+Enter（対応ターミナル）。
- 入力の先頭：`@` ファイルのパスの補完、`!` シェルのモード（直接実行し出力を会話に入れる。サンドボックスの外）、`/` コマンド・スキル。`#` によるメモリへの追加はページに記載なし（問題にしない）。
- チェックポイント：依頼の前に自動で作成。`/rewind`（別名 `/undo`）か、入力が空のときの Esc 2回。「コードと会話」「会話だけ」「コードだけ」を戻せる。要約もできる。
  - Bash のコマンドだけで変えたファイルは追跡されず戻らない。サブエージェントの編集も基本的に戻らない。Git の代わりにはならない。
- MCP：`claude mcp add --transport http <名前> <URL>`、`claude mcp add [options] <名前> -- <コマンド> [引数]`（stdio）。transport は http（推奨）・stdio・sse（非推奨）。
  - スコープ：local（既定）・project（プロジェクト直下の `.mcp.json`、チームで共有）・user。`/mcp` で状態の確認・認証。`claude mcp list`／`get`／`remove`。
