// 端末間の記録の同期（合言葉方式）。API は sync-api/（Vercel）にある。
// 合流の規則は sync-api/lib/merge.js と同じにすること。
import { load, save, remove } from './store.js';

// Vercel にデプロイした同期 API の URL。空にすると同期の画面を出さない。
export const SYNC_URL = 'https://claude-cert-sync-api.vercel.app/api/sync';

const PREFIX = 'claude-cert:';
const KEY = /^claude-cert:(history|bookmarks|bookmark-log|reset):(.+)$/;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 見間違えやすい l・o・0・1 を除いた32文字

// ---------- 合言葉 ----------
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => ALPHABET[b & 31]).join('');
}
export const formatCode = (c) => c.match(/.{1,4}/g).join('-');
export function normalizeCode(input) {
  const c = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^[a-z2-9]{16}$/.test(c) ? c : null;
}
export const getCode = () => load('sync-code', null);
export function setCode(code) { save('sync-code', code); remove('sync-status'); }
export function clearCode() { remove('sync-code'); remove('sync-status'); }
export const getStatus = () => load('sync-status', null);

// ---------- 合流 ----------
function mergeExam(a = {}, b = {}) {
  const resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
  const history = {};
  for (const src of [a.history || {}, b.history || {}]) {
    for (const [qid, r] of Object.entries(src)) {
      if ((r.last || 0) <= resetAt) continue;
      if (!history[qid] || r.last > history[qid].last) history[qid] = r;
    }
  }
  const bookmarks = {};
  for (const src of [a.bookmarks || {}, b.bookmarks || {}]) {
    for (const [qid, m] of Object.entries(src)) {
      if (m.t <= resetAt && m.on) continue;
      if (!bookmarks[qid] || m.t > bookmarks[qid].t) bookmarks[qid] = m;
    }
  }
  return { resetAt, history, bookmarks };
}

function examIds() {
  const ids = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const m = KEY.exec(localStorage.key(i) || '');
      if (m) ids.add(m[2]);
    }
  } catch { /* 保存できない環境 */ }
  return [...ids];
}

function localData() {
  const exams = {};
  for (const id of examIds()) {
    const list = load(`bookmarks:${id}`, []);
    const log = load(`bookmark-log:${id}`, {});
    const bookmarks = {};
    for (const [qid, m] of Object.entries(log)) if (!m.on && !list.includes(qid)) bookmarks[qid] = m;
    // 同期の前から付いていたブックマークは時刻がないので 0 とする
    for (const qid of list) bookmarks[qid] = { on: true, t: log[qid] && log[qid].on ? log[qid].t : 0 };
    exams[id] = { resetAt: load(`reset:${id}`, 0), history: load(`history:${id}`, {}), bookmarks };
  }
  return { v: 1, exams };
}

// 受け取った記録を、この端末の記録と合流させて保存する。変わったら true。
// 変更の通知（claude-cert:changed）を出さないよう、localStorage に直接書く。
function applyRemote(remote) {
  let changed = false;
  const write = (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch { /* 保存できない環境 */ } };
  const local = localData().exams;
  for (const [id, r] of Object.entries((remote && remote.exams) || {})) {
    const m = mergeExam(local[id], r);
    const oldHistory = load(`history:${id}`, {});
    const oldList = load(`bookmarks:${id}`, []);
    const on = Object.keys(m.bookmarks).filter((q) => m.bookmarks[q].on);
    const list = [...oldList.filter((q) => on.includes(q)), ...on.filter((q) => !oldList.includes(q))];
    if (JSON.stringify(oldHistory) !== JSON.stringify(m.history) || JSON.stringify(oldList) !== JSON.stringify(list)) changed = true;
    write(`history:${id}`, m.history);
    write(`bookmarks:${id}`, list);
    write(`bookmark-log:${id}`, m.bookmarks);
    if (m.resetAt) write(`reset:${id}`, m.resetAt);
  }
  return changed;
}

// ---------- 送受信 ----------
let running = null;
let again = false;

async function post(keepalive = false) {
  const res = await fetch(SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: getCode(), data: localData() }),
    keepalive,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.data;
}

// 今すぐ同期する。結果は { ok, changed, error }。同期中に呼ばれたら、終わってからもう1回行う。
export async function syncNow() {
  if (!SYNC_URL || !getCode()) return { ok: false, changed: false, error: '同期は設定されていません' };
  if (running) { again = true; return running; }
  running = (async () => {
    let changed = false;
    try {
      do {
        again = false;
        changed = applyRemote(await post()) || changed;
      } while (again);
      save('sync-status', { ok: true, at: Date.now() });
      return { ok: true, changed };
    } catch (e) {
      const error = e instanceof TypeError ? 'サーバーに接続できませんでした' : e.message;
      save('sync-status', { ok: false, at: Date.now(), error });
      return { ok: false, changed, error };
    } finally {
      running = null;
    }
  })();
  return running;
}

// ページを開いたときに同期し、記録が変わったら少し待って送る。
// onChanged：ほかの端末の記録が入って、この端末の記録が変わったときに呼ぶ（画面の描き直し用）。
export function startAutoSync(onChanged) {
  if (!SYNC_URL || !getCode()) return;
  let timer = null;
  const run = async () => {
    timer = null;
    const r = await syncNow();
    if (r.changed && onChanged) onChanged();
  };
  run();
  window.addEventListener('claude-cert:changed', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 3000);
  });
  // 送る前にページを閉じても届くようにする
  window.addEventListener('pagehide', () => {
    if (timer) { clearTimeout(timer); post(true).catch(() => {}); }
  });
}
