// Messages API の疑似エンジン。ブラウザの中だけで、リクエストの検証とレスポンスの生成を行う。
// 仕様の根拠は docs/api-notes.md。本物の Claude は呼ばない。

export const VERSIONS = ['2026-10-21', '2023-06-01', '2023-01-01'];

// 料金は $/100万トークン（2026年11月時点。docs/api-notes.md）
export const MODELS = {
  'claude-opus-5-5': {
    label: 'Claude Opus 5.5', context: 1_000_000, maxOut: 128_000, input: 4, output: 20, cacheRead: 0.05,
    minCache: 512, gen: 5, prefill: false, thinking: ['adaptive'], defaultThinking: 'adaptive', forcedToolChoice: false, speed: 45,
  },
  'claude-sonnet-5-5': {
    label: 'Claude Sonnet 5.5', context: 1_000_000, maxOut: 128_000, input: 2, output: 10, cacheRead: 0.05,
    minCache: 512, gen: 5, prefill: false, thinking: ['adaptive', 'disabled', 'between_tools'], defaultThinking: 'none', forcedToolChoice: false, speed: 70,
  },
  'claude-haiku-5-5': {
    label: 'Claude Haiku 5.5', context: 1_000_000, maxOut: 128_000, input: 0.10, output: 0.50, cacheRead: 0.1,
    tier: { above: 100_000, input: 0.50, output: 2.50 },
    minCache: 512, gen: 5, prefill: false, thinking: ['adaptive', 'disabled', 'between_tools'], defaultThinking: 'none', forcedToolChoice: true, speed: 150,
  },
  'claude-haiku-4-5': {
    label: 'Claude Haiku 4.5（旧世代）', context: 200_000, maxOut: 64_000, input: 1, output: 5, cacheRead: 0.1,
    minCache: 4096, gen: 4.5, prefill: true, thinking: ['enabled', 'disabled'], defaultThinking: 'none', forcedToolChoice: true, speed: 120,
  },
};

const BLOCK_TYPES_USER = ['text', 'image', 'document', 'tool_result'];
const BLOCK_TYPES_ASSISTANT = ['text', 'tool_use', 'thinking', 'redacted_thinking', 'server_tool_use'];

// ---------- 小さな道具 ----------
const rand = (n = 20) => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
};
export const newId = (prefix) => `${prefix}_01${rand(22)}`;

// トークン数の推定（実際のトークナイザーではない。ASCII は約4文字で1、日本語は約1文字で1）
export function estTokens(value) {
  if (value == null) return 0;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  let ascii = 0;
  let other = 0;
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4 + other * 0.9);
}

function contentToBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

export function textOf(content) {
  return contentToBlocks(content).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function blockTokens(b) {
  if (b.type === 'image') return imageTokens(b).tokens;
  if (b.type === 'text') return estTokens(b.text);
  if (b.type === 'tool_result') return estTokens(b.content) + 8;
  return estTokens(b);
}

// PNG のヘッダーから画像サイズを読む（JPEG などは推定しない）
export function imageInfo(block) {
  const src = block.source || {};
  if (src.type !== 'base64' || typeof src.data !== 'string') return null;
  try {
    const bin = atob(src.data.slice(0, 64));
    const bytes = [...bin].map((c) => c.charCodeAt(0));
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    const actual = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isGif ? 'image/gif' : null;
    let width = null;
    let height = null;
    if (isPng && bytes.length >= 24) {
      width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    }
    return { actual, width, height };
  } catch {
    return { actual: null, width: null, height: null, invalid: true };
  }
}

function imageTokens(block) {
  const info = imageInfo(block);
  if (info && info.width && info.height) {
    return { tokens: Math.ceil(info.width / 28) * Math.ceil(info.height / 28), ...info };
  }
  return { tokens: 1000, ...(info || {}) };
}

// ---------- エラー ----------
const STATUS_TYPES = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
  500: 'api_error',
  529: 'overloaded_error',
};

class ApiError extends Error {
  constructor(status, message, explain, extraHeaders = {}) {
    super(message);
    this.status = status;
    this.explain = explain;
    this.extraHeaders = extraHeaders;
  }
}
const bad = (message, explain) => new ApiError(400, message, explain);

function errorResponse(e, requestId) {
  return {
    status: e.status,
    headers: { 'content-type': 'application/json', 'request-id': requestId, ...e.extraHeaders },
    body: { type: 'error', error: { type: STATUS_TYPES[e.status] || 'api_error', message: e.message }, request_id: requestId },
    notes: [{ kind: 'ng', text: e.explain }],
  };
}

// ---------- ヘッダーの検証 ----------
export function parseHeaders(text) {
  const headers = {};
  const errors = [];
  String(text).split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const m = t.match(/^([A-Za-z0-9-]+)\s*:\s*(.*)$/);
    if (!m) errors.push(`${i + 1}行目「${t}」は「名前: 値」の形になっていません`);
    else headers[m[1].toLowerCase()] = m[2].trim();
  });
  return { headers, errors };
}

function checkHeaders(h) {
  if (!h['x-api-key'] && !h.authorization) {
    throw new ApiError(401, 'x-api-key header is required',
      'API キー（x-api-key ヘッダー）がありません。どのアカウントからの呼び出しかを確認できないので 401 になります。');
  }
  const key = h['x-api-key'] || '';
  if (key && !key.startsWith('sk-ant-')) {
    throw new ApiError(401, 'invalid x-api-key',
      'API キーの形式が正しくありません（疑似環境では sk-ant- で始まる値を有効とみなします）。キーの誤りは再試行しても直りません。');
  }
  if (!h['anthropic-version']) {
    throw bad('anthropic-version: header is required',
      'anthropic-version ヘッダーは必須です。API の挙動のバージョンを固定するためのもので、例えば 2026-10-21 を指定します。');
  }
  if (!VERSIONS.includes(h['anthropic-version'])) {
    throw bad(`anthropic-version: invalid version "${h['anthropic-version']}"`,
      `有効なバージョンは ${VERSIONS.join('、')} です。`);
  }
  if (h['content-type'] && !h['content-type'].includes('application/json')) {
    throw bad('content-type must be application/json', 'ボディは JSON なので、content-type は application/json にします。');
  }
}

