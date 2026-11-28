// 問題演習エンジン（全試験共通）。<main id="app" data-exam="ccdv-f"> のように試験を指定する。
// data-set="challenge" を付けると最難関演習（「すべて選べ」形式、別の問題データと記録）になる。
// data-set="plus" を付けるとプラスONEチェック（用語と考え方の確認。別の問題データと記録、難易度なし）になる。
// プラスONEチェックは、選択肢を選んだらすぐに結果を出し、同じ条件ですぐに繰り返せるようにする。
// プラスONEチェックでは、1問ずつ答え合わせするか、続けて解いて最後に振り返るかを選べる（flow: each／batch）。
// プラスONEチェックでは制限時間（5・10・20分）も選べる。時間内に何問正解できるかを競い、時間ごとの自己ベストを残す。
import { loadData, escapeHtml, richText, siteUrl, confirmClick } from './common.js';
import { getHistory, recordAnswer, needsReview, getBookmarks, toggleBookmark, resetExam, load, save, recordDaily, getDaily, recordChallenge, getChallenges, dayKey } from './store.js';
import { startAutoSync } from './sync.js';

const app = document.getElementById('app');
const examId = app.dataset.exam;
const setId = app.dataset.set || '';
const isChallenge = setId === 'challenge';
const isPlus = setId === 'plus';
const noLevel = isChallenge || isPlus; // 難易度で絞り込まない問題集
const storeId = setId ? `${examId}-${setId}` : examId;
const dataFile = setId ? `${examId}-${setId}.json` : `${examId}.json`;
const LEVELS = { 1: '基礎', 2: '標準', 3: '応用' };
const isSelectAll = (q) => q.type === 'select-all';

// 選択肢ごとの判断が合っているか（選ぶべきものを選び、選ぶべきでないものを選ばなかったか）
// 解き方：exam＝本番形式（問い方の側を選ぶ）／judge＝すべての記述を ◯✗ で判定
let style = 'exam';
// その選択肢に「印を付けるべきか」。judge では ◯（正しい）を付けるべきかどうか
const shouldSelect = (q, o) => (isSelectAll(q) && style === 'judge' ? o.fact === true : o.correct);
const judgedCount = (q, chosen) => q.options.filter((o, i) => shouldSelect(q, o) === chosen.includes(i)).length;

function pointHtml(point) {
  if (Array.isArray(point)) return `<ul class="point-list">${point.map((p) => `<li>${richText(p)}</li>`).join('')}</ul>`;
  return richText(point);
}

// 狙い：この問題で確認すること／学んでほしいこと（解説の最初に出す）
function aimHtml(q) {
  if (!q.aim) return '';
  return `<div class="callout aim">
    <p><b>この問題で確認すること</b><br>${richText(q.aim.check)}</p>
    <p><b>学んでほしいこと</b><br>${richText(q.aim.lesson)}</p>
  </div>`;
}

function optionTags(q, o, chosen) {
  if (!isSelectAll(q)) {
    return `${o.correct ? '<b class="tag ok">正解</b>' : '<b class="tag ng">誤り</b>'}${chosen ? '<span class="tag mine">あなたの解答</span>' : ''}`;
  }
  const fact = o.fact ? '<b class="tag ok">正しい記述</b>' : '<b class="tag ng">誤った記述</b>';
  if (style === 'judge') {
    const ok = shouldSelect(q, o) === chosen;
    return fact + (ok ? '<span class="tag judge-ok">✓ 判定は正しい</span>' : `<span class="tag judge-ng">判定が誤り（正しくは ${o.fact ? '◯' : '✗'}）</span>`);
  }
  const sym = q.ask === 'correct' ? '◯' : '✗';
  const judge = o.correct === chosen
    ? `<span class="tag judge-ok">✓ 判断は正しい</span>`
    : `<span class="tag judge-ng">${o.correct ? `${sym} を付けるべきだった` : `${sym} を付けるべきではなかった`}</span>`;
  return fact + judge;
}

function askBanner(q) {
  if (style === 'judge') {
    return '<div class="ask-banner judge"><b>すべての記述</b>を ◯ 正しい／✗ 誤り で判定してください<small>全選択肢を判定するモードです。すべてに印を付けると解答できます。</small></div>';
  }
  return q.ask === 'correct'
    ? '<div class="ask-banner correct"><b>正しいもの</b>をすべて選んでください<small>選ぶ数は示されません。各記述を ◯ 正しい／✗ 誤り で判定し、<b>◯ を付けたもの</b>が解答になります。</small></div>'
    : '<div class="ask-banner incorrect"><b>誤っているもの</b>をすべて選んでください<small>選ぶ数は示されません。各記述を ◯ 正しい／✗ 誤り で判定し、<b>✗ を付けたもの</b>が解答になります。</small></div>';
}
const LETTERS = 'ABCDEFGH';

