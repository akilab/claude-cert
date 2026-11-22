# Messages API 仕様メモ

確認日：2026-11-20
出典：公式ドキュメント（platform.claude.com/docs）。疑似環境と問題は、このメモを根拠にする。
「（未確認）」と書いた項目は、公式で確かめてから使う。

---

## 1. リクエスト

`POST https://api.anthropic.com/v1/messages`

### ヘッダー
| ヘッダー | 値 |
|---|---|
| `x-api-key` | API キー |
| `anthropic-version` | **必須**。有効な値：`2026-10-21`（最新）、`2023-06-01`、`2023-01-01` |
| `content-type` | `application/json` |

### ボディ
| 項目 | 必須 | 内容 |
|---|---|---|
| `model` | ◯ | 例：`claude-sonnet-5-5` |
| `max_tokens` | ◯ | 出力トークンの上限。`0` にするとキャッシュの作成だけ行う（Batch では不可） |
| `messages` | ◯ | 会話。1リクエスト最大 100,000 件 |
| `system` | | 文字列、または text ブロックの配列（`cache_control` を付けられる） |
| `stop_sequences` | | 文字列の配列。出力に現れたらそこで止まる |
| `stream` | | `true` で SSE によるストリーミング |
| `tools` / `tool_choice` | | ツール定義と、ツールの使わせ方 |
| `thinking` | | 思考の設定（§6） |
| `output_config` | | `effort`（low／medium／high／xhigh／max）、`format`（構造化出力。§8） |
| `cache_control` | | トップレベルに付けると自動キャッシュ（§7） |
| `metadata.user_id` | | 利用者の識別子（名前やメールは入れない） |
| `service_tier` | | `auto`／`standard_only` |

**重要（`anthropic-version: 2026-10-21`）**：`temperature`、`top_p`、`top_k` は**廃止**。送るとすべてのモデルで 400 になる。古いバージョン（2023-06-01）ではまだ使える。

### messages のルール
- role は `user` と `assistant`。基本は交互に並べる。同じ role が続くと1つのターンにまとめられる。
- `content` は文字列（text ブロック1つの省略形）か、ブロックの配列。text ブロックの `text` は1文字以上。
- 最後を `assistant` にすると「プリフィル」（続きを書かせる）になる。**Claude 4.6 以降のモデルではプリフィルは 400**：
  `This model does not support assistant message prefill. The conversation must end with a user message.`
  → 出力の形を決めたいときは構造化出力（§8）を使う。
- 最初のメッセージが user でなければならないかは（未確認）。疑似環境では「user から始める」を推奨として扱い、エラーにはしない。

### content ブロックの種類（リクエスト側）
| type | 形 |
|---|---|
| `text` | `{"type":"text","text":"..."}` |
| `image` | `{"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}}`。`source.type` は `url`、`file` も可 |
| `document` | PDF（base64）、プレーンテキスト、URL、file など |
| `tool_use` | `{"type":"tool_use","id":"toolu_...","name":"...","input":{...}}`（assistant 側） |
| `tool_result` | `{"type":"tool_result","tool_use_id":"toolu_...","content":"...","is_error":true}`（user 側。`is_error` は任意） |
| `thinking` | `{"type":"thinking","thinking":"...","signature":"..."}`。**受け取ったまま変えずに返す**。変えると 400 |
| `redacted_thinking` | `{"type":"redacted_thinking","data":"..."}`。中身は読めない。そのまま返す |

---

## 2. レスポンス

