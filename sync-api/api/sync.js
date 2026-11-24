// POST /api/sync  { code, data } → { data: 合流した記録 }
// 合言葉（code）ごとに記録を Upstash Redis に保存する。ログインはなく、合言葉を知っている人だけが読み書きできる。
const { clean, merge } = require('../lib/merge');

const ALLOWED_ORIGINS = ['https://akilab.github.io', 'http://localhost:8765'];
const CODE = /^[a-z2-9]{16}$/;          // 合言葉：区切りの「-」を除いた16文字
const MAX_BYTES = 64 * 1024;            // 1件の上限
const TTL_SECONDS = 180 * 24 * 60 * 60; // 180日使われなければ消える
const RATE_PER_MIN = 30;                // 同じ IP からの1分あたりの上限

// Vercel のマーケットプレイスでつなぐと KV_REST_API_*、Upstash から直接つなぐと UPSTASH_REDIS_REST_* が入る
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const out = await res.json();
  return out.map((r) => {
    if (r.error) throw new Error(`redis ${r.error}`);
    return r.result;
  });
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST だけを受け付けます' });
  if (!ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: '学習サイト以外からは使えません' });
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: '保存場所（Redis）がつながっていません' });

  try {
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const minute = Math.floor(Date.now() / 60000);
    const [count] = await redis([['INCR', `rl:${ip}:${minute}`], ['EXPIRE', `rl:${ip}:${minute}`, '120']]);
    if (count > RATE_PER_MIN) return res.status(429).json({ error: '短時間に送りすぎです。少し待ってください' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: '本文が JSON ではありません' });
    const code = String(body.code || '').replace(/-/g, '').toLowerCase();
    if (!CODE.test(code)) return res.status(400).json({ error: '合言葉の形が正しくありません' });
    if (JSON.stringify(body.data || {}).length > MAX_BYTES) return res.status(413).json({ error: '記録が大きすぎます' });

    const key = `sync:${code}`;
    const [stored] = await redis([['GET', key]]);
    const merged = merge(stored ? clean(JSON.parse(stored)) : { v: 1, exams: {} }, clean(body.data));
    const text = JSON.stringify(merged);
    if (text.length > MAX_BYTES) return res.status(413).json({ error: '記録が大きすぎます' });
    await redis([['SET', key, text, 'EX', String(TTL_SECONDS)]]);
    return res.status(200).json({ data: merged });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '保存場所との通信に失敗しました' });
  }
};