let exam;           // exams.json の該当試験
let questions = []; // 全問題
let domainMap = {};
let hasChallenge = false; // 最難関の問題データがあるか（通常の開始画面に案内を出す）
let hasPlus = false;      // プラスONEチェックの問題データがあるか
let session = null; // { list, index, results: [{q, chosen, correct}], time, endsAt, timeUp, flow }
let timer = null;   // 制限時間ありのときの残り時間の表示
const TIMES = [[0, 'なし（問題数で解く）'], [300, '5分'], [600, '10分'], [1200, '20分']];
const timeLabel = (sec) => (TIMES.find(([t]) => t === sec) || [0, `${sec}秒`])[1];
const fmtLeft = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function stopTimer() { clearInterval(timer); timer = null; }
// 制限時間ごとの自己ベスト。同期されるチャレンジの記録と、以前この端末だけに残していた値（best:）の大きいほう
function bestOf(sec) {
  const legacy = (load(`best:${storeId}`, {}) || {})[sec] || 0;
  return Math.max(legacy, ...getChallenges(storeId).filter((c) => c.sec === sec).map((c) => c.ok));
}
const shortDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

// プラスONEチェックの開始画面：チャレンジの結果と、直近14日の解いた数
function plusStatsHtml() {
  const daily = getDaily(storeId);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const e = daily[dayKey(d)] || { n: 0, ok: 0 };
    days.push({ d, n: e.n, ok: e.ok });
  }
  const total = days.reduce((a, x) => a + x.n, 0);
  const today = days[13].n;
  let streak = 0; // 今日（今日がまだなら昨日）から続けて解いた日数
  for (let i = today ? 13 : 12; i >= 0 && days[i].n; i--) streak += 1;
  const challenges = getChallenges(storeId);

  const cards = TIMES.filter(([t]) => t).map(([sec, label]) => {
    const mine = challenges.filter((c) => c.sec === sec);
    const last = mine[mine.length - 1];
    const best = bestOf(sec);
    return `<div class="stat-card">
      <div class="stat-label">${label}チャレンジ</div>
      <div class="stat-best">${best ? `<b>${best}</b>問` : '<span class="muted">—</span>'}<small>自己ベスト</small></div>
      <div class="stat-last small muted">${last ? `前回 ${last.ok}問（${shortDate(last.t)}）・${mine.length}回` : 'まだ挑戦していません'}</div>
    </div>`;
  }).join('');

  const max = Math.max(5, ...days.map((x) => x.n));
  const H = 100;
  const bars = days.map((x, i) => {
    const x0 = i * 30 + 5;
    const hOk = (x.ok / max) * H;
    const hNg = ((x.n - x.ok) / max) * H;
    const label = i === 13 ? '今日' : i % 2 === 1 ? '' : `${x.d.getMonth() + 1}/${x.d.getDate()}`;
    return `<rect x="${x0}" y="${20 + H - hOk}" width="20" height="${hOk}" rx="2" style="fill:var(--ok)"/>
      <rect x="${x0}" y="${20 + H - hOk - hNg}" width="20" height="${hNg}" rx="2" style="fill:var(--ng);opacity:.75"/>
      ${x.n ? `<text x="${x0 + 10}" y="${20 + H - hOk - hNg - 4}" text-anchor="middle" style="font-size:11px;fill:var(--ink-2)">${x.n}</text>` : ''}
      <text x="${x0 + 10}" y="${20 + H + 16}" text-anchor="middle" style="font-size:11px;fill:var(--ink-2)">${label}</text>`;
  }).join('');

  return `<section class="card plus-stats" aria-label="記録">
      <div class="stat-cards">${cards}</div>
      <div class="daily-head">
        <h2>直近14日の解いた数</h2>
        <p class="small">今日 <b>${today}</b>問 ・ 14日で <b>${total}</b>問 ・ ${streak ? `<b>${streak}</b>日連続` : 'きょうから始めよう'}</p>
      </div>
      <svg class="daily-chart" viewBox="0 0 420 140" role="img" aria-label="直近14日の解いた数。今日 ${today}問、14日で ${total}問">
        <line x1="0" y1="${20 + H}" x2="420" y2="${20 + H}" style="stroke:var(--line)"/>
        ${bars}
      </svg>
      <p class="xsmall muted"><span class="dot ok"></span>正解　<span class="dot ng"></span>不正解　記録は<a href="../#sync">同期</a>を設定すると、ほかの端末と合わせて数えます。</p>
    </section>`;
}

