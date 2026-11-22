// 疑似環境のシナリオ（演習）。各シナリオは、最初のリクエスト・課題・専用の応答規則を持つ。
// check(r) の r は { req: {method, path, headers, body}, res }。

export const DEFAULT_HEADERS = `x-api-key: sk-ant-demo-0000000000000000
anthropic-version: 2026-10-21
content-type: application/json`;

const SAMPLE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAjAAAAEYCAIAAADNhFv+AAADSElEQVR42u3VsQkAAAgEsd9/WkuxcgxBApngmst0AcC5SACAIQGAIQFgSABgSAAYEgAYEgCGBACGBIAhAYAhAWBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYEgAYEgCGBACGBACGBIAhAYAhAWBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYEgAYEgCGBACGBIAhAYAhAWBIAGBIABgSABgSAIakAgCGBACGBIAhAYAhAWBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYEgAYEgCGBACGBIAhAYAhAWBIAGBIABgSABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYEgAYEgCGBACGBIAhAYAhAWBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYEgAYEgCGBACGBIAhAYAhAWBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYkgoAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYEgAYEgCGBACGBIAhAYAhAWBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAhgQAhgSAIQGAIQFgSABgSABgSAAYEgAYEgCGBACGBIAhAYAhAWBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYEgAYEgCGBACGBIAhAYAhAWBIAGBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYEgAYEgCGBACGBIAhAYAhAWBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgSAGBIAGBIABgSABgSAIYEAIYEgCEBgCEBYEgAYEgAGBIAGBIAhgQAhgSAIQGAIQFgSABgSAAYEgAYEgAfLY1bIHtMlvHiAAAAAElFTkSuQmCC';

// キャッシュの演習用の、長い社内規程（疑似）
function makePolicy(n = 110) {
  const topics = ['勤務時間', '休暇の申請', '経費の精算', '情報の取り扱い', '機器の貸与', '出張', '在宅勤務', '研修', '安全衛生', '懲戒'];
  const lines = ['あなたは株式会社サンプルの社内規程アシスタントです。以下の規程だけを根拠に、条番号を示して回答してください。規程にないことは「規程に記載がありません」と答えてください。', ''];
  for (let i = 1; i <= n; i++) {
    const t = topics[i % topics.length];
    lines.push(`第${i}条（${t}）社員は、${t}に関して所定の手続きに従い、所属長の承認を得たうえで、期限までに必要な書類を人事部に提出しなければならない。例外は別に定める。`);
  }
  return lines.join('\n');
}

const has = (r, path) => {
  let v = r.req.body;
  for (const k of path) { if (v == null) return undefined; v = v[k]; }
  return v;
};
const ok = (r) => r.res && r.res.status === 200;
const errType = (r) => r.res && r.res.body && r.res.body.error && r.res.body.error.type;
const stop = (r) => r.res && r.res.body && r.res.body.stop_reason;
const lastMsg = (r) => { const m = r.req.body && r.req.body.messages; return Array.isArray(m) ? m[m.length - 1] : null; };

function kansai(text) {
  return text.replace(/です。/g, 'やで。').replace(/ですか？/g, 'なん？').replace(/ます。/g, 'るで。').replace(/ください。/g, 'な。');
}

const SEASONS = '1. 春（3〜5月）：桜が咲き、新年度が始まる季節です。気温が上がり、花見などの行事が各地で行われます。\n2. 夏（6〜8月）：梅雨のあとに暑さが本格化します。花火大会や夏祭りが多く、湿度の高さが特徴です。\n3. 秋（9〜11月）：暑さがやわらぎ、紅葉が美しい季節です。収穫の時期でもあり、食べ物がおいしくなります。\n4. 冬（12〜2月）：北日本や日本海側では雪が多く、太平洋側は乾燥した晴れの日が続きます。年末年始の行事があります。';

