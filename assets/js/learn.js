// 学習ページ共通：図（SVG）の埋め込みと目次の生成
import './common.js';

// <figure class="diagram" data-src="../../assets/img/x.svg"> を、テーマの色に追従するインライン SVG にする
document.querySelectorAll('figure.diagram[data-src]').forEach(async (fig) => {
  try {
    const res = await fetch(fig.dataset.src);
    if (!res.ok) throw new Error(res.status);
    const svg = await res.text();
    if (!svg.trim().startsWith('<svg')) throw new Error('not svg');
    fig.insertAdjacentHTML('afterbegin', svg);
  } catch {
    fig.insertAdjacentHTML('afterbegin', '<p class="muted small">図を読み込めませんでした。</p>');
  }
});

// 目次：article 内の h2[id] から作る
const toc = document.getElementById('toc');
const heads = [...document.querySelectorAll('.prose h2[id]')];
if (toc && heads.length) {
  toc.innerHTML = `<p class="toc-title">このページの内容</p><ol>${heads.map((h) => `<li><a href="#${h.id}">${h.textContent}</a></li>`).join('')}</ol>`;
  const links = new Map([...toc.querySelectorAll('a')].map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        links.forEach((a) => a.removeAttribute('aria-current'));
        const a = links.get(e.target.id);
        if (a) a.setAttribute('aria-current', 'true');
      }
    });
  }, { rootMargin: '-10% 0px -80% 0px' });
  heads.forEach((h) => io.observe(h));
}
