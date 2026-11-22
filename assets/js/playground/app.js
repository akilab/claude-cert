// Messages API 疑似環境の画面
import { escapeHtml } from '../common.js';
import { load, save } from '../store.js';
import { handle, createCacheStore, createBatchStore, MODELS, estTokens } from './sim.js';
import { SCENARIOS } from './scenarios.js';

const $ = (id) => document.getElementById(id);
const els = {
  list: $('scenario-list'), select: $('scenario-select'), intro: $('intro'),
  method: $('method'), path: $('path'), headers: $('headers'), body: $('body'), jsonStatus: $('json-status'),
  send: $('send'), format: $('format'), reset: $('reset'), server: $('server-state'), advance: $('advance-clock'), clock: $('clock'),
  status: $('res-status'), tabs: document.querySelectorAll('.res-tab'), resBody: $('res-body'), resHeaders: $('res-headers'), resStream: $('res-stream'),
  streamText: $('stream-text'), streamEvents: $('stream-events'), notes: $('notes'), helpers: $('helpers'), meter: $('meter'), timeline: $('timeline'), clearTimeline: $('clear-timeline'),
};

let scenario = null;
let cacheStore = createCacheStore();
let batchStore = createBatchStore();
let timeline = [];
let last = null; // 直前の { req, res }
let flags = {};
let streamTimer = null;

// ---------- 表示の道具 ----------
function highlight(json) {
  return escapeHtml(json).replace(
    /(&quot;(?:\\.|[^&\\]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, lit, num) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (lit) return `<span class="j-lit">${lit}</span>`;
      return `<span class="j-num">${num}</span>`;
    },
  );
}
const pretty = (v) => JSON.stringify(v, null, 2);
const fmtUsd = (v) => (v < 0.01 ? `$${v.toFixed(6)}` : `$${v.toFixed(4)}`);

function lineCol(text, pos) {
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  return { line, col: pos - before.lastIndexOf('\n') };
}

function checkJson() {
  if (els.method.value === 'GET') { els.jsonStatus.textContent = 'GET ではボディは送りません。'; els.jsonStatus.className = 'json-status muted'; return; }
  const t = els.body.value;
  try {
    JSON.parse(t);
    els.jsonStatus.textContent = '✓ JSON の形式は正しいです';
    els.jsonStatus.className = 'json-status ok';
  } catch (e) {
    const m = String(e.message).match(/position (\d+)/);
    const where = m ? (() => { const p = lineCol(t, Number(m[1])); return `（${p.line}行目 ${p.col}文字目付近）`; })() : '';
    els.jsonStatus.textContent = `✕ JSON の形式に誤りがあります${where}：${e.message}`;
    els.jsonStatus.className = 'json-status ng';
  }
}

// ---------- シナリオ ----------
function taskKey(id) { return `pg-tasks:${id}`; }

function renderScenarioList() {
  els.list.innerHTML = SCENARIOS.map((s) => {
    const done = load(taskKey(s.id), []);
    const total = s.tasks.length;
    const badge = total ? `<span class="xsmall muted">${done.length}/${total}</span>` : '';
    return `<li><a href="#${s.id}" data-id="${s.id}" ${scenario && scenario.id === s.id ? 'aria-current="true"' : ''}>${escapeHtml(s.title)} ${badge}</a></li>`;
  }).join('');
  els.select.innerHTML = SCENARIOS.map((s) => `<option value="${s.id}" ${scenario && scenario.id === s.id ? 'selected' : ''}>${escapeHtml(s.title)}</option>`).join('');
}