// ---------- Messages のボディの検証 ----------
function checkTools(body, model) {
  const names = new Set();
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) throw bad('tools: Input should be a valid list', 'tools は配列で指定します。');
    body.tools.forEach((t, i) => {
      if (t.type && t.type.startsWith('web_search')) { names.add(t.name || 'web_search'); return; }
      if (!t.name || !/^[a-zA-Z0-9_-]{1,128}$/.test(t.name)) {
        throw bad(`tools.${i}.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'`,
          'ツール名は英数字・アンダースコア・ハイフンの 1〜128 文字です（日本語や空白は使えません）。');
      }
      if (!t.input_schema || t.input_schema.type !== 'object') {
        throw bad(`tools.${i}.input_schema: Field required (type must be "object")`,
          'ツールには input_schema（type: "object" の JSON Schema）が必要です。Claude はこれを見て入力を組み立てます。');
      }
      names.add(t.name);
    });
  }
  const tc = body.tool_choice;
  if (tc !== undefined) {
    if (!tc || !['auto', 'any', 'tool', 'none'].includes(tc.type)) {
      throw bad('tool_choice.type: Input should be "auto", "any", "tool" or "none"', 'tool_choice の type は auto／any／tool／none のどれかです。');
    }
    if ((tc.type === 'any' || tc.type === 'tool') && !model.forcedToolChoice) {
      throw bad(`tool_choice: type "${tc.type}" is not supported for this model.`,
        'このモデル（Opus 5.5／Sonnet 5.5 など）は、ツールの強制（any／tool）に対応していません。auto か none を使い、説明文やプロンプトで使い方を伝えます。');
    }
    if (tc.type === 'tool' && !names.has(tc.name)) {
      throw bad(`tool_choice.name: tool "${tc.name}" not found in tools`, 'tool_choice で指定した名前のツールが tools にありません。');
    }
    if (tc.type !== 'none' && !names.size) {
      throw bad('tool_choice may only be specified while providing tools', 'tools を指定していないのに tool_choice を指定しています。');
    }
  }
  return names;
}

function checkThinking(body, model, modelId) {
  const th = body.thinking;
  if (th === undefined) return model.defaultThinking;
  const type = th && th.type;
  if (!['enabled', 'adaptive', 'disabled', 'between_tools'].includes(type)) {
    throw bad('thinking.type: Input should be "enabled", "adaptive", "disabled" or "between_tools"', 'thinking.type の値が正しくありません。');
  }
  if (!model.thinking.includes(type)) {
    if (type === 'enabled' && model.gen >= 4.7) {
      throw bad('"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.',
        'Claude 4.7 以降のモデルでは budget_tokens による思考の予算指定（enabled）は使えません。adaptive にして、量は output_config.effort で調整します。');
    }
    if (type === 'adaptive' && model.gen <= 4.5) {
      throw bad('"thinking.type.adaptive" is not supported for this model.', 'Claude 4.5 以前のモデルは adaptive thinking に対応していません。enabled と budget_tokens を使います。');
    }
    throw bad(`"thinking.type.${type}" is not supported for ${modelId}.`, `${model.label} では thinking.type「${type}」は使えません（使える値：${model.thinking.join('、')}）。`);
  }
  if (type === 'enabled') {
    const b = th.budget_tokens;
    if (!Number.isInteger(b) || b < 1024) throw bad('thinking.budget_tokens: Input should be greater than or equal to 1024', 'budget_tokens は 1024 以上の整数です。');
    if (b >= body.max_tokens) {
      throw bad('max_tokens must be greater than thinking.budget_tokens',
        '思考のトークンは max_tokens の内側で使われるので、budget_tokens は max_tokens より小さくする必要があります。');
    }
  }
  return type;
}

