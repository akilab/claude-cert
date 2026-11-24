// トップページ：試験カードの表示
import { loadData, escapeHtml } from './common.js';
import { getHistory, needsReview } from './store.js';
import {
  SYNC_URL, newCode, formatCode, normalizeCode, getCode, setCode, clearCode, getStatus, syncNow,
} from './sync.js';

function weightBars(domains) {
  const max = Math.max(...domains.map((d) => d.weight));
  return domains
    .map((d) => `<div class="weight-row">
        <span class="label">${escapeHtml(d.ja)}</span>
        <span class="num">${d.weight}%</span>
        <span class="track"><i style="width:${(d.weight / max) * 100}%"></i></span>
      </div>`)
    .join('');
}

function progress(examId, total) {
  const h = getHistory(examId);
  const ids = Object.keys(h);
  const answered = ids.length;
  const review = ids.filter((id) => needsReview(h[id])).length;
  let att = 0;
  let cor = 0;
  ids.forEach((id) => { att += h[id].attempts; cor += h[id].correct; });
  const rate = att ? Math.round((cor / att) * 100) + '%' : '—';
  return `<div class="exam-progress" aria-label="これまでの記録">
      <div><b>${answered}<small>/${total}</small></b><span>解いた問題</span></div>
      <div><b>${rate}</b><span>正答率</span></div>
      <div><b>${review}</b><span>復習が必要</span></div>
    </div>`;
}

async function main() {
  const grid = document.getElementById('exam-grid');
  try {
    const exams = await loadData('exams.json');
    const cards = await Promise.all(Object.entries(exams).map(async ([id, ex]) => {
      let total = 0;
      try { total = (await loadData(`${id}.json`)).length; } catch { /* 問題データがまだない */ }
      let challenge = 0;
      try { challenge = (await loadData(`${id}-challenge.json`)).length; } catch { /* 最難関はまだない */ }
      return `<article class="card exam-card">
        <header>
          <span class="code">${ex.code}</span>
          <h3>${escapeHtml(ex.nameJa)}</h3>
        </header>
        <p class="muted small" style="margin:0">${escapeHtml(ex.summary)}</p>
        <div class="facts">
          <span class="badge">本番 ${ex.items}問</span>
          <span class="badge">${ex.minutes}分</span>
          <span class="badge">合格 720/1000</span>
          <span class="badge">${ex.fee}</span>
        </div>
        <div class="weights" aria-label="分野ごとの配点">${weightBars(ex.domains)}</div>
        ${progress(id, total)}
        <div class="exam-actions">
          <a class="btn primary" href="${id}/exercises.html">問題演習を始める</a>
          <a class="btn" href="${id}/learn/">学習コンテンツ</a>
          ${challenge ? `<a class="btn challenge" href="${id}/challenge.html">最難関演習（${challenge}問）</a>` : ''}
        </div>
      </article>`;
    }));
    grid.innerHTML = cards.join('');
  } catch (e) {
    grid.innerHTML = `<p class="callout warn">データを読み込めませんでした。${escapeHtml(e.message)}</p>`;
  }
}

// ---------- 記録の同期 ----------
const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
const panel = document.getElementById('sync');
let notice = '';        // 操作の結果のメッセージ
let linkCode = null;    // QR コードのリンクで開いたときの合言葉（今の合言葉と違う場合）

const syncLink = (code) => `${location.origin}${location.pathname}#sync=${formatCode(code)}`;
const timeText = (t) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function statusText() {
  const st = getStatus();
  if (!st) return '';
  return st.ok
    ? `<p class="sync-status ok">最後の同期：${timeText(st.at)}</p>`
    : `<p class="sync-status ng">同期できませんでした（${timeText(st.at)}）：${escapeHtml(st.error)}</p>`;
}