function renderIntro() {
  const done = load(taskKey(scenario.id), []);
  els.intro.innerHTML = `
    <h1>${escapeHtml(scenario.title)}</h1>
    <p class="goal"><b>この演習で学ぶこと：</b>${escapeHtml(scenario.goal)}</p>
    <p>${scenario.intro}</p>
    ${scenario.tasks.length ? `<h2 class="tasks-title">やってみよう <span class="xsmall muted">（${done.length}/${scenario.tasks.length} 完了。送信すると自動で判定します）</span></h2>
    <ol class="tasks">
      ${scenario.tasks.map((t, i) => `<li class="${done.includes(i) ? 'done' : ''}">
        <span class="check" aria-hidden="true">${done.includes(i) ? '✓' : ''}</span>
        <div><span>${escapeHtml(t.text).replace(/`([^`]+)`/g, '<code>$1</code>')}</span>
        <details><summary>ヒント</summary><div class="small">${escapeHtml(t.hint)}</div></details></div>
      </li>`).join('')}
    </ol>` : ''}`;
}

function loadScenario(id) {
  scenario = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
  const r = scenario.request;
  els.method.value = r.method;
  els.path.value = r.path;
  els.headers.value = r.headers;
  els.body.value = r.method === 'GET' ? '' : pretty(r.body);
  cacheStore = createCacheStore();
  batchStore = createBatchStore();
  timeline = [];
  last = null;
  flags = {};
  els.server.value = 'normal';
  els.advance.hidden = scenario.id !== 'caching';
  renderClock();
  renderScenarioList();
  renderIntro();
  clearResponse();
  renderTimeline();
  checkJson();
  document.title = `${scenario.title} | Messages API 疑似環境`;
}

function renderClock() {
  els.clock.textContent = `疑似時計：${cacheStore.clock}分経過`;
}

// ---------- レスポンスの表示 ----------
function clearResponse() {
  clearInterval(streamTimer);
  els.status.innerHTML = '<span class="muted">まだ送信していません。左のリクエストを確認して「送信」を押してください。</span>';
  els.resBody.innerHTML = '';
  els.resHeaders.innerHTML = '';
  els.streamEvents.innerHTML = '';
  els.streamText.textContent = '';
  els.notes.innerHTML = '';
  els.helpers.innerHTML = '';
  els.meter.innerHTML = '';
  selectTab('body');
  document.querySelector('.res-tab[data-tab="stream"]').hidden = true;
}

function selectTab(name) {
  els.tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  els.resBody.hidden = name !== 'body';
  els.resHeaders.hidden = name !== 'headers';
  els.resStream.hidden = name !== 'stream';
}

function renderResponse(req, res) {
  clearInterval(streamTimer);
  const okStatus = res.status === 200;
  els.status.innerHTML = `<span class="http ${okStatus ? 'ok' : 'ng'}">HTTP ${res.status}</span>
    <span class="small muted">${escapeHtml(req.method)} ${escapeHtml(req.path)}</span>
    ${res.body && res.body.stop_reason ? `<span class="badge ${res.body.stop_reason === 'max_tokens' ? 'ng' : 'ok'}">stop_reason: ${res.body.stop_reason}</span>` : ''}
    ${res.body && res.body.error ? `<span class="badge ng">${res.body.error.type}</span>` : ''}`;

  if (res.jsonl) {
    els.resBody.innerHTML = `<pre class="code">${res.jsonl.split('\n').map((l) => highlight(pretty(JSON.parse(l)))).join('\n<span class="j-sep">── 次の行 ──</span>\n')}</pre>`;
  } else {
    els.resBody.innerHTML = `<pre class="code">${highlight(pretty(res.body))}</pre>`;
  }
  els.resHeaders.innerHTML = `<pre class="code">${escapeHtml(Object.entries(res.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n'))}</pre>`;

  const streamTab = document.querySelector('.res-tab[data-tab="stream"]');
  streamTab.hidden = !res.stream;
  if (res.stream) {
    selectTab('stream');
    playStream(res.stream);
  } else {
    selectTab('body');
  }

  els.notes.innerHTML = (res.notes || []).map((n) => `<li class="note ${n.kind}">${escapeHtml(n.text)}</li>`).join('');
  renderHelpers(req, res);
  renderMeter(res);
}

function playStream(events) {
  els.streamEvents.innerHTML = '';
  els.streamText.textContent = '';
  let i = 0;
  const speed = 70;
  const step = () => {
    if (i >= events.length) { clearInterval(streamTimer); return; }
    const e = events[i++];
    const li = document.createElement('li');
    li.innerHTML = `<span class="ev">event: ${e.event}</span><code>data: ${escapeHtml(JSON.stringify(e.data))}</code>`;
    els.streamEvents.appendChild(li);
    els.streamEvents.scrollTop = els.streamEvents.scrollHeight;
    const d = e.data.delta;
    if (d && d.type === 'text_delta') els.streamText.textContent += d.text;
    if (d && d.type === 'thinking_delta') els.streamText.textContent += '';
    if (d && d.type === 'input_json_delta') els.streamText.textContent += d.partial_json;
    if (e.event === 'content_block_start' && e.data.content_block.type === 'tool_use') els.streamText.textContent += `\n[tool_use ${e.data.content_block.name}] `;
    if (e.event === 'content_block_start' && e.data.content_block.type === 'thinking') els.streamText.textContent += '[thinking…] ';
  };
  streamTimer = setInterval(step, speed);
  $('stream-skip').onclick = () => { clearInterval(streamTimer); while (i < events.length) step(); };
  $('stream-replay').onclick = () => playStream(events);
}

function renderMeter(res) {
  if (!res.usage || !res.model) { els.meter.innerHTML = ''; return; }
  const u = res.usage;
  const m = res.model;
  const parts = [
    ['入力（キャッシュなし）', u.input_tokens, 'm-in'],
    ['キャッシュ書き込み', u.cache_creation_input_tokens, 'm-write'],
    ['キャッシュ読み込み', u.cache_read_input_tokens, 'm-read'],
    ['出力', u.output_tokens, 'm-out'],
  ];
  const sum = parts.reduce((a, p) => a + p[1], 0) || 1;
  const thinkingTok = (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0;
  const ttft = 0.35 + u.input_tokens / 12000 + u.cache_creation_input_tokens / 12000 + u.cache_read_input_tokens / 150000 + thinkingTok / m.speed;
  const total = ttft + (u.output_tokens - thinkingTok) / m.speed;
  const saved = res.cost.noCache - res.cost.usd;
  els.meter.innerHTML = `
    <h3>トークンと費用（推定）</h3>
    <div class="stack" role="img" aria-label="トークンの内訳">${parts.map((p) => (p[1] ? `<i class="${p[2]}" style="flex:${p[1]}"></i>` : '')).join('')}</div>
    <ul class="legend">${parts.map((p) => `<li><span class="sw ${p[2]}"></span>${p[0]} <b>${p[1].toLocaleString()}</b></li>`).join('')}</ul>
    <div class="meter-grid">
      <div><span>費用（このリクエスト）</span><b>${fmtUsd(res.cost.usd)}</b></div>
      <div><span>キャッシュなしの場合</span><b>${fmtUsd(res.cost.noCache)}</b>${saved > 0.0000005 ? `<small class="ok-text">−${Math.round((saved / res.cost.noCache) * 100)}%</small>` : saved < -0.0000005 ? `<small class="ng-text">+${Math.round((-saved / res.cost.noCache) * 100)}%（書き込み）</small>` : ''}</div>
      <div><span>最初のトークンまで</span><b>約 ${ttft.toFixed(2)} 秒</b></div>
      <div><span>全体の生成時間</span><b>約 ${total.toFixed(1)} 秒</b></div>
    </div>
    <p class="xsmall muted">${escapeHtml(m.label)}：入力 $${res.cost.price.input}／出力 $${res.cost.price.output}（100万トークンあたり）。トークン数・時間は学習用の推定値で、本物とは異なります。100万件なら 約 $${Math.round(res.cost.usd * 1_000_000).toLocaleString()}。</p>`;
  void sum;
}

// ---------- 補助のボタン ----------
function parseBodySafe() {
  try { return JSON.parse(els.body.value); } catch { return null; }
}

function renderHelpers(req, res) {
  const btns = [];
  const msg = res.status === 200 && res.body && res.body.type === 'message' ? res.body : null;
  if (msg && msg.stop_reason === 'tool_use' && req.path === '/v1/messages') {
    btns.push(['run-tool', '🔧 ツールを実行して結果を追加', 'primary']);
  } else if (msg && req.path === '/v1/messages') {
    btns.push(['append', '↩ 応答を履歴に追加して会話を続ける', '']);
  }
  if (res.status === 200 && res.body && res.body.type === 'message_batch') {
    if (res.body.processing_status !== 'ended') btns.push(['batch-get', '⏱ 状態を確認（GET）', 'primary']);
    else btns.push(['batch-results', '📥 結果を取得（GET …/results）', 'primary']);
  }
  if (scenario.id === 'errors' && res.status >= 429) btns.push(['retry', '🔁 SDK のように再試行（指数バックオフ）', 'primary']);
  els.helpers.innerHTML = btns.map(([id, label, cls]) => `<button class="btn small ${cls}" type="button" data-act="${id}">${label}</button>`).join('');
}

els.helpers.addEventListener('click', (e) => {
  const act = e.target.closest('button') && e.target.closest('button').dataset.act;
  if (!act || !last) return;
  const body = parseBodySafe();
  if (act === 'run-tool' || act === 'append') {
    if (!body || !Array.isArray(body.messages)) return;
    const content = last.res.body.content.filter((b) => b.type !== 'text' || b.text);
    body.messages.push({ role: 'assistant', content });
    if (act === 'run-tool') {
      const results = content.filter((b) => b.type === 'tool_use').map((b) => {
        const impl = scenario.tools && scenario.tools[b.name];
        const out = impl ? impl(b.input) : { content: `（疑似のツール「${b.name}」の実行結果）`, is_error: false };
        timeline.push({ from: 'app', to: 'tool', label: `${b.name}(${JSON.stringify(b.input)})`, kind: 'tool' });
        timeline.push({ from: 'tool', to: 'app', label: out.is_error ? `失敗：${out.content}` : out.content, kind: out.is_error ? 'ng' : 'tool' });
        const r = { type: 'tool_result', tool_use_id: b.id, content: out.content };
        if (out.is_error) r.is_error = true;
        return r;
      });
      body.messages.push({ role: 'user', content: results });
      els.notes.insertAdjacentHTML('beforeend', '<li class="note info">アプリがツールを実行し、assistant の内容（tool_use）と、user の tool_result を messages に追加しました。この状態で「送信」すると、Claude が結果を使って回答します。</li>');
    } else {
      body.messages.push({ role: 'user', content: '（ここに次の質問を書いてください）' });
      els.notes.insertAdjacentHTML('beforeend', '<li class="note info">応答を assistant として履歴に追加し、次の user メッセージの欄を作りました。内容を書き換えてから送信してください。API はステートレスなので、毎回この履歴全体を送ります。</li>');
    }
    els.body.value = pretty(body);
    checkJson();
    renderTimeline();
    els.helpers.innerHTML = '';
    els.body.focus();
  }
  if (act === 'batch-get' || act === 'batch-results') {
    const id = last.res.body.id;
    els.method.value = 'GET';
    els.path.value = act === 'batch-get' ? `/v1/messages/batches/${id}` : `/v1/messages/batches/${id}/results`;
    checkJson();
    send();
  }
  if (act === 'retry') simulateRetry();
});

function simulateRetry() {
  const status = last.res.status;
  const waits = status === 429 ? [8, 8] : [1.0, 2.1];
  const steps = [];
  let t = 0;
  steps.push({ from: 'app', to: 'api', label: `試行1（t=${t.toFixed(1)}秒）`, kind: '' });
  steps.push({ from: 'api', to: 'app', label: `${status}`, kind: 'ng' });
  waits.forEach((w, i) => {
    t += w;
    steps.push({ from: 'app', to: 'app', label: status === 429 ? `retry-after の ${w} 秒だけ待つ` : `${w.toFixed(1)} 秒待つ（指数バックオフ＋ゆらぎ）`, kind: 'wait' });
    steps.push({ from: 'app', to: 'api', label: `試行${i + 2}（t=${t.toFixed(1)}秒）`, kind: '' });
    steps.push({ from: 'api', to: 'app', label: i === waits.length - 1 ? '200 OK（混雑が解消）' : `${status}`, kind: i === waits.length - 1 ? 'ok' : 'ng' });
  });
  let k = 0;
  const timer = setInterval(() => {
    if (k >= steps.length) {
      clearInterval(timer);
      els.notes.insertAdjacentHTML('beforeend', `<li class="note ok">再試行の結果、${waits.length + 1}回目で成功しました。公式 SDK は一時的なエラーを既定で2回まで自動で再試行します。回数には必ず上限を付け、最後まで失敗したら利用者に分かる形で伝えます。</li>`);
      flags.retried = true;
      els.server.value = 'normal';
      runChecks(last.req, last.res);
      return;
    }
    timeline.push(steps[k++]);
    renderTimeline();
  }, 350);
}

// ---------- 時系列 ----------
const LANE = { tool: 1, app: 2, api: 3 };
function renderTimeline() {
  if (!timeline.length) {
    els.timeline.innerHTML = '<p class="muted small">送信すると、アプリ・API・ツールの間のやり取りがここに並びます。</p>';
    return;
  }
  els.timeline.innerHTML = `<div class="seq">
    <div class="lane-head" style="grid-column:1">🔧 ツール</div>
    <div class="lane-head" style="grid-column:2">💻 あなたのアプリ</div>
    <div class="lane-head" style="grid-column:3">☁️ Claude API</div>
    ${timeline.map((s) => {
      if (s.from === s.to) return `<div class="seq-row wait" style="grid-column:${LANE[s.from]}">⏳ ${escapeHtml(s.label)}</div>`;
      const a = LANE[s.from];
      const b = LANE[s.to];
      const dir = b > a ? 'right' : 'left';
      return `<div class="seq-row arrow ${dir} ${s.kind}" style="grid-column:${Math.min(a, b)} / ${Math.max(a, b) + 1}"><span>${escapeHtml(s.label)}</span></div>`;
    }).join('')}
  </div>`;
  els.timeline.scrollTop = els.timeline.scrollHeight;
}

// ---------- 送信 ----------
function runChecks(req, res) {
  const done = new Set(load(taskKey(scenario.id), []));
  const before = done.size;
  scenario.tasks.forEach((t, i) => {
    try { if (t.check({ req, res, state: flags })) done.add(i); } catch { /* 判定できない形は未完了のまま */ }
  });
  save(taskKey(scenario.id), [...done]);
  if (done.size !== before) { renderIntro(); renderScenarioList(); }
}

function summarizeRequest(req) {
  if (req.method === 'GET') return `GET ${req.path.replace(/msgbatch_\w+/, 'msgbatch_…')}`;
  const b = req.body;
  if (!b) return `POST ${req.path}（JSON の誤り）`;
  if (req.path.endsWith('/batches')) return `POST バッチ作成（${(b.requests || []).length}件）`;
  const n = Array.isArray(b.messages) ? b.messages.length : 0;
  return `POST ${req.path}（messages ${n}件${b.tools ? `・tools ${b.tools.length}` : ''}${b.stream ? '・stream' : ''}）`;
}

function summarizeResponse(res) {
  if (res.status !== 200) return { label: `${res.status} ${res.body.error.type}`, kind: 'ng' };
  const b = res.body;
  if (res.jsonl) return { label: `200 結果 ${res.jsonl.split('\n').length}件（JSONL）`, kind: 'ok' };
  if (b.type === 'message') {
    const tu = b.content.find((x) => x.type === 'tool_use');
    return { label: `200 stop_reason: ${b.stop_reason}${tu ? `（${tu.name} を要求）` : ''}`, kind: b.stop_reason === 'tool_use' ? 'tool' : b.stop_reason === 'max_tokens' ? 'warn' : 'ok' };
  }
  if (b.type === 'message_batch') return { label: `200 ${b.processing_status}`, kind: 'ok' };
  return { label: '200', kind: 'ok' };
}

function send() {
  const req = { method: els.method.value, path: els.path.value.trim(), headersText: els.headers.value, bodyText: els.body.value };
  const res = handle({ ...req, scenario, cacheStore, batchStore, serverState: els.server.value });
  let parsed = null;
  try { parsed = req.method === 'POST' ? JSON.parse(req.bodyText) : null; } catch { parsed = null; }
  const hdr = {};
  req.headersText.split('\n').forEach((l) => { const m = l.match(/^\s*([\w-]+)\s*:\s*(.*)$/); if (m) hdr[m[1].toLowerCase()] = m[2]; });
  const r = { method: req.method, path: req.path, headers: hdr, body: parsed };
  last = { req: r, res };
  timeline.push({ from: 'app', to: 'api', label: summarizeRequest(r), kind: '' });
  const s = summarizeResponse(res);
  timeline.push({ from: 'api', to: 'app', label: s.label, kind: s.kind });
  renderResponse(r, res);
  renderTimeline();
  runChecks(r, res);
}

// ---------- イベント ----------
els.send.addEventListener('click', send);
els.format.addEventListener('click', () => {
  try { els.body.value = pretty(JSON.parse(els.body.value)); checkJson(); } catch { checkJson(); }
});
els.reset.addEventListener('click', () => loadScenario(scenario.id));
els.body.addEventListener('input', () => { clearTimeout(els.body._t); els.body._t = setTimeout(checkJson, 250); });
els.method.addEventListener('change', checkJson);
els.advance.addEventListener('click', () => {
  cacheStore.clock += 5;
  flags.advanced = true;
  renderClock();
  timeline.push({ from: 'app', to: 'app', label: '5分経過（キャッシュの有効期限は既定5分）', kind: 'wait' });
  renderTimeline();
});
els.clearTimeline.addEventListener('click', () => { timeline = []; renderTimeline(); });
els.tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
els.select.addEventListener('change', () => { location.hash = els.select.value; });
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
});
window.addEventListener('hashchange', () => loadScenario(location.hash.slice(1)));

// Tab キーでインデントを入れる（エディタ）
els.body.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const { selectionStart: s, selectionEnd: en, value } = els.body;
    els.body.value = `${value.slice(0, s)}  ${value.slice(en)}`;
    els.body.selectionStart = els.body.selectionEnd = s + 2;
  }
});

// モデルの一覧（参考表示）
$('model-list').innerHTML = Object.entries(MODELS).map(([id, m]) => `<li><code>${id}</code> <span class="muted">${escapeHtml(m.label)}・入力 $${m.input}／出力 $${m.output}</span></li>`).join('');
void estTokens;

loadScenario(location.hash.slice(1));