function checkMessages(body, toolNames, model, version) {
  const msgs = body.messages;
  if (!Array.isArray(msgs)) throw bad('messages: Input should be a valid list', 'messages は配列で指定します。');
  if (!msgs.length) throw bad('messages: at least one message is required', 'messages には少なくとも1件のメッセージが必要です。');

  msgs.forEach((m, i) => {
    if (!m || typeof m !== 'object') throw bad(`messages.${i}: Input should be an object`, 'メッセージは {"role": ..., "content": ...} の形です。');
    if (m.role === 'system') {
      throw bad(`messages.${i}.role: Input should be "user" or "assistant"`,
        'system は messages の中ではなく、トップレベルの system パラメータで指定します。');
    }
    if (!['user', 'assistant'].includes(m.role)) {
      throw bad(`messages.${i}.role: Input should be "user" or "assistant"`, 'role は user か assistant です。');
    }
    if (m.content === undefined) throw bad(`messages.${i}.content: Field required`, 'メッセージには content が必要です。');
    if (typeof m.content === 'string') {
      if (!m.content.length) throw bad(`messages.${i}.content: String should have at least 1 character`, '空の文字列は送れません。');
      return;
    }
    if (!Array.isArray(m.content)) throw bad(`messages.${i}.content: Input should be a valid string or list`, 'content は文字列か、ブロックの配列です。');
    const allowed = m.role === 'user' ? BLOCK_TYPES_USER : BLOCK_TYPES_ASSISTANT;
    m.content.forEach((b, j) => {
      const where = `messages.${i}.content.${j}`;
      if (!b || !allowed.includes(b.type)) {
        throw bad(`${where}.type: "${b && b.type}" is not allowed in a ${m.role} message`,
          `${m.role} のメッセージに入れられるブロックは ${allowed.join('／')} です。${b && b.type === 'tool_result' ? 'tool_result は user のメッセージに入れます。' : ''}${b && b.type === 'tool_use' ? 'tool_use は assistant（Claude）の出力です。' : ''}`);
      }
      if (b.type === 'text' && (typeof b.text !== 'string' || !b.text.length)) {
        throw bad(`${where}.text: String should have at least 1 character`, 'text ブロックの text は1文字以上です。');
      }
      if (b.type === 'text' && version === '2026-10-21' && m.role === 'user' && Array.isArray(b.citations) && b.citations.length) {
        throw bad(`${where}.citations: not allowed in user messages`, 'API バージョン 2026-10-21 では、user メッセージの text に citations を付けられません。');
      }
      if (b.type === 'image') checkImage(b, where);
      if (b.type === 'tool_use') {
        if (!b.id || !/^[a-zA-Z0-9_-]+$/.test(b.id)) throw bad(`${where}.id: invalid tool_use id`, 'tool_use の id はレスポンスで受け取ったものをそのまま使います。');
        if (!toolNames.has(b.name)) {
          throw bad(`${where}: tool "${b.name}" is not defined in tools`,
            '履歴に tool_use があるときは、そのツールの定義も毎回 tools に含めます（API はステートレスなので、前回の定義を覚えていません）。');
        }
      }
      if (b.type === 'thinking' && (typeof b.signature !== 'string' || !b.signature)) {
        throw bad(`${where}.signature: Field required`, 'thinking ブロックは、受け取った signature も含めて変更せずに送り返します。');
      }
      if (b.type === 'thinking' && b.signature && !b.signature.startsWith('sim_sig_')) {
        throw bad(`${where}: Invalid signature in thinking block`, 'thinking ブロックの内容や署名が変更されています。受け取ったまま送り返す必要があります。');
      }
    });
  });

  // tool_use と tool_result の対応
  msgs.forEach((m, i) => {
    const blocks = contentToBlocks(m.content);
    const uses = blocks.filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (m.role === 'assistant' && uses.length) {
      const next = msgs[i + 1];
      const nextBlocks = next ? contentToBlocks(next.content) : [];
      const results = nextBlocks.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
      const missing = uses.filter((id) => !results.includes(id));
      if (!next || next.role !== 'user' || missing.length) {
        throw bad(`messages.${i + 1}: \`tool_use\` ids were found without \`tool_result\` blocks immediately after: ${(missing.length ? missing : uses).join(', ')}. Each \`tool_use\` block must have a corresponding \`tool_result\` block in the next message.`,
          'assistant の tool_use の直後の user メッセージに、すべての tool_use に対応する tool_result（tool_use_id が一致するもの）が必要です。並列に複数呼ばれたら、結果も全部まとめて1つの user メッセージに入れます。');
      }
      const firstNonResult = nextBlocks.findIndex((b) => b.type !== 'tool_result');
      const lastResult = nextBlocks.map((b) => b.type).lastIndexOf('tool_result');
      if (firstNonResult !== -1 && firstNonResult < lastResult) {
        throw bad(`messages.${i + 1}.content: tool_result blocks must come first in the content array, before any other content`,
          'tool_result は user の content 配列の先頭に置きます。テキストを添えたい場合は、すべての tool_result の後ろに置きます。');
      }
    }
    if (m.role === 'user') {
      const results = blocks.filter((b) => b.type === 'tool_result');
      if (results.length) {
        const prev = msgs[i - 1];
        const prevUses = prev && prev.role === 'assistant' ? contentToBlocks(prev.content).filter((b) => b.type === 'tool_use').map((b) => b.id) : [];
        const orphan = results.find((r) => !prevUses.includes(r.tool_use_id));
        if (orphan) {
          throw bad(`messages.${i}.content: unexpected \`tool_use_id\` found in \`tool_result\` blocks: ${orphan.tool_use_id}. Each \`tool_result\` block must have a corresponding \`tool_use\` block in the previous message.`,
            'tool_result は、直前の assistant メッセージにある tool_use への返事です。tool_use_id が一致しているか、assistant の tool_use を履歴に入れ忘れていないかを確認します。');
        }
      }
    }
  });

  const last = msgs[msgs.length - 1];
  if (last.role === 'assistant' && !model.prefill) {
    throw bad('This model does not support assistant message prefill. The conversation must end with a user message.',
      'Claude 4.6 以降のモデルでは、最後を assistant にして続きを書かせる「プリフィル」は使えません。出力の形を決めたいときは構造化出力（output_config.format）を使います。');
  }
}

function checkImage(b, where) {
  const src = b.source || {};
  if (!['base64', 'url', 'file'].includes(src.type)) throw bad(`${where}.source.type: Input should be "base64", "url" or "file"`, '画像の source.type は base64／url／file のどれかです。');
  if (src.type === 'base64') {
    const okTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!okTypes.includes(src.media_type)) {
      throw bad(`${where}.source.media_type: Input should be ${okTypes.map((t) => `'${t}'`).join(', ')}`, `対応している画像形式は JPEG・PNG・GIF・WebP です。`);
    }
    const info = imageInfo(b);
    if (!info || info.invalid) throw bad(`${where}.source.data: invalid base64 data`, 'base64 のデータが正しくありません。');
    if (info.actual && info.actual !== src.media_type) {
      throw bad(`${where}: Image does not match the provided media type ${src.media_type}`,
        `画像の中身は ${info.actual} ですが、media_type に ${src.media_type} と書かれています。中身と一致させます。`);
    }
  }
}

function checkOutputConfig(body, model) {
  const oc = body.output_config;
  if (oc === undefined) return;
  if (oc.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(oc.effort)) {
    throw bad('output_config.effort: Input should be "low", "medium", "high", "xhigh" or "max"', 'effort は low／medium／high／xhigh／max のどれかです。');
  }
  if (oc.format !== undefined) {
    if (!oc.format || oc.format.type !== 'json_schema' || typeof oc.format.schema !== 'object') {
      throw bad('output_config.format: expected {"type": "json_schema", "schema": {...}}', '構造化出力は {"type": "json_schema", "schema": {...}} の形で指定します。');
    }
    checkSchema(oc.format.schema, 'output_config.format.schema');
    if (model.gen < 4.5) throw bad('output_config.format is not supported for this model', 'このモデルは構造化出力に対応していません。');
  }
}

function checkSchema(s, path) {
  if (!s || typeof s !== 'object') return;
  if (s.oneOf || s.not) throw bad(`${path}: "oneOf" and "not" are not supported`, '構造化出力のスキーマでは oneOf や not は使えません。');
  const limits = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength'].filter((k) => s[k] !== undefined);
  if (limits.length) {
    throw bad(`${path}: "${limits[0]}" is not supported in structured outputs`, '構造化出力のスキーマでは、数値の範囲や文字数の制約（minimum、maxLength など）は使えません。値の候補を絞りたいときは enum を使い、範囲の確認はアプリ側で行います。');
  }
  if (s.type === 'object') {
    if (s.additionalProperties !== false) {
      throw bad(`${path}.additionalProperties: must be false`, '構造化出力では、object の additionalProperties を false にする必要があります（決めた項目以外を出さないため）。');
    }
    Object.entries(s.properties || {}).forEach(([k, v]) => checkSchema(v, `${path}.properties.${k}`));
  }
  if (s.type === 'array' && s.items) checkSchema(s.items, `${path}.items`);
}

