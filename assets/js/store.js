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
const SYNCED = /^(history|bookmarks|bookmark-log|reset):/;

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
  // 同期しているほかの端末でも、この時刻より前の記録を消したものとして扱う
  save(`reset:${examId}`, Date.now());
}