```json
{
  "id": "msg_01...",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-5-5",
  "content": [{"type": "text", "text": "..."}],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 25,
    "output_tokens": 120,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

- 入力トークンの合計 ＝ `input_tokens` ＋ `cache_creation_input_tokens` ＋ `cache_read_input_tokens`
- `usage` にはほかに `cache_creation.ephemeral_5m_input_tokens`／`ephemeral_1h_input_tokens`、`output_tokens_details.thinking_tokens`、`server_tool_use`、`service_tier` などがある。

### stop_reason
| 値 | 意味 | アプリの対応 |
|---|---|---|
| `end_turn` | 自然に書き終えた | そのまま使う |
| `max_tokens` | `max_tokens` の上限で切れた | 上限を上げる、続きを生成する、出力を短くさせる |
| `stop_sequence` | `stop_sequences` の文字列が出た（`stop_sequence` にその文字列が入る） | 想定どおりの停止として処理する |
| `tool_use` | ツールを呼んでほしい | ツールを実行し、`tool_result` を返して再度呼ぶ |
| `pause_turn` | サーバーツールのループが上限（既定 10回）に達した | 返ってきた assistant の内容をそのまま送り返して続ける |
| `refusal` | 応答を断った（HTTP 200。エラーではない） | `stop_details` を確認。別のモデルで再試行する |
| `model_context_window_exceeded` | 出力がコンテキストウィンドウいっぱいになった | 途中で切れたものとして扱う |

---

## 3. ストリーミング（SSE）

`"stream": true`。各イベントは `event: 名前` と `data: JSON` の2行。

順番：
1. `message_start`（`content` は空、`stop_reason` は null、usage は入力トークン）
2. ブロックごとに `content_block_start` → `content_block_delta`（複数回） → `content_block_stop`
3. `message_delta`（`stop_reason` と出力トークン数。usage は累計）
4. `message_stop`

`ping` はどこにでも入りうる。ストリームの途中で `error` イベント（例：`overloaded_error`）が来ることがある（HTTP は 200 のまま）。知らないイベントは無視できるように作る。

delta の種類：
| delta.type | ブロック | 中身 |
|---|---|---|
| `text_delta` | text | `text` の断片 |
| `input_json_delta` | tool_use | `partial_json`（JSON 文字列の断片。全部つなげてから `content_block_stop` でパースする） |
| `thinking_delta` | thinking | `thinking` の断片 |
| `signature_delta` | thinking | 署名。`content_block_stop` の直前に来る |

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_...","type":"message","role":"assistant","model":"claude-sonnet-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":25,"output_tokens":1}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"こんにちは"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}

event: message_stop
data: {"type":"message_stop"}
```

---

## 4. ツール利用（tool use）

### 定義
```json
{"name": "get_weather", "description": "指定した都市の現在の天気を返す。", "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}
```
- `name`：`^[a-zA-Z0-9_-]{1,128}$`。`description` は任意だが強く推奨。`input_schema` は `type: "object"` の JSON Schema。
- `strict: true` で入力がスキーマどおりであることを保証する（strict ツールは1リクエスト最大20個）。

### tool_choice
| 値 | 意味 |
|---|---|
| `{"type":"auto"}` | 使うかどうかは Claude が決める（既定） |
| `{"type":"any"}` | どれかのツールを必ず使う |
| `{"type":"tool","name":"..."}` | 指定したツールを必ず使う |
| `{"type":"none"}` | ツールを使わない |

`disable_parallel_tool_use: true` で、1回の応答で使うツールを1つまでにする。
注意：Opus 5.5、Sonnet 5.5 などの一部の最新モデルは `any` と `tool` に対応しておらず、400 になる。

### ループの流れ
1. ツール定義つきでリクエスト → `stop_reason: "tool_use"`、`content` に `tool_use` ブロック
2. **アプリが** ツールを実行する（Claude は実行しない）
3. 次のリクエストの `messages` に、(a) さっきの assistant の内容をそのまま、(b) user メッセージに `tool_result` を入れて送る
4. Claude が結果を使って答える（または、さらにツールを呼ぶ）