export function validateMessagesBody(body, version) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Request body must be a JSON object', 'ボディは JSON のオブジェクト（{ ... }）です。');
  if (body.model === undefined) throw bad('model: Field required', 'model は必須です。どのモデルで処理するかを指定します。');
  const model = MODELS[body.model];
  if (!model) {
    throw new ApiError(404, `model: ${body.model}`,
      `モデル「${body.model}」は存在しません（疑似環境で使えるのは ${Object.keys(MODELS).join('、')}）。名前の誤りは再試行しても直りません。`);
  }
  if (body.max_tokens === undefined) throw bad('max_tokens: Field required', 'max_tokens は必須です。出力をどこまで許すか（上限）を毎回指定します。');
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) {
    throw bad('max_tokens: Input should be greater than or equal to 1', 'max_tokens は 1 以上の整数にします（本物の API では 0 でキャッシュの作成だけを行う使い方もありますが、疑似環境では扱いません）。');
  }
  if (body.max_tokens > model.maxOut) {
    throw bad(`max_tokens: ${body.max_tokens} > ${model.maxOut}, which is the maximum allowed number of output tokens for ${body.model}`,
      `${model.label} の最大出力は ${model.maxOut.toLocaleString()} トークンです。`);
  }
  if (body.messages === undefined) throw bad('messages: Field required', 'messages は必須です。会話の内容（履歴を含む）を入れます。');
  if (body.prompt !== undefined) throw bad('prompt: Extra inputs are not permitted', 'prompt は古い Text Completions API の項目です。Messages API では messages を使います。');
  for (const p of ['temperature', 'top_p', 'top_k']) {
    if (body[p] !== undefined && version === '2026-10-21') {
      throw bad(`${p}: this parameter has been removed in API version 2026-10-21`,
        `API バージョン 2026-10-21 では ${p} は廃止され、どのモデルでも 400 になります。出力のばらつきの調整ではなく、プロンプトや effort、構造化出力で制御します。`);
    }
  }
  if (body.temperature !== undefined && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 1)) {
    throw bad('temperature: Input should be between 0 and 1', 'temperature は 0〜1 の数値です（古い API バージョンの場合）。');
  }
  if (body.system !== undefined && typeof body.system !== 'string' && !Array.isArray(body.system)) {
    throw bad('system: Input should be a valid string or list', 'system は文字列か、text ブロックの配列です。');
  }
  if (body.stop_sequences !== undefined && (!Array.isArray(body.stop_sequences) || body.stop_sequences.some((s) => typeof s !== 'string' || !s))) {
    throw bad('stop_sequences: Input should be a list of non-empty strings', 'stop_sequences は空でない文字列の配列です。');
  }
  const toolNames = checkTools(body, model);
  const thinking = checkThinking(body, model, body.model);
  checkOutputConfig(body, model);
  checkMessages(body, toolNames, model, version);
  if (body.output_config && body.output_config.format && body.tool_choice && body.tool_choice.type !== 'none' && body.tools) {
    // 両方を使うこと自体は可能。疑似環境では構造化出力を優先して最終回答を作る。
  }
  return { model, thinking };
}

// ---------- 入力トークンとキャッシュ ----------
function systemBlocks(system) {
  if (system === undefined) return [];
  return typeof system === 'string' ? [{ type: 'text', text: system }] : system;
}

// キャッシュの対象になる「部品」を tools → system → messages の順に並べる
function flattenPrompt(body) {
  const parts = [];
  (body.tools || []).forEach((t) => parts.push({ tokens: estTokens(t) + 10, key: JSON.stringify(t), cc: t.cache_control }));
  systemBlocks(body.system).forEach((b) => parts.push({ tokens: estTokens(b.text), key: `sys:${b.text}`, cc: b.cache_control }));
  (body.messages || []).forEach((m) => {
    contentToBlocks(m.content).forEach((b) => parts.push({ tokens: blockTokens(b) + 2, key: `${m.role}:${JSON.stringify({ ...b, cache_control: undefined })}`, cc: b.cache_control }));
    parts.push({ tokens: 4, key: `turn:${m.role}` });
  });
  return parts;
}

// 疑似のキャッシュ。プレフィックスの文字列をキーに、作成時刻と TTL を持つ。
export function createCacheStore() {
  return { entries: new Map(), clock: 0 };
}

function applyCache(body, model, store) {
  const parts = flattenPrompt(body);
  const total = parts.reduce((a, p) => a + p.tokens, 0) + 3;
  const result = { total, input: total, write: 0, read: 0, write1h: 0, notes: [] };
  let breakpoints = parts.map((p, i) => (p.cc ? i : -1)).filter((i) => i >= 0);
  const auto = body.cache_control && body.cache_control.type === 'ephemeral';
  if (auto) {
    // 自動キャッシュ：最後のキャッシュできるブロックに区切りを置く
    const lastIdx = parts.map((p) => !p.key.startsWith('turn:')).lastIndexOf(true);
    if (lastIdx >= 0) breakpoints.push(lastIdx);
  }
  if (!breakpoints.length || !store) return result;
  if (breakpoints.length > 4) throw bad('A maximum of 4 blocks with cache_control may be provided. Found more.', 'cache_control の区切りは最大4つです（自動キャッシュも1つ分を使います）。');
  breakpoints = [...new Set(breakpoints)].sort((a, b) => a - b);

  // 最も長く一致したキャッシュを探す
  let readUpTo = -1;
  let readTokens = 0;
  for (const bp of breakpoints) {
    const key = parts.slice(0, bp + 1).map((p) => p.key).join('|') + `@${body.model}`;
    const e = store.entries.get(key);
    if (e && store.clock - e.at < e.ttl) {
      readUpTo = bp;
      readTokens = parts.slice(0, bp + 1).reduce((a, p) => a + p.tokens, 0);
      e.at = store.clock; // 読むと有効期限が延びる
    }
  }
  // 最後の区切りまでを書き込む（読めた分を除く）
  const lastBp = breakpoints[breakpoints.length - 1];
  const prefixTokens = parts.slice(0, lastBp + 1).reduce((a, p) => a + p.tokens, 0);
  if (prefixTokens < model.minCache) {
    result.notes.push({ kind: 'warn', text: `キャッシュの区切りまでが約 ${prefixTokens} トークンで、このモデルの最小（${model.minCache} トークン）に足りません。エラーにはならず、キャッシュされないだけです（cache の usage は両方 0）。` });
    return result;
  }
  const ttlName = (parts[lastBp].cc && parts[lastBp].cc.ttl) || (auto && body.cache_control.ttl) || '5m';
  const ttl = ttlName === '1h' ? 60 : 5;
  breakpoints.forEach((bp) => {
    const key = parts.slice(0, bp + 1).map((p) => p.key).join('|') + `@${body.model}`;
    const tok = parts.slice(0, bp + 1).reduce((a, p) => a + p.tokens, 0);
    if (tok >= model.minCache && !(store.entries.get(key) && store.clock - store.entries.get(key).at < store.entries.get(key).ttl)) {
      store.entries.set(key, { at: store.clock, ttl });
    }
  });
  result.read = readTokens;
  const writeTokens = Math.max(0, prefixTokens - readTokens);
  if (ttl === 60) result.write1h = writeTokens;
  result.write = writeTokens;
  result.input = total - readTokens - writeTokens;
  if (readTokens) result.notes.push({ kind: 'ok', text: `先頭から約 ${readTokens.toLocaleString()} トークンがキャッシュに一致しました（cache_read_input_tokens）。この部分は安い単価で処理され、最初のトークンまでの時間も短くなります。` });
  if (writeTokens) result.notes.push({ kind: 'info', text: `約 ${writeTokens.toLocaleString()} トークンをキャッシュに書き込みました（cache_creation_input_tokens、有効期限 ${ttlName === '1h' ? '1時間' : '5分'}）。書き込みは通常の入力より少し高い単価です。同じ先頭部分で再度送ると読み込みになります。` });
  if (!readTokens && writeTokens && store.entries.size > 1) result.notes.push({ kind: 'warn', text: '以前のキャッシュと先頭部分が一致しませんでした。先頭に毎回変わる内容（時刻や利用者名など）があると、後ろが同じでも一致しません。' });
  return result;
}

