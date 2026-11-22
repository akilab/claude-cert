// 全ページ共通：テーマ切り替えとデータの読み込み
import { load, save } from './store.js';

const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: '🌓 自動', light: '☀️ ライト', dark: '🌙 ダーク' };

function applyTheme(theme) {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-toggle').forEach((b) => {
    b.textContent = THEME_LABEL[theme];
    b.setAttribute('aria-label', `表示テーマ：${THEME_LABEL[theme]}（クリックで切り替え）`);
  });
}

export function initTheme() {
  let theme = load('theme', 'auto');
  if (!THEMES.includes(theme)) theme = 'auto';
  applyTheme(theme);
  document.querySelectorAll('.theme-toggle').forEach((b) => {
    b.addEventListener('click', () => {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      save('theme', theme);
      applyTheme(theme);
    });
  });
}

// assets/data/ 以下の JSON を読む（ページの深さに関係なく動く）
export async function loadData(name) {
  const url = new URL(`../data/${name}`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} を読み込めませんでした（HTTP ${res.status}）`);
  return res.json();
}

// サイトのルートからの相対パスを、現在のページから見たパスに変換する
export function siteUrl(path) {
  return new URL(`../../${path}`, import.meta.url).href;
}

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// 問題文や解説で使う簡易記法：`code` と **強調** と改行
const inlineText = (s) => escapeHtml(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// 「| a | b |」で始まる連続した行は表にする（2行目の |---| は見出しの区切り）
export function richText(s) {
  const lines = String(s ?? '').split('\n');
  const parts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\|.*\|$/.test(lines[i].trim())) { parts.push({ table: false, html: inlineText(lines[i]) }); continue; }
    const rows = [];
    while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows.push(lines[i].trim()); i += 1; }
    i -= 1;
    const cells = (row) => row.slice(1, -1).split('|').map((c) => inlineText(c.trim()));
    const hasHead = rows.length > 1 && /^\|[\s:|-]+\|$/.test(rows[1]);
    const head = hasHead ? `<thead><tr>${cells(rows[0]).map((c) => `<th>${c}</th>`).join('')}</tr></thead>` : '';
    const body = (hasHead ? rows.slice(2) : rows).map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    parts.push({ table: true, html: `<div class="table-wrap"><table class="rich-table">${head}<tbody>${body}</tbody></table></div>` });
  }
  return parts.map((p, i) => (i > 0 && !p.table && !parts[i - 1].table ? '<br>' : '') + p.html).join('');
}

// 確認ダイアログ（confirm）はブラウザによって表示されないことがあるため、
// 「もう一度押すと実行」の2段階のボタンで確認する。
export function confirmClick(button, label, action, ms = 4000) {
  const original = button.textContent;
  let armed = false;
  let timer = null;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = label;
      button.classList.add('armed');
      timer = setTimeout(() => {
        armed = false;
        button.textContent = original;
        button.classList.remove('armed');
      }, ms);
      return;
    }
    clearTimeout(timer);
    armed = false;
    button.textContent = original;
    button.classList.remove('armed');
    action();
  });
}

initTheme();