// ---------- ユーティリティ ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const correctCount = (q) => q.options.filter((o) => o.correct).length;
const domainName = (id) => (domainMap[id] ? domainMap[id].ja : id);
function scrollTop() { window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' }); }

// ---------- 開始画面 ----------
function filterPool(settings) {
  const h = getHistory(storeId);
  const bm = getBookmarks(storeId);
  return questions.filter((q) => {
    if (!noLevel && settings.level !== 'all' && String(q.level) !== settings.level) return false;
    if (!settings.domains.includes(q.domain)) return false;
    if (settings.mode === 'new' && h[q.id]) return false;
    if (settings.mode === 'review' && !needsReview(h[q.id])) return false;
    if (settings.mode === 'bookmark' && !bm.includes(q.id)) return false;
    return true;
  });
}

function renderSetup() {
  stopTimer();
  const saved = load(`settings:${storeId}`, null);
  const settings = {
    level: saved?.level ?? 'all',
    domains: (saved?.domains ?? exam.domains.map((d) => d.id)).filter((id) => domainMap[id]),
    mode: saved?.mode ?? (isPlus ? 'all' : 'new'),
    count: saved?.count ?? 10,
    style: saved?.style ?? 'exam',
    // 以前の選択肢（1分・3分）が保存されていたら「なし」に戻す
    flow: isPlus && saved?.flow === 'batch' ? 'batch' : 'each',
    time: isPlus && TIMES.some(([t]) => t === saved?.time) ? saved.time : 0,
  };
  if (!settings.domains.length) settings.domains = exam.domains.map((d) => d.id);

  const h = getHistory(storeId);
  const reviewN = questions.filter((q) => needsReview(h[q.id])).length;
  const bookmarkN = getBookmarks(storeId).filter((id) => questions.some((q) => q.id === id)).length;
  const newN = questions.filter((q) => !h[q.id]).length;

  const perDomain = {};
  questions.forEach((q) => { perDomain[q.domain] = (perDomain[q.domain] || 0) + 1; });

  app.innerHTML = `
    <section class="setup">
      <h1>${exam.code} ${isChallenge ? '最難関演習' : isPlus ? 'プラスONEチェック' : '問題演習'}</h1>
      ${isChallenge
        ? `<p class="muted">本番より難しい「正しいもの（誤っているもの）をすべて選べ」形式の問題です。選ぶ数は示されません。選択肢の1つ1つが重要事項の確認になっています。全 ${questions.length}問。1回 5問程度がおすすめです。</p>`
        : isPlus
        ? `<p class="muted">試験の問題文に出てくる<b>用語と考え方</b>を、短い問題で確認します。紛らわしい用語どうしを見分けられるかがポイントです。全 ${questions.length}問。1回 10〜20問がおすすめです。</p>
           <p class="callout small">用語の意味とサンプルは <a href="./learn/terms.html">試験に出る用語集</a> にまとめています。解答後の解説から、該当する用語や学習ページの説明に直接飛べます。</p>
           ${plusStatsHtml()}`
        : `<p class="muted">条件を選んで始めます。1回 10問程度がおすすめです。全 ${questions.length}問。</p>
           ${hasChallenge ? `<p class="callout small">本番より難しい「すべて選べ」形式の問題は <a href="./challenge.html">最難関演習</a> で解けます（通常の問題とは混ざりません）。</p>` : ''}
           ${hasPlus ? `<p class="callout small">用語と考え方の確認は <a href="./plus.html">プラスONEチェック</a> で（通常の問題とは混ざりません）。</p>` : ''}`}

      <form id="setup-form" class="card setup-form">
        <fieldset>
          <legend>出題する問題</legend>
          <div class="seg" role="radiogroup">
            ${[
              ['new', `まだ解いていない問題`, newN],
              ['review', `間違えた問題（復習）`, reviewN],
              ['bookmark', `ブックマークした問題`, bookmarkN],
              ['all', `すべての問題`, questions.length],
            ].map(([v, label, n]) => `<label class="seg-item"><input type="radio" name="mode" value="${v}" ${settings.mode === v ? 'checked' : ''}><span>${label}<small>${n}問</small></span></label>`).join('')}
          </div>
          <p class="xsmall muted">「間違えた問題」は、一度間違えた問題のうち、まだ2回続けて正解していないものです。</p>
        </fieldset>

        ${isChallenge ? `<fieldset>
          <legend>解き方</legend>
          <div class="seg" role="radiogroup">
            ${[['exam', '本番形式', '正しいもの／誤っているものを選ぶ'], ['judge', '全選択肢を判定', 'すべての記述を ◯／✗ で判定']].map(([v, label, sub]) => `<label class="seg-item"><input type="radio" name="style" value="${v}" ${settings.style === v ? 'checked' : ''}><span>${label}<small>${sub}</small></span></label>`).join('')}
          </div>
          <p class="xsmall muted">全選択肢を判定：選択肢1つ1つの知識を確かめる（学習の初期・苦手分野の復習向け）／本番形式：問いの向きを取り違えない練習（仕上げ向け）。記録はどちらも同じ問題に積み上がります。</p>
        </fieldset>` : ''}

        <fieldset ${noLevel ? 'hidden' : ''}>
          <legend>難易度</legend>
          <div class="seg" role="radiogroup">
            ${[['all', 'すべて'], ['1', '基礎'], ['2', '標準'], ['3', '応用']].map(([v, label]) => `<label class="seg-item"><input type="radio" name="level" value="${v}" ${settings.level === v ? 'checked' : ''}><span>${label}</span></label>`).join('')}
          </div>
          <p class="xsmall muted">基礎：用語と仕組み ／ 標準：状況に合った方法を選ぶ ／ 応用：複数の条件を比べる・原因を切り分ける</p>
        </fieldset>

        <fieldset>
          <legend>分野 <button type="button" class="btn small ghost" id="toggle-domains">すべて選択／解除</button></legend>
          <div class="domain-list">
            ${exam.domains.map((d) => `<label class="check"><input type="checkbox" name="domain" value="${d.id}" ${settings.domains.includes(d.id) ? 'checked' : ''}><span>${escapeHtml(d.ja)} <small class="muted">${d.weight}% ・ ${perDomain[d.id] || 0}問</small></span></label>`).join('')}
          </div>
        </fieldset>

        ${isPlus ? `<fieldset>
          <legend>答え合わせ</legend>
          <div class="seg" role="radiogroup">
            ${[['each', '1問ずつ', '選ぶとすぐに正誤と解説'], ['batch', '最後にまとめて', '次々に解き、結果の画面で振り返る']].map(([v, label, sub]) => `<label class="seg-item"><input type="radio" name="flow" value="${v}" ${settings.flow === v ? 'checked' : ''}><span>${label}<small>${sub}</small></span></label>`).join('')}
          </div>
        </fieldset>

        <fieldset>
          <legend>制限時間</legend>
          <div class="seg" role="radiogroup">
            ${TIMES.map(([t, label]) => `<label class="seg-item"><input type="radio" name="time" value="${t}" ${Number(settings.time) === t ? 'checked' : ''}><span>${label}</span></label>`).join('')}
          </div>
          <p class="xsmall muted">時間を決めると、時間内に何問正解できるかに挑戦します。解説を読む時間も含みます。時間ごとに自己ベストを残します。</p>
        </fieldset>` : ''}

        <fieldset id="count-set">
          <legend>出題数</legend>
          <div class="seg" role="radiogroup">
            ${[5, 10, 20, 0].map((n) => `<label class="seg-item"><input type="radio" name="count" value="${n}" ${Number(settings.count) === n ? 'checked' : ''}><span>${n ? n + '問' : '全部'}</span></label>`).join('')}
          </div>
        </fieldset>

        <div class="setup-foot">
          <p id="pool-info" class="small" aria-live="polite"></p>
          <button class="btn primary" id="start" type="submit">始める</button>
        </div>
      </form>

      <details class="help card">
        <summary>使い方</summary>
        <ul class="small">
          ${isPlus
            ? '<li>「1問ずつ」では、選択肢を選ぶとすぐに結果が出ます。「最後にまとめて」では、選ぶとすぐ次の問題に進み、結果の画面で正誤と解説を振り返ります。</li><li>制限時間を選ぶと、時間内に何問正解できるかに挑戦できます（解説を読む時間も含みます）。時間切れになると、そこで結果の画面になります。</li><li>キーボード：<kbd>1</kbd>〜<kbd>4</kbd> で解答、<kbd>Enter</kbd> で次へ、<kbd>B</kbd> でブックマーク。結果の画面で <kbd>Enter</kbd> を押すと、同じ条件でもう一度始めます。</li>'
            : '<li>選択肢の右にある <b>✕</b> で、違うと思う選択肢を消せます（もう一度押すと戻ります）。</li><li>キーボード：<kbd>1</kbd>〜<kbd>7</kbd> で選択、<kbd>Enter</kbd> で解答・次へ、<kbd>B</kbd> でブックマーク。</li>'}
          ${isChallenge ? '<li>各選択肢の右の <b>◯ 正しい</b>／<b>✗ 誤り</b> で記述の正誤を判定します。「正しいものを選べ」なら ◯、「誤っているものを選べ」なら ✗ を付けたものが解答です。もう一度押すと判定を取り消せます。</li><li>すべての選択肢の判断が合って初めて正解です。あわせて「6つ中4つの判断が正しい」のような部分点も表示します。</li>' : ''}
          <li>解答すると、すべての選択肢について「なぜ正しいか・なぜ違うか」が表示されます。</li>
          <li>記録はこのブラウザに保存されます。<a href="../#sync">記録の同期</a>を設定すると、ほかの端末と共有できます。</li>
        </ul>
        <button type="button" class="btn small" id="reset">${exam.code} の記録をすべて消す</button>
      </details>
    </section>`;

  const form = document.getElementById('setup-form');
  const info = document.getElementById('pool-info');
  const startBtn = document.getElementById('start');

  const read = () => ({
    mode: form.mode.value,
    style: isChallenge ? form.style.value : 'exam',
    level: noLevel ? 'all' : form.level.value,
    count: Number(form.count.value),
    time: isPlus ? Number(form.time.value) : 0,
    flow: isPlus ? form.flow.value : 'each',
    domains: [...form.querySelectorAll('input[name=domain]:checked')].map((i) => i.value),
  });
  const update = () => {
    const s = read();
    const n = filterPool(s).length;
    const take = s.count ? Math.min(s.count, n) : n;
    document.getElementById('count-set').hidden = s.time > 0;
    info.textContent = !n ? '条件に合う問題がありません。条件を変えてください。'
      : s.time ? `条件に合う問題：${n}問（${timeLabel(s.time)}で、できるだけ多く解く）`
      : `条件に合う問題：${n}問（今回 ${take}問を出題）`;
    startBtn.disabled = n === 0;
  };
  form.addEventListener('change', update);
  document.getElementById('toggle-domains').addEventListener('click', () => {
    const boxes = [...form.querySelectorAll('input[name=domain]')];
    const allOn = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allOn; });
    update();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = read();
    save(`settings:${storeId}`, s);
    style = s.style;
    startWith(s);
  });
  confirmClick(document.getElementById('reset'), 'もう一度押すとすべて消します（元に戻せません）', () => {
    resetExam(storeId);
    renderSetup();
  });
  update();
}