// ---------- レスポンスの生成 ----------
const KEYWORDS = {
  weather: ['天気', '気温', 'weather', '雨', '晴'],
  stock: ['株価', 'stock', '株'],
  order: ['注文', 'order'],
  inventory: ['在庫', 'inventory', 'stock_level'],
  search: ['検索', '調べ', 'search'],
};
const CITIES = ['東京', '大阪', '名古屋', '札幌', '福岡', '那覇', '京都', '横浜', '仙台', '広島'];

function pickTool(body, userText) {
  const tools = (body.tools || []).filter((t) => !t.type || !t.type.startsWith('web_search'));
  const tc = body.tool_choice || { type: 'auto' };
  if (!tools.length || tc.type === 'none') return null;
  if (tc.type === 'tool') return tools.find((t) => t.name === tc.name);
  const hit = tools.find((t) => {
    const hay = `${t.name} ${t.description || ''}`.toLowerCase();
    return Object.values(KEYWORDS).some((words) => words.some((w) => hay.includes(w.toLowerCase())) && words.some((w) => userText.toLowerCase().includes(w.toLowerCase())))
      || userText.includes(t.name);
  });
  if (hit) return hit;
  return tc.type === 'any' ? tools[0] : null;
}

function buildToolInput(tool, userText) {
  const props = (tool.input_schema && tool.input_schema.properties) || {};
  const input = {};
  Object.entries(props).forEach(([k, p]) => {
    const required = (tool.input_schema.required || []).includes(k);
    if (p.enum) { input[k] = p.enum.find((v) => userText.includes(String(v))) ?? p.enum[0]; return; }
    if (p.type === 'number' || p.type === 'integer') {
      const n = userText.match(/\d+(\.\d+)?/);
      if (n || required) input[k] = n ? Number(n[0]) : 1;
      return;
    }
    if (p.type === 'boolean') { if (required) input[k] = true; return; }
    if (/city|location|place|都市|場所/i.test(`${k} ${p.description || ''}`)) {
      input[k] = CITIES.find((c) => userText.includes(c)) || (required ? '東京' : undefined);
    } else if (/id|number|code|番号/i.test(`${k} ${p.description || ''}`)) {
      const id = userText.match(/[A-Za-z0-9-]*\d[A-Za-z0-9-]*/);
      input[k] = id ? id[0] : (required ? 'UNKNOWN' : undefined);
    } else if (required) {
      input[k] = userText.replace(/[？?。]/g, '').slice(0, 40);
    }
    if (input[k] === undefined) delete input[k];
  });
  return input;
}

function sampleFromSchema(schema, userText, hints = {}) {
  if (!schema) return null;
  if (schema.enum) {
    const h = hints.enum && hints.enum(schema.enum, userText);
    return h ?? schema.enum.find((v) => userText.includes(String(v))) ?? schema.enum[0];
  }
  switch (schema.type) {
    case 'object': {
      const o = {};
      Object.entries(schema.properties || {}).forEach(([k, v]) => {
        o[k] = hints[k] !== undefined ? hints[k] : sampleFromSchema(v, userText, hints);
      });
      return o;
    }
    case 'array': return [sampleFromSchema(schema.items, userText, hints)];
    case 'integer': return schema.minimum ?? 1;
    case 'number': return schema.minimum ?? 0.5;
    case 'boolean': return true;
    default: return schema.description ? `（${schema.description}）` : '（疑似の値）';
  }
}

function genericReply(userText) {
  const q = userText.length > 60 ? `${userText.slice(0, 60)}…` : userText;
  return `（疑似応答）「${q}」を受け取りました。これは本物の Claude ではなく、学習用の疑似環境が用意した定型の返答です。リクエストとレスポンスの形や、stop_reason・usage の変化に注目してください。`;
}

