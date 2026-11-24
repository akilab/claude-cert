// 記録の検証と合流。学習サイト側の assets/js/sync.js と同じ規則にそろえること。
//
// data = { v: 1, exams: { [examId]: {
//   resetAt: 数値（その時刻より前の記録は消したもの扱い）,
//   history: { [qid]: { attempts, correct, streak, wrongOnce, last } },
//   bookmarks: { [qid]: { on: 真偽, t: 時刻 } },
// } } }

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_EXAMS = 20;
const MAX_ITEMS = 3000;

const num = (x) => (Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);

function cleanExam(e) {
  const out = { resetAt: num(e && e.resetAt), history: {}, bookmarks: {} };
  const h = (e && typeof e.history === 'object' && e.history) || {};
  for (const [qid, r] of Object.entries(h).slice(0, MAX_ITEMS)) {
    if (!ID.test(qid) || !r || typeof r !== 'object') continue;
    out.history[qid] = {
      attempts: num(r.attempts), correct: num(r.correct), streak: num(r.streak),
      wrongOnce: r.wrongOnce === true, last: num(r.last),
    };
  }
  const b = (e && typeof e.bookmarks === 'object' && e.bookmarks) || {};
  for (const [qid, m] of Object.entries(b).slice(0, MAX_ITEMS)) {
    if (!ID.test(qid) || !m || typeof m !== 'object') continue;
    out.bookmarks[qid] = { on: m.on === true, t: num(m.t) };
  }
  return out;
}

function clean(data) {
  const out = { v: 1, exams: {} };
  const ex = (data && typeof data.exams === 'object' && data.exams) || {};
  for (const [id, e] of Object.entries(ex).slice(0, MAX_EXAMS)) {
    if (ID.test(id)) out.exams[id] = cleanExam(e);
  }
  return out;
}

function mergeExam(a = { resetAt: 0, history: {}, bookmarks: {} }, b = { resetAt: 0, history: {}, bookmarks: {} }) {
  const resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
  const history = {};
  for (const src of [a.history || {}, b.history || {}]) {
    for (const [qid, r] of Object.entries(src)) {
      if (r.last <= resetAt) continue;
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

function merge(a, b) {
  const out = { v: 1, exams: {} };
  const ids = new Set([...Object.keys(a.exams || {}), ...Object.keys(b.exams || {})]);
  for (const id of ids) out.exams[id] = mergeExam(a.exams[id], b.exams[id]);
  return out;
}

module.exports = { clean, merge };
