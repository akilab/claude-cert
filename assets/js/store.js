// localStorage の読み書き。プライベートモードなどで使えなくても動くようにする。
const PREFIX = 'claude-cert:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// 同期の対象になる記録が変わったら知らせる（assets/js/sync.js が受け取って送信する）
const SYNCED = /^(history|bookmarks|bookmark-log|reset|daily|challenges):/;

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    if (SYNCED.test(key)) window.dispatchEvent(new CustomEvent('claude-cert:changed', { detail: key }));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 保存できない環境では何もしない */
  }
}

// ----- 問題演習の記録 -----
// history[examId][questionId] = { attempts, correct, streak, last, wrongOnce }
// streak：連続正解数。2回続けて正解したら「間違えた問題」から外す。

const REVIEW_CLEAR_STREAK = 2;

export function getHistory(examId) {
  return load(`history:${examId}`, {});
}

export function recordAnswer(examId, qid, isCorrect) {
  const h = getHistory(examId);
  const r = h[qid] || { attempts: 0, correct: 0, streak: 0, wrongOnce: false };
  r.attempts += 1;
  if (isCorrect) {
    r.correct += 1;
    r.streak += 1;
  } else {
    r.streak = 0;
    r.wrongOnce = true;
  }
  r.last = Date.now();
  h[qid] = r;
  save(`history:${examId}`, h);
  return r;
}

export function needsReview(rec) {
  return !!rec && rec.wrongOnce && rec.streak < REVIEW_CLEAR_STREAK;
}

export function getBookmarks(examId) {
  return load(`bookmarks:${examId}`, []);
}

export function toggleBookmark(examId, qid) {
  const list = getBookmarks(examId);
  const i = list.indexOf(qid);
  if (i >= 0) list.splice(i, 1);
  else list.push(qid);
  // 外したことも端末間で同期できるように、付け外しの時刻を残す
  const log = load(`bookmark-log:${examId}`, {});
  log[qid] = { on: i < 0, t: Date.now() };
  save(`bookmark-log:${examId}`, log);
  save(`bookmarks:${examId}`, list);
  return i < 0;
}

export function resetExam(examId) {
  remove(`history:${examId}`);
  remove(`bookmarks:${examId}`);
  remove(`bookmark-log:${examId}`);
  remove(`best:${examId}`); // 制限時間ありの自己ベスト（この端末だけ）
  remove(`daily:${examId}`);
  remove(`challenges:${examId}`);
  // 同期しているほかの端末でも、この時刻より前の記録を消したものとして扱う
  save(`reset:${examId}`, Date.now());
}

// ----- 毎日の解答数と、制限時間ありのチャレンジの記録 -----
// daily[examId] = { [端末ID]: { 'YYYY-MM-DD': { n: 解いた数, ok: 正解数, t: 最後に更新した時刻 } } }
//   端末ごとに数え、同期では端末ごとに合流して、表示のときに合計する（同じ解答を二重に数えないため）。
// challenges[examId] = [{ t: 終えた時刻, sec: 制限時間（秒）, ok: 正解数, n: 解いた数 }]（新しい順ではなく古い順）
const DAILY_KEEP_DAYS = 45;
const CHALLENGES_KEEP = 60;

export function deviceId() {
  let id = load('device-id', null);
  if (!id) {
    try {
      id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b & 31]).join('');
    } catch {
      id = Math.random().toString(36).slice(2, 10);
    }
    save('device-id', id);
  }
  return id;
}

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function recordDaily(examId, isCorrect) {
  const all = load(`daily:${examId}`, {}) || {};
  const mine = (all[deviceId()] ||= {});
  const e = (mine[dayKey()] ||= { n: 0, ok: 0, t: 0 });
  e.n += 1;
  if (isCorrect) e.ok += 1;
  e.t = Date.now();
  const oldest = new Date();
  oldest.setDate(oldest.getDate() - DAILY_KEEP_DAYS);
  const cut = dayKey(oldest);
  for (const k of Object.keys(mine)) if (k < cut) delete mine[k];
  save(`daily:${examId}`, all);
}

// 日付ごとに、すべての端末の数を合計して返す：{ 'YYYY-MM-DD': { n, ok } }
export function getDaily(examId) {
  const out = {};
  for (const days of Object.values(load(`daily:${examId}`, {}) || {})) {
    for (const [k, e] of Object.entries(days || {})) {
      const o = (out[k] ||= { n: 0, ok: 0 });
      o.n += e.n || 0;
      o.ok += e.ok || 0;
    }
  }
  return out;
}

export function recordChallenge(examId, { sec, ok, n }) {
  const list = load(`challenges:${examId}`, []) || [];
  list.push({ t: Date.now(), sec, ok, n });
  save(`challenges:${examId}`, list.slice(-CHALLENGES_KEEP));
}

export function getChallenges(examId) {
  return (load(`challenges:${examId}`, []) || []).slice().sort((a, b) => a.t - b.t);
}