// シナリオの respond(ctx) が返したものを使い、なければ汎用の規則で応答を作る
function decide(body, scenario) {
  const msgs = body.messages;
  const last = msgs[msgs.length - 1];
  const lastBlocks = contentToBlocks(last.content);
  const toolResults = lastBlocks.filter((b) => b.type === 'tool_result');
  const userText = textOf(last.content);
  const systemText = systemBlocks(body.system).map((b) => b.text).join('\n');
  const historyText = msgs.slice(0, -1).map((m) => textOf(m.content)).join('\n');
  const ctx = { body, msgs, last, userText, systemText, historyText, toolResults, images: lastBlocks.filter((b) => b.type === 'image') };

  const custom = scenario && scenario.respond ? scenario.respond(ctx) : null;
  if (custom) return custom;

  if (body.output_config && body.output_config.format) {
    return { json: sampleFromSchema(body.output_config.format.schema, userText) };
  }
  if (toolResults.length) {
    const r = toolResults.map((t) => (typeof t.content === 'string' ? t.content : textOf(t.content))).join(' / ');
    const err = toolResults.some((t) => t.is_error);
    return { text: err ? `（疑似応答）ツールの実行に失敗したようです（${r}）。時間をおいて再度お試しいただくか、別の方法で確認します。` : `（疑似応答）ツールの結果「${r}」をもとにお答えします。` };
  }
  if (last.role === 'assistant') {
    return { text: '（疑似応答：プリフィルの続き）…という形で、assistant の最後の文の続きから書き始めます。', prefill: true };
  }
  const tool = pickTool(body, userText);
  if (tool) return { tool: { name: tool.name, input: buildToolInput(tool, userText) }, text: null };
  if (ctx.images.length) {
    const info = imageTokens(ctx.images[0]);
    return { text: `（疑似応答）画像${info.width ? `（${info.width}×${info.height} px、約 ${info.tokens} トークン）` : ''}を受け取りました。疑似環境では画像の中身は読めませんが、本物の Claude はこの画像を見て質問に答えます。` };
  }
  return { text: genericReply(userText || '（テキストなし）') };
}

function thinkingFor(body, model, thinkingType, plan) {
  if (plan.thinking === false) return null;
  const effort = (body.output_config && body.output_config.effort) || (model.label.includes('Opus') ? 'medium' : 'high');
  const want = thinkingType === 'enabled' || (thinkingType === 'adaptive' && (plan.complex || effort === 'high' || effort === 'xhigh' || effort === 'max'));
  if (!want && !plan.thinking) return null;
  const base = plan.thinking || '質問の条件を整理する。必要な情報がそろっているか確認し、答えの方針を決める。';
  if (thinkingType === 'enabled') return `${base} 予算（budget_tokens）の範囲で検討を終える。`;
  const sentences = base.split('。').filter(Boolean).map((s) => `${s}。`);
  const keep = { low: 1, medium: 3 }[effort] ?? sentences.length;
  const extra = { high: ' 別の解釈がないか検討し、根拠を確かめる。', xhigh: ' 別の解釈を比べ、反例がないかも確かめる。', max: ' 考えられる解釈をすべて比べ、反例と境界条件まで確かめる。' };
  return sentences.slice(0, keep).join('') + (extra[effort] || '');
}

function truncateToTokens(text, limit) {
  let out = '';
  for (const ch of text) {
    if (estTokens(out + ch) > limit) break;
    out += ch;
  }
  return out;
}

export function priceFor(model, inputTotal) {
  if (model.tier && inputTotal > model.tier.above) return { input: model.tier.input, output: model.tier.output };
  return { input: model.input, output: model.output };
}

function costOf(model, usage, batch = false) {
  const totalIn = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  const p = priceFor(model, totalIn);
  const w1h = (usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens) || 0;
  const w5m = usage.cache_creation_input_tokens - w1h;
  const usd = (usage.input_tokens * p.input
    + w5m * p.input * 1.25
    + w1h * p.input * 2
    + usage.cache_read_input_tokens * p.input * model.cacheRead
    + usage.output_tokens * p.output) / 1_000_000;
  const noCache = ((totalIn) * p.input + usage.output_tokens * p.output) / 1_000_000;
  return { usd: batch ? usd / 2 : usd, noCache: batch ? noCache / 2 : noCache, price: p };
}

export function runMessages(body, { version, scenario, cacheStore }) {
  const { model, thinking: thinkingType } = validateMessagesBody(body, version);
  const notes = [];
  const cache = applyCache(body, model, cacheStore);
  notes.push(...cache.notes);
  if (cache.total > model.context) {
    throw bad(`prompt is too long: ${cache.total} tokens > ${model.context} maximum`, `入力が ${model.label} のコンテキストウィンドウ（${model.context.toLocaleString()} トークン）を超えています。`);
  }

  const plan = decide(body, scenario);
  const content = [];
  let stopReason = 'end_turn';
  let stopSequence = null;

  const thoughts = thinkingFor(body, model, thinkingType, plan);
  if (thoughts) content.push({ type: 'thinking', thinking: thoughts, signature: `sim_sig_${rand(32)}` });

  let text = plan.text;
  if (plan.json !== undefined) text = JSON.stringify(plan.json);
  if (plan.preface) content.push({ type: 'text', text: plan.preface });

  // stop_sequences と max_tokens の処理
  const budget = body.max_tokens - (thoughts ? estTokens(thoughts) : 0);
  if (text != null) {
    if (body.stop_sequences) {
      let cut = -1;
      for (const s of body.stop_sequences) {
        const at = text.indexOf(s);
        if (at >= 0 && (cut === -1 || at < cut)) { cut = at; stopSequence = s; }
      }
      if (cut >= 0) { text = text.slice(0, cut); stopReason = 'stop_sequence'; } else stopSequence = null;
    }
    if (estTokens(text) > budget) {
      text = truncateToTokens(text, Math.max(0, budget));
      stopReason = 'max_tokens';
      stopSequence = null;
    }
    if (text.length) content.push({ type: 'text', text });
  }
  if (plan.tool && stopReason === 'end_turn') {
    const toolInputTokens = estTokens(plan.tool.input) + 20;
    if (toolInputTokens > budget) {
      stopReason = 'max_tokens';
    } else {
      content.push({ type: 'tool_use', id: newId('toolu'), name: plan.tool.name, input: plan.tool.input });
      stopReason = 'tool_use';
    }
  }
  if (plan.stopReason) stopReason = plan.stopReason;

  const outTokens = content.reduce((a, b) => a + (b.type === 'thinking' ? estTokens(b.thinking) : b.type === 'text' ? estTokens(b.text) : estTokens(b.input) + 20), 0) + 2;
  const usage = {
    input_tokens: cache.input,
    cache_creation_input_tokens: cache.write,
    cache_read_input_tokens: cache.read,
    cache_creation: { ephemeral_5m_input_tokens: cache.write - cache.write1h, ephemeral_1h_input_tokens: cache.write1h },
    output_tokens: Math.min(outTokens, body.max_tokens),
    service_tier: 'standard',
  };
  if (thoughts) usage.output_tokens_details = { thinking_tokens: estTokens(thoughts) };

  const message = {
    id: newId('msg'),
    type: 'message',
    role: 'assistant',
    model: body.model,
    content,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    stop_details: null,
    usage,
  };

  // 解説
  const explain = {
    end_turn: 'stop_reason は end_turn：Claude が自然に書き終えました。そのまま使えます。',
    max_tokens: 'stop_reason は max_tokens：出力が上限に達し、途中で切れています。max_tokens を増やすか、短く出すよう指示します。',
    stop_sequence: `stop_reason は stop_sequence：指定した文字列「${stopSequence}」が出たところで止まりました（その文字列自体は出力に含まれません）。`,
    tool_use: 'stop_reason は tool_use：Claude がツールを呼んでほしいと要求しています。アプリがツールを実行し、tool_result を返して再度呼び出します。',
  };
  if (explain[stopReason]) notes.unshift({ kind: stopReason === 'max_tokens' ? 'warn' : 'ok', text: explain[stopReason] });
  if (thoughts) notes.push({ kind: 'info', text: `thinking ブロックが先頭に入っています（思考トークン 約 ${estTokens(thoughts)}。出力として課金され、max_tokens に含まれます）。ツールのループでは、このブロックを変えずに送り返します。` });
  if (plan.note) notes.push(plan.note);

  return { message, notes, usage, cost: costOf(model, usage), model };
}