// ---------- 出題 ----------
function startWith(s) {
  const pool = shuffle(filterPool(s));
  if (!pool.length) { renderSetup(); return; }
  startSession(s.time || !s.count ? pool : pool.slice(0, s.count), s.time, s.flow);
}

function startSession(list, time = 0, flow = 'each') {
  stopTimer();
  session = { list, index: 0, results: [], time, endsAt: time ? Date.now() + time * 1000 : 0, timeUp: false, flow };
  renderQuestion();
  if (time) timer = setInterval(tick, 200);
}

// 制限時間：残り時間を表示し、0 になったら（解説を読んでいる途中でも）結果へ
function tick() {
  const left = session.endsAt - Date.now();
  if (left <= 0) { session.timeUp = true; renderResults(); return; }
  const t = document.getElementById('timer');
  if (t) t.textContent = `残り ${fmtLeft(left)}`;
  const bar = document.querySelector('.q-progress .bar i');
  if (bar) bar.style.width = `${(left / (session.time * 1000)) * 100}%`;
}

function renderQuestion() {
  const q = session.list[session.index];
  const total = session.list.length;
  const n = correctCount(q);
  const selectAll = isSelectAll(q);
  const order = shuffle(q.options.map((_, i) => i));
  const state = { selected: new Set(), eliminated: new Set(), answered: false, order };
  const bookmarked = getBookmarks(storeId).includes(q.id);

  app.innerHTML = `
    <section class="question" aria-live="polite">
      <div class="q-top">
        ${session.time
          ? `<div class="q-progress timed">
              <span id="timer">残り ${fmtLeft(session.endsAt - Date.now())}</span>
              <span class="bar"><i style="width:${((session.endsAt - Date.now()) / (session.time * 1000)) * 100}%"></i></span>
              <span>${session.flow === 'batch' ? `解いた ${session.results.length}` : `正解 ${session.results.filter((r) => r.correct).length}`}</span>
            </div>`
          : `<div class="q-progress" aria-label="${session.index + 1}問目／全${total}問">
              <span>${session.index + 1} / ${total}</span>
              <span class="bar"><i style="width:${(session.index / total) * 100}%"></i></span>
            </div>`}
        <button class="btn small ghost" id="quit" type="button">終了</button>
      </div>

      <article class="card q-card">
        <div class="q-meta">
          <span class="badge blue">${escapeHtml(domainName(q.domain))}</span>
          ${isPlus ? '' : (q.skills || [q.skill]).map((s) => `<span class="badge">${escapeHtml(s)}</span>`).join('')}
          ${selectAll ? '<span class="badge lv4">最難関</span>' : isPlus ? '<span class="badge">用語チェック</span>' : `<span class="badge lv${q.level}">${LEVELS[q.level]}</span>`}
          <button class="bookmark ${bookmarked ? 'on' : ''}" id="bookmark" type="button" aria-pressed="${bookmarked}" title="ブックマーク（B）">${bookmarked ? '★' : '☆'}<span class="visually-hidden">ブックマーク</span></button>
        </div>
        <div class="q-stem">${richText(q.stem)}</div>
        ${selectAll ? askBanner(q) : `<p class="q-instruction">${n > 1 ? `<b>${n}つ</b>選んでください。` : '1つ選んでください。'}</p>`}

        <div id="verdict"></div>
        <ol class="options" id="options">
          ${order.map((oi, pos) => `
            <li class="opt ${selectAll ? 'sa' : ''}" data-oi="${oi}">
              <button class="opt-main" type="button" aria-pressed="false">
                <span class="opt-letter">${LETTERS[pos]}</span>
                <span class="opt-text">${richText(q.options[oi].text)}</span>
              </button>
              ${selectAll
                ? `<div class="opt-judge" role="group" aria-label="選択肢 ${LETTERS[pos]} の判定">
                     <button class="j-btn j-true" type="button" data-mark="true" aria-pressed="false" title="この記述は正しい">◯<span>正しい</span></button>
                     <button class="j-btn j-false" type="button" data-mark="false" aria-pressed="false" title="この記述は誤り">✗<span>誤り</span></button>
                   </div>`
                : isPlus ? '' : `<button class="opt-cut" type="button" title="この選択肢を消す／戻す" aria-label="選択肢 ${LETTERS[pos]} を消す">✕</button>`}
              <div class="opt-why" hidden></div>
            </li>`).join('')}
        </ol>

        <div class="q-actions" ${isPlus ? 'hidden' : ''}>
          <span class="small muted" id="sel-info"></span>
          <button class="btn primary" id="submit" type="button" disabled>解答する</button>
        </div>
        <div id="feedback"></div>
      </article>
    </section>`;
  scrollTop();

  const optsEl = document.getElementById('options');
  const submitBtn = document.getElementById('submit');
  const selInfo = document.getElementById('sel-info');

  // 「すべて選べ」では、各選択肢を ◯（正しい）／✗（誤り）で判定する。
  // 問い方と同じ側の判定が「選んだ」、反対側の判定が「選ばない」になる。
  const selectMark = style === 'judge' || q.ask === 'correct' ? 'true' : 'false';
  const markOf = (oi) => {
    if (state.selected.has(oi)) return selectMark;
    if (state.eliminated.has(oi)) return selectMark === 'true' ? 'false' : 'true';
    return null;
  };
  const setMark = (oi, mark) => {
    const current = markOf(oi);
    state.selected.delete(oi);
    state.eliminated.delete(oi);
    if (current === mark) return; // 同じボタンをもう一度押したら判定を取り消す
    if (mark === selectMark) state.selected.add(oi);
    else state.eliminated.add(oi);
  };

  const refresh = () => {
    optsEl.querySelectorAll('.opt').forEach((li) => {
      const oi = Number(li.dataset.oi);
      const sel = state.selected.has(oi);
      const cut = state.eliminated.has(oi);
      li.classList.toggle('selected', sel);
      const main = li.querySelector('.opt-main');
      main.setAttribute('aria-pressed', String(sel));
      if (selectAll) {
        const mark = markOf(oi);
        li.classList.toggle('mark-true', mark === 'true');
        li.classList.toggle('mark-false', mark === 'false');
        main.disabled = state.answered;
        li.querySelectorAll('.j-btn').forEach((b) => {
          b.setAttribute('aria-pressed', String(b.dataset.mark === mark));
          b.disabled = state.answered;
        });
      } else {
        li.classList.toggle('eliminated', cut);
        main.disabled = state.answered || cut;
        const cutBtn = li.querySelector('.opt-cut');
        if (cutBtn) {
          cutBtn.disabled = state.answered;
          cutBtn.setAttribute('aria-pressed', String(cut));
        }
      }
    });
    if (!state.answered) {
      if (selectAll) {
        const judged = state.selected.size + state.eliminated.size;
        if (style === 'judge') {
          selInfo.textContent = `判定済み ${judged} / ${q.options.length}`;
          submitBtn.disabled = judged < q.options.length;
        } else {
          selInfo.textContent = `${selectMark === 'true' ? '◯' : '✗'} を付けた ${state.selected.size} 個が解答（判定済み ${judged} / ${q.options.length}）`;
          submitBtn.disabled = state.selected.size === 0;
        }
      } else {
        selInfo.textContent = n > 1 ? `${state.selected.size} / ${n} 選択中` : '';
        submitBtn.disabled = state.selected.size !== n;
      }
    }
  };

  const choose = (oi) => {
    if (state.answered) return;
    if (selectAll) {
      // 本文を押したときは、問い方と同じ側の判定を付け外しする
      setMark(oi, selectMark);
      refresh();
      return;
    }
    if (state.eliminated.has(oi)) return;
    if (n === 1) {
      state.selected = new Set([oi]);
      if (isPlus) { submit(); return; } // 選んだらすぐに結果を出す
    } else if (state.selected.has(oi)) {
      state.selected.delete(oi);
    } else if (state.selected.size < n) {
      state.selected.add(oi);
    }
    refresh();
  };

  optsEl.addEventListener('click', (e) => {
    const li = e.target.closest('.opt');
    if (!li || state.answered) return;
    const oi = Number(li.dataset.oi);
    const jb = e.target.closest('.j-btn');
    if (jb) {
      setMark(oi, jb.dataset.mark);
      refresh();
      return;
    }
    if (e.target.closest('.opt-cut')) {
      if (state.eliminated.has(oi)) state.eliminated.delete(oi);
      else { state.eliminated.add(oi); state.selected.delete(oi); }
      refresh();
    } else if (e.target.closest('.opt-main')) {
      choose(oi);
    }
  });

  const bmBtn = document.getElementById('bookmark');
  const toggleBm = () => {
    const on = toggleBookmark(storeId, q.id);
    bmBtn.classList.toggle('on', on);
    bmBtn.setAttribute('aria-pressed', String(on));
    bmBtn.firstChild.textContent = on ? '★' : '☆';
  };
  bmBtn.addEventListener('click', toggleBm);

  document.getElementById('quit').addEventListener('click', renderResults);

  const submit = () => {
    if (state.answered) return;
    if (selectAll && style === 'judge' && state.selected.size + state.eliminated.size < q.options.length) return;
    if (selectAll ? state.selected.size === 0 && style !== 'judge' : state.selected.size !== n) return;
    state.answered = true;
    const correctSet = new Set(q.options.map((o, i) => (shouldSelect(q, o) ? i : -1)).filter((i) => i >= 0));
    const isCorrect = state.selected.size === correctSet.size && [...state.selected].every((i) => correctSet.has(i));
    recordAnswer(storeId, q.id, isCorrect);
    if (isPlus) recordDaily(storeId, isCorrect);
    const chosen = [...state.selected];
    session.results.push({ q, chosen, correct: isCorrect, order, judged: judgedCount(q, chosen) });
    if (session.flow === 'batch') { // 最後にまとめて振り返る：正誤を出さずに次の問題へ
      if (session.index === session.list.length - 1) renderResults();
      else { session.index += 1; renderQuestion(); }
      return;
    }
    showFeedback(q, state, isCorrect);
    refresh();
  };
  submitBtn.addEventListener('click', submit);

  document.onkeydown = (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-8]$/.test(e.key)) {
      const pos = Number(e.key) - 1;
      if (pos < order.length) choose(order[pos]);
    } else if (e.key === 'Enter') {
      if (!state.answered) { if (!submitBtn.disabled) { e.preventDefault(); submit(); } }
      else { const nx = document.getElementById('next'); if (nx) { e.preventDefault(); nx.click(); } }
    } else if (e.key === 'b' || e.key === 'B') {
      toggleBm();
    }
  };
  refresh();
}