export const SCENARIOS = [
  {
    id: 'basic',
    title: '1. 最小のリクエスト',
    goal: '必須の3項目（model・max_tokens・messages）と、必須のヘッダーを理解する。',
    intro: 'Messages API は <code>POST /v1/messages</code> に JSON を送るだけのシンプルな API です。まずはそのまま「送信」してみましょう。次に、項目を消したり値を変えたりして、どんなエラーが返るかを確かめます。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: { model: 'claude-sonnet-5-5', max_tokens: 1024, messages: [{ role: 'user', content: 'こんにちは。簡単に自己紹介してください。' }] },
    },
    tasks: [
      { text: 'そのまま送信して、200 のレスポンスを受け取る', hint: '右側の content・stop_reason・usage を確認しましょう。', check: (r) => ok(r) && stop(r) === 'end_turn' },
      { text: '`max_tokens` を消して送り、400 エラーを確認する', hint: '"max_tokens": 1024, の行を削除します。', check: (r) => errType(r) === 'invalid_request_error' && r.req.body && r.req.body.max_tokens === undefined },
      { text: 'model を存在しない名前（例：claude-5）にして、404 を確認する', hint: '名前の誤りは 404 not_found_error です。', check: (r) => r.res.status === 404 },
      { text: 'ヘッダーの x-api-key の行を消して、401 を確認する', hint: 'API キーがないと認証エラーになります。', check: (r) => r.res.status === 401 },
      { text: 'エンドポイントを `/v1/messages/count_tokens` に変えて、入力トークン数を数える', hint: 'メソッドは POST のまま、パスだけ変えます。', check: (r) => ok(r) && r.req.path === '/v1/messages/count_tokens' },
    ],
    respond: ({ userText, systemText }) => {
      if (/自己紹介/.test(userText)) {
        const t = 'はじめまして。Anthropic が開発した AI アシスタントの Claude です（疑似応答）。文章の作成・要約・翻訳、コードの作成やレビュー、資料の分析など、さまざまな作業をお手伝いできます。';
        return { text: /関西弁/.test(systemText) ? kansai(t) : t };
      }
      return null;
    },
  },
  {
    id: 'stateless',
    title: '2. system と会話の履歴',
    goal: 'API が会話を覚えない（ステートレス）ことと、system パラメータの役割を体験する。',
    intro: 'いまのリクエストには「では大阪は？」しか入っていません。このまま送ると、Claude は何の続きか分かりません。<b>前のやり取りを messages に入れて</b> 送り直してみましょう。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: { model: 'claude-sonnet-5-5', max_tokens: 512, messages: [{ role: 'user', content: 'では大阪は？' }] },
    },
    tasks: [
      { text: 'そのまま送り、文脈が分からない返事になることを確認する', hint: 'API は前回の会話を覚えていません。', check: (r) => ok(r) && (r.req.body.messages || []).length === 1 },
      { text: 'messages の先頭に「東京の人口は？」（user）と「東京都の人口は約1,400万人です。」（assistant）を加えて送る', hint: '[{"role":"user","content":"東京の人口は？"},{"role":"assistant","content":"東京都の人口は約1,400万人です。"},{"role":"user","content":"では大阪は？"}]', check: (r) => ok(r) && (r.req.body.messages || []).length >= 3 && /人口/.test(JSON.stringify(r.req.body.messages)) },
      { text: '`"system": "関西弁で答えてください。"` を加えて、口調が変わることを確認する', hint: 'system は messages の外、トップレベルに書きます。', check: (r) => ok(r) && /関西弁/.test(JSON.stringify(r.req.body.system || '')) },
      { text: 'messages の中に role: "system" を入れて送り、エラーを確認する', hint: 'system は messages の中には入れられません。', check: (r) => errType(r) === 'invalid_request_error' && /system/.test(JSON.stringify(r.req.body.messages || '')) },
    ],
    respond: ({ userText, historyText, systemText }) => {
      const style = (t) => (/関西弁/.test(systemText) ? kansai(t) : t);
      if (/大阪/.test(userText)) {
        if (/人口/.test(historyText)) return { text: style('大阪府の人口は約880万人です。（疑似応答：履歴にある「東京の人口」という話題から、大阪の人口を聞かれていると判断しました）') };
        return { text: style('「大阪」の何についてお知りになりたいですか？　天気、人口、観光地など、もう少し詳しく教えてください。（疑似応答：履歴がないので、何の続きか分かりません）') };
      }
      if (/東京/.test(userText) && /人口/.test(userText)) return { text: style('東京都の人口は約1,400万人です。') };
      return null;
    },
  },
  {
    id: 'stop-reason',
    title: '3. stop_reason と出力の上限',
    goal: 'end_turn・max_tokens・stop_sequence の違いと、プリフィルが使えないことを確かめる。',
    intro: 'レスポンスの <code>stop_reason</code> は「なぜ出力が止まったか」を示します。アプリはこの値を見て次の動作を決めます。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: { model: 'claude-sonnet-5-5', max_tokens: 1024, messages: [{ role: 'user', content: '日本の四季について、1. から 4. の番号つきで説明してください。' }] },
    },
    tasks: [
      { text: 'そのまま送り、stop_reason が end_turn になることを確認する', hint: '最後まで書き終えた状態です。', check: (r) => ok(r) && stop(r) === 'end_turn' },
      { text: '`max_tokens` を 40 にして、stop_reason が max_tokens になることを確認する', hint: '文章が途中で切れます。', check: (r) => ok(r) && stop(r) === 'max_tokens' },
      { text: '`"stop_sequences": ["3."]` を加えて、stop_sequence で止まることを確認する', hint: '「3.」の直前で止まり、stop_sequence に "3." が入ります。', check: (r) => ok(r) && stop(r) === 'stop_sequence' },
      { text: 'messages の最後に `{"role":"assistant","content":"1. 春"}` を加えて（プリフィル）、400 を確認する', hint: 'Claude 4.6 以降のモデルはプリフィルに対応していません。', check: (r) => errType(r) === 'invalid_request_error' && lastMsg(r) && lastMsg(r).role === 'assistant' },
      { text: '同じプリフィルのまま model を claude-haiku-4-5 にすると、続きから書かれることを確認する', hint: '旧世代のモデルではプリフィルが使えます。', check: (r) => ok(r) && lastMsg(r) && lastMsg(r).role === 'assistant' },
    ],
    respond: ({ userText, last }) => {
      if (last.role === 'assistant') return { text: `${SEASONS.replace(/^1\. 春/, '').slice(0, 200)}（疑似応答：プリフィル「${typeof last.content === 'string' ? last.content : '…'}」の続きから書いています）` };
      if (/四季/.test(userText)) return { text: SEASONS };
      return null;
    },
  },
  {
    id: 'streaming',
    title: '4. ストリーミング',
    goal: 'SSE のイベントの順番と、文字が少しずつ届く様子を観察する。',
    intro: '<code>"stream": true</code> にすると、レスポンスは一度に返らず、イベントの列（Server-Sent Events）として少しずつ届きます。右側の「ストリーム」タブでイベントを1つずつ確認できます。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: { model: 'claude-sonnet-5-5', max_tokens: 1024, stream: true, messages: [{ role: 'user', content: '日本の四季について、1. から 4. の番号つきで説明してください。' }] },
    },
    tasks: [
      { text: 'そのまま送り、イベントが message_start → content_block_* → message_delta → message_stop の順に届くのを見る', hint: 'stop_reason と出力トークン数は message_delta で届きます。', check: (r) => ok(r) && r.req.body.stream === true },
      { text: '`"stream": false` にして送り、一度にまとめて返る違いを確認する', hint: '品質や料金は同じで、届け方だけが違います。', check: (r) => ok(r) && r.req.body.stream === false },
      { text: '天気ツール（シナリオ5のもの）を tools に加え、「大阪の天気は？」と聞いて input_json_delta を観察する', hint: 'ツールの入力は JSON の断片として届き、最後につなげてパースします。', check: (r) => ok(r) && r.req.body.stream === true && stop(r) === 'tool_use' },
    ],
    respond: ({ userText }) => (/四季/.test(userText) ? { text: SEASONS } : null),
  },
  {
    id: 'tool-use',
    title: '5. ツール利用のループ',
    goal: 'tool_use → アプリが実行 → tool_result → 最終回答、の流れと、よくある誤りを体験する。',
    intro: 'ツールを定義すると、Claude は必要に応じて「このツールをこの入力で呼んで」と要求します（<code>stop_reason: "tool_use"</code>）。<b>実行するのはあなたのアプリ</b>です。送信後に表示される「ツールを実行して結果を追加」ボタンで、アプリの役目を体験しましょう。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: {
        model: 'claude-sonnet-5-5', max_tokens: 1024,
        tools: [{
          name: 'get_weather',
          description: '指定した都市の現在の天気と気温を返す。利用者が天気・気温・雨などを尋ねたときに使う。',
          input_schema: { type: 'object', properties: { city: { type: 'string', description: '都市名（例：大阪）' } }, required: ['city'] },
        }],
        messages: [{ role: 'user', content: '大阪の今の天気を教えて。' }],
      },
    },
    tasks: [
      { text: '送信して、stop_reason: tool_use と tool_use ブロックを確認する', hint: 'input に {"city": "大阪"} が入っています。', check: (r) => ok(r) && stop(r) === 'tool_use' },
      { text: '「ツールを実行して結果を追加」を押してから送信し、最終回答（end_turn）を受け取る', hint: 'assistant の tool_use と、user の tool_result が履歴に加わります。', check: (r) => ok(r) && stop(r) === 'end_turn' && /tool_result/.test(JSON.stringify(r.req.body.messages || '')) },
      { text: 'tool_result の前に text ブロックを置いて送り、400 を確認する', hint: 'user の content を [{"type":"text",...},{"type":"tool_result",...}] の順にします。', check: (r) => errType(r) === 'invalid_request_error' && /must come first/.test(r.res.body.error.message) },
      { text: 'tool_result のメッセージを消して送り、400 を確認する', hint: 'tool_use には必ず対応する tool_result が必要です。', check: (r) => errType(r) === 'invalid_request_error' && /without `tool_result`/.test(r.res.body.error.message) },
      { text: '`"tool_choice": {"type": "any"}` を加えて送り、このモデルでは使えないことを確認する', hint: 'Opus 5.5／Sonnet 5.5 はツールの強制に対応していません。', check: (r) => errType(r) === 'invalid_request_error' && r.req.body.tool_choice && r.req.body.tool_choice.type === 'any' },
    ],
    tools: {
      get_weather: ({ city }) => {
        const table = { 大阪: ['晴れ', 18], 東京: ['くもり', 15], 札幌: ['雪', -2], 那覇: ['晴れ', 24], 福岡: ['雨', 14] };
        const w = table[city];
        if (!w) return { content: `都市「${city}」の天気は見つかりませんでした`, is_error: true };
        return { content: JSON.stringify({ city, weather: w[0], temp_c: w[1] }) };
      },
    },
    respond: ({ toolResults }) => {
      if (!toolResults.length) return null;
      const r = toolResults[0];
      if (r.is_error) return { text: `申し訳ありません、天気を取得できませんでした（${r.content}）。都市名を確認して、もう一度お試しください。（疑似応答）` };
      try {
        const d = JSON.parse(typeof r.content === 'string' ? r.content : r.content[0].text);
        return { text: `${d.city}の現在の天気は${d.weather}、気温は${d.temp_c}℃です。（疑似応答：ツールの結果をもとに回答しています）` };
      } catch {
        return null;
      }
    },
  },
  {
    id: 'structured',
    title: '6. 構造化出力',
    goal: 'output_config.format で、出力を決まった JSON の形に縛る方法を学ぶ。',
    intro: '後続のシステムが機械的に読む出力は、JSON スキーマで形を決めます。<code>enum</code> で値の候補を固定し、<code>additionalProperties: false</code> で余計な項目を出させません。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: {
        model: 'claude-haiku-5-5', max_tokens: 512,
        system: '問い合わせメールを分類してください。',
        output_config: {
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                category: { type: 'string', enum: ['billing', 'technical', 'cancellation', 'other'] },
                urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
                summary: { type: 'string', description: '問い合わせの要約（1文）' },
              },
              required: ['category', 'urgency', 'summary'],
              additionalProperties: false,
            },
          },
        },
        messages: [{ role: 'user', content: '至急です。今月の請求額が先月の2倍になっています。理由を教えてください。' }],
      },
    },
    tasks: [
      { text: '送信して、スキーマどおりの JSON が text に入ることを確認する', hint: 'category は billing、urgency は high になるはずです。', check: (r) => ok(r) && has(r, ['output_config', 'format']) },
      { text: 'メールの内容を「ログインできません」に変えて、分類が変わることを確認する', hint: '技術的な問い合わせ（technical）になります。', check: (r) => ok(r) && /ログイン/.test(JSON.stringify(r.req.body.messages)) },
      { text: '`additionalProperties` を消して送り、400 を確認する', hint: '構造化出力では false の指定が必要です。', check: (r) => errType(r) === 'invalid_request_error' && /additionalProperties/.test(r.res.body.error.message) },
    ],
    respond: ({ userText, body }) => {
      if (!body.output_config || !body.output_config.format) return null;
      const category = /請求|料金|支払/.test(userText) ? 'billing' : /ログイン|エラー|動かな|不具合/.test(userText) ? 'technical' : /解約|退会/.test(userText) ? 'cancellation' : 'other';
      const urgency = /至急|今すぐ|急ぎ/.test(userText) ? 'high' : /できれば|お手すき/.test(userText) ? 'low' : 'medium';
      const props = (body.output_config.format.schema && body.output_config.format.schema.properties) || {};
      const json = {};
      Object.keys(props).forEach((k) => {
        if (k === 'category') json[k] = props[k].enum && !props[k].enum.includes(category) ? props[k].enum[props[k].enum.length - 1] : category;
        else if (k === 'urgency') json[k] = urgency;
        else if (k === 'summary') json[k] = `${userText.replace(/\s+/g, '').slice(0, 30)}…に関する問い合わせ`;
        else json[k] = props[k].enum ? props[k].enum[0] : '（疑似の値）';
      });
      return { json };
    },
  },
  {
    id: 'vision',
    title: '7. 画像の入力',
    goal: 'image ブロックの形と、画像のトークン数の目安を学ぶ。',
    intro: '画像は user の content に <code>type: "image"</code> のブロックとして入れます。疑似環境では画像の中身は読めませんが、形式の検証とトークン数の計算（⌈幅/28⌉×⌈高さ/28⌉）を体験できます。サンプルは 560×280 px の PNG です。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: {
        model: 'claude-sonnet-5-5', max_tokens: 512,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: SAMPLE_PNG } },
          { type: 'text', text: 'この画像に何が写っていますか？' },
        ] }],
      },
    },
    tasks: [
      { text: '送信して、画像のトークン数（20×10＝200）が usage に反映されることを確認する', hint: '560÷28＝20、280÷28＝10。', check: (r) => ok(r) && /image/.test(JSON.stringify(r.req.body.messages)) },
      { text: 'media_type を image/jpeg に変えて、中身と一致しないエラーを確認する', hint: 'PNG のデータに JPEG と書いています。', check: (r) => errType(r) === 'invalid_request_error' && /media type/.test(r.res.body.error.message) },
      { text: 'media_type を image/bmp にして、対応していない形式のエラーを確認する', hint: '対応は JPEG・PNG・GIF・WebP です。', check: (r) => errType(r) === 'invalid_request_error' && /bmp/.test(JSON.stringify(r.req.body.messages)) },
    ],
  },
  {
    id: 'thinking',
    title: '8. 思考（thinking）と effort',
    goal: 'adaptive thinking と effort の関係、モデルによる違いを確かめる。',
    intro: '新しいモデルでは <code>thinking: {"type": "adaptive"}</code> で、考えるかどうか・どれだけ考えるかを Claude が判断します。量の目安は <code>output_config.effort</code> で調整します。思考は thinking ブロックとして返り、出力トークンとして課金されます。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: {
        model: 'claude-opus-5-5', max_tokens: 4096,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        messages: [{ role: 'user', content: '論理パズルです。A・B・C の3人のうち1人だけが本当のことを言っています。A「Bはうそつき」、B「Cはうそつき」、C「AとBはうそつき」。本当のことを言っているのは誰？' }],
      },
    },
    tasks: [
      { text: '送信して、thinking ブロックが text より前にあることを確認する', hint: 'usage の output_tokens_details.thinking_tokens も見てみましょう。', check: (r) => ok(r) && (r.res.body.content || []).some((b) => b.type === 'thinking') },
      { text: 'effort を low にして、思考の量（thinking_tokens）が減ることを確認する', hint: '簡単な問題なら、effort を下げて速く・安くできます。', check: (r) => ok(r) && has(r, ['output_config', 'effort']) === 'low' },
      { text: 'thinking を `{"type": "enabled", "budget_tokens": 2000}` にして、Opus 5.5 では 400 になることを確認する', hint: 'Claude 4.7 以降は budget_tokens による指定に対応していません。', check: (r) => errType(r) === 'invalid_request_error' && has(r, ['thinking', 'type']) === 'enabled' && r.req.body.model === 'claude-opus-5-5' },
      { text: 'model を claude-haiku-4-5 にし、thinking を enabled（budget_tokens 2000）、output_config を削除して送る', hint: '旧世代のモデルでは budget_tokens で思考の予算を指定します（budget_tokens < max_tokens）。', check: (r) => ok(r) && r.req.body.model === 'claude-haiku-4-5' && has(r, ['thinking', 'type']) === 'enabled' },
    ],
    respond: ({ userText }) => {
      if (/パズル|うそつき/.test(userText)) {
        return {
          complex: true,
          thinking: 'A が正直なら B はうそつき。B の発言「C はうそつき」はうそなので C は正直になり、正直者が2人になって矛盾。B が正直なら C はうそつき、A の発言「B はうそつき」はうそで A もうそつき。C の発言「A と B はうそつき」は B が正直なのでうそ。条件を満たす。C が正直なら A も B もうそつきだが、A の発言「B はうそつき」が本当になって矛盾。',
          text: '本当のことを言っているのは B です。B が正直だとすると、C はうそつき、A の「B はうそつき」もうそになり、正直者がちょうど1人という条件を満たします。A や C が正直だと仮定すると、どちらも矛盾が生じます。（疑似応答）',
        };
      }
      return null;
    },
  },
  {
    id: 'caching',
    title: '9. プロンプトキャッシュ',
    goal: 'キャッシュの書き込みと読み込み、一致しない原因、最小の長さを体験する。',
    intro: 'system の長い社内規程（約6,000トークン）に <code>cache_control</code> を付けています。同じ先頭部分で2回送ると、2回目は <code>cache_read_input_tokens</code> になり、費用と最初のトークンまでの時間が下がります。右下のメーターで費用の変化を確かめましょう。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: {
        model: 'claude-sonnet-5-5', max_tokens: 512,
        system: [{ type: 'text', text: makePolicy(), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: '在宅勤務の申請はどうすればいいですか？' }],
      },
    },
    tasks: [
      { text: '1回目を送信し、cache_creation_input_tokens（書き込み）を確認する', hint: '書き込みは通常の入力の 1.25 倍の単価です。', check: (r) => ok(r) && r.res.body.usage.cache_creation_input_tokens > 0 },
      { text: '質問だけを変えて送り、cache_read_input_tokens（読み込み）になることを確認する', hint: '変わったのは末尾の質問だけなので、先頭の規程はキャッシュに一致します。', check: (r) => ok(r) && r.res.body.usage.cache_read_input_tokens > 0 },
      { text: 'system の text の先頭に「現在時刻：10:31」を加えて送り、一致しなくなることを確認する', hint: '先頭が変わるとプレフィックスが一致しません。', check: (r) => ok(r) && r.res.body.usage.cache_read_input_tokens === 0 && /現在時刻/.test(JSON.stringify(r.req.body.system || '')) },
      { text: '「時間を5分進める」を押してから送り、有効期限切れで再び書き込みになることを確認する', hint: '既定の有効期限は5分です（読むたびに延長されます）。', check: (r) => ok(r) && r.res.body.usage.cache_creation_input_tokens > 0 && r.state && r.state.advanced },
      { text: 'system を短い1文（例："規程アシスタントです。"）にして送り、最小の長さに満たずキャッシュされないことを確認する', hint: 'エラーにはならず、cache の usage が両方 0 になります。', check: (r) => ok(r) && r.res.body.usage.cache_creation_input_tokens === 0 && r.res.body.usage.cache_read_input_tokens === 0 && JSON.stringify(r.req.body.system || '').length < 400 },
    ],
    respond: ({ userText }) => {
      if (/在宅/.test(userText)) return { text: '在宅勤務は、第7条などの規程に基づき、所定の手続きに従って所属長の承認を得たうえで、期限までに必要な書類を人事部に提出してください。（疑似応答）' };
      if (/休暇/.test(userText)) return { text: '休暇の申請は、第1条・第11条などに基づき、所属長の承認を得て人事部に書類を提出します。（疑似応答）' };
      if (/経費|精算/.test(userText)) return { text: '経費の精算は、第2条・第12条などに基づき、期限までに必要な書類を人事部に提出します。（疑似応答）' };
      return { text: 'ご質問の内容について、規程の該当する条を確認してお答えします。（疑似応答）' };
    },
  },
  {
    id: 'errors',
    title: '10. エラーと再試行',
    goal: '再試行すべきエラーと、直すべきエラーを見分け、指数バックオフを体験する。',
    intro: '「サーバーの状態」を切り替えると、混雑やレート制限を再現できます。429・500・529 は待って再試行、400・401・404 はリクエストを直します。「SDK のように再試行」で、指数バックオフの流れを時系列で確認できます。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: { model: 'claude-haiku-5-5', max_tokens: 256, messages: [{ role: 'user', content: 'こんにちは。簡単に自己紹介してください。' }] },
    },
    tasks: [
      { text: 'サーバーの状態を「429 レート制限」にして送り、retry-after ヘッダーを確認する', hint: 'ヘッダーのタブで retry-after を見ます。', check: (r) => r.res.status === 429 },
      { text: 'サーバーの状態を「529 過負荷」にして送る', hint: '一時的な混雑です。', check: (r) => r.res.status === 529 },
      { text: '「SDK のように再試行」を押して、待ち時間が 1秒→2秒→… と延びる様子を確認する', hint: '時系列の欄に試行が並びます。', check: (r) => r.state && r.state.retried },
      { text: '状態を「正常」に戻し、JSON のカンマを1つ消して送り、400 の解説を確認する', hint: 'JSON の形式の誤りは、再試行しても直りません。', check: (r) => errType(r) === 'invalid_request_error' && r.req.body === null },
    ],
    respond: ({ userText }) => (/自己紹介/.test(userText) ? { text: 'はじめまして。Claude です（疑似応答）。' } : null),
  },
  {
    id: 'batches',
    title: '11. Message Batches',
    goal: '急がない大量処理を、非同期でまとめて安く処理する流れを体験する。',
    intro: 'Batches では、複数のリクエストを <code>custom_id</code> つきでまとめて送り、後で結果を受け取ります。料金は通常の 50% です。作成 → 状態の確認 → 結果の取得、の順に進めましょう。',
    request: {
      method: 'POST', path: '/v1/messages/batches', headers: DEFAULT_HEADERS,
      body: {
        requests: [
          { custom_id: 'review-001', params: { model: 'claude-haiku-5-5', max_tokens: 128, messages: [{ role: 'user', content: 'このレビューの感情を分類して：とても使いやすく満足しています。' }] } },
          { custom_id: 'review-002', params: { model: 'claude-haiku-5-5', max_tokens: 128, messages: [{ role: 'user', content: 'このレビューの感情を分類して：すぐに壊れてがっかりしました。' }] } },
          { custom_id: 'review-003', params: { model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'このレビューの感情を分類して：普通です。' }] } },
        ],
      },
    },
    tasks: [
      { text: '送信してバッチを作成し、processing_status: in_progress を確認する', hint: 'レスポンスの id（msgbatch_…）を使います。', check: (r) => ok(r) && r.req.path === '/v1/messages/batches' },
      { text: 'メソッドを GET、パスを `/v1/messages/batches/{id}` にして、状態が ended になるまで確認する', hint: '「状態を確認」ボタンでも自動で入力できます。', check: (r) => ok(r) && r.res.body && r.res.body.processing_status === 'ended' },
      { text: 'パスを `/v1/messages/batches/{id}/results` にして結果を取得し、順番と errored の1件を確認する', hint: 'review-003 は max_tokens がないので errored になります。', check: (r) => ok(r) && /results$/.test(r.req.path) },
    ],
    respond: ({ userText }) => {
      const m = userText.match(/分類して：(.*)$/);
      if (!m) return null;
      const t = m[1];
      const label = /満足|使いやすい|良い/.test(t) ? '肯定' : /がっかり|壊れ|悪い/.test(t) ? '否定' : '中立';
      return { text: label };
    },
  },
  {
    id: 'free',
    title: '12. 自由に試す',
    goal: 'これまでの要素を組み合わせて、自由にリクエストを書いてみる。',
    intro: '好きなリクエストを書いて送ってみましょう。シナリオ専用の応答はないため、返答は定型の文になりますが、検証・stop_reason・usage・費用の計算はすべて動きます。',
    request: {
      method: 'POST', path: '/v1/messages', headers: DEFAULT_HEADERS,
      body: { model: 'claude-sonnet-5-5', max_tokens: 1024, system: 'あなたは丁寧なアシスタントです。', messages: [{ role: 'user', content: 'ここに質問を書いてください。' }] },
    },
    tasks: [],
  },
];