function renderSync() {
  const code = getCode();
  const msg = notice ? `<p class="callout small">${escapeHtml(notice)}</p>` : '';
  if (linkCode && linkCode !== code) {
    panel.innerHTML = `<h2 id="h-sync" class="section-title">記録の同期</h2>${msg}
      <p>リンクの合言葉 <code class="sync-code">${formatCode(linkCode)}</code> に切り替えますか？この端末の記録は、切り替え先の記録と合わせて残ります。</p>
      <div class="sync-actions">
        <button type="button" class="btn primary" data-act="switch">切り替える</button>
        <button type="button" class="btn" data-act="keep">今のままにする</button>
      </div>`;
    return;
  }
  if (!code) {
    panel.innerHTML = `<h2 id="h-sync" class="section-title">記録の同期</h2>${msg}
      <p class="muted small">合言葉を設定すると、PC・スマホ・会社の端末など、ほかのブラウザと解答の記録とブックマークを共有できます。ログインは不要で、名前やメールアドレスは扱いません。</p>
      <div class="sync-actions">
        <button type="button" class="btn primary" data-act="start">この端末で同期を始める</button>
      </div>
      <form class="sync-join" id="sync-join">
        <label for="sync-input" class="small">ほかの端末で同期を始めている場合は、その合言葉を入力します</label>
        <div class="sync-join-row">
          <input id="sync-input" class="sync-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx-xxxx">
          <button type="submit" class="btn">つなぐ</button>
        </div>
      </form>`;
    return;
  }
  panel.innerHTML = `<h2 id="h-sync" class="section-title">記録の同期</h2>${msg}
    <p class="sync-code-row">合言葉 <code class="sync-code">${formatCode(code)}</code>
      <button type="button" class="btn small" data-act="copy">コピー</button></p>
    <p class="muted small">ほかの端末では、この合言葉を入力するか、QR コードをスマホのカメラで読み取ってください。合言葉を知っている人は記録を読み書きできるので、ほかの人には教えないでください。</p>
    <div class="sync-qr" id="sync-qr" hidden></div>
    <div class="sync-actions">
      <button type="button" class="btn primary" data-act="now">今すぐ同期</button>
      <button type="button" class="btn" data-act="qr">QR コードを表示</button>
      <button type="button" class="btn" data-act="stop">この端末の同期をやめる</button>
    </div>
    ${statusText()}`;
}

async function runSync(message) {
  notice = '';
  const r = await syncNow();
  notice = r.ok ? message || '' : '';
  renderSync();
  if (r.changed) main();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.QRCode) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('QR コードの部品を読み込めませんでした'));
    document.head.append(el);
  });
}

async function showQr() {
  const box = document.getElementById('sync-qr');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<p class="muted small">読み込み中…</p>';
  try {
    await loadScript(QR_LIB);
    const link = syncLink(getCode());
    box.innerHTML = '<div class="sync-qr-img"></div><p class="muted small">スマホのカメラで読み取ると、合言葉が入った状態でサイトが開きます。</p>';
    // 読み取りやすいよう、テーマに関係なく白地に黒で描く
    new window.QRCode(box.querySelector('.sync-qr-img'), { text: link, width: 168, height: 168, colorDark: '#000000', colorLight: '#ffffff' });
  } catch (e) {
    box.innerHTML = `<p class="callout warn small">${escapeHtml(e.message)}</p>`;
  }
}

function initSync() {
  if (!SYNC_URL) return;
  panel.hidden = false;
  // QR コードのリンク（#sync=合言葉）で開いたとき
  const m = /[#&]sync=([A-Za-z0-9-]+)/.exec(location.hash);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    const c = normalizeCode(m[1]);
    if (c && !getCode()) {
      setCode(c);
      notice = '合言葉を設定しました。';
    } else if (c && c !== getCode()) {
      linkCode = c;
    }
  }
  panel.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'start') { setCode(newCode()); notice = ''; renderSync(); runSync('同期を始めました。ほかの端末で、この合言葉を入力してください。'); }
    if (act === 'now') runSync('同期しました。');
    if (act === 'qr') showQr();
    if (act === 'stop') { clearCode(); notice = 'この端末の同期をやめました。記録はこの端末に残っています。'; renderSync(); }
    if (act === 'switch') { setCode(linkCode); linkCode = null; renderSync(); runSync('合言葉を切り替えて同期しました。'); }
    if (act === 'keep') { linkCode = null; notice = ''; renderSync(); }
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(formatCode(getCode())); notice = '合言葉をコピーしました。'; } catch { notice = 'コピーできませんでした。合言葉を書き写してください。'; }
      renderSync();
    }
  });
  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = normalizeCode(document.getElementById('sync-input').value);
    if (!c) { notice = '合言葉は英小文字と数字の16文字です（「-」はあってもなくてもかまいません）。'; renderSync(); return; }
    setCode(c);
    renderSync();
    runSync('つなぎました。ほかの端末の記録と合わせました。');
  });
  renderSync();
  if (getCode() && !linkCode) runSync('');
}

main();
initSync();