async function inlineDiagram(container, path) {
  try {
    const res = await fetch(siteUrl(path));
    if (!res.ok) throw new Error();
    const text = await res.text();
    if (!text.trim().startsWith('<svg')) throw new Error();
    container.innerHTML = text;
  } catch {
    container.remove();
  }
}

function showFeedback(q, state, isCorrect) {
  document.querySelectorAll('#options .opt').forEach((li) => {
    const oi = Number(li.dataset.oi);
    const o = q.options[oi];
    const chosen = state.selected.has(oi);
    // 「すべて選べ」では、選ぶべきかどうかではなく「判断が合っていたか」で色を付ける
    if (isSelectAll(q)) li.classList.add(shouldSelect(q, o) === chosen ? 'judge-ok' : 'judge-miss');
    else li.classList.add(o.correct ? 'is-correct' : 'is-wrong');
    if (chosen) li.classList.add('was-chosen');
    const why = li.querySelector('.opt-why');
    why.innerHTML = `${optionTags(q, o, chosen)} ${richText(o.why)}`;
    why.hidden = false;
  });

  const isLast = session.index === session.list.length - 1;
  const fb = document.getElementById('feedback');
  const partial = isSelectAll(q) ? `<small>${q.options.length}つ中 ${judgedCount(q, [...state.selected])}つの判断が正しい</small>` : '';
  const banner = `<div class="result-banner ${isCorrect ? 'ok' : 'ng'}">${isCorrect ? (isSelectAll(q) ? '◯ 完全正解' : '◯ 正解') : '✕ 不正解'}${partial}</div>`;
  // 狙いがある問題は、結果と狙いを選択肢の上に出し、解説を「狙い → 各選択肢 → ポイント」の順に読めるようにする
  const verdict = document.getElementById('verdict');
  const nextBtn = `<button class="btn primary" id="next" type="button">${isLast ? '結果を見る' : '次の問題へ'}</button>`;
  // プラスONEチェック：結果と「次へ」を選択肢のすぐ上に出し、スクロールせずに進めるようにする
  if (isPlus) verdict.innerHTML = `<div class="instant-bar">${banner}${nextBtn}</div>`;
  else if (q.aim) verdict.innerHTML = banner + aimHtml(q);
  fb.innerHTML = `
    ${q.aim || isPlus ? '' : banner}
    <div class="callout point"><b>ポイント</b>${Array.isArray(q.point) ? '' : '<br>'}${pointHtml(q.point)}</div>
    ${q.diagram ? '<figure class="diagram" id="diagram"></figure>' : ''}
    ${q.learn ? `<p class="small"><a href="${siteUrl(q.learn)}" target="_blank" rel="noopener">📖 関連する学習コンテンツを開く（新しいタブ）</a></p>` : ''}
    ${isPlus ? '' : `<div class="q-actions"><span></span>${nextBtn}</div>`}`;
  document.getElementById('submit').remove();
  document.getElementById('sel-info').remove();
  if (q.diagram) inlineDiagram(document.getElementById('diagram'), q.diagram);
  document.getElementById('next').addEventListener('click', () => {
    if (isLast) renderResults();
    else { session.index += 1; renderQuestion(); }
  });
  if (!session.time) document.querySelector('.q-progress .bar i').style.width = `${((session.index + 1) / session.list.length) * 100}%`;
  if (isPlus) { verdict.scrollIntoView({ block: 'nearest' }); document.getElementById('next').focus({ preventScroll: true }); }
  else if (q.aim) verdict.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- 結果 ----------
function renderResults() {
  stopTimer();
  document.onkeydown = null;
  const res = session.results;
  const ok = res.filter((r) => r.correct).length;
  const rate = res.length ? Math.round((ok / res.length) * 100) : 0;

  const byDomain = {};
  res.forEach((r) => {
    const d = (byDomain[r.q.domain] ||= { ok: 0, n: 0 });
    d.n += 1;
    if (r.correct) d.ok += 1;
  });
  const wrong = res.filter((r) => !r.correct);
  const optTotal = res.reduce((a, r) => a + r.q.options.length, 0);
  const optOk = res.reduce((a, r) => a + r.judged, 0);

  // 制限時間ありの回：記録を残し、時間ごとの自己ベスト（正解数）と比べる
  let bestHtml = '';
  if (session.time) {
    const prev = bestOf(session.time);
    if (res.length) recordChallenge(storeId, { sec: session.time, ok, n: res.length });
    if (ok > prev) {
      bestHtml = `<p class="best-line new">🎉 自己ベスト更新！${prev ? `（これまで ${prev}問）` : ''}</p>`;
    } else {
      bestHtml = `<p class="best-line">自己ベスト：${prev}問</p>`;
    }
  }

  app.innerHTML = `
    <section class="results">
      <h1>結果</h1>
      <div class="card score-card">
        ${session.time
          ? `<p class="small muted">${session.timeUp ? '⏱ 時間切れ' : '終了'}（制限時間 ${timeLabel(session.time)}）</p>
             <div class="score"><b>${ok}</b> 問正解 <span class="small muted">（解いた ${res.length}問）</span> <span class="rate ${rate >= 72 ? 'ok' : 'ng'}">${rate}%</span></div>
             ${bestHtml}`
          : `<div class="score"><b>${ok}</b> / ${res.length} 問正解 <span class="rate ${rate >= 72 ? 'ok' : 'ng'}">${rate}%</span></div>`}
        ${isChallenge
          ? `<p class="small">選択肢ごとの判断：<b>${optTotal}個中 ${optOk}個</b>が正しい（${optTotal ? Math.round((optOk / optTotal) * 100) : 0}%）</p>
             <p class="small muted">最難関は本番より難しく作っています。完全正解の数より、選択肢ごとの判断の正答率を伸ばすことを目標にしましょう。</p>`
          : isPlus ? '<p class="small muted">間違えた問題は、解説のリンクから用語集や学習ページで確認し、「間違えた問題」で解き直しましょう。</p>'
          : '<p class="small muted">目安：本番の合格ライン（720/1000）は正答率そのものではありませんが、練習では 7〜8割を安定して取れることを目標にしましょう。</p>'}
        <div class="weights">
          ${Object.entries(byDomain).map(([d, v]) => `<div class="weight-row">
              <span class="label">${escapeHtml(domainName(d))}</span>
              <span class="num">${v.ok}/${v.n}</span>
              <span class="track"><i style="width:${(v.ok / v.n) * 100}%;background:${v.ok / v.n >= 0.7 ? 'var(--ok)' : 'var(--ng)'}"></i></span>
            </div>`).join('')}
        </div>
      </div>

      <div class="result-actions">
        ${isPlus ? '<button class="btn primary" id="same" type="button">同じ条件でもう一度</button>' : ''}
        ${wrong.length ? `<button class="btn ${isPlus ? '' : 'primary'}" id="retry-wrong" type="button">間違えた ${wrong.length}問を解き直す</button>` : ''}
        <button class="btn" id="again" type="button">条件を選んでもう一度</button>
        <a class="btn ghost" href="../">トップへ</a>
      </div>

      <h2>解いた問題の振り返り</h2>
      <ol class="review-list">
        ${res.map((r, i) => `<li class="card review-item ${r.correct ? 'ok' : 'ng'}">
            <details ${session.flow === 'batch' && !r.correct ? 'open' : ''}>
              <summary><span class="mark">${r.correct ? '◯' : '✕'}</span> <span class="badge">${escapeHtml(domainName(r.q.domain))}</span> ${escapeHtml(r.q.stem.split('\n')[0].slice(0, 80))}${r.q.stem.length > 80 ? '…' : ''}</summary>
              <div class="review-body">
                <div class="q-stem">${richText(r.q.stem)}</div>
                ${aimHtml(r.q)}
                <ul class="review-opts">
                  ${r.order.map((oi, pos) => {
                    const o = r.q.options[oi];
                    const chosen = r.chosen.includes(oi);
                    const cls = isSelectAll(r.q) ? (shouldSelect(r.q, o) === chosen ? 'judge-ok' : 'judge-miss') : (o.correct ? 'is-correct' : 'is-wrong');
                    return `<li class="${cls} ${chosen ? 'was-chosen' : ''}">
                      <div><b>${LETTERS[pos]}.</b> ${richText(o.text)}</div>
                      <div class="small">${optionTags(r.q, o, chosen)}</div>
                      <div class="small muted">${richText(o.why)}</div>
                    </li>`;
                  }).join('')}
                </ul>
                <div class="callout point"><b>ポイント</b>${Array.isArray(r.q.point) ? '' : '<br>'}${pointHtml(r.q.point)}</div>
                ${r.q.learn ? `<p class="small"><a href="${siteUrl(r.q.learn)}" target="_blank" rel="noopener">📖 関連する学習コンテンツ</a></p>` : ''}
              </div>
            </details>
          </li>`).join('')}
      </ol>
    </section>`;
  scrollTop();

  document.getElementById('again').addEventListener('click', renderSetup);
  const rw = document.getElementById('retry-wrong');
  if (rw) rw.addEventListener('click', () => startSession(shuffle(wrong.map((r) => r.q)), 0, session.flow));
  const same = document.getElementById('same');
  if (same) {
    same.addEventListener('click', () => startWith(load(`settings:${storeId}`, null) || { mode: 'all', level: 'all', count: 10, domains: exam.domains.map((d) => d.id) }));
    same.focus({ preventScroll: true }); // Enter ですぐに繰り返せる
  }
}

// ---------- 起動 ----------
async function main() {
  try {
    const exams = await loadData('exams.json');
    exam = exams[examId];
    if (!exam) throw new Error(`試験 ${examId} が見つかりません`);
    exam.domains.forEach((d) => { domainMap[d.id] = d; });
    questions = await loadData(dataFile);
    if (!setId) {
      try { hasChallenge = (await loadData(`${examId}-challenge.json`)).length > 0; } catch { hasChallenge = false; }
      hasPlus = Boolean(exam.plus); // プラスONEチェックがある試験だけ exams.json に "plus": true を書く
    }
    // 最難関：fact（記述が正しいか）と ask（何を選ぶか）から、選ぶべきかどうか（correct）を決める
    questions.forEach((q) => {
      if (isSelectAll(q)) q.options.forEach((o) => { o.correct = (q.ask === 'correct') === (o.fact === true); });
    });
    renderSetup();
    // ほかの端末の記録が入ったら、開始画面の件数を描き直す（解いている途中なら何もしない）
    startAutoSync(() => { if (document.getElementById('setup-form')) renderSetup(); });
  } catch (e) {
    app.innerHTML = `<div class="callout warn">問題を読み込めませんでした。${escapeHtml(e.message)}</div>`;
  }
}

main();