### tool_result のルール
- 対応する `tool_use` を含む assistant メッセージの **直後** の user メッセージに置く。
- user の `content` 配列の **先頭** に置く。テキストは全部の tool_result の後ろ。テキストを先に置くと 400。
- 並列に複数のツールが呼ばれたら、1つの user メッセージに、`tool_use` 1つにつき `tool_result` を1つずつ入れる（失敗した場合も `is_error: true` で返す）。
- 対応する結果がないときのエラー例：`tool_use ids were found without tool_result blocks immediately after`

### クライアントツールとサーバーツール
- クライアントツール：自分で定義し、自分のアプリで実行する。
- サーバーツール：Anthropic 側で実行される（web_search、web_fetch、code_execution など）。`server_tool_use` ブロックと結果ブロックが返る。

---

## 5. モデル（2026年11月時点）

| モデル | API の ID | コンテキスト | 最大出力 | 入力／出力（$/100万トークン） |
|---|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | 1M | 128K | $4 ／ $20 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 1M | 128K | $2 ／ $10 |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 1M | 128K | $0.10 ／ $0.50（10万トークンまで） |
| Claude Fable 5.2 | `claude-fable-5-2` | 1M | 128K | $8 ／ $40 |

使い分けの目安：Haiku は速くて安い（分類、抽出、大量処理）／Sonnet は品質とコストのバランス（多くの本番用途）／Opus は難しい推論やエージェント。
すべての現行モデルが、テキストと画像の入力、ツール利用に対応している。

---

## 6. 思考（thinking）と effort

| 設定 | 内容 |
|---|---|
| `{"type":"adaptive"}` | 考えるかどうか・どれだけ考えるかを Claude が決める。Claude 4.6 以降 |
| `{"type":"enabled","budget_tokens":N}` | 思考トークンの予算を指定（N ≥ 1024、N < max_tokens）。**Claude 4.7 以降は 400**（adaptive と effort を使う） |
| `{"type":"disabled"}` | 思考しない。Opus 5.5 などでは使えない |

- 思考の量は `output_config.effort`（low〜max）で調整する。既定値は Opus 5.5 が medium、Sonnet 5.5 が high、Haiku 5.5 が medium。
- 思考トークンは出力トークンとして課金され、`max_tokens` に含まれる。
- レスポンスには `thinking` ブロック（`thinking` と `signature`）が text より前に入る。ツールのループでは、思考ブロックを変えずに送り返す。

---

## 7. プロンプトキャッシュ

- `cache_control: {"type":"ephemeral"}`、任意で `"ttl": "5m"`（既定）または `"1h"`。
- 2つの方法：
  - 自動：リクエストのトップレベルに `cache_control` を1つ付ける。区切りは最後のキャッシュできるブロックに置かれる。
  - 明示：`tools`、`system`、`messages` の各ブロックに付ける。区切りは最大4つ。
- キャッシュされる順番：`tools` → `system` → `messages`。**先頭から一致する部分（プレフィックス）** だけが再利用される。だから、変わらない内容を先に、変わる内容を後に置く。
- 最小の長さ：Opus 5.5、Sonnet 5.5、Haiku 5.5 は 512 トークン。足りないとエラーにはならず、キャッシュされないだけ（cache の usage が両方 0）。
- 料金（基本の入力単価に対する倍率）：書き込み 5分 = 1.25倍、1時間 = 2倍。読み込み = 0.1倍（Opus 5.5／Sonnet 5.5 は 0.05倍）。
- usage：初回は `cache_creation_input_tokens`、2回目以降（有効期限内）は `cache_read_input_tokens` に計上される。
- `cache_read_input_tokens` はレート制限の ITPM に数えない。

---

## 8. 構造化出力

- `output_config.format = {"type": "json_schema", "schema": {...}}` で、出力をスキーマどおりの JSON にする。
- 制限：再帰、`oneOf`、`not` は使えない。`additionalProperties` は `false`。プリフィルと引用（citations）とは併用できない。
- 古い `output_format` パラメータは非推奨。

---

## 9. 画像入力（vision）

