// トップページ：試験カードの表示
import { loadData, escapeHtml } from './common.js';
import { getHistory, needsReview } from './store.js';

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

main();
