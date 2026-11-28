// 記録の検証と合流。学習サイト側の assets/js/sync.js と同じ規則にそろえること。
//
// data = { v: 1, exams: { [examId]: {
//   resetAt: 数値（その時刻より前の記録は消したもの扱い）,
//   history: { [qid]: { attempts, correct, streak, wrongOnce, last } },
//   bookmarks: { [qid]: { on: 真偽, t: 時刻 } },
//   daily: { [端末ID]: { 'YYYY-MM-DD': { n: 解いた数, ok: 正解数, t: 時刻 } } },
//   challenges: [{ t: 時刻, sec: 制限時間（秒）, ok: 正解数, n: 解いた数 }],
// } } }

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_EXAMS = 20;
const MAX_ITEMS = 3000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DEVICES = 10;
const MAX_DAYS = 60;
const MAX_CHALLENGES = 60;

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
  out.daily = cleanDaily(e && e.daily);
  out.challenges = cleanChallenges(e && e.challenges);
  return out;
}

function cleanDaily(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  for (const [dev, days] of Object.entries(d).slice(0, MAX_DEVICES)) {
    if (!ID.test(dev) || !days || typeof days !== 'object') continue;
    const o = {};
    for (const [k, v] of Object.entries(days).sort().slice(-MAX_DAYS)) {
      if (!DAY.test(k) || !v || typeof v !== 'object') continue;
      o[k] = { n: num(v.n), ok: Math.min(num(v.ok), num(v.n)), t: num(v.t) };
    }
    out[dev] = o;
  }
  return out;
}

function cleanChallenges(c) {
  if (!Array.isArray(c)) return [];
  return c.slice(-MAX_CHALLENGES)
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({ t: num(x.t), sec: Math.min(num(x.sec), 3600), ok: num(x.ok), n: num(x.n) }));
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
  return { resetAt, history, bookmarks, daily: mergeDaily(a.daily, b.daily, resetAt), challenges: mergeChallenges(a.challenges, b.challenges, resetAt) };
}

// 毎日の数は端末ごと・日ごとに、多いほう（同じなら新しいほう）を残す。端末をまたいで足すのは表示のときだけ
function mergeDaily(a = {}, b = {}, resetAt = 0) {
  const out = {};
  for (const src of [a || {}, b || {}]) {
    for (const [dev, days] of Object.entries(src)) {
      for (const [k, v] of Object.entries(days || {})) {
        if ((v.t || 0) <= resetAt) continue;
        const o = (out[dev] ||= {});
        const cur = o[k];
        if (!cur || v.n > cur.n || (v.n === cur.n && v.t > cur.t)) o[k] = v;
      }
    }
  }
  return out;
}

// チャレンジは終えた時刻と制限時間で同じものを見分けて合わせ、古い順に最大60件
function mergeChallenges(a = [], b = [], resetAt = 0) {
  const seen = new Map();
  for (const x of [...(a || []), ...(b || [])]) {
    if ((x.t || 0) <= resetAt) continue;
    seen.set(`${x.t}-${x.sec}`, x);
  }
  return [...seen.values()].sort((p, q) => p.t - q.t).slice(-MAX_CHALLENGES);
}

function merge(a, b) {
  const out = { v: 1, exams: {} };
  const ids = new Set([...Object.keys(a.exams || {}), ...Object.keys(b.exams || {})]);
  for (const id of ids) out.exams[id] = mergeExam(a.exams[id], b.exams[id]);
  return out;
}

module.exports = { clean, merge };