- 形式：JPEG、PNG、GIF、WebP。
- 1枚あたり最大 10MB（base64 のサイズ）、最大 8000×8000 px。1リクエストに20枚を超えると、長辺の上限が下がる。
- 1リクエストの最大枚数：コンテキスト 200K のモデルは100枚、それ以外は600枚。
- トークンの目安：⌈幅 / 28⌉ × ⌈高さ / 28⌉。大きい画像は縮小される（Claude 4.7 以降は長辺 2,576 px、最大 4,784 トークン）。

---

## 10. エラー

```json
{
  "type": "error",
  "error": {"type": "invalid_request_error", "message": "..."},
  "request_id": "req_011..."
}
```
レスポンスヘッダー `request-id` にも同じ ID が入る。問い合わせのときに使う。

| HTTP | error.type | 主な原因 | 対応 |
|---|---|---|---|
| 400 | `invalid_request_error` | リクエストの形式や内容の誤り | 直してから送る（再試行しても同じ） |
| 401 | `authentication_error` | API キーの誤り | キーを確認する |
| 402 | `billing_error` | 支払いの問題 | 請求設定を確認する |
| 403 | `permission_error` | 権限がない | 権限を確認する |
| 404 | `not_found_error` | リソースがない（モデル名の誤りなど） | 名前を確認する |
| 413 | `request_too_large` | リクエストが大きすぎる（Messages は 128MB まで） | 小さくする |
| 429 | `rate_limit_error` | レート制限 | `retry-after` だけ待って再試行 |
| 500 | `api_error` | Anthropic 側の内部エラー | 指数バックオフで再試行 |
| 504 | `timeout_error` | タイムアウト | ストリーミングや Batches を検討、再試行 |
| 529 | `overloaded_error` | 一時的な過負荷 | 指数バックオフで再試行 |

公式 SDK は一時的なエラーを既定で2回再試行し、`retry-after` があればそれに従う。

### レート制限
- 単位：RPM（リクエスト／分）、ITPM（入力トークン／分）、OTPM（出力トークン／分）。モデルごと。
- 方式：トークンバケット（上限まで少しずつ回復する）。
- ヘッダー：`retry-after`（秒）、`anthropic-ratelimit-requests-remaining`、`anthropic-ratelimit-input-tokens-remaining`、`anthropic-ratelimit-output-tokens-remaining` など（`-limit`／`-remaining`／`-reset`）。

---

## 11. Message Batches API

- 作成：`POST /v1/messages/batches`
  ```json
  {"requests": [{"custom_id": "doc-001", "params": {"model": "claude-haiku-5-5", "max_tokens": 1024, "messages": [{"role": "user", "content": "..."}]}}]}
  ```
  `custom_id` は `^[a-zA-Z0-9_-]{1,64}$` で、重複不可。
- 状態の確認：`GET /v1/messages/batches/{id}`。`processing_status` は `in_progress` → `ended`（取り消し中は `canceling`）。`request_counts` に processing／succeeded／errored／canceled／expired の件数。
- 結果：`GET /v1/messages/batches/{id}/results`（JSONL。1行に1件）。順番は保証されないので **`custom_id` で対応づける**。
  `result.type` は `succeeded`（`message` を含む）／`errored`／`canceled`／`expired`。errored と expired は課金されない。
- 取り消し：`POST /v1/messages/batches/{id}/cancel`
- 制限：1バッチ最大 100,000 件または 256MB。24時間以内に終わらないものは expired。結果は作成から29日間取得できる。
- 料金：通常の **50%**。
- 使えないもの：`stream: true`、`max_tokens: 0` など。

---

## 12. トークン数の計測

- `POST /v1/messages/count_tokens`。ボディは Messages とほぼ同じ（model、messages、system、tools など）。
- レスポンス：`{"input_tokens": 14}`。目安の値。

---

## 未確認の点

- 最初のメッセージが user でなければならないか。content が空配列のときの挙動。
- `anthropic-version: 2023-06-01` での temperature などの範囲と既定値。