// ---------- ストリーミング（SSE）への変換 ----------
function chunks(str, size) {
  const arr = [];
  const chars = [...str];
  for (let i = 0; i < chars.length; i += size) arr.push(chars.slice(i, i + size).join(''));
  return arr;
}

export function toSSE(message) {
  const ev = [];
  const push = (event, data) => ev.push({ event, data });
  push('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: message.usage.input_tokens, cache_creation_input_tokens: message.usage.cache_creation_input_tokens, cache_read_input_tokens: message.usage.cache_read_input_tokens, output_tokens: 1 } } });
  message.content.forEach((b, index) => {
    if (b.type === 'text') {
      push('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      if (index === 0) push('ping', { type: 'ping' });
      chunks(b.text, 6).forEach((t) => push('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } }));
    } else if (b.type === 'thinking') {
      push('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      chunks(b.thinking, 10).forEach((t) => push('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: t } }));
      push('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature } });
    } else if (b.type === 'tool_use') {
      push('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      const json = JSON.stringify(b.input);
      push('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: '' } });
      chunks(json, 8).forEach((t) => push('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: t } }));
    }
    push('content_block_stop', { type: 'content_block_stop', index });
  });
  push('message_delta', { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: message.stop_sequence }, usage: { output_tokens: message.usage.output_tokens } });
  push('message_stop', { type: 'message_stop' });
  return ev;
}

// ---------- Message Batches ----------
export function createBatchStore() {
  return { batches: new Map() };
}

function batchView(b) {
  const ended = b.ticks >= 2;
  const counts = { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 };
  b.items.forEach((it) => {
    if (b.canceled && !ended) counts.canceled += 1;
    else if (!ended) counts.processing += 1;
    else counts[it.result.type] += 1;
  });
  return {
    id: b.id,
    type: 'message_batch',
    processing_status: b.canceled ? (ended ? 'ended' : 'canceling') : ended ? 'ended' : 'in_progress',
    request_counts: counts,
    ended_at: ended ? new Date(b.created + 30 * 60_000).toISOString() : null,
    created_at: new Date(b.created).toISOString(),
    expires_at: new Date(b.created + 24 * 3600_000).toISOString(),
    cancel_initiated_at: b.canceled ? new Date(b.created + 60_000).toISOString() : null,
    results_url: ended ? `https://api.anthropic.com/v1/messages/batches/${b.id}/results` : null,
  };
}

export function runBatchCreate(body, { version, scenario, batchStore }) {
  if (!body || !Array.isArray(body.requests) || !body.requests.length) {
    throw bad('requests: Field required (non-empty list)', 'Batches のボディは {"requests": [{"custom_id": ..., "params": {...}}, ...]} の形です。');
  }
  if (body.requests.length > 100_000) throw bad('requests: too many requests (max 100,000)', '1つのバッチは最大 100,000 件です。');
  const ids = new Set();
  body.requests.forEach((r, i) => {
    if (!r.custom_id || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.custom_id)) {
      throw bad(`requests.${i}.custom_id: String should match pattern '^[a-zA-Z0-9_-]{1,64}$'`, 'custom_id は英数字・アンダースコア・ハイフンの 1〜64 文字です。結果との対応づけに使います。');
    }
    if (ids.has(r.custom_id)) throw bad(`requests.${i}.custom_id: duplicate custom_id "${r.custom_id}"`, 'custom_id はバッチの中で重複できません。');
    ids.add(r.custom_id);
    if (!r.params) throw bad(`requests.${i}.params: Field required`, '各リクエストには params（Messages API のボディ）が必要です。');
    if (r.params.stream) throw bad(`requests.${i}.params.stream: streaming is not supported in batches`, 'Batches ではストリーミングは使えません。');
  });
  const id = newId('msgbatch');
  const items = body.requests.map((r) => {
    try {
      const res = runMessages(r.params, { version, scenario, cacheStore: null });
      const discounted = { ...res.cost, usd: res.cost.usd / 2 };
      return { custom_id: r.custom_id, result: { type: 'succeeded', message: res.message }, cost: discounted.usd };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      return { custom_id: r.custom_id, result: { type: 'errored', error: { type: 'error', error: { type: STATUS_TYPES[e.status], message: e.message } } }, cost: 0 };
    }
  });
  const b = { id, items, ticks: 0, created: Date.now(), canceled: false };
  batchStore.batches.set(id, b);
  return {
    status: 200,
    body: batchView(b),
    notes: [{ kind: 'ok', text: `バッチを作成しました（${items.length}件）。状態は in_progress です。GET /v1/messages/batches/{id} で状態を確認します（疑似環境では、確認するたびに時間が進み、2回目で ended になります）。` }],
  };
}

export function runBatchGet(id, batchStore, { advance = true } = {}) {
  const b = batchStore.batches.get(id);
  if (!b) throw new ApiError(404, `batch ${id} not found`, `ID「${id}」のバッチがありません。作成時に返った id を使います。`);
  if (advance) b.ticks += 1;
  const v = batchView(b);
  return {
    status: 200,
    body: v,
    notes: [v.processing_status === 'ended'
      ? { kind: 'ok', text: 'processing_status が ended になりました。results_url（GET …/results）から結果を取得できます。' }
      : { kind: 'info', text: 'まだ処理中です（in_progress）。本物では多くが1時間以内、最長24時間で終わります。間隔をあけて状態を確認します。' }],
  };
}

export function runBatchResults(id, batchStore) {
  const b = batchStore.batches.get(id);
  if (!b) throw new ApiError(404, `batch ${id} not found`, `ID「${id}」のバッチがありません。`);
  if (b.ticks < 2) throw bad(`batch ${id} is still processing`, 'バッチの処理が終わるまで結果は取得できません。まず状態（processing_status）が ended になったことを確認します。');
  const shuffled = b.items.slice().sort(() => Math.random() - 0.5);
  const lines = shuffled.map((it) => JSON.stringify({ custom_id: it.custom_id, result: it.result }));
  const total = b.items.reduce((a, it) => a + it.cost, 0);
  return {
    status: 200,
    jsonl: lines.join('\n'),
    notes: [
      { kind: 'warn', text: '結果の順番は、送ったときの順番と一致しません。必ず custom_id で元のリクエストと対応づけます。' },
      { kind: 'info', text: `料金は通常の 50%（疑似計算で合計 約 $${total.toFixed(6)}）。errored の結果は課金されません。` },
    ],
  };
}

export function runBatchCancel(id, batchStore) {
  const b = batchStore.batches.get(id);
  if (!b) throw new ApiError(404, `batch ${id} not found`, `ID「${id}」のバッチがありません。`);
  if (b.ticks < 2) b.canceled = true;
  return { status: 200, body: batchView(b), notes: [{ kind: 'info', text: 'キャンセルを受け付けました（canceling）。処理済みの分は結果に残り、未処理の分は canceled になります。' }] };
}

// ---------- 入口 ----------
export function handle({ method, path, headersText, bodyText, scenario, cacheStore, batchStore, serverState }) {
  const requestId = newId('req');
  try {
    const { headers, errors } = parseHeaders(headersText);
    if (errors.length) throw bad('invalid headers', errors.join('\n'));
    checkHeaders(headers);
    const version = headers['anthropic-version'];

    if (serverState === '429') {
      throw new ApiError(429, 'Number of request tokens has exceeded your per-minute rate limit (https://docs.claude.com/en/api/rate-limits); see the response headers for current usage. Please reduce the prompt length or the maximum tokens requested, or try again later.',
        'レート制限（1分あたりのリクエスト数やトークン数）を超えました。retry-after ヘッダーの秒数だけ待ってから再試行します。内容を変えても解決しません。',
        { 'retry-after': '8', 'anthropic-ratelimit-requests-remaining': '0', 'anthropic-ratelimit-input-tokens-remaining': '0', 'anthropic-ratelimit-requests-reset': new Date(Date.now() + 8000).toISOString() });
    }
    if (serverState === '529') throw new ApiError(529, 'Overloaded', 'API が一時的に過負荷です。指数バックオフ（1秒→2秒→4秒…、回数に上限）で再試行します。');
    if (serverState === '500') throw new ApiError(500, 'Internal server error', 'API 側の一時的な内部エラーです。指数バックオフで再試行します。続く場合は request-id を添えて問い合わせます。');

    let body = null;
    if (method === 'POST') {
      try {
        body = JSON.parse(bodyText);
      } catch (e) {
        throw bad(`There was an error parsing the body: ${e.message}`, `ボディが正しい JSON になっていません（${e.message}）。カンマの付け忘れ・付けすぎ、引用符の閉じ忘れがよくある原因です。`);
      }
    }

    const ctx = { version, scenario, cacheStore, batchStore };
    const okHeaders = (extra = {}) => ({
      'content-type': 'application/json',
      'request-id': requestId,
      'anthropic-ratelimit-requests-remaining': String(3990 + Math.floor(Math.random() * 9)),
      'anthropic-ratelimit-input-tokens-remaining': String(1_990_000 + Math.floor(Math.random() * 9000)),
      ...extra,
    });

    if (method === 'POST' && path === '/v1/messages') {
      const res = runMessages(body, ctx);
      return { status: 200, headers: okHeaders(body.stream ? { 'content-type': 'text/event-stream' } : {}), body: res.message, stream: body.stream ? toSSE(res.message) : null, notes: res.notes, usage: res.usage, cost: res.cost, model: res.model };
    }
    if (method === 'POST' && path === '/v1/messages/count_tokens') {
      const { model } = validateMessagesBody({ max_tokens: 1, ...body }, version);
      const total = flattenPrompt(body).reduce((a, p) => a + p.tokens, 0) + 3;
      return { status: 200, headers: okHeaders(), body: { input_tokens: total }, notes: [{ kind: 'info', text: `送る前に入力トークン数（推定）を確認できます。${model.label} の料金なら入力だけで 約 $${(total * priceFor(model, total).input / 1e6).toFixed(6)}。max_tokens は不要です。` }] };
    }
    if (method === 'POST' && path === '/v1/messages/batches') {
      const res = runBatchCreate(body, ctx);
      return { status: 200, headers: okHeaders(), body: res.body, notes: res.notes };
    }
    let m = path.match(/^\/v1\/messages\/batches\/([^/]+)\/results$/);
    if (method === 'GET' && m) {
      const res = runBatchResults(m[1], batchStore);
      return { status: 200, headers: okHeaders({ 'content-type': 'application/x-jsonl' }), jsonl: res.jsonl, notes: res.notes };
    }
    m = path.match(/^\/v1\/messages\/batches\/([^/]+)\/cancel$/);
    if (method === 'POST' && m) {
      const res = runBatchCancel(m[1], batchStore);
      return { status: 200, headers: okHeaders(), body: res.body, notes: res.notes };
    }
    m = path.match(/^\/v1\/messages\/batches\/([^/]+)$/);
    if (method === 'GET' && m) {
      const res = runBatchGet(m[1], batchStore);
      return { status: 200, headers: okHeaders(), body: res.body, notes: res.notes };
    }
    throw new ApiError(404, `Not Found: ${method} ${path}`, 'このエンドポイントはありません（疑似環境で使えるのは Messages、count_tokens、Batches です）。');
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e, requestId);
    return errorResponse(new ApiError(500, 'Internal simulator error', `疑似環境の内部エラーです：${e.message}`), requestId);
  }
}
