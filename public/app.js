'use strict';
const $ = s => document.querySelector(s);
const main = $('#main'), dialog = $('#dialog');
const kinds = {
  posts: {name: '博客', intro: '整理想法，写成完整的文章。', icon: 'post'},
  notes: {name: '笔记', intro: '记录想法，也整理值得反复阅读的知识。', icon: 'note'},
  projects: {name: '项目', intro: '做过的东西：工具、网站，以及还在路上的实验。', icon: 'project'},
  friends: {name: '友链', intro: '收录朋友的网站，保持彼此的连接。', icon: 'friends'},
  works: {name: '作品记录', intro: '记录看过、读过与玩过的作品。', icon: 'works'},
  bookmarks: {name: '收藏', intro: '保存文章、资源，以及再次打开它的理由。', icon: 'bookmark'}
};
const projectStatuses = ['进行中', '已完成', '归档'];
const categories = ['动画', '漫画', '游戏', '小说', '书籍', '影视'];
const workStatusLabels = {
  动画: {seen: '看过', watching: '在看', want: '想看'},
  影视: {seen: '看过', watching: '在看', want: '想看'},
  漫画: {seen: '读过', watching: '在读', want: '想读'},
  小说: {seen: '读过', watching: '在读', want: '想读'},
  书籍: {seen: '读过', watching: '在读', want: '想读'},
  游戏: {seen: '玩过', watching: '在玩', want: '想玩'}
};
const workCategoryAlias = {'动漫': '动画', '电影': '影视', '电视剧': '影视', '出版书籍': '书籍'};
function workCategory(work) { const category = (work && work.category) || ''; return workCategoryAlias[category] || category; }
function statusLabelsFor(category) { return workStatusLabels[category] || workStatusLabels['动画']; }
function workStatus(work) {
  const p = String(work.progress || '').trim();
  const labels = statusLabelsFor(workCategory(work));
  if (!p || p === labels.want) return 'want';
  if (p === labels.seen || /已看完|看完了|已通关|已读完|听完|已听过/.test(p)) return 'seen';
  return 'watching';
}
const iconPaths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  post: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8"/>',
  note: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
  project: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5h6v2M9 12h6M9 15h4"/>',
  renewal: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M18 17a7 7 0 0 1-12 1l-2-3"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6"/>',
  works: '<path d="M4 4v16M8 5v15M13 4l3 16M18 4l3 16"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  friends: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.note}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const date = value => { const d = new Date(value * 1000); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const excerpt = (value, length = 120) => window.markdownExcerpt(value, length);
function dateLabel(record, mode = 'publication') {
  const published = publicationTime(record);
  const updated = record?.updated;
  if (mode === 'updated' && updated != null) {
    return date(updated) !== date(published) ? `更新于 ${date(updated)}` : `发表于 ${date(published)}`;
  }
  return `发表于 ${date(published)}`;
}
function completeExcerpt(value, length = 120) {
  const source = String(window.markdownExcerpt(value, Math.max(length * 3, 300)) || '').replace(/…$/, '').trim();
  if (!source) return '';
  const chars = Array.from(source);
  if (chars.length <= length) return source;
  const sentences = source.match(/[^。！？!?；;]+[。！？!?；;]|[^。！？!?；;]+$/g) || [source];
  let result = '';
  for (const sentence of sentences) {
    const next = result + sentence;
    if (Array.from(next).length > length) break;
    result = next;
  }
  if (result.trim()) return result.trim() + (Array.from(result).length < chars.length ? '…' : '');
  return chars.slice(0, length).join('') + '…';
}
let authenticated = false;
let site = {profile: {name: 'RongGuang233', bio: '写下想法，记录生活中的喜欢。', avatar_url: null}, posts: [], notes: [], projects: [], friends: [], works: [], bookmarks: [], note_category_order: []};
let privateRecords = [], privateKind = 'posts', search = '', category = '', sort = 'updated', privateVisibility = '', routeVersion = 0, toastTimer;
let dialogHasChanges = () => false, pageHasChanges = () => false, pageIsBusy = () => false, currentUrl = location.href;
let leaveDecision = null, resolveLeave, dialogBeforeLeave = null;
let privateDrafts = [];
let cleanupReadingNavigation = () => {};
let cleanupAboutNavigation = () => {};
const formValues = form => JSON.stringify([...new FormData(form)]);
const hasChanges = () => (dialog.open && dialogHasChanges()) || pageHasChanges();
async function canLeave() {
  if ((dialog.open && $('#save').disabled) || pageIsBusy()) { toast('正在保存或处理图片，请稍候。'); return false; }
  if (leaveDecision) return false;
  if (dialog.open && dialogBeforeLeave && !await dialogBeforeLeave()) return false;
  if (!hasChanges()) return true;
  leaveDecision = new Promise(resolve => { resolveLeave = resolve; });
  $('#leave-dialog').showModal();
  return leaveDecision;
}
function finishLeave(discard) { $('#leave-dialog').close(); resolveLeave?.(discard); leaveDecision = null; resolveLeave = null; }
$('#keep-editing').onclick = () => finishLeave(false);
$('#discard-changes').onclick = () => finishLeave(true);
$('#leave-dialog').addEventListener('cancel', event => { event.preventDefault(); finishLeave(false); });
const markdown = text => window.renderMarkdown(text);
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; toastTimer = setTimeout(() => $('#toast').textContent = '', 4000); }
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, {method, headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '请求失败，请稍后重试'); error.status = response.status; throw error; }
  return result;
}
function theme(value, persist = true) {
  document.documentElement.dataset.theme = value;
  if (persist) {
    try { localStorage.setItem('appearance', value); } catch {}
    delete document.documentElement.dataset.themeSource;
  }
  const toggle = $('#theme-toggle');
  if (!toggle) return;
  toggle.textContent = value === 'dark' ? '☀' : '☾';
  toggle.setAttribute('aria-label', value === 'dark' ? '切换浅色外观' : '切换深色外观');
  toggle.title = toggle.getAttribute('aria-label');
}
function storedTheme() {
  try { const value = localStorage.getItem('appearance'); return value === 'dark' || value === 'light' ? value : null; } catch { return null; }
}
const systemTheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
// theme-init.js already painted the right theme; this only syncs the toggle and follows the system.
const initialTheme = document.documentElement.dataset.theme;
theme(initialTheme === 'dark' || initialTheme === 'light' ? initialTheme : (storedTheme() || (systemTheme?.matches ? 'dark' : 'light')), false);
systemTheme?.addEventListener('change', () => { if (!storedTheme()) theme(systemTheme.matches ? 'dark' : 'light', false); });
$('#theme-toggle').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#search-toggle').onclick = () => go(document.body.dataset.section === 'notes' ? 'search?type=notes' : 'search');
function go(route) { if (routeFromLocation() === route) renderRoute(); else location.hash = route; }
function avatarMarkup(profile, label = '个人头像') { return `<div class="avatar">${profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="${esc(label)}">` : '<span aria-label="默认 RG 头像">RG</span>'}</div>`; }
function publicLayout(content, reading = false) { main.innerHTML = `${reading ? '<div class="reading-progress" id="reading-progress" aria-hidden="true"><span></span></div>' : ''}<div class="layout public-layout${reading ? ' reading-layout' : ''}"><section class="content">${content}</section></div><button type="button" class="back-top" id="back-top" hidden aria-label="回到顶部">↑</button>`; bindCoverImages(main); const top = $('#back-top'), progress = $('#reading-progress span'); if (top || progress) { const sync = () => { if (top) top.hidden = window.scrollY < 480; if (progress) { const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight); progress.style.transform = `scaleX(${Math.min(1, Math.max(0, window.scrollY / max))})`; } }; window.onscroll = sync; window.onresize = sync; sync(); if (top) top.onclick = () => window.scrollTo({top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); } }
function lightMark() { return '<svg class="light-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M8 29a12 12 0 0 1 24 0M20 3v7M4 13l5 4M36 13l-5 4M3 29h34M12 34h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; }
function ownerMenu() {
  if (!authenticated) return '';
  return `<details class="owner-menu"><summary aria-label="写点什么"><span class="owner-menu-label">写点什么</span></summary><div class="owner-menu-items">${['posts','notes','projects','works'].map(kind => `<button type="button" data-create="${kind}">${kind === 'works' ? '记录作品' : kind === 'projects' ? '新增项目' : '写' + kinds[kind].name}</button>`).join('')}<a href="#private/drafts">继续草稿</a><a href="#private/posts">内容管理</a></div></details>`;
}
function updateClock() {
  const clock = $('#local-clock'); if (!clock) return;
  const now = new Date(); clock.dateTime = now.toISOString();
  clock.textContent = new Intl.DateTimeFormat('zh-CN', {hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
  $('#local-date').textContent = new Intl.DateTimeFormat('zh-CN', {month:'long',day:'numeric',weekday:'long'}).format(now);
}
setInterval(updateClock, 15000);
function heading(title, more = '') { return `<div class="heading"><h1>${esc(title)}</h1>${more}</div>`; }
function empty(title, detail = '') { return `<div class="empty"><h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ''}</div>`; }
function coverMarkup(record, type, eager = false) {
  // One tone per work category, so a library of placeholders still reads as a shelf.
  const category = typeof record.category === 'string' ? (workCategoryAlias[record.category] || record.category) : '';
  const index = categories.indexOf(category);
  const tone = index < 0 ? 0 : index;
  return `<div class="${type}-cover ${record.cover_url ? 'has-cover cover-tone-' + tone : 'cover-placeholder ' + (type === 'work' ? 'work-placeholder ' : '') + 'cover-tone-' + tone}">${record.cover_url ? `<img src="${esc(record.cover_url)}" alt="${esc(record.title)}的封面" loading="${eager ? 'eager' : 'lazy'}" decoding="async"><span class="cover-fallback" aria-hidden="true">${esc(Array.from(record.title || '作')[0])}</span>` : `<span class="cover-category">${esc(record.category || record.status || '文字与记录')}</span>${type === 'work' ? `<span class="cover-initial" aria-hidden="true">${esc(Array.from(record.title || '作')[0])}</span>` : `<span class="cover-title">${esc(record.title)}</span>`}<span class="cover-line" aria-hidden="true"></span>`}</div>`;
}
function bindCoverImages(root = document) {
  root.querySelectorAll('.has-cover img').forEach(img => {
    const show = () => {
      clearTimeout(timeoutId);
      img.classList.add('is-ready');
    };
    const fallbackToPlaceholder = () => {
      clearTimeout(timeoutId);
      if (!img.isConnected) return;
      const box = img.closest('.work-cover, .post-cover, .project-cover');
      img.remove();
      if (!box) return;
      box.classList.remove('has-cover');
      box.classList.add('cover-placeholder');
      if (box.classList.contains('work-cover')) box.classList.add('work-placeholder');
      if (!box.querySelector('.cover-category, .cover-title')) {
        const title = box.closest('.work-card, .similar-card, .blog-card')?.querySelector('h2, strong')?.textContent?.trim() || '';
        const category = box.closest('.work-card')?.querySelector('.work-meta > span')?.textContent?.trim() || '封面';
        const initial = Array.from(title || category || '作')[0];
        box.insertAdjacentHTML('beforeend', `<span class="cover-category">${esc(category)}</span><span class="cover-initial" aria-hidden="true">${esc(initial)}</span><span class="cover-line" aria-hidden="true"></span>`);
      }
      const fallback = box.querySelector('.cover-fallback');
      if (fallback) fallback.remove();
    };
    const timeoutId = setTimeout(() => {
      if (!img.complete || img.naturalWidth === 0) fallbackToPlaceholder();
    }, 3000);
    if (img.complete) {
      if (img.naturalWidth > 0) show();
      else fallbackToPlaceholder();
      return;
    }
    img.addEventListener('load', show, {once: true});
    img.addEventListener('error', fallbackToPlaceholder, {once: true});
  });
}
function openImageLightbox(image) {
  let lightbox = $('#image-lightbox');
  if (!lightbox) {
    lightbox = document.createElement('dialog');
    lightbox.id = 'image-lightbox';
    lightbox.className = 'image-lightbox';
    lightbox.setAttribute('aria-label', '图片预览');
    lightbox.innerHTML = '<button type="button" class="image-lightbox-close" aria-label="关闭图片">×</button><img alt=""><div class="image-lightbox-meta"><p></p><a class="image-lightbox-original" target="_blank" rel="noopener noreferrer">查看原图 ↗</a></div>';
    lightbox.addEventListener('click', event => { if (event.target === lightbox) lightbox.close(); });
    document.body.append(lightbox);
  }
  const preview = lightbox.querySelector('img');
  preview.src = image.currentSrc || image.src;
  preview.alt = image.alt || '放大图片';
  lightbox.querySelector('p').textContent = image.alt || '';
  lightbox.querySelector('.image-lightbox-original').href = preview.src;
  lightbox.querySelector('.image-lightbox-close').onclick = () => lightbox.close();
  if (!lightbox.open) lightbox.showModal();
}
document.addEventListener('click', event => {
  const image = event.target.closest('.reader .markdown img');
  if (!image || event.defaultPrevented) return;
  event.preventDefault();
  openImageLightbox(image);
});
function wordCount(value) {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/[>*_`~|]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  return Array.from(text).length;
}
function postCard(post, cover = false) {
  const count = wordCount(post.body);
  return `<article class="blog-card${post.cover_url ? ' illustrated-post' : ' text-post'}">${post.cover_url ? `<a class="cover-link" href="#read/posts/${post.id}" tabindex="-1" aria-hidden="true">${coverMarkup(post, 'post', cover)}</a>` : ''}<div class="blog-copy"><div class="article-meta">${postTags(post).length ? tagLinks(post) : '<span class="tag">博客</span>'}<time>${dateLabel(post)}</time>${count ? `<span class="article-count">${count.toLocaleString('zh-CN')} 字</span>` : ''}${post.pinned ? '<span class="tag pin-tag">置顶</span>' : ''}</div><h2><a class="blog-title" href="#read/posts/${post.id}">${esc(post.title)}</a></h2><p class="summary">${esc(completeExcerpt(post.summary || post.body))}</p><a class="read-link" href="#read/posts/${post.id}">阅读全文 ↗</a></div></article>`;
}
function postCollectionMarkup(rows, cover = false) {
  const pinned = rows.filter(row => row.pinned);
  const regular = rows.filter(row => !row.pinned);
  const cards = values => values.map((post, index) => postCard(post, cover && index === 0)).join('');
  if (!pinned.length) return cards(regular);
  const group = (title, values) => `<section class="note-recent blog-post-group"><div class="note-section-heading"><h2>${title}</h2><span>${values.length} 篇</span></div>${cards(values)}</section>`;
  return group('置顶文章', pinned) + (regular.length ? group('全部文章', regular) : '');
}
function noteTags(record) { return [...new Set(String(record.tags || '').split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))]; }
function noteCategory(record) { return String(record.category || '').trim(); }
function noteOrder(record) { const value = Number(record.order); return Number.isInteger(value) && value > 0 ? value : Number.POSITIVE_INFINITY; }
function noteChapterRank(record) {
  const title = String(record.title || '');
  const chapter = title.match(/第\s*(\d+)\s*[章讲节部课]/) || title.match(/^(\d+)\s*[.、．]/);
  return chapter ? Number(chapter[1]) : null;
}
function compareNoteOrder(a,b) {
  const manual = noteOrder(a) - noteOrder(b);
  if (manual) return manual;
  const rankA = noteChapterRank(a), rankB = noteChapterRank(b);
  if (rankA != null && rankB != null && rankA !== rankB) return rankA - rankB;
  if ((rankA == null) !== (rankB == null)) return rankA == null ? 1 : -1;
  return publicationTime(b) - publicationTime(a) || b.id - a.id;
}
function noteCategories(rows = publicNotes()) {
  const values = [...new Set(rows.map(noteCategory).filter(Boolean))];
  const order = Array.isArray(site.note_category_order) ? site.note_category_order : [];
  const fallback = values.slice().sort((a, b) => a.localeCompare(b, 'zh-CN') || a.localeCompare(b));
  const fallbackIndex = new Map(fallback.map((value, index) => [value, index]));
  return values.sort((a,b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return fallbackIndex.get(a) - fallbackIndex.get(b);
  });
}
function noteCategoryLink(record) { return noteCategory(record) ? `<a class="tag category-link" href="#notes?${esc(new URLSearchParams({category:noteCategory(record)}).toString())}">${esc(noteCategory(record))}</a>` : ''; }
function noteTagLinks(record, limit = Infinity) { return noteTags(record).slice(0, limit).map(tag => `<a class="tag topic-link" href="#notes?${esc(new URLSearchParams({tag}).toString())}">${esc(tag)}</a>`).join(''); }
function noteComparableText(note) { return String(note.body || '').replace(/(!\[[^\]]*\]\()[^)]*(\))/g, '$1$2'); }
function publicNotes() {
  const selected = new Map();
  const images = note => new Set([...String(note.body || '').matchAll(/\/media\/([a-f0-9]{32})\.jpg/g)].map(match => match[1]).filter(id => site.note_image_sizes?.[id])).size;
  for (const note of site.notes) {
    const body = noteComparableText(note);
    const key = JSON.stringify([String(note.title || '').trim(), noteCategory(note), body || note.id]);
    const previous = selected.get(key);
    if (!previous || images(note) > images(previous) || (images(note) === images(previous) && (publicationTime(note) > publicationTime(previous) || (publicationTime(note) === publicationTime(previous) && note.id > previous.id)))) selected.set(key, note);
  }
  return [...selected.values()];
}
function noteDuplicateDetail(note) {
  const peers = publicNotes().filter(row => String(row.title || '').trim() === String(note.title || '').trim() && noteCategory(row) === noteCategory(note));
  if (peers.length < 2) return null;
  return {label: `${date(publicationTime(note))} 发布`};
}
function noteSummary(note, length = 72) {
  let source = String(note.summary || note.body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*|[（(]\d+[）)]\s*|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯]\s*)/gm, '')
    .replace(/[|*_`>#~]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。；、：,:;、])\s*/g, '$1')
    .replace(/([，。；、：])\1+/g, '$1');
  // 公式被抽掉后，中文之间会留下空洞（如「在 处」），这里压回去
  for (let i = 0; i < 3; i += 1) {
    source = source.replace(/([一-鿿　-〿＀-￯])[\s]+(?=[一-鿿　-〿＀-￯])/g, '$1');
  }
  source = source.replace(/\s+([，。；、：,:;、])/g, '$1').replace(/([，。；、：])\s+/g, '$1').trim();
  if (!source) return noteCategory(note) ? `${noteCategory(note)}笔记` : '打开查看完整内容';
  return Array.from(source).slice(0, length).join('') + (Array.from(source).length > length ? '…' : '');
}
function articleBodyMarkup(row, kind = '') {
  let body = String(row.body || '');
  const title = String(row.title || '').trim();
  if (title) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`^[ \\t]{0,3}#[ \\t]+${escaped}(?:[ \\t]+#+)?[ \\t]*\\r?$`, 'm'), '');
  }
  const html = markdown(body);
  if (kind !== 'notes') return html;
  const levels = [...html.matchAll(/<h([2-6])>/g)].map(match => Number(match[1]));
  const offset = levels.length ? Math.min(...levels) - 2 : 0;
  return offset ? html.replace(/<(\/?)h([2-6])>/g, (_, closing, level) => `<${closing}h${Number(level) - offset}>`) : html;
}
function noteCard(note) { return `<article class="note note-list-item"><div class="note-date">${icon('note')}<time>${dateLabel(note)}</time>${noteCategoryLink(note)}${noteTags(note).length ? `<span class="note-topics">${noteTagLinks(note, 3)}</span>` : ''}</div><div class="note-card-heading"><h2><a href="#read/notes/${note.id}">${esc(note.title)}</a></h2><a class="note-card-arrow" href="#read/notes/${note.id}" aria-label="阅读笔记" aria-hidden="true">↗</a></div><p class="summary note-summary">${esc(noteSummary(note))}</p></article>`; }
function compactNote(note) { return `<a class="note compact-note" href="#read/notes/${note.id}"><span class="note-date">${icon('note')}<time>${date(publicationTime(note))}</time></span><h3>${esc(note.title)}</h3><p>${esc(excerpt(note.body, 130))}</p><span class="note-more">读这条笔记 ↗</span></a>`; }
function ratingMarkup(value) {
  const label = value == null ? '未评分' : `评分：${value}分，满分10分`;
  const star = '<svg viewBox="0 0 24 24" focusable="false"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z"/></svg>';
  const stars = Array.from({ length: 5 }, (_, index) => {
    const fill = Math.max(0, Math.min(1, (value ?? 0) / 2 - index)) * 100;
    return `<span class="rating-star">${star}<span class="rating-star-fill" style="width:${fill}%">${star}</span></span>`;
  }).join('');
  return `<span class="star-rating${value == null ? ' unrated' : ''}" role="img" aria-label="${esc(label)}"><span class="rating-stars" aria-hidden="true">${stars}</span><span class="rating-value" aria-hidden="true">${value == null ? '未评分' : esc(value)}</span></span>`;
}
function workCard(work, managed = false) {
  const cover = coverMarkup(work, 'work');
  const progressText = String(work.progress || '').trim();
  const labels = statusLabelsFor(workCategory(work));
  const isDoneStatus = !progressText || progressText === labels.seen || progressText === '已看完' || workStatus(work) === 'seen';
  const showProgress = managed || (progressText && !isDoneStatus);
  const title = esc(work.title);
  const categoryHidden = (site.hidden_work_categories || []).includes(workCategory(work));
  return `<article class="work-card">${managed ? cover : `<a class="cover-link" href="#read/works/${work.id}" tabindex="-1" aria-hidden="true">${cover}</a>`}<div class="work-copy"><div class="work-meta"><span>${esc(work.category)}</span>${ratingMarkup(work.rating)}</div><h2>${managed ? title : `<a href="#read/works/${work.id}" title="${title}">${title}</a>`}</h2>${showProgress ? `<p class="work-progress">${esc(progressText || '未填写进度')}</p>` : ''}${work.notes ? `<p class="work-review">${esc(excerpt(work.notes, 120))}</p>` : ''}${managed ? `<span class="visibility ${work.published && !categoryHidden ? '' : 'private'}">${categoryHidden ? '分类已隐藏' : work.published ? '已公开' : '仅自己可见'}</span><div class="work-actions"><button data-edit="${work.id}">编辑</button><button data-delete="${work.id}">删除</button></div>` : ''}</div></article>`;
}
function friendCard(friend) { const host = new URL(friend.url).hostname; return `<a class="friend" href="${esc(friend.url)}" target="_blank" rel="noreferrer"><span class="friend-avatar">${friend.avatar_url ? `<img src="${esc(friend.avatar_url)}" alt="" loading="lazy">` : esc(Array.from(friend.title)[0] || '友')}</span><span class="friend-info"><span class="friend-title">${esc(friend.title)} <span aria-hidden="true">↗</span></span><span class="friend-desc">${esc(friend.notes || '个人网站')}</span><span class="friend-domain">${esc(host)}</span></span></a>`; }
function projectTags(record) { return postTags(record); }
function projectTagLinks(record) { return projectTags(record).map(tag => `<a class="tag topic-link" href="#projects?${esc(new URLSearchParams({tag}).toString())}">${esc(tag)}</a>`).join(''); }
function filteredProjects(params) {
  const tag = params.get('tag') || '';
  return site.projects.filter(row => !tag || projectTags(row).includes(tag)).sort((a,b) => Number(!!b.featured)-Number(!!a.featured) || publicationTime(b)-publicationTime(a) || b.id-a.id);
}
function projectCard(project, managed = false) {
  const status = project.status || '进行中';
  const tone = status === '已完成' ? 'done' : status === '归档' ? 'archived' : 'active';
  const links = [project.repo_url ? `<a class="project-link" href="${esc(project.repo_url)}" target="_blank" rel="noreferrer">仓库 ↗</a>` : '', project.demo_url ? `<a class="project-link" href="${esc(project.demo_url)}" target="_blank" rel="noreferrer">演示 ↗</a>` : ''].filter(Boolean).join('');
  const tags = projectTags(project).slice(0, 4).map(tag => `<span class="tag">${esc(tag)}</span>`).join('');
  return `<article class="project-card">${managed ? coverMarkup(project, 'project') : `<a class="cover-link" href="#read/projects/${project.id}" tabindex="-1" aria-hidden="true">${coverMarkup(project, 'project')}</a>`}<div class="project-copy"><div class="project-meta"><span class="project-status tone-${tone}">${esc(status)}</span><time>${dateLabel(project)}</time></div><h2>${managed ? esc(project.title) : `<a href="#read/projects/${project.id}">${esc(project.title)}</a>`}</h2><p class="project-summary">${esc(excerpt(project.summary || project.body, 90))}</p><div class="project-bottom">${tags ? `<div class="project-tags">${tags}</div>` : ''}${managed ? `<div class="work-actions"><button data-edit="${project.id}">编辑</button><button data-delete="${project.id}">删除</button></div>` : links}</div></div></article>`;
}
function publicHome() {
  const profile = site.profile;
  const entries = ['posts','notes','projects','works','friends','bookmarks'].map(id => ({id,...kinds[id]}));
  const name = profile.name === 'RongGuang233' ? 'RongGuang<span>233</span>' : esc(profile.name);
  const byUpdated = (a,b) => b.updated-a.updated || b.id-a.id;
  const posts = [...site.posts].sort((a,b) => Number(!!b.pinned)-Number(!!a.pinned) || Number(!!b.featured)-Number(!!a.featured) || publicationTime(b)-publicationTime(a) || b.id-a.id).slice(0, 2);
  const notes = publicNotes().sort(byUpdated);
  const works = [...site.works].sort(byUpdated).slice(0, 2);
  const projects = [...site.projects].sort((a,b) => Number(!!b.featured)-Number(!!a.featured) || publicationTime(b)-publicationTime(a) || b.id-a.id).slice(0, 2);
  const categories = noteCategories(notes);
  let selectedCategory = categories.includes(history.state?.homeNoteCategory) ? history.state.homeNoteCategory : '';
  if (history.state?.homeNoteCategory && !selectedCategory) history.replaceState({...history.state, homeNoteCategory:''}, '', location.href);
  const reviewedWorks = site.works.filter(row => String(row.notes || '').trim());
  const otherPosts = site.posts.filter(row => !posts.some(item => item.id === row.id));
  const otherReviews = reviewedWorks.filter(row => !works.some(item => item.id === row.id));
  const randomChoices = {posts: otherPosts.length ? otherPosts : site.posts, works: otherReviews.length ? otherReviews : reviewedWorks};
  const randomMarkup = ['posts','works'].map(kind => {
    const label = kind === 'posts' ? 'Random Post' : 'Random Review';
    const available = randomChoices[kind].length > 0;
    const hint = kind === 'posts' ? (available ? '随机阅读一篇公开博客' : '暂无公开博客') : (available ? '随机阅读一条公开作品短评' : '暂无公开作品短评');
    return `<button type="button" data-home-random="${kind}" title="${hint}"${available ? '' : ' disabled'}>${label}</button>`;
  }).join('');
  const postMarkup = posts.map(row => {
    return `<a class="home-mid-item${row.pinned ? ' is-pinned' : ''}" data-kind="posts" href="#read/posts/${row.id}"><span class="meta">博客 · ${date(publicationTime(row))}${row.pinned ? '<span class="home-pin-label">置顶</span>' : ''}</span><strong>${esc(row.title)}</strong></a>`;
  }).join('');
  const noteMarkup = () => notes.filter(row => !selectedCategory || noteCategory(row) === selectedCategory).slice(0, 4).map(row => {
    return `<a class="home-mid-item" data-kind="notes" href="#read/notes/${row.id}"><span class="meta">笔记 · ${date(publicationTime(row))}</span><strong>${esc(row.title)}</strong></a>`;
  }).join('') || '<p class="home-empty">还没有公开笔记。</p>';
  const workMarkup = works.map(row => {
    const titleMarkup = String(row.title || '').split('·').map((part,index,parts) => `<span class="home-work-title-part">${esc(part)}${index < parts.length - 1 ? '·' : ''}</span>`).join('');
    return `<a class="recent-item${row.cover_url ? '' : ' without-cover'}" data-kind="works" href="#read/works/${row.id}" title="${esc(row.title)}">${row.cover_url ? `<img class="home-work-cover" src="${esc(row.cover_url)}" alt="《${esc(row.title)}》封面" width="88" height="124" decoding="async">` : `<span class="home-work-cover home-work-placeholder" aria-hidden="true">${icon('works')}</span>`}<div class="home-work-copy"><h3>${titleMarkup}</h3></div></a>`;
  }).join('');
  const projectMarkup = projects.map(row => {
    const toolIcon = /续费|订阅/.test(row.title) ? 'renewal' : /课时|课程/.test(row.title) ? 'calendar' : 'project';
    return `<a class="home-tool" href="#read/projects/${row.id}"><span class="home-tool-icon" aria-hidden="true">${icon(toolIcon)}</span><strong>${esc(row.title)}</strong></a>`;
  }).join('');
  const themeLabel = document.documentElement.dataset.theme === 'dark' ? '切换浅色外观' : '切换深色外观';
  main.innerHTML = `<div class="portal home-restored">
    <header class="portal-top"><a href="#home" class="small-brand">${lightMark()}<span class="brand-name brand-text">${name}</span></a><div class="portal-tools"><a href="#search">${icon('search')}<span>搜索</span></a><button type="button" id="home-theme-toggle" aria-label="${themeLabel}" title="${themeLabel}">${document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'}</button>${ownerMenu()}</div></header>
    <div class="portal-main">
      <section class="identity" id="home-profile" aria-labelledby="home-name"><div class="identity-cover"><img src="${esc(profile.background_url || '/cover.jpg')}" alt="" decoding="async"></div><div class="identity-copy"><div class="identity-avatar">${profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="${esc(profile.name)}的头像">` : '<span aria-label="默认 RG 头像">RG</span>'}</div><h1 id="home-name">${name}<span class="name-period" aria-hidden="true">.</span></h1>${profile.bio ? `<p class="identity-description">${esc(profile.bio)}</p>` : ''}</div></section>
      <nav class="portal-navigation" aria-label="网站栏目"><div class="portal-links">${entries.map(entry => `<a href="#${entry.id}" class="portal-link">${icon(entry.icon)}<strong>${entry.name}</strong></a>`).join('')}<a href="#about" class="portal-link">${icon('profile')}<strong>关于我</strong></a></div><a class="owner-entry" href="#private/posts">${icon('lock')}${authenticated ? '内容管理' : '私人空间'}</a></nav>
      <div class="home-feed-wrap"><section class="home-feed" aria-label="博客与笔记" tabindex="0">
      <section class="home-mid-list" aria-label="博客精选"><div class="home-mid-block"><h2 class="home-mid-label"><a class="home-section-link" href="#posts">博客精选</a></h2>${postMarkup || '<p class="home-empty">还没有公开博客。</p>'}</div></section>
      <section class="home-notes-section" aria-labelledby="home-notes-title"><div class="home-mid-heading"><h2 class="home-mid-label" id="home-notes-title"><a class="home-section-link" href="#notes">最近笔记</a></h2><div class="home-note-categories" role="group" aria-label="筛选首页笔记">${['', ...categories].map(category => `<button type="button" data-home-note-category="${esc(category)}" aria-pressed="${category === selectedCategory}" aria-controls="home-note-preview">${esc(category || '最近')}</button>`).join('')}</div></div><div class="home-note-grid" id="home-note-preview" aria-live="polite">${noteMarkup()}</div></section>
      </section><span class="home-feed-hint" aria-hidden="true" hidden>上下滑动</span></div>
      <aside class="portal-aside"><section class="clock-card" aria-label="本地时间"><div class="clock-label">此刻</div><time id="local-clock"></time><p id="local-date"></p></section><section class="home-side-panel" aria-label="作品与工具">${works.length ? `<section class="recent-card" aria-labelledby="home-works-title"><h2 class="navigation-caption" id="home-works-title"><a class="home-section-link" href="#works">最近作品记录</a></h2><div class="home-work-grid">${workMarkup}</div></section>` : ''}<div class="home-side-actions">${projects.length ? `<section class="home-tools-card" aria-labelledby="home-tools-title"><h2 class="navigation-caption" id="home-tools-title">我做的小工具</h2><div class="home-tool-list">${projectMarkup}</div></section>` : ''}<nav class="home-random" aria-label="随机探索">${randomMarkup}</nav></div></section></aside>
    </div>
    <footer class="portal-footer"><span>${esc(profile.name)} © ${new Date().getFullYear()}</span><span class="beian"><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">黔ICP备2026017181号-1</a><a href="https://beian.mps.gov.cn/" target="_blank" rel="noreferrer">贵公网安备52010202004633号</a></span></footer>
  </div>`;
  updateClock();
  const feed = main.querySelector('.home-feed'), feedWrap = main.querySelector('.home-feed-wrap'), feedHint = main.querySelector('.home-feed-hint');
  const syncFeedHint = () => {
    const scrollable = getComputedStyle(feed).overflowY !== 'visible' && feed.scrollHeight > feed.clientHeight + 1;
    feedWrap.classList.toggle('is-scrollable', scrollable);
    feedHint.hidden = !scrollable;
  };
  feed.addEventListener('scroll', syncFeedHint, {passive: true});
  feed.addEventListener('scroll', rememberPosition, {passive: true});
  const feedResize = new ResizeObserver(() => {
    if (!feed.isConnected) { feedResize.disconnect(); return; }
    syncFeedHint();
  });
  feedResize.observe(feed);
  syncFeedHint();
  const categoryButtons = main.querySelectorAll('[data-home-note-category]');
  categoryButtons.forEach(button => {
    button.onclick = () => {
      const category = button.dataset.homeNoteCategory;
      if (category === selectedCategory) return;
      selectedCategory = category;
      main.querySelector('#home-note-preview').innerHTML = noteMarkup();
      categoryButtons.forEach(item => item.setAttribute('aria-pressed', String(item.dataset.homeNoteCategory === category)));
      history.replaceState({...history.state, homeNoteCategory:category}, '', location.href);
      syncFeedHint();
      rememberPosition();
    };
  });
  main.querySelectorAll('[data-home-random]').forEach(button => {
    const kind = button.dataset.homeRandom;
    const choices = randomChoices[kind];
    if (!choices.length) return;
    button.onclick = () => {
      const row = choices[Math.floor(Math.random() * choices.length)];
      rememberPosition();
      pendingFrom = routeFromLocation();
      go(`read/${kind}/${row.id}`);
    };
  });
  const homeTheme = $('#home-theme-toggle');
  homeTheme.onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    theme(next);
    homeTheme.textContent = next === 'dark' ? '☀' : '☾';
    homeTheme.setAttribute('aria-label', next === 'dark' ? '切换浅色外观' : '切换深色外观');
    homeTheme.title = homeTheme.getAttribute('aria-label');
  };
}
function recordBody(record, kind) {
  return `${record.category ? `<p class="meta">${esc(record.category)} · ${esc(record.progress || '未填写进度')}</p>` : ''}${record.tags ? `<p class="tags"><span class="tag">${esc(record.tags)}</span></p>` : ''}${record.summary ? `<p class="summary">${esc(record.summary)}</p>` : ''}${record.body ? `<div class="markdown">${markdown(record.body)}</div>` : ''}${record.notes ? `<p class="notes-text">${esc(record.notes)}</p>` : ''}`;
}
function publicRecord(record, kind) { return `<article class="record"><div class="record-top"><h2>${record.url ? `<a href="${esc(record.url)}" target="_blank" rel="noreferrer">${esc(record.title)} ↗</a>` : esc(record.title)}</h2>${kind === 'works' ? `${ratingMarkup(record.rating)}` : ''}</div>${recordBody(record, kind)}<p class="meta">${date(record.updated)}</p></article>`; }
function knowledgeMapMarkup(rows) {
  const groups = new Map();
  rows.forEach(row => noteTags(row).forEach(tag => groups.set(tag, (groups.get(tag) || 0) + 1)));
  const entries = [...groups.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).slice(0, 8);
  const categoryGroups = new Map();
  rows.forEach(row => {
    const category = noteCategory(row) || '未分类';
    const entry = categoryGroups.get(category) || {count:0, latest:0};
    entry.count += 1; entry.latest = Math.max(entry.latest, row.updated);
    categoryGroups.set(category, entry);
  });
  const categoryEntries = noteCategories([...rows]).map(category => [category, categoryGroups.get(category)]).filter(([, entry]) => entry);
  if (categoryGroups.has('未分类')) categoryEntries.push(['未分类', categoryGroups.get('未分类')]);
  if (!categoryEntries.length && !entries.length) return `<section class="knowledge-map is-empty"><div><h2>还没有笔记分类</h2></div><a class="read-link" href="#private/notes">去添加分类 →</a></section>`;
  const categoryCards = categoryEntries.map(([category,entry], index) => {
    const target = category === '未分类' ? '#notes?uncategorized=1' : `#notes?${esc(new URLSearchParams({category}).toString())}`;
    return `<a class="knowledge-category-card tone-${index % 4}" href="${target}"><span class="knowledge-card-kicker">分类</span><strong>${esc(category)}</strong><span class="knowledge-card-count">${entry.count} 篇笔记</span><span class="knowledge-card-meta">最近更新 ${date(entry.latest)}</span></a>`;
  }).join('');
  const topicMarkup = entries.length ? `<div class="knowledge-topics"><span>主题</span>${entries.map(([tag,count]) => `<a href="#notes?${esc(new URLSearchParams({tag}).toString())}">${esc(tag)} <small>${count}</small></a>`).join('')}</div>` : '';
  return `<section class="knowledge-map"><div class="knowledge-heading"><div><h2>笔记分类</h2></div><span class="knowledge-total">${rows.length} 篇笔记</span></div><div class="knowledge-category-grid">${categoryCards}</div>${topicMarkup}</section>`;
}
function noteCompactRow(note, index = null, showCategory = true) {
  const detail = noteDuplicateDetail(note);
  const meta = [showCategory ? noteCategory(note) : '', detail ? '' : date(index === null ? note.updated : publicationTime(note))].filter(Boolean).join(' · ');
  const numbered = index !== null && !/第\s*\d+\s*[章讲节部课]/.test(String(note.title || ''));
  return `<a class="note-compact-row" href="#read/notes/${note.id}">${numbered ? `<span class="note-directory-index">${String(index).padStart(2, '0')}</span>` : ''}<span class="note-compact-copy"><strong>${esc(note.title)}${detail ? `<span class="note-edition-label">${esc(detail.label)}</span>` : ''}</strong>${meta ? `<small>${esc(meta)}</small>` : ''}</span><span class="note-compact-arrow" aria-hidden="true">→</span></a>`;
}
function noteRecentMarkup(rows) {
  const ordered = rows.slice().sort((a,b) => b.updated-a.updated || b.id-a.id);
  const recent = ordered.slice(0, 6);
  const more = ordered.length - recent.length;
  const countLabel = more > 0 ? `共 ${ordered.length} 篇 · 最近 ${recent.length} 篇` : `${ordered.length} 篇笔记`;
  return `<section class="note-recent"><div class="note-section-heading"><h2>最近更新</h2><span>${countLabel}</span></div>${recent.length ? `<div class="note-compact-list">${recent.map(note => noteCompactRow(note)).join('')}</div>${more > 0 ? `<p class="note-empty-hint">其余 ${more} 篇可从上方分类进入查看。</p>` : ''}` : '<p class="note-empty-hint">选择一个分类，开始整理你的笔记。</p>'}</section>`;
}
function noteDirectoryMarkup(rows, category, tag = '') {
  const title = category || (tag ? `主题：${tag}` : '笔记目录');
  const ordered = rows.slice().sort((a,b) => compareNoteOrder(a,b));
  return `<section class="note-directory"><div class="note-directory-heading"><div><p class="note-section-kicker">${category ? '分类目录' : '主题结果'}</p><h2>${esc(title)}</h2></div><span>${ordered.length} 篇</span></div>${ordered.length ? `<div class="note-directory-list">${ordered.map((note,index) => noteCompactRow(note,index+1,!category)).join('')}</div>` : '<p class="note-empty-hint">这个分类还没有公开笔记。</p>'}</section>`;
}
function noteCollectionBody(allRows, rows, category, tag = '') {
  // The category switcher above already shows where we are, so a category or topic
  // view must not repeat it with a second navigation row.
  if (category || tag) return `<section class="note-category-view">${noteDirectoryMarkup(rows, category, tag)}</section>`;
  return `${knowledgeMapMarkup(allRows)}${noteRecentMarkup(allRows)}`;
}
function contentOverviewMarkup(kind, rows) {
  if (kind === 'posts') {
    const topics = [...new Set(rows.flatMap(postTags))].slice(0, 8);
    return `<section class="collection-overview is-compact"><div class="collection-overview-line"><strong>${rows.length}</strong><span>篇文章</span>${rows.length ? `<span class="collection-dot">·</span><span>最近发布 ${date(Math.max(...rows.map(publicationTime)))}</span>` : ''}${topics.length ? `<span class="collection-dot">·</span><span class="collection-topics">${topics.map(tag => `<a href="#posts?${esc(new URLSearchParams({tag}).toString())}">${esc(tag)}</a>`).join('')}</span>` : ''}</div></section>`;
  }
  if (kind === 'projects') {
    const active = rows.filter(row => (row.status || '进行中') === '进行中').length;
    const completed = rows.filter(row => row.status === '已完成').length;
    const status = rows.length && completed === rows.length ? '全部已完成' : rows.length && active === rows.length ? '全部进行中' : `${active ? `${active} 个进行中` : ''}${active && completed ? ' · ' : ''}${completed ? `${completed} 个已完成` : ''}`;
    return `<section class="collection-overview is-compact project-overview"><div class="collection-overview-line"><strong>${rows.length}</strong><span>个项目</span>${status ? `<span class="collection-dot">·</span><span>${status}</span>` : ''}</div></section>`;
  }
  return '';
}
function filteredNotes(params) {
  const tag = params.get('tag') || '', category = params.get('category') || '';
  return publicNotes().filter(row => (!tag || noteTags(row).includes(tag)) && (params.get('uncategorized') !== '1' || !noteCategory(row)) && (!category || noteCategory(row) === category)).sort((a,b) => category || tag ? compareNoteOrder(a,b) : publicationTime(b)-publicationTime(a) || b.id-a.id);
}
function showCollection(kind) {
  if (kind === 'works') { showWorks(); return; }
  const tag = ['posts','notes','projects'].includes(kind) ? routeParams().get('tag') || '' : '';
  const noteCategoryFilter = kind === 'notes' ? routeParams().get('category') || '' : '';
  const rows = kind === 'posts' ? filteredPosts(routeParams()) : kind === 'notes' ? filteredNotes(routeParams()) : kind === 'projects' ? filteredProjects(routeParams()) : site[kind];
  const pagedKind = ['posts','projects'].includes(kind) || (kind === 'notes' && (tag || noteCategoryFilter || routeParams().get('uncategorized') === '1'));
  const pageSize = kind === 'posts' ? 10 : kind === 'projects' ? 12 : 20;
  const paged = pagedKind ? paginateRows(rows, pageFromParams(routeParams()), pageSize) : {items: rows, page: 1, totalPages: 1, total: rows.length, pageSize};
  const content = kind === 'posts' ? postCollectionMarkup(paged.items, paged.page === 1) : kind === 'notes' ? noteCollectionBody(publicNotes(), paged.items, noteCategoryFilter || (routeParams().get('uncategorized') === '1' ? '未分类' : ''), tag) : kind === 'projects' ? `<div class="project-grid">${paged.items.map(p => projectCard(p)).join('')}</div>` : kind === 'friends' ? `<div class="friend-grid">${rows.map(friendCard).join('')}</div>` : rows.map(r => publicRecord(r, kind)).join('');
  const pager = pagedKind ? paginationMarkup(paged.page, paged.totalPages) : '';
  const theme = kind === 'notes' ? '' : tag || noteCategoryFilter ? `<div class="topic-filter" role="status"><span>${noteCategoryFilter ? '分类' : '主题'}：<strong>${esc(noteCategoryFilter || tag)}</strong> · ${rows.length} 篇</span><a href="#${kind}" class="read-link">清除筛选</a></div>` : '';
  const overview = kind === 'notes' ? '' : contentOverviewMarkup(kind, rows);
  const intro = kind === 'notes' && pagedKind ? `<nav class="note-kind-pills" aria-label="笔记分类"><a href="#notes">全部</a>${noteCategories().map(value => `<a href="#notes?${esc(new URLSearchParams({category:value}).toString())}" ${value === noteCategoryFilter ? 'aria-current="page"' : ''}>${esc(value)}</a>`).join('')}</nav>` : '';
  publicLayout(heading(kinds[kind].name, `<div class="collection-tools"><a href="#search${kind === 'notes' ? '?type=notes' : ''}">搜索${kind === 'notes' ? '笔记' : ''}</a></div>`) + intro + overview + theme + (rows.length || kind === 'notes' ? content + pager : tag ? empty('这个主题还没有公开内容','可以清除主题筛选，查看其他内容。') : empty('还没有公开的' + kinds[kind].name, authenticated ? '可以在私人空间新增内容；默认公开，勾选“仅自己可见”后才设为私密。' : '稍后再来看看。')));
  if (pager) bindPagination(main, paged.page, next => {
    const values = {tag, category: noteCategoryFilter, uncategorized: routeParams().get('uncategorized') === '1' ? '1' : '', page: next > 1 ? next : ''};
    saveListParams(values);
    showCollection(kind);
    window.scrollTo({top: 0, behavior: 'instant'});
  });
}
function routeParams() { return new URLSearchParams(location.hash.split('?')[1] || ''); }
function pageFromParams(params) {
  const value = Number(params.get('page'));
  return Number.isInteger(value) && value > 0 ? value : 1;
}
function paginateRows(rows, page, pageSize) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return {items: rows.slice(start, start + pageSize), page: current, totalPages, total, pageSize};
}
function paginationMarkup(page, totalPages) {
  if (totalPages <= 1) return '';
  const pages = [];
  const push = value => { if (!pages.includes(value)) pages.push(value); };
  push(1);
  for (let value = page - 1; value <= page + 1; value += 1) if (value > 1 && value < totalPages) push(value);
  if (totalPages > 1) push(totalPages);
  pages.sort((a,b) => a-b);
  const items = [];
  let previous = 0;
  pages.forEach(value => {
    if (previous && value - previous > 1) items.push('<span class="pagination-gap" aria-hidden="true">…</span>');
    items.push(value === page ? `<span class="pagination-current" aria-current="page">${value}</span>` : `<button type="button" data-page="${value}">${value}</button>`);
    previous = value;
  });
  return `<nav class="pagination" aria-label="分页"><span class="pagination-label">第 ${page} / ${totalPages} 页</span><button type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>${items.join('')}<button type="button" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button></nav>`;
}
function bindPagination(root, page, onSelect) {
  root.querySelectorAll('[data-page]').forEach(button => {
    button.onclick = () => {
      const next = Number(button.dataset.page);
      if (!Number.isInteger(next) || next === page || next < 1) return;
      onSelect(next);
    };
  });
}
function saveListParams(values) {
  const params = new URLSearchParams();
  // Callers omit their own default sort, so every non-default choice survives reload and paging.
  Object.entries(values).forEach(([key,value]) => { if (value) params.set(key,value); });
  const route = location.hash.split('?')[0] || '#home';
  history.replaceState({...history.state, scrollY:window.scrollY}, '', route + (params.size ? '?' + params : ''));
  currentUrl = location.href;
}
function publicationTime(record) { return record.published_at ?? record.updated; }
function postTags(record) { return [...new Set(String(record.tags || '').split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))]; }
function tagLinks(record) { return postTags(record).map(tag => `<a class="tag topic-link" href="#posts?${esc(new URLSearchParams({tag}).toString())}">${esc(tag)}</a>`).join(''); }
function filteredPosts(params) {
  const tag = params.get('tag') || '';
  return site.posts.filter(row => !tag || postTags(row).includes(tag)).sort((a,b) => Number(!!b.pinned)-Number(!!a.pinned) || publicationTime(b)-publicationTime(a) || b.id-a.id);
}
function matchesVisibility(record, visibility) { return visibility === 'public' ? record.published === true : visibility === 'private' ? record.published !== true : true; }
function rememberedWorkCategory(record = {}) {
  const raw = typeof record.category === 'string' ? record.category : '';
  const fromRecord = workCategoryAlias[raw] || raw;
  if (categories.includes(fromRecord)) return fromRecord;
  const page = routeFromLocation().split('?')[0];
  const routeValue = (page === 'works' || page === 'private/works') ? (routeParams().get('category') || '') : '';
  const chosen = workCategoryAlias[routeValue] || routeValue;
  if (categories.includes(chosen)) return chosen;
  let last = '';
  try { last = localStorage.getItem('work-category-last') || ''; } catch {}
  return categories.includes(last) ? last : categories[0];
}
function workStatusSelect(category, statusKind) {
  const labels = statusLabelsFor(category);
  return `<select name="progress" data-category="${esc(category)}">${['want', 'watching', 'seen'].map(kind => `<option value="${esc(labels[kind])}" ${kind === statusKind ? 'selected' : ''}>${esc(labels[kind])}</option>`).join('')}</select>`;
}
// The three status verbs follow the chosen category, so switching 动画 → 游戏 offers 想玩/在玩/玩过.
function bindWorkStatusSelect(root) {
  const select = root.querySelector('select[name=progress]');
  const modules = root.querySelector('.category-modules');
  if (!select || !modules) return;
  modules.addEventListener('change', () => {
    const nextCategory = root.querySelector('input[name=category]:checked')?.value || categories[0];
    const previous = statusLabelsFor(select.dataset.category || categories[0]);
    const statusKind = select.value === previous.want ? 'want' : select.value === previous.seen ? 'seen' : 'watching';
    const labels = statusLabelsFor(nextCategory);
    select.dataset.category = nextCategory;
    select.innerHTML = ['want', 'watching', 'seen'].map(kind => `<option value="${esc(labels[kind])}" ${kind === statusKind ? 'selected' : ''}>${esc(labels[kind])}</option>`).join('');
  });
}
function newRecordDefaults(kind) {
  const page = routeFromLocation().split('?')[0];
  if (kind === 'works') {
    const category = rememberedWorkCategory({});
    return {category, progress: statusLabelsFor(category).seen};
  }
  const noteChosen = page === 'notes' || page === 'private/notes' ? routeParams().get('category') || '' : '';
  return kind === 'notes' && noteChosen ? {category:noteChosen} : {};
}
function searchableValues(record) {
  return [record.title,record.body,record.summary,record.notes,record.tags,record.category,record.progress,record.status,record.repo_url,record.demo_url].map(value => String(value || ''));
}
function matchesSearch(record, query) { return searchableValues(record).some(value => value.toLowerCase().includes(query.trim().toLowerCase())); }
function searchRecords(query, type = '') {
  const value = query.trim().toLowerCase();
  if (!value) return [];
  return Object.keys(kinds).filter(kind => !Object.hasOwn(kinds,type) || kind === type).flatMap(kind => (kind === 'notes' ? publicNotes() : site[kind]).map(row => ({...row,kind}))).filter(row => matchesSearch(row,value)).sort((a,b) => Number(b.title.toLowerCase().includes(value))-Number(a.title.toLowerCase().includes(value)) || b.updated-a.updated);
}
function highlightText(text, query) {
  text = String(text || ''); const value = query.trim().toLowerCase();
  if (!value) return esc(text);
  let output = '', position = 0, match;
  const lower = text.toLowerCase();
  while ((match = lower.indexOf(value,position)) !== -1) {
    output += esc(text.slice(position,match)) + '<mark>' + esc(text.slice(match,match+value.length)) + '</mark>';
    position = match+value.length;
  }
  return output + esc(text.slice(position));
}
function searchSnippet(row, query) {
  const value = query.trim().toLowerCase();
  const strip = text => String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const candidates = [row.summary,row.body,row.notes,row.tags,row.category,row.progress].filter(Boolean).map(strip);
  const text = candidates.find(text => text.toLowerCase().includes(value)) || candidates[0] || '';
  const match = text.toLowerCase().indexOf(value);
  const start = Math.max(0, match - 36);
  const end = Math.min(text.length, start + 120);
  return (start ? '…' : '') + highlightText(text.slice(start, end).trimEnd(), value) + (end < text.length ? '…' : '');
}
function filteredWorks(params) {
  const query = params.get('q') || '', chosen = params.get('category') || '';
  const matchCategory = work => !chosen || work.category === chosen || (chosen === '动画' && work.category === '动漫');
  return site.works.filter(work => matchCategory(work) && (params.get('progressEmpty') === '1' ? !work.progress : !params.get('progress') || work.progress === params.get('progress')) && matchesSearch(work,query)).slice().sort((a,b) => {
    if (params.get('sort') === 'rating') return ((b.rating ?? -1) - (a.rating ?? -1)) || (a.legacy_order ?? 0) - (b.legacy_order ?? 0) || (b.updated - a.updated);
    const rankA = Number.isFinite(a.legacy_order) ? a.legacy_order : null;
    const rankB = Number.isFinite(b.legacy_order) ? b.legacy_order : null;
    if (rankA !== null && rankB !== null) return rankA - rankB;
    if (rankA !== null) return 1;
    if (rankB !== null) return -1;
    return (b.updated - a.updated) || ((b.rating ?? -1) - (a.rating ?? -1));
  });
}
function readingSequence(kind, source) {
  const [page,query] = source.split('?');
  if (page === 'search') { const params = new URLSearchParams(query); return searchRecords(params.get('q') || '',params.get('type')).filter(row => ['posts','notes','projects','works'].includes(row.kind)); }
  if (page.startsWith('private/')) {
    const params = new URLSearchParams(query);
    const rows = kind === 'works' ? filteredWorks(params) : site[kind].filter(row => matchesSearch(row,params.get('q') || '') && matchesVisibility(row,params.get('visibility'))).sort((a,b) => b.updated-a.updated);
    return rows.map(row => ({...row,kind}));
  }
  const rows = kind === 'works' ? filteredWorks(new URLSearchParams(query)) : kind === 'posts' ? filteredPosts(new URLSearchParams(query)) : kind === 'notes' ? filteredNotes(new URLSearchParams(query)) : site[kind].slice().sort((a,b) => (kind === 'posts' ? Number(!!b.pinned)-Number(!!a.pinned) : 0) || publicationTime(b)-publicationTime(a) || b.id-a.id);
  return rows.map(row => ({...row,kind}));
}
function preferredWorkView(params) {
  const explicit = params.get('view');
  if (explicit === 'grid' || explicit === 'list') return explicit;
  try { return localStorage.getItem('work-view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}
function noteReaderFooter(previous, next, returnRoute, returnName, nextLabel) {
  const link = (row, previous) => row ? `<a class="reader-next${previous ? ' reader-previous' : ''}" href="#read/${row.kind}/${row.id}"><small>${previous ? '← 上一篇' : nextLabel + ' →'}</small><strong>${esc(row.title)}</strong></a>` : '';
  return `<footer class="reader-footer note-reader-footer">${previous || next ? `<nav class="note-reader-sequence" aria-label="相邻笔记">${link(previous, true)}${link(next, false)}</nav>` : ''}<div class="note-reader-tools"><a class="back" data-back-list href="#${esc(returnRoute)}">← 返回${returnName}</a><button type="button" id="copy-link">复制链接</button></div></footer>`;
}
function bindNoteImages(root) {
  root?.querySelectorAll('img').forEach(image => {
    const ident = image.getAttribute('src')?.match(/^\/media\/([a-f0-9]{32})\.jpg$/)?.[1];
    const size = site.note_image_sizes?.[ident];
    if (size) { image.width = size.width; image.height = size.height; }
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', `放大图片${image.alt ? '：' + image.alt : ''}`);
    image.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openImageLightbox(image);
    });
    const unavailable = () => {
      if (image.hidden) return;
      image.hidden = true;
      const label = document.createElement('span');
      label.className = 'note-image-unavailable';
      label.textContent = `示意图暂不可用${image.alt ? '：' + image.alt : ''}`;
      image.after(label);
    };
    image.addEventListener('error', unavailable, {once: true});
    if (image.complete && !image.naturalWidth) unavailable();
  });
}
function bindReaderEditor(kind, row) {
  const button = $('#edit-current'), version = routeVersion;
  if (!button) return;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const latest = (await api(kind)).find(record => record.id === row.id);
      if (version !== routeVersion) return;
      if (!latest) throw new Error('内容已不存在，请刷新页面。');
      editRecord(kind, latest);
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  };
}
function readRecord(kind, id) {
  cleanupReadingNavigation(); cleanupReadingNavigation = () => {};
  cleanupAboutNavigation(); cleanupAboutNavigation = () => {};
  const row = (site[kind] || []).find(r => r.id === Number(id));
  if (!row || !['posts', 'notes', 'works', 'projects'].includes(kind)) {
    const collection = ['posts', 'notes', 'works', 'projects'].includes(kind) ? kind : 'posts';
    publicLayout(empty('内容不存在或尚未公开') + `<a class="read-link" href="#${collection}">返回${kinds[collection].name}列表 ↗</a>` + (authenticated ? `<a class="read-link" href="#private/${collection}">前往内容管理 ↗</a>` : ''), true);
    return;
  }
  const source = history.state?.from || '';
  const management = authenticated && /^private\/(posts|notes|works|projects)(\?|$)/.test(source);
  const returnRoute = source === 'home' || management || /^(posts|notes|works|projects|search)(\?|$)/.test(source) ? source : kind;
  const returnName = management ? '内容管理' : returnRoute === 'home' ? '首页' : returnRoute.startsWith('search') ? '搜索结果' : kinds[kind].name;
  const noteDirectoryRoute = kind === 'notes' && noteCategory(row) && !management && !/^search/.test(returnRoute) ? 'notes?' + new URLSearchParams({category:noteCategory(row)}) : '';
  const rows = readingSequence(kind,noteDirectoryRoute || returnRoute);
  const index = rows.findIndex(item => item.id === row.id && item.kind === kind);
  const previous = noteDirectoryRoute && index > 0 ? rows[index-1] : null;
  const next = index >= 0 ? rows[index+1] : null;
  const nextLabel = returnRoute.startsWith('search') ? '下一个结果' : '下一' + (next?.kind === 'works' ? '部' : '篇');
  const author = kind === 'notes' ? `<footer class="reader-author note-reader-author">${avatarMarkup(site.profile)}<a href="#about">${esc(site.profile.name)}</a></footer>` : `<footer class="reader-author">${avatarMarkup(site.profile)}<div><a href="#about">${esc(site.profile.name)}</a><p>${esc(site.profile.bio)}</p></div></footer>`;
  const readerActions = kind === 'notes' && !management
    ? `<nav class="note-reader-path" aria-label="笔记路径"><a href="#notes"${returnRoute === 'notes' ? ' data-back-list' : ''}>笔记</a>${noteCategory(row) ? `<span aria-hidden="true">/</span><a href="#notes?${esc(new URLSearchParams({category:noteCategory(row)}).toString())}"${returnRoute === noteDirectoryRoute ? ' data-back-list' : ''}>${esc(noteCategory(row))}</a>` : ''}</nav>${returnRoute === 'home' || returnRoute.startsWith('search') || (returnRoute.startsWith('notes?') && returnRoute !== noteDirectoryRoute) ? `<a class="back note-source-back" data-back-list href="#${esc(returnRoute)}">← 返回${returnName}</a>` : ''}`
    : `<a class="back" data-back-list href="#${esc(returnRoute)}">← 返回${returnName}</a>`;
  publicLayout(`<article class="reader reader-${kind} ${kind === 'works' ? 'work-reader' : ''}"><div class="reader-actions">${readerActions}${authenticated ? '<button id="edit-current" class="subtle">编辑此篇</button>' : ''}</div>${kind === 'works' ? `<div class="work-detail">${coverMarkup(row, 'work')}<div><h1>${esc(row.title)}</h1><p class="meta">${esc(row.category)} · ${date(row.updated)}</p><p class="work-detail-rating">${ratingMarkup(row.rating)}</p><p>${esc(row.progress || '未填写进度')}</p></div></div>${row.notes ? `<div class="markdown"><p>${esc(row.notes)}</p></div>` : '<p class="intro">还没有填写短评。</p>'}${row.url ? `<a class="read-link" href="${esc(row.url)}" target="_blank" rel="noreferrer">作品相关链接 ↗</a>` : ''}` : kind === 'projects' ? `<h1>${esc(row.title)}</h1><div class="article-meta"><span>${kinds[kind].name}</span><span class="tag">${esc(row.status || '进行中')}</span><time>发表于 ${date(publicationTime(row))}</time>${projectTagLinks(row)}</div><div class="project-reader-links">${row.repo_url ? `<a class="read-link" href="${esc(row.repo_url)}" target="_blank" rel="noreferrer">仓库 ↗</a>` : ''}${row.demo_url ? `<a class="read-link" href="${esc(row.demo_url)}" target="_blank" rel="noreferrer">演示 ↗</a>` : ''}</div>${row.cover_url ? coverMarkup(row, 'project', true) : ''}<div class="markdown">${articleBodyMarkup(row, kind)}</div>` : `<h1>${esc(row.title)}</h1><div class="article-meta">${kind === 'notes' && !management ? '' : `<span>${kinds[kind].name}</span>`}${kind === 'notes' && management && noteCategory(row) ? `<a class="tag category-link" href="#notes?${esc(new URLSearchParams({category:noteCategory(row)}).toString())}">${esc(noteCategory(row))}</a>` : ''}<time>发表于 ${date(publicationTime(row))}</time>${date(row.updated) !== date(publicationTime(row)) ? `<time class="updated-date">更新于 ${date(row.updated)}</time>` : ''}${kind === 'posts' && wordCount(row.body) ? `<span class="article-count">${wordCount(row.body).toLocaleString('zh-CN')} 字</span>` : ''}${kind === 'posts' ? tagLinks(row) : kind === 'notes' ? noteTagLinks(row) : ''}</div>${row.cover_url ? coverMarkup(row, 'post', true) : ''}<div class="markdown">${articleBodyMarkup(row, kind)}</div>${kind === 'posts' || kind === 'projects' ? '<p class="article-end">— 完 —</p>' : ''}`}${author}${kind === 'notes' ? noteReaderFooter(previous, next, returnRoute, returnName, nextLabel) : `<footer class="reader-footer"><a class="back" data-back-list href="#${esc(returnRoute)}">← 返回${returnName}</a><div class="share-actions"><button type="button" id="copy-link">复制链接</button><a class="read-link" href="${esc(publicArticleURL(kind,row.id))}" target="_blank" rel="noreferrer">公开地址 ↗</a></div>${previous ? `<a class="reader-next reader-previous" href="#read/notes/${previous.id}">← 上一篇：${esc(previous.title)}</a>` : ''}${next ? `<a class="reader-next" href="#read/${next.kind}/${next.id}">${nextLabel}：${esc(next.title)} →</a>` : ''}</footer>`}</article>`, true);
  $('#copy-link').onclick = async () => {
    try { await navigator.clipboard.writeText(publicArticleURL(kind,row.id)); toast('链接已复制'); }
    catch {
      if (kind === 'notes' && !document.getElementById('copy-link-fallback')) {
        const link = document.createElement('a');
        link.id = 'copy-link-fallback';
        link.className = 'copy-link-fallback';
        link.href = publicArticleURL(kind,row.id);
        link.textContent = '公开地址';
        $('#copy-link').after(link);
      }
      toast('自动复制不可用，可长按或右键“公开地址”复制链接。');
    }
  };
  if (kind === 'works') {
    const similar = site.works.filter(item => item.id !== row.id && item.category === row.category).slice(0, 3);
    if (similar.length) {
      const box = document.createElement('section');
      box.className = 'similar-works';
      box.innerHTML = `<h2>相近作品</h2><div class="similar-grid">${similar.map(item => `<a class="similar-card" href="#read/works/${item.id}">${coverMarkup(item, 'work')}<strong>${esc(item.title)}</strong></a>`).join('')}</div>`;
      $('.reader-footer')?.before(box);
      bindCoverImages(box);
    }
  }
  const hasSections = kind === 'notes'
    ? main.querySelectorAll('.reader > .markdown h2, .reader > .markdown h3, .reader > .markdown h4').length >= 3
    : (row.body || '').length >= 1500 && main.querySelectorAll('.reader > .markdown h2, .reader > .markdown h3').length >= 3;
  if (hasSections) {
    cleanupReadingNavigation = mountReadingNavigation(main.querySelector('.reader'));
  }
  if (kind === 'notes') bindNoteImages(main.querySelector('.reader-notes .markdown'));
  const cleanupMath = window.mountMathScrolling(main.querySelector('.reader'));
  const cleanupNavigation = cleanupReadingNavigation;
  cleanupReadingNavigation = () => { cleanupMath(); cleanupNavigation(); };
  if (authenticated) bindReaderEditor(kind, row);
  document.title = row.title + ' · ' + site.profile.name;
}
function showSearch() {
  const params = routeParams(); let type = Object.hasOwn(kinds,params.get('type')) ? params.get('type') : '';
  const options = [['','全部'], ...['posts','notes','projects','works','friends','bookmarks'].map(kind => [kind,kinds[kind].name])];
  publicLayout(heading('搜索') + '<div class="search-panel"><label>搜索公开内容<input id="public-search" type="search" placeholder="搜标题或正文，如 电磁感应、勇气…" autocomplete="off"></label></div>' + `<div class="search-kind-tabs" role="group" aria-label="搜索内容类型">${options.map(([kind,name]) => `<button type="button" data-search-kind="${kind}" aria-pressed="${kind === type}">${name}<span class="filter-count"></span></button>`).join('')}</div><div id="search-results" aria-live="polite"></div>`);
  const input = $('#public-search'); input.value = params.get('q') || '';
  const render = (persist = true) => {
    const value = input.value.trim().toLowerCase();
    if (persist) saveListParams({q:input.value,type});
    const all = searchRecords(value), rows = type ? all.filter(row => row.kind === type) : all;
    document.querySelectorAll('[data-search-kind]').forEach(button => {
      const kind = button.dataset.searchKind;
      button.setAttribute('aria-pressed',String(kind === type));
      button.querySelector('.filter-count').textContent = value ? String(kind ? all.filter(row => row.kind === kind).length : all.length) : '';
    });
    if (!value) { $('#search-results').innerHTML = '<p class="intro">输入关键词，找回想看的内容。</p>'; return; }
    $('#search-results').innerHTML = `<p class="search-count">找到 ${rows.length} 条${type ? kinds[type].name : '内容'}</p>` + (rows.length ? `<div class="list">${rows.map(r => { const readable = ['posts','notes','projects','works'].includes(r.kind); return `<a class="list-row" href="${readable ? '#read/'+r.kind+'/'+r.id : esc(r.url)}" ${readable ? '' : 'target="_blank" rel="noreferrer"'}><h2>${highlightText(r.title,value)}</h2><p>${kinds[r.kind].name} · ${searchSnippet(r,value)}</p></a>`; }).join('')}</div>` : empty('没有匹配内容',type && all.length ? '其他栏目有匹配结果，可以切换到“全部”。' : '试试更短的关键词。') + (rows.length ? '' : `<div class="search-suggestions"><a class="read-link" href="#notes">最近笔记 ↗</a><a class="read-link" href="#works">作品记录 ↗</a><a class="read-link" href="#posts">博客 ↗</a></div><div class="search-recent"><span>最近更新</span>${['posts','notes','projects'].flatMap(kind => (kind === 'notes' ? publicNotes() : site[kind]).map(row => ({...row, kind}))).sort((a,b) => publicationTime(b)-publicationTime(a)).slice(0, 3).map(row => `<a href="#read/${row.kind}/${row.id}">${esc(row.title)}</a>`).join('')}</div>`));
  };
  document.querySelectorAll('[data-search-kind]').forEach(button => button.onclick = () => { type = button.dataset.searchKind; render(); });
  input.oninput = () => render(); render(false);
}
// 2026 软科中国大学总榜：https://www.shanghairanking.cn/rankings/bcur/202610
// 保存完整总榜的展示顺序，以支持编辑名单时更换院校；数值为顺序索引，并非全国名次。
const universityOrder2026 = {"清华大学":0,"北京大学":1,"浙江大学":2,"上海交通大学":3,"复旦大学":4,"南京大学":5,"中国科学技术大学":6,"武汉大学":7,"华中科技大学":8,"西安交通大学":9,"北京航空航天大学":10,"哈尔滨工业大学":11,"中山大学":12,"北京理工大学":13,"北京协和医学院":14,"东南大学":15,"四川大学":16,"中国人民大学":17,"同济大学":18,"北京师范大学":19,"天津大学":20,"南开大学":21,"山东大学":22,"西北工业大学":23,"中国农业大学":24,"厦门大学":25,"吉林大学":26,"中南大学":27,"大连理工大学":28,"华东师范大学":29,"南方科技大学":30,"湖南大学":31,"华南理工大学":32,"电子科技大学":33,"重庆大学":34,"北京科技大学":35,"上海财经大学":36,"南京理工大学":37,"南京航空航天大学":38,"首都医科大学":39,"东北大学":40,"西安电子科技大学":41,"香港中文大学（深圳）":42,"兰州大学":43,"北京交通大学":44,"华东理工大学":45,"中央财经大学":46,"南方医科大学":47,"哈尔滨工程大学":48,"郑州大学":49,"华中农业大学":50,"南京医科大学":51,"苏州大学":52,"上海科技大学":53,"东北师范大学":54,"西南交通大学":55,"北京邮电大学":56,"中国海洋大学":57,"江南大学":58,"华中师范大学":59,"武汉理工大学":60,"南京农业大学":61,"中国地质大学（武汉）":62,"中国政法大学":63,"北京化工大学":64,"对外经济贸易大学":65,"中南财经政法大学":66,"南京师范大学":67,"暨南大学":68,"上海大学":69,"天津医科大学":70,"西南大学":71,"中国石油大学（北京）":72,"中国医科大学":73,"河海大学":74,"陕西师范大学":75,"北京中医药大学":76,"北京工业大学":77,"宁波诺丁汉大学":78,"深圳大学":79,"西南财经大学":80,"中国矿业大学":81,"浙江工业大学":82,"西北农林科技大学":83,"上海中医药大学":84,"西北大学":85,"云南大学":86,"东华大学":87,"中国石油大学（华东）":88,"南昌大学":89,"中国地质大学（北京）":90,"中国矿业大学（北京）":91,"福州大学":92,"宁波大学":93,"上海纽约大学":94,"华南师范大学":95,"中央民族大学":96,"广州医科大学":97,"哈尔滨医科大学":98,"北京外国语大学":99,"合肥工业大学":100,"江苏大学":101,"东北财经大学":102,"重庆医科大学":103,"上海外国语大学":104,"南京邮电大学":105,"中国传媒大学":106,"北京林业大学":107,"华北电力大学":108,"贵州大学":109,"广西大学":110,"海南大学":111,"南京工业大学":112,"中国药科大学":113,"长安大学":114,"福建师范大学":115,"浙江师范大学":116,"温州医科大学":117,"湖南师范大学":118,"南京林业大学":119,"扬州大学":120,"南京中医药大学":121,"河南大学":122,"昆山杜克大学":123,"广东工业大学":124,"太原理工大学":125,"南京信息工程大学":126,"广州中医药大学":127,"杭州电子科技大学":128,"首都师范大学":129,"安徽大学":130,"江西财经大学":131,"浙江工商大学":132,"山西大学":133,"西交利物浦大学":134,"华南农业大学":135,"山东师范大学":136,"广州大学":137,"外交学院":138,"上海理工大学":139,"河北工业大学":140,"青岛大学":141,"深圳北理莫斯科大学":142,"燕山大学":143,"河北医科大学":144,"昆明理工大学":145,"西安理工大学":146,"浙江理工大学":147,"大连医科大学":148,"大连海事大学":149,"首都经济贸易大学":150,"内蒙古大学":151,"东北林业大学":152,"杭州师范大学":153,"湘潭大学":154,"西安建筑科技大学":155,"西南石油大学":156,"北京语言大学":157,"华东政法大学":158,"东北农业大学":159,"天津中医药大学":160,"湖北大学":161,"成都中医药大学":162,"福建农林大学":163,"上海师范大学":164,"武汉科技大学":165,"安徽医科大学":166,"西南政法大学":167,"辽宁大学":168,"江西师范大学":169,"福建医科大学":170,"成都理工大学":171,"浙江中医药大学":172,"山东农业大学":173,"温州大学":174,"南京财经大学":175,"北京工商大学":176,"广东外语外贸大学":177,"河北大学":178,"浙江财经大学":179,"新疆大学":180,"上海体育大学":181,"陕西科技大学":182,"山西医科大学":183,"天津工业大学":184,"四川农业大学":185,"长沙理工大学":186,"石河子大学":187,"山东第一医科大学":188,"宁夏大学":189,"长春理工大学":190,"广东以色列理工学院":191,"华侨大学":192,"中国人民公安大学":193,"山东科技大学":194,"江苏科技大学":195,"上海海洋大学":196,"安徽农业大学":197,"山东财经大学":198,"上海对外经贸大学":199,"中北大学":200,"安徽师范大学":201,"河南农业大学":202,"重庆邮电大学":203,"南通大学":204,"广西师范大学":205,"浙江农林大学":206,"齐鲁工业大学":207,"中国计量大学":208,"温州肯恩大学":209,"广西医科大学":210,"沈阳农业大学":211,"西北师范大学":212,"北师香港浸会大学":213,"黑龙江大学":214,"集美大学":215,"延边大学":216,"天津科技大学":217,"徐州医科大学":218,"武汉纺织大学":219,"南京审计大学":220,"中南民族大学":221,"天津师范大学":222,"吉林农业大学":223,"湖北工业大学":224,"辽宁师范大学":225,"曲阜师范大学":226,"常州大学":227,"湖南农业大学":228,"青岛科技大学":229,"河南师范大学":230,"沈阳药科大学":231,"武汉工程大学":232,"山东中医药大学":233,"湖南中医药大学":234,"天津理工大学":235,"上海海事大学":236,"江苏师范大学":237,"汕头大学":238,"三峡大学":239,"济南大学":240,"天津财经大学":241,"河南科技大学":242,"福建中医药大学":243,"河北师范大学":244,"北京体育大学":245,"北京建筑大学":246,"沈阳航空航天大学":247,"河南中医药大学":248,"安徽理工大学":249,"南昌航空大学":250,"北京信息科技大学":251,"桂林电子科技大学":252,"长江大学":253,"宁夏医科大学":254,"国际关系学院":255,"西北政法大学":256,"西安科技大学":257,"青岛理工大学":258,"上海电力大学":259,"河北农业大学":260,"湖南科技大学":261,"辽宁中医药大学":262,"重庆交通大学":263,"兰州交通大学":264,"安徽工业大学":265,"河南理工大学":266,"华东交通大学":267,"昆明医科大学":268,"西安邮电大学":269,"新疆医科大学":270,"山东理工大学":271,"南华大学":272,"沈阳工业大学":273,"云南师范大学":274,"江西中医药大学":275,"西藏大学":276,"江西理工大学":277,"安徽财经大学":278,"青海大学":279,"兰州理工大学":280,"西南科技大学":281,"湖北中医药大学":282,"西安工业大学":283,"江西农业大学":284,"西南民族大学":285,"西南医科大学":286,"长春中医药大学":287,"东北电力大学":288,"四川师范大学":289,"河南工业大学":290,"滨州医学院":291,"大连工业大学":292,"黑龙江中医药大学":293,"内蒙古农业大学":294,"东北石油大学":295,"北京第二外国语学院":296,"哈尔滨理工大学":297,"重庆师范大学":298,"山西财经大学":299,"嘉兴大学":300,"遵义医科大学":301,"上海政法学院":302,"苏州科技大学":303,"河南医药大学":304,"浙大城市学院":305,"安徽中医药大学":306,"中南林业科技大学":307,"贵州师范大学":308,"内蒙古师范大学":309,"贵州医科大学":310,"山东第二医科大学":311,"沈阳建筑大学":312,"吉林财经大学":313,"中国刑事警察学院":314,"哈尔滨师范大学":315,"烟台大学":316,"山西农业大学":317,"中国民航大学":318,"海南师范大学":319,"青岛农业大学":320,"东华理工大学":321,"内蒙古医科大学":322,"西安石油大学":323,"石家庄铁道大学":324,"浙江科技大学":325,"重庆工商大学":326,"广东财经大学":327,"北京电子科技学院":328,"海南医科大学":329,"湖州师范学院":330,"甘肃农业大学":331,"浙江传媒学院":332,"浙江海洋大学":333,"佛山大学":334,"上海工程技术大学":335,"北方工业大学":336,"陕西中医药大学":337,"鲁东大学":338,"成都大学":339,"西安外国语大学":340,"四川外国语大学":341,"上海应用技术大学":342,"北京物资学院":343,"广西中医药大学":344,"重庆理工大学":345,"沈阳化工大学":346,"长春工业大学":347,"厦门理工学院":348,"锦州医科大学":349,"东莞理工学院":350,"延安大学":351,"大连交通大学":352,"华北水利水电大学":353,"山东建筑大学":354,"赣南师范大学":355,"西安工程大学":356,"河北经贸大学":357,"河北科技大学":358,"沈阳理工大学":359,"河北中医药大学":360,"青海师范大学":361,"河南财经政法大学":362,"武汉轻工大学":363,"桂林理工大学":364,"郑州轻工业大学":365,"天津外国语大学":366,"成都信息工程大学":367,"内蒙古工业大学":368,"西华大学":369,"首都体育学院":370,"辽宁石油化工大学":371,"湖北经济学院":372,"绍兴文理学院":373,"江汉大学":374,"沈阳大学":375,"广东医科大学":376,"大连外国语大学":377,"中国人民警察大学":378,"山西师范大学":379,"湖南工商大学":380,"湖北医药学院":381,"聊城大学":382,"华北理工大学":383,"上海立信会计金融学院":384,"太原科技大学":385,"天津商业大学":386,"浙江外国语学院":387,"四川警察学院":388,"辽宁工程技术大学":389,"西华师范大学":390,"贵州中医药大学":391,"广西民族大学":392,"南京工程学院":393,"贵州财经大学":394,"安徽工程大学":395,"福建理工大学":396,"郑州航空工业管理学院":397,"大连民族大学":398,"上海海关学院":399,"沈阳师范大学":400,"台州学院":401,"重庆科技大学":402,"辽宁工业大学":403,"西藏民族大学":404,"贵州民族大学":405,"江苏警官学院":406,"北京农学院":407,"北京印刷学院":408,"云南财经大学":409,"武汉体育学院":410,"安徽建筑大学":411,"深圳技术大学":412,"蚌埠医科大学":413,"沈阳医学院":414,"渤海大学":415,"大理大学":416,"川北医学院":417,"云南中医药大学":418,"大连大学":419,"苏州工学院":420,"浙大宁波理工学院":421,"中国劳动关系学院":422,"山西中医药大学":423,"云南农业大学":424,"河北地质大学":425,"西北民族大学":426,"南京警察学院":427,"河北工程大学":428,"桂林医科大学":429,"宁波工程学院":430,"广东药科大学":431,"湖南工业大学":432,"西安财经大学":433,"浙江警察学院":434,"吉林建筑大学":435,"西藏藏医药大学":436,"南宁师范大学":437,"北方民族大学":438,"大连海洋大学":439,"闽江学院":440,"广东海洋大学":441,"临沂大学":442,"哈尔滨商业大学":443,"云南民族大学":444,"中华女子学院":445,"北京石油化工学院":446,"内蒙古财经大学":447,"赣南医科大学":448,"黑龙江八一农垦大学":449,"甘肃中医药大学":450,"新疆师范大学":451,"沈阳体育学院":452,"西南林业大学":453,"皖南医学院":454,"辽宁科技大学":455,"新疆农业大学":456,"山东工商学院":457,"北京联合大学":458,"重庆文理学院":459,"北华大学":460,"闽南师范大学":461,"湖南理工学院":462,"五邑大学":463,"湖北师范大学":464,"浙江万里学院":465,"青海民族大学":466,"甘肃政法大学":467,"广东技术师范大学":468,"内蒙古科技大学":469,"合肥大学":470,"承德医学院":471,"淮阴工学院":472,"天津城建大学":473,"无锡学院":474,"中原工学院":475,"景德镇陶瓷大学":476,"济宁医学院":477,"吉林师范大学":478,"吉首大学":479,"江西科技师范大学":480,"南京体育学院":481,"江苏海洋大学":482,"天津体育学院":483,"四川轻化工大学":484,"上海第二工业大学":485,"长沙学院":486,"广西科技大学":487,"淮北师范大学":488,"成都体育学院":489,"淮阴师范学院":490,"上海电机学院":491,"南京晓庄学院":492,"盐城工学院":493,"贵州师范学院":494,"常州工学院":495,"新疆财经大学":496,"长春师范大学":497,"信阳师范大学":498,"山东体育学院":499,"上海健康医学院":500,"中央司法警官学院":501,"榆林学院":502,"安庆师范大学":503,"内蒙古民族大学":504,"重庆警察学院":505,"湖北汽车工业学院":506,"陕西理工大学":507,"塔里木大学":508,"天津职业技术师范大学":509,"辽宁警察学院":510,"长江师范学院":511,"兰州财经大学":512,"湖北民族大学":513,"湖南第一师范学院":514,"江苏理工学院":515,"上海商学院":516,"北京警察学院":517,"江西水利电力大学":518,"长春工程学院":519,"盐城师范学院":520,"井冈山大学":521,"金陵科技学院":522,"广东金融学院":523,"广东警官学院":524,"天津农学院":525,"仲恺农业工程学院":526,"铜仁学院":527,"杭州医学院":528,"山东交通学院":529,"黄冈师范学院":530,"泉州师范学院":531,"河南科技学院":532,"温州理工学院":533,"西安医学院":534,"安徽科技学院":535,"洛阳师范学院":536,"徐州工程学院":537,"湖北第二师范学院":538,"丽水学院":539,"中国民用航空飞行学院":540,"河北北方学院":541,"惠州学院":542,"广州体育学院":543,"长春大学":544,"贵阳学院":545,"厦门医学院":546,"湖州学院":547,"哈尔滨体育学院":548,"沈阳工程学院":549,"河南警察学院":550,"湖北科技学院":551,"湖北文理学院":552,"黔南民族师范学院":553,"广西财经学院":554,"内蒙古科技大学包头医学院":555,"郑州警察学院":556,"防灾科技学院":557,"广东石油化工学院":558,"洛阳理工学院":559,"遵义师范学院":560,"衢州学院":561,"重庆三峡学院":562,"齐齐哈尔大学":563,"三明学院":564,"牡丹江医科大学":565,"齐齐哈尔医学院":566,"右江民族医学院":567,"太原师范学院":568,"山东政法学院":569,"阜阳师范大学":570,"北华航天工业学院":571,"绵阳师范学院":572,"佳木斯大学":573,"成都医学院":574,"成都师范学院":575,"云南警官学院":576,"昆明学院":577,"周口师范学院":578,"福建警察学院":579,"岭南师范学院":580,"莆田学院":581,"福建江夏学院":582,"德州学院":583,"黑龙江科技大学":584,"攀枝花学院":585,"山东航空学院":586,"浙江水利水电学院":587,"龙岩学院":588,"西藏农牧大学":589,"曲靖师范学院":590,"华北科技学院":591,"泰山学院":592,"潍坊学院":593,"湖南财政经济学院":594,"河北科技师范学院":595,"湘南学院":596,"衡阳师范学院":597,"湖南工程学院":598,"内江师范学院":599,"许昌学院":600,"宜宾学院":601,"河北金融学院":602,"贵州理工学院":603,"吉林化工大学":604,"宁夏师范大学":605,"合肥师范学院":606,"湖北理工学院":607,"江苏第二师范学院":608,"皖西学院":609,"上海公安学院":610,"安阳师范学院":611,"西安体育学院":612,"湖北工程学院":613,"南阳师范学院":614,"苏州城市学院":615,"南昌医学院":616,"北部湾大学":617,"西安文理学院":618,"长治医学院":619,"广东第二师范学院":620,"韶关学院":621,"嘉兴南湖学院":622,"乐山师范学院":623,"武夷学院":624,"六盘水师范学院":625,"商丘师范学院":626,"石家庄学院":627,"吉林警察学院":628,"宜春学院":629,"枣庄学院":630,"重庆第二师范学院":631,"湖北警官学院":632,"黄淮学院":633,"滁州学院":634,"怀化学院":635,"玉林师范学院":636,"邵阳学院":637,"唐山师范学院":638,"南昌师范学院":639,"肇庆学院":640,"湖南警察学院":641,"广州航海学院":642,"平顶山学院":643,"河南工程学院":644,"西安航空学院":645,"成都工业学院":646,"天水师范大学":647,"河西学院":648,"南京特殊教育师范学院":649,"宝鸡文理学院":650,"南阳理工学院":651,"宁德师范学院":652,"西昌学院":653,"吉林医药学院":654,"贵州警察学院":655,"河南城建学院":656,"黑龙江工程学院":657,"湖南文理学院":658,"上饶师范学院":659,"内蒙古科技大学包头师范学院":660,"吉林体育学院":661,"通化师范学院":662,"济宁学院":663,"渭南师范学院":664,"湖南科技学院":665,"武汉商学院":666,"海南热带海洋学院":667,"湖南城市学院":668,"齐鲁师范学院":669,"廊坊师范学院":670,"玉溪师范学院":671,"牡丹江师范学院":672,"哈尔滨学院":673,"山西大同大学":674,"湖南工学院":675,"韩山师范学院":676,"九江学院":677,"太原工业学院":678,"宿迁学院":679,"陇东学院":680,"福建技术师范学院":681,"鞍山师范学院":682,"巢湖学院":683,"山东青年政治学院":684,"黄山学院":685,"吉林工程技术师范学院":686,"河北民族师范学院":687,"四川旅游学院":688,"江西警察学院":689,"山东女子学院":690,"山东管理学院":691,"咸阳师范学院":692,"吉林农业科技学院":693,"兰州城市学院":694,"湖南人文科技学院":695,"宿州学院":696,"安阳工学院":697,"凯里学院":698,"安顺学院":699,"长治学院":700,"淮南师范学院":701,"贺州学院":702,"新乡学院":703,"嘉应学院":704,"伊犁师范大学":705,"阿坝师范学院":706,"安康学院":707,"白城师范学院":708,"百色学院":709,"保定学院":710,"保山学院":711,"蚌埠学院":712,"亳州学院":713,"沧州师范学院":714,"昌吉学院":715,"长沙工业学院":716,"长沙师范学院":717,"赤峰学院":718,"池州学院":719,"楚雄师范学院":720,"大庆师范学院":721,"滇西科技师范学院":722,"滇西应用技术大学":723,"鄂尔多斯应用技术学院":724,"赣东学院":725,"赣南科技学院":726,"甘肃民族师范学院":727,"广西科技师范学院":728,"广西民族师范学院":729,"广西职业师范学院":730,"桂林航天工业学院":731,"贵州工程应用技术学院":732,"邯郸学院":733,"汉江师范学院":734,"河北环境工程学院":735,"河北建筑工程学院":736,"河北水利电力学院":737,"河池学院":738,"合肥理工学院":739,"黑河学院":740,"黑龙江工业学院":741,"河南工学院":742,"河南牧业经济学院":743,"衡水学院":744,"河套学院":745,"菏泽学院":746,"红河学院":747,"呼伦贝尔学院":748,"荆楚理工学院":749,"景德镇学院":750,"集宁师范学院":751,"晋中学院":752,"喀什大学":753,"兰州工业学院":754,"兰州文理学院":755,"辽东学院":756,"辽宁科技学院":757,"吕梁学院":758,"萍乡学院":759,"普洱学院":760,"琼台师范学院":761,"山东农业工程学院":762,"山东石油化工学院":763,"商洛学院":764,"山西电子科技学院":765,"山西工程技术学院":766,"山西工学院":767,"山西科技学院":768,"山西能源学院":769,"陕西学前师范学院":770,"绍兴理工学院":771,"四川民族学院":772,"四川文理学院":773,"绥化学院":774,"太原学院":775,"泰州学院":776,"唐山学院":777,"天津中德应用技术大学":778,"文山学院":779,"梧州学院":780,"邢台学院":781,"兴义民族师范学院":782,"新疆工程学院":783,"新疆理工学院":784,"新疆政法学院":785,"信阳农林学院":786,"新余学院":787,"忻州师范学院":788,"营口理工学院":789,"运城学院":790,"豫章师范学院":791,"张家口学院":792,"昭通学院":793,"郑州工程技术学院":794,"郑州师范学院":795,"福建商学院":796,"桂林旅游学院":797,"贵州商学院":798,"哈尔滨金融学院":799,"河南财政金融学院":800,"吉林工商学院":801,"铜陵学院":802,"新疆科技学院":803,"呼和浩特民族学院":804,"河北体育学院":805,"河南体育学院":806,"甘肃医学院":807,"湖南医药学院":808,"山西医药学院":809,"新疆第二医学院":810,"湖南女子学院":811,"广西警察学院":812,"山东警察学院":813,"山西警察学院":814,"新疆警察学院":815};
// 国防科技大学未列入软科总榜，参考校友会 2026 榜单（全国第 13，位于中山大学之前）补充展示位置。
// 来源：https://www.caigou.com.cn/news/202601144.shtml；此值仅为展示顺序，不代表软科名次。
universityOrder2026['国防科技大学'] = universityOrder2026['中山大学'] - 0.5;
function sortedStudents(students = []) {
  return [...students].sort((a,b) =>
    (universityOrder2026[a.university] ?? Infinity) - (universityOrder2026[b.university] ?? Infinity)
    || a.university.localeCompare(b.university,'zh-CN-u-co-pinyin'));
}
const universitySeals = {
  '天津中医药大学': {src: '/university-seals/tjucm.png', style: 'emblem-tjucm'},
  '贵州大学': {src: '/university-seals/gzu-combo.png', style: 'emblem-combo emblem-gzu'},
  '北京邮电大学': {src: '/university-seals/bupt-combo.png', style: 'emblem-combo emblem-bupt'},
  '西安电子科技大学': {src: '/university-seals/xidian-combo.png', style: 'emblem-combo emblem-xidian'},
  '中山大学': {src: '/university-seals/sysu.png', style: 'emblem-sysu'},
  '北京师范大学': {src: '/university-seals/bnu-combo.png', style: 'emblem-bnu'},
  '国防科技大学': {src: '/university-seals/nudt-combo.svg', style: 'emblem-combo emblem-white'},
  '北京林业大学': {src: '/university-seals/bjfu.svg', style: 'emblem-white'},
  '四川大学': {src: '/university-seals/scu.jpg', style: 'emblem-scu'},
  '中国矿业大学': {src: '/university-seals/cumt-seal.jpg', style: 'emblem-cumt'}
};
function studentWall(students = []) {
  return students.length ? `<ul class="student-wall" aria-label="部分学生风采">${sortedStudents(students).map(student => {
    const seal = universitySeals[student.university];
    const emblem = seal ? `<img src="${esc(seal.src)}" alt="${esc(student.university)}校徽" loading="lazy" decoding="async">` : `<span aria-hidden="true">${esc(student.university.slice(0,2))}</span>`;
    return `<li class="student-plaque"><div class="student-emblem ${seal?.style || ''}">${emblem}</div><h3 class="student-university">${esc(student.university)}</h3><p class="student-name">${esc(student.surname)}<span>**</span></p>${student.subjects ? `<p class="student-subject" aria-label="辅导科目">${esc(student.subjects)}</p>` : ''}</li>`;
  }).join('')}</ul>` : '<div class="student-wall-empty"><p>部分学生风采正在整理中。</p></div>';
}
function formatTeachingContent(container) {
  if (!container) return;
  const related = [...container.children].find(element => element.tagName === 'P' && element.textContent.startsWith('具体备课过程见') && element.querySelector('a'));
  if (related) related.remove();
  for (const paragraph of container.querySelectorAll('p')) {
    for (const node of [...paragraph.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.includes('举一反三')) continue;
      node.replaceWith(...node.textContent.split(/(举一反三)/u).map(text => {
        if (text !== '举一反三') return document.createTextNode(text);
        const phrase = document.createElement('span');
        phrase.className = 'about-key-phrase';
        phrase.textContent = text;
        return phrase;
      }));
    }
  }
  const paragraph = [...container.children].find(element => element.tagName === 'P' && element.textContent.includes('高斯') && element.textContent.includes('求和'));
  if (paragraph) {
    const example = document.createElement('details');
    example.className = 'about-teaching-example';
    const label = document.createElement('summary');
    label.textContent = '教学示例：高斯求和';
    paragraph.before(example);
    example.append(label, paragraph);
  }
  // 按 Markdown 小标题分组，编辑后的正文和示例仍使用同一份内容。
  for (const title of [...container.children].filter(element => element.tagName === 'H3')) {
    const row = document.createElement('div');
    row.className = 'about-teaching-row';
    const content = document.createElement('div');
    content.className = 'about-teaching-content';
    title.before(row);
    row.append(title, content);
    while (row.nextElementSibling && row.nextElementSibling.tagName !== 'H3') {
      content.append(row.nextElementSibling);
    }
  }
  if (related) {
    related.classList.add('about-teaching-related');
    container.append(related);
  }
}
function showAbout() {
  const profile = site.profile;
  publicLayout(`<article class="reader about-page"><div class="about-cover"><img src="${esc(profile.background_url || '/cover.jpg')}" alt="" decoding="async"><a class="back about-return" href="#home">← 返回首页</a></div><div class="about-content"><header class="about-profile">${avatarMarkup(profile)}<div class="about-profile-info"><h1>${esc(profile.name)}</h1>${profile.bio ? `<p class="about-lead">${esc(profile.bio)}</p>` : ''}</div><div class="about-profile-actions"><button type="button" class="about-contact-jump" hidden>欢迎联系 <span aria-hidden="true">↘</span></button><button type="button" class="about-students-jump" hidden>学生风采 <span aria-hidden="true">↓</span></button></div></header><div class="about-story"><section class="about-introduction" aria-labelledby="about-intro-title"><h2 id="about-intro-title">个人简介</h2><div class="markdown about-body">${markdown(profile.about || '')}</div></section>${profile.experience ? `<section class="about-experience" aria-labelledby="about-experience-title"><header class="about-experience-heading"><h2 id="about-experience-title">教学实践</h2></header><div class="markdown about-experience-body">${markdown(profile.experience)}</div></section>` : ''}</div><section class="about-students" aria-labelledby="about-students-title"><header class="about-section-heading"><h2 id="about-students-title" tabindex="-1">部分学生风采</h2>${authenticated ? '<a class="read-link" href="#private/profile">编辑名单</a>' : ''}</header>${studentWall(profile.students || [])}</section><section class="about-contact-section" aria-labelledby="about-contact-title" hidden><div><h2 id="about-contact-title" tabindex="-1">欢迎联系</h2><p>欢迎通过 QQ 或邮箱联系我。</p></div><div class="about-contacts"></div><p class="about-copy-status" id="about-copy-status" role="status" aria-live="polite"></p></section>${authenticated ? '<a class="read-link about-edit" href="#private/profile">编辑关于页</a>' : ''}</div></article>`);
  const navigation = $('.site-nav');
  const navigationLinks = [...navigation.querySelectorAll('a')];
  const navigationControls = document.createElement('div');
  navigationControls.className = 'about-nav-scroll';
  const leftArrow = document.createElement('button');
  const rightArrow = document.createElement('button');
  for (const [button, direction, label, symbol] of [[leftArrow, -1, '向左浏览导航', '‹'], [rightArrow, 1, '向右浏览导航', '›']]) {
    button.type = 'button';
    button.className = `about-nav-arrow ${direction < 0 ? 'about-nav-left' : 'about-nav-right'}`;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<span aria-hidden="true">${symbol}</span>`;
    button.hidden = true;
    button.onclick = () => {
      const boundary = navigation.getBoundingClientRect();
      const positions = navigationLinks.map(link => link.getBoundingClientRect().left - boundary.left + navigation.scrollLeft);
      const nextPage = navigation.scrollLeft + direction * navigation.clientWidth * 0.8;
      const target = direction > 0
        ? positions.find(position => position > navigation.scrollLeft + 1 && position >= nextPage - 1) ?? navigation.scrollWidth
        : positions.filter(position => position < navigation.scrollLeft - 1 && position <= nextPage + 1).at(-1) ?? 0;
      navigation.scrollTo({left: target, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    };
  }
  navigation.before(navigationControls);
  navigationControls.append(leftArrow, navigation, rightArrow);
  const current = navigation.querySelector('[aria-current="page"]');
  if (current && navigation.scrollWidth > navigation.clientWidth) {
    const edge = current.getBoundingClientRect().right - navigation.getBoundingClientRect().right;
    if (edge > 0) navigation.scrollLeft += edge;
  }
  const updateNavigationEdges = () => {
    const boundary = navigation.getBoundingClientRect();
    for (const link of navigationLinks) {
      const rect = link.getBoundingClientRect();
      // 边缘只显示完整菜单项，避免露出半个字；键盘聚焦时由浏览器滚动到完整链接。
      link.classList.toggle('nav-link-clipped', rect.left < boundary.left - 1 || rect.right > boundary.right + 1);
    }
    leftArrow.hidden = navigation.scrollLeft <= 1;
    rightArrow.hidden = navigation.scrollWidth - navigation.clientWidth - navigation.scrollLeft <= 1;
  };
  navigation.onscroll = updateNavigationEdges;
  const navigationResize = new ResizeObserver(updateNavigationEdges);
  navigationResize.observe(navigation);
  updateNavigationEdges();
  cleanupAboutNavigation = () => {
    navigationResize.disconnect();
    navigation.onscroll = null;
    navigationLinks.forEach(link => link.classList.remove('nav-link-clipped'));
    navigationControls.replaceWith(navigation);
  };
  const studentJump = $('.about-students-jump');
  studentJump.hidden = !(profile.students || []).length;
  studentJump.onclick = () => {
    $('.about-students').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
    $('#about-students-title').focus({preventScroll: true});
  };
  // 首段身份显示在昵称下方，教育引言移至教学实践；保留资料中的 Markdown。
  const identity = main.querySelector('.about-body > p:first-child');
  if (identity && !identity.children.length && !/^(?:QQ|邮箱|Email|E-mail)\s*[:：]/i.test(identity.textContent.trim())) {
    identity.classList.add('about-identity');
    main.querySelector('.about-profile h1').after(identity);
  }
  const teachingBody = main.querySelector('.about-experience-body');
  const teachingQuote = main.querySelector('.about-body > blockquote');
  if (teachingBody && teachingQuote) {
    teachingQuote.classList.add('about-teaching-quote');
    const quoteParagraph = teachingQuote.querySelector('p');
    if (quoteParagraph && !quoteParagraph.children.length) {
      const text = quoteParagraph.textContent;
      const breakAt = text.indexOf('而不是');
      if (breakAt > 0) {
        quoteParagraph.replaceChildren(...[text.slice(0, breakAt), text.slice(breakAt)].map(phrase => {
          const span = document.createElement('span');
          span.className = 'about-quote-phrase';
          span.textContent = phrase;
          return span;
        }));
      }
    }
    teachingBody.prepend(teachingQuote);
  }
  formatTeachingContent(teachingBody);
  // Move explicit contact lines into one place, leaving the stored Markdown untouched.
  const contacts = new Map();
  main.querySelectorAll('.about-body p').forEach(paragraph => {
    if (paragraph.children.length) return;
    const text = paragraph.textContent.trim();
    const qq = text.match(/^QQ\s*[:：]\s*([0-9]{5,20})$/i);
    const mail = text.match(/^(?:邮箱|Email|E-mail)\s*[:：]\s*([^\s@]+@[^\s@]+\.[^\s@]+)$/i);
    const match = qq || mail;
    if (!match) return;
    const kind = qq ? 'QQ' : '邮箱';
    contacts.set(`${kind}:${match[1]}`, `<button type="button" class="about-contact" data-copy="${esc(match[1])}" title="点击复制${qq ? 'QQ号' : '邮箱'}"><span class="about-contact-kind">${kind}</span><span class="about-contact-value">${esc(match[1])}</span><span class="about-contact-action" aria-hidden="true">复制</span></button>`);
    paragraph.remove();
  });
  if (contacts.size) {
    $('.about-contact-section').hidden = false;
    const contactJump = $('.about-contact-jump');
    contactJump.hidden = false;
    contactJump.onclick = () => {
      $('.about-contact-section').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
      $('#about-contact-title').focus({preventScroll: true});
    };
    $('.about-contact-section .about-contacts').innerHTML = [...contacts.values()].join('');
    main.querySelectorAll('.about-body p').forEach(paragraph => {
      if (!paragraph.children.length && paragraph.textContent.trim() === '欢迎联系') paragraph.remove();
    });
  }
  if (!$('.about-body').textContent.trim() && !$('.about-body').querySelector('img')) $('.about-introduction').remove();
  if (!$('.about-story').children.length) $('.about-story').remove();
  main.querySelectorAll('.about-contact').forEach(button => {
    button.onclick = async () => {
      const text = button.dataset.copy;
      const status = $('#about-copy-status');
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = `已复制 ${text}`;
        button.classList.add('is-copied');
        setTimeout(() => button.classList.remove('is-copied'), 1200);
      } catch { status.textContent = `可手动复制：${text}`; }
    };
  });
}
function showForm(title, fields, submit, label = '保存', options = {}) {
  dialogBeforeLeave = null;
  dialog.classList.toggle('writing-dialog', !!options.writing);
  $('#dialog-title').textContent = title; $('#fields').innerHTML = fields; $('#form-error').textContent = ''; $('#save').textContent = label;
  $('#save-hint').textContent = '';
  const original = options.watch ? formValues($('#form')) : null;
  dialogHasChanges = () => !!options.watch && (formValues($('#form')) !== original || !!options.extraChanges?.());
  $('#form').onsubmit = async event => {
    event.preventDefault(); $('#save').disabled = true; $('#close').disabled = true; $('#fields').inert = true;
    try { await submit(Object.fromEntries(new FormData(event.target))); dialogHasChanges = () => false; dialog.close(); }
    catch (error) { $('#form-error').textContent = error.message; }
    finally { $('#save').disabled = false; $('#close').disabled = false; $('#fields').inert = false; }
  };
  if (!dialog.open) dialog.showModal();
  $('#fields').scrollTop = 0;
  $('#fields').querySelector('input:not([type=hidden]),textarea')?.focus({preventScroll:true});
}
$('#close').onclick = async () => { if (await canLeave()) dialog.close(); };
dialog.addEventListener('cancel', async event => { event.preventDefault(); if (await canLeave()) dialog.close(); });
dialog.addEventListener('close', () => { dialogHasChanges = () => false; dialogBeforeLeave = null; });
window.addEventListener('beforeunload', event => { if (hasChanges() || pageIsBusy() || (dialog.open && $('#save').disabled)) { event.preventDefault(); event.returnValue = ''; } });
function field(name, label, value = '', type = 'text', required = false, extra = '') { return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0" max="10" step="0.1"' : ''} ${type === 'password' ? 'autocomplete="current-password"' : ''} ${extra}></label>`; }
function area(name, label, value = '', rows = 4, max = 50000) { return `<label>${label}<textarea name="${name}" rows="${rows}" maxlength="${max}">${esc(value)}</textarea></label>`; }
function login(destination = 'posts') {
  showForm('登录私人空间', field('username', '用户名', '', 'text', true, 'autocomplete="username"') + field('password', '密码', '', 'password', true) + '<p class="hint">使用你为小站设置的账号登录。</p>', async data => { await api('login', 'POST', data); authenticated = true; await renderRoute('private/' + destination); }, '登录');
}
function privateShell(kind) {
  return `<div class="layout"><aside class="sidebar private-sidebar"><details class="manage-navigation" ${window.innerWidth > 650 ? 'open' : ''}><summary>${kind === 'profile' ? '个人资料' : kind === 'drafts' ? '继续草稿' : kinds[kind].name}<span>切换栏目</span></summary><nav class="directory private-nav" aria-label="私人功能"><a href="#private/drafts" ${kind === 'drafts' ? 'aria-current="page"' : ''}>${icon('note')}<span>继续草稿</span></a>${Object.entries(kinds).map(([key, value]) => `<a href="#private/${key}" ${kind === key ? 'aria-current="page"' : ''}>${icon(value.icon)}<span>${value.name}</span></a>`).join('')}<a href="#private/profile" ${kind === 'profile' ? 'aria-current="page"' : ''}>${icon('profile')}<span>个人资料</span></a></nav><div class="manage-utilities"><a class="export-all" href="/api/export.zip" download>导出全部内容 ↓</a><button class="logout" id="logout">退出登录 ↗</button></div></details></aside><section class="content" id="private-content"></section></div>`;
}
async function showAllDrafts(version) {
  try {
    const drafts = await api('drafts'); if (version !== routeVersion) return;
    $('#private-content').innerHTML = heading('继续草稿') + '' + (drafts.length ? `<section class="drafts">${draftRowsMarkup(drafts,true)}</section>` : empty('还没有草稿','通过“写点什么”开始记录，未发布的文章和笔记会保存在这里。'));
    bindDraftRows($('#private-content'),drafts,() => showAllDrafts(routeVersion));
  } catch(error) {
    if (version !== routeVersion) return;
    $('#private-content').innerHTML = empty('暂时无法读取草稿',error.message) + '<button id="retry-drafts">重新读取</button>';
    $('#retry-drafts').onclick = () => error.status === 401 ? login('drafts') : showAllDrafts(routeVersion);
  }
}
async function workspace(kind, version) {
  if (!authenticated) { publicLayout(heading('私人空间') + '<div class="profile-settings"><h2>记录与整理，从这里开始。</h2><p class="summary">登录后可管理内容、设置公开范围，也可以更换头像。</p><button class="primary" id="login-button">登录私人空间</button></div>'); $('#login-button').onclick = () => login(kind); return; }
  main.innerHTML = privateShell(kind);
  $('#logout').onclick = async () => {
    if (!await canLeave()) return;
    const button = $('#logout'), previousBusy = pageIsBusy;
    pageIsBusy = () => true; main.inert = true; button.disabled = true; button.textContent = '正在退出…';
    try { await api('logout', 'POST', {}); pageHasChanges = () => false; authenticated = false; privateRecords = []; go('home'); toast('已退出登录'); }
    catch (error) { toast(error.message); }
    finally { pageIsBusy = previousBusy; main.inert = false; button.disabled = false; button.textContent = '退出登录 ↗'; }
  };
  if (kind === 'drafts') { await showAllDrafts(version); return; }
  if (kind === 'profile') { await profileSettings(version); return; }
  const params = routeParams();
  privateVisibility = ['public','private'].includes(params.get('visibility')) ? params.get('visibility') : '';
  privateKind = kind; search = params.get('q') || ''; category = (kind === 'works' && categories.includes(params.get('category'))) || (kind === 'notes' ? params.get('category') || '' : '') ? params.get('category') : ''; sort = kind === 'works' && params.get('sort') === 'rating' ? 'rating' : 'updated';
  const categoryOptions = kind === 'works' ? categories : kind === 'notes' ? noteCategories() : [];
  $('#private-content').innerHTML = `<div class="heading manage-head"><div><h1>${kinds[kind].name}</h1></div><div class="manage-head-actions">${kind === 'works' ? '<button class="subtle" id="work-category-visibility" type="button">分类公开设置</button>' : ''}${kind === 'notes' ? '<button class="subtle" id="toggle-note-category-order" type="button">整理分类</button><button class="subtle" id="toggle-note-order" type="button">调整顺序</button>' : ''}<button class="primary" id="add">＋ 新增</button></div></div><div class="filters"><input id="private-search" type="search" aria-label="搜索${kinds[kind].name}" placeholder="搜索${kinds[kind].name}…">${['works','notes'].includes(kind) ? `<select id="category" aria-label="分类筛选"><option value="">全部分类</option>${categoryOptions.map(c => `<option>${esc(c)}</option>`).join('')}</select>${kind === 'works' ? '<select id="sort" aria-label="排序"><option value="updated">最近更新</option><option value="rating">评分从高到低</option></select>' : ''}` : ''}<select id="private-visibility" aria-label="公开范围"><option value="">全部范围</option><option value="public">已公开</option><option value="private">仅自己可见</option></select><span id="count"></span></div><div id="draft-list"></div><div id="private-list" aria-live="polite"><p class="loading">正在读取…</p></div>`;
  $('#add').onclick = () => editRecord(kind);
  if (kind === 'works') $('#work-category-visibility').onclick = openWorkCategoryVisibility;
  $('#private-search').value = search;
  const applyFilters = () => { saveListParams({q:search,category,sort:sort === 'updated' ? '' : sort,visibility:privateVisibility}); renderPrivate(); };
  $('#private-visibility').value = privateVisibility;
  $('#private-visibility').onchange = event => { privateVisibility = event.target.value; applyFilters(); };
  $('#private-search').oninput = event => { search = event.target.value; applyFilters(); };
  if (kind === 'notes') {
    $('#toggle-note-category-order').onclick = () => openNoteCategoryOrderEditor();
    $('#toggle-note-order').onclick = () => { if (!category) { toast('请先选择一个分类，再调整其中的笔记顺序。'); return; } openNoteOrderEditor(category); };
  }
  if (['works','notes'].includes(kind)) { $('#category').onchange = event => { category = event.target.value; applyFilters(); }; $('#category').value = category; if (kind === 'works') { $('#sort').value = sort; $('#sort').onchange = event => { sort = event.target.value; applyFilters(); }; } }
  try { const [rows, drafts] = await Promise.all([api(kind), ['posts','notes','projects'].includes(kind) ? api('drafts') : Promise.resolve([])]); if (version !== routeVersion) return; privateRecords = rows; privateDrafts = drafts; if (kind === 'notes') { const values = noteCategories(rows); $('#category').innerHTML = '<option value="">全部分类</option>' + values.map(value => `<option>${esc(value)}</option>`).join(''); $('#category').value = category; } renderPrivate(); }
  catch (error) { if (version !== routeVersion) return; if (error.status === 401) { authenticated = false; await workspace(kind, version); } else { $('#private-list').innerHTML = empty('暂时无法读取', error.message) + '<button id="retry">重新读取</button>'; $('#retry').onclick = renderRoute; } }
}
function renderPrivate() {
  if (!$('#private-list')) return;
  renderDrafts();
  const visibilityRecord = row => privateKind === 'works' ? {...row,published:row.published && !(site.hidden_work_categories || []).includes(workCategory(row))} : row;
  const rows = privateRecords.filter(r => (!category || r.category === category) && matchesSearch(r,search) && matchesVisibility(visibilityRecord(r),privateVisibility)).sort((a, b) => privateKind === 'friends' ? (a.order||0)-(b.order||0) || b.updated-a.updated : privateKind === 'works' && sort === 'rating' ? ((b.rating ?? -1) - (a.rating ?? -1)) || b.updated - a.updated : b.updated - a.updated);
  $('#count').textContent = `${rows.length} 条`;
  $('#private-list').innerHTML = rows.length ? (privateKind === 'works' ? `<div class="work-grid managed-shelf">${rows.map(r => workCard(r, true)).join('')}</div>` : rows.map(r => managedRecord(r, privateKind)).join('')) : empty(search || category || privateVisibility ? '没有匹配的记录' : '还没有' + kinds[privateKind].name, search || category || privateVisibility ? '换个关键词、分类或公开范围试试。' : '点击「新增」，从第一条开始。');
  bindCoverImages($('#private-list'));
  $('#private-list').querySelectorAll('[data-edit]').forEach(button => button.onclick = () => editRecord(privateKind, privateRecords.find(r => r.id === Number(button.dataset.edit))));
  $('#private-list').querySelectorAll('[data-delete]').forEach(button => button.onclick = () => {
    const kind = privateKind, row = privateRecords.find(r => r.id === Number(button.dataset.delete));
    showForm('删除记录', `<p>确定删除「${esc(row.title)}」？删除后无法恢复。</p>`, async () => { await api(kind + '/' + row.id, 'DELETE', {}); await refreshContent(kind); toast('已删除'); }, '确认删除');
  });
}
function workCategoryVisibilityMarkup(hidden) {
  return '<p class="hint">勾选要隐藏的大类。该类下的全部作品将停止公开展示；取消勾选后，恢复各条作品原来的公开状态。</p>' + categories.map((name,index) => `<label class="checkbox-label"><input type="checkbox" name="category-${index}" ${hidden.includes(name) ? 'checked' : ''}><span>隐藏${esc(name)}<small>${privateRecords.filter(row => workCategory(row) === name).length} 部作品</small></span></label>`).join('');
}
async function openWorkCategoryVisibility() {
  const button = $('#work-category-visibility'), version = routeVersion;
  button.disabled = true;
  try {
    const result = await api('works/categories/visibility');
    if (version !== routeVersion) return;
    showForm('作品分类公开设置', workCategoryVisibilityMarkup(result.hidden_categories), async data => {
      await api('works/categories/visibility', 'PUT', {hidden_categories:categories.filter((name,index) => data[`category-${index}`] === 'on')});
      await refreshContent('works');
      toast('已保存分类公开设置');
    }, '保存设置', {watch:true});
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
function noteCategoryOrderEditorMarkup(rows) {
  return `<section class="note-order-editor category-order-editor"><div class="note-order-heading"><div><h2>整理笔记分类</h2><p>拖动排列，或用上下按钮微调。</p></div><span>${rows.length} 个分类</span></div><div class="note-order-list" id="note-category-order-list">${rows.map((name,index) => `<article class="note-order-row" data-category-order-name="${esc(name)}"><span class="note-order-handle" draggable="true" aria-hidden="true">⠿</span><span class="note-order-index">${String(index+1).padStart(2,'0')}</span><span class="note-order-copy"><strong>${esc(name)}</strong><small>分类内笔记会保留自己的顺序</small></span><span class="note-order-actions"><button type="button" data-category-move="up" aria-label="上移 ${esc(name)}">↑</button><button type="button" data-category-move="down" aria-label="下移 ${esc(name)}">↓</button></span></article>`).join('')}</div></section>`;
}
function openNoteCategoryOrderEditor() {
  const values = [...new Set(privateRecords.map(noteCategory).filter(Boolean))];
  const saved = Array.isArray(site.note_category_order) ? site.note_category_order : [];
  values.sort((a,b) => {
    const ai = saved.indexOf(a), bi = saved.indexOf(b);
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi) || a.localeCompare(b, 'zh-CN');
  });
  const original = values.join('|');
  showForm('整理笔记分类', noteCategoryOrderEditorMarkup(values), async () => {
    const categories = [...$('#note-category-order-list').children].map(row => row.dataset.categoryOrderName);
    const result = await api('notes/categories/order', 'POST', {categories});
    site.note_category_order = result.categories;
    await refreshContent('notes');
    toast('分类顺序已保存');
  }, '保存分类顺序');
  const list = $('#note-category-order-list');
  const names = () => [...list.children].map(row => row.dataset.categoryOrderName);
  dialogHasChanges = () => names().join('|') !== original;
  const refreshIndices = () => [...list.children].forEach((row,index) => {
    row.querySelector('.note-order-index').textContent = String(index+1).padStart(2,'0');
    row.querySelector('[data-category-move="up"]').disabled = index === 0;
    row.querySelector('[data-category-move="down"]').disabled = index === list.children.length-1;
  });
  list.querySelectorAll('[data-category-move]').forEach(button => button.onclick = () => {
    const row = button.closest('.note-order-row'), target = button.dataset.categoryMove === 'up' ? row.previousElementSibling : row.nextElementSibling;
    if (!target) return;
    if (button.dataset.categoryMove === 'up') list.insertBefore(row, target); else list.insertBefore(target, row);
    refreshIndices();
  });
  let dragging = null;
  list.addEventListener('dragstart', event => {
    if (!event.target.closest('.note-order-handle')) return;
    dragging = event.target.closest('.note-order-row'); dragging.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', event => {
    if (!dragging) return;
    event.preventDefault(); const row = event.target.closest('.note-order-row');
    if (!row || row === dragging) return;
    const rect = row.getBoundingClientRect();
    list.insertBefore(dragging, event.clientY > rect.top + rect.height / 2 ? row.nextElementSibling : row); refreshIndices();
  });
  list.addEventListener('dragend', () => { dragging?.classList.remove('is-dragging'); dragging = null; refreshIndices(); });
  refreshIndices();
}
function noteOrderEditorMarkup(rows, selectedCategory) {
  return `<section class="note-order-editor"><div class="note-order-heading"><div><h2>调整「${esc(selectedCategory)}」顺序</h2><p>拖动排列，或用上下按钮微调。</p></div><span>${rows.length} 条</span></div><div class="note-order-list" id="note-order-list">${rows.map((row,index) => `<article class="note-order-row" data-note-order-id="${row.id}"><span class="note-order-handle" draggable="true" aria-hidden="true">⠿</span><span class="note-order-index">${String(index+1).padStart(2,'0')}</span><span class="note-order-copy"><strong>${esc(row.title)}</strong><small>${date(row.updated)}${row.published ? '' : ' · 仅自己可见'}</small></span><span class="note-order-actions"><button type="button" data-note-move="up" aria-label="上移 ${esc(row.title)}">↑</button><button type="button" data-note-move="down" aria-label="下移 ${esc(row.title)}">↓</button></span></article>`).join('')}</div></section>`;
}
function openNoteOrderEditor(selectedCategory) {
  const rows = privateRecords.filter(row => noteCategory(row) === selectedCategory).sort(compareNoteOrder);
  const original = rows.map(row => row.id).join(',');
  showForm('调整笔记顺序', noteOrderEditorMarkup(rows, selectedCategory), async () => {
    await api('notes/reorder', 'POST', {category:selectedCategory, ids:ids()});
    await refreshContent('notes'); toast('笔记顺序已保存');
  }, '保存顺序');
  const list = $('#note-order-list');
  const ids = () => [...list.children].map(row => Number(row.dataset.noteOrderId));
  dialogHasChanges = () => ids().join(',') !== original;
  const refreshIndices = () => [...list.children].forEach((row,index) => {
    row.querySelector('.note-order-index').textContent = String(index+1).padStart(2,'0');
    row.querySelector('[data-note-move="up"]').disabled = index === 0;
    row.querySelector('[data-note-move="down"]').disabled = index === list.children.length-1;
  });
  list.querySelectorAll('[data-note-move]').forEach(button => button.onclick = () => {
    const row = button.closest('.note-order-row'), target = button.dataset.noteMove === 'up' ? row.previousElementSibling : row.nextElementSibling;
    if (!target) return;
    if (button.dataset.noteMove === 'up') list.insertBefore(row,target); else list.insertBefore(target,row);
    refreshIndices();
    (button.disabled ? row.querySelector('[data-note-move]:not(:disabled)') : button)?.focus();
  });
  let dragging = null, beforeDrag = [];
  list.addEventListener('dragstart', event => {
    if (!event.target.closest('.note-order-handle')) return;
    dragging = event.target.closest('.note-order-row'); beforeDrag = [...list.children];
    dragging.classList.add('is-dragging'); event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain',dragging.dataset.noteOrderId);
  });
  list.addEventListener('dragover', event => {
    if (!dragging) return;
    event.preventDefault(); const row=event.target.closest('.note-order-row');
    if (!row || row===dragging) return;
    const rect=row.getBoundingClientRect();
    list.insertBefore(dragging,event.clientY > rect.top+rect.height/2 ? row.nextElementSibling : row); refreshIndices();
  });
  list.addEventListener('drop', event => { if (dragging) { event.preventDefault(); beforeDrag=[]; } });
  list.addEventListener('dragend', () => {
    if (beforeDrag.length) beforeDrag.forEach(row => list.appendChild(row));
    dragging?.classList.remove('is-dragging'); dragging=null; refreshIndices();
  });
  refreshIndices();
}
function managedRecord(record, kind) {
  const writing = ['posts', 'notes', 'projects'].includes(kind);
  const friend = kind === 'friends';
  const friendAvatar = friend ? `<span class="friend-avatar">${record.avatar_url ? `<img src="${esc(record.avatar_url)}" alt="">` : esc(Array.from(record.title || '友')[0])}</span>` : '';
  return `<article class="record ${writing ? 'managed-writing' : friend ? 'friend-record' : ''}"><div class="record-top${friend ? ' friend-management-heading' : ''}">${friendAvatar}<h2>${record.url ? `<a href="${esc(record.url)}" target="_blank" rel="noreferrer">${esc(record.title)} ↗</a>` : esc(record.title)}</h2><span class="visibility ${record.published ? '' : 'private'}">${record.published ? '已公开' : '仅自己可见'}</span></div>${friend ? `<p class="friend-order">顺序 ${esc(record.order || 0)}</p>` : ''}${writing ? `<p class="managed-excerpt">${esc(excerpt(record.summary || record.body, 160)) || '还没有正文。'}</p>${record.category ? `<p class="meta">分类：${esc(record.category)}</p>` : ''}${record.tags ? `<p class="meta">${esc(record.tags)}</p>` : ''}` : recordBody(record, kind)}<div class="record-bottom"><time>${date(record.updated)}</time><div>${writing && record.published ? `<a href="#read/${kind}/${record.id}">查看公开页 ↗</a>` : ''}${writing ? `<a href="/api/export/${kind}/${record.id}.zip" download>导出 ↓</a>` : ''}<button data-edit="${record.id}">编辑</button><button data-delete="${record.id}">删除</button></div></div></article>`;
}
async function refreshContent(kind) {
  site = await api('public');
  if (privateKind === kind && $('#private-list')) {
    [privateRecords, privateDrafts] = await Promise.all([api(kind), ['posts','notes','projects'].includes(kind) ? api('drafts') : Promise.resolve([])]);
    renderPrivate();
  } else {
    const [page, type, id] = routeFromLocation().split('?')[0].split('/');
    if (page === 'read' && type === kind) readRecord(kind, id);
    else await renderRoute();
  }
}
function editRecord(kind, record = {}) {
  if (!record.id) record = {...newRecordDefaults(kind), ...record};
  if (['posts','notes','projects'].includes(kind)) { openWritingEditor(kind, record).catch(error => toast(error.message)); return; }
  const supportsCover = ['posts', 'works'].includes(kind);
  const writing = ['posts', 'notes', 'projects'].includes(kind);
  let savedId = record.id, pendingCover, pendingFriendAvatar, coverProcessing = false;
  const titleField = field('title', kind === 'works' ? '作品名称' : kind === 'friends' ? '站点名称' : '标题', record.title, 'text', true, 'maxlength="4000"');
  let fields = '', coverFields = '';
  if (supportsCover) coverFields = `<section class="cover-editor" id="cover-editor" aria-labelledby="cover-label"><span id="cover-label">${kind === 'works' ? '作品封面' : '文章封面'}</span><div class="cover-preview ${kind === 'works' ? 'portrait-preview' : ''}" id="cover-preview" ${record.cover_url ? '' : 'hidden'}>${record.cover_url ? `<img src="${esc(record.cover_url)}" alt="当前封面">` : ''}</div><input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="cover-editor-actions"><button type="button" id="choose-cover" class="subtle">上传封面</button><button type="button" id="paste-cover" class="subtle">粘贴封面</button>${kind === 'works' ? '<button type="button" id="search-cover" class="subtle">搜索封面</button>' : ''}<button type="button" id="remove-cover" ${record.cover_url ? '' : 'hidden'}>移除封面</button></div><p class="hint">PNG/JPG/WebP，最大 8 MB。可粘贴截图（Ctrl/Cmd+V）。</p><p class="form-status" id="cover-status" role="status"></p>${kind === 'works' ? '<div class="cover-search"><p id="cover-search-status" class="hint" role="status">输入名称后自动查找封面。</p><div id="cover-candidates" class="cover-candidates" aria-label="候选封面" hidden></div></div>' : ''}</section>`;
  if (kind === 'friends') fields += `<section class="friend-image-editor"><span class="friend-avatar" id="friend-avatar-preview">${record.avatar_url ? `<img src="${esc(record.avatar_url)}" alt="友链头像">` : esc(Array.from(record.title || '友')[0])}</span><input type="file" id="friend-avatar-file" accept="image/png,image/jpeg,image/webp" hidden><button type="button" id="choose-friend-avatar">选择头像</button><button type="button" id="remove-friend-avatar" ${record.avatar_url ? '' : 'hidden'}>移除头像</button><p id="friend-image-status" class="hint" role="status"></p></section><label>显示顺序<input name="order" type="number" step="1" min="-100000" max="100000" value="${esc(record.order || 0)}"><small>数字越小越靠前。</small></label>`;
  if (['friends', 'bookmarks'].includes(kind)) fields += field('url', '链接', record.url, 'url', true);
  if (['posts', 'bookmarks'].includes(kind)) fields += field('tags', '标签（逗号分隔，可留空）', record.tags);
  if (kind === 'posts') fields += area('summary', '摘要（可留空，默认取正文开头）', record.summary, 3, 4000);
  if (kind === 'works') {
    const cat0 = rememberedWorkCategory(record);
    // New records default to the category's completion verb; legacy free-text progress maps onto it.
    const statusKind = (record.progress || record.id) ? workStatus({...record, category: cat0}) : 'seen';
    fields += `<label>状态${workStatusSelect(cat0, statusKind)}</label>` + field('rating', '评分（0–10，可留空）', record.rating, 'number');
  }
  if (!['posts', 'notes'].includes(kind)) fields += area('notes', kind === 'works' ? '短评' : kind === 'friends' ? '站点简介' : '备注', record.notes, 4, 4000);
  if (supportsCover) fields += kind === 'works' ? `<details class="work-cover-settings"><summary>${record.cover_url ? `<img class="work-cover-thumb" src="${esc(record.cover_url)}" alt="当前封面">` : ''}<span>封面设置</span><small id="cover-summary-note" class="hint">${record.cover_url ? '已设置' : '搜索或上传'}</small></summary>${coverFields}</details>` : coverFields;
  fields += `<label class="checkbox-label"><input type="checkbox" name="is_private" ${(record.id ? record.published !== true : record.published === false) ? 'checked' : ''}><span>仅自己可见<small>勾选后设为私密。</small></span></label>`;
  fields = titleField + (kind === 'works' ? `<fieldset class="category-modules"><legend>分类</legend>${categories.map(c => `<label class="category-module"><input type="radio" name="category" value="${esc(c)}" ${c === rememberedWorkCategory(record) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</fieldset>` : '') + fields;
  showForm((record.id ? '编辑' : '新增') + kinds[kind].name, fields, async data => {
    if (coverProcessing) throw new Error('正在处理封面，请稍候再保存。');
    data.published = data.is_private !== 'on';
    delete data.is_private;
    if (kind === 'friends') data.order = Number(data.order);
    if (kind === 'works' && data.category) { try { localStorage.setItem('work-category-last', data.category); } catch {} }
    if (supportsCover) { $('#choose-cover').disabled = true; $('#remove-cover').disabled = true; }
    try {
      const result = await api(kind + (savedId ? '/' + savedId : ''), savedId ? 'PUT' : 'POST', data);
      savedId = savedId || result.id;
      if (supportsCover && pendingCover !== undefined) {
        try {
          const response = await api(`${kind}/${savedId}/cover`, pendingCover === null ? 'DELETE' : 'POST', pendingCover === null ? {} : {image: pendingCover});
          record.cover_url = response.cover_url; pendingCover = undefined;
        } catch (error) {
          throw new Error('文字内容已保存，封面未保存：' + error.message + ' 可以再次点击保存重试。');
        }
      }
      if (kind === 'friends' && pendingFriendAvatar !== undefined) {
        try {
          if (pendingFriendAvatar === null && record.avatar_url) await api('media/' + record.avatar_url.match(/\/media\/([a-f0-9]{32})/)[1], 'DELETE', {});
          else if (pendingFriendAvatar !== null) await api('media','POST',{owner_type:'friend',owner_key:String(savedId),role:'avatar',image:pendingFriendAvatar});
          pendingFriendAvatar = undefined;
        } catch(error) { throw new Error('文字已保存，友链头像未保存：' + error.message + '，可再次保存重试。'); }
      }
      await refreshContent(kind); toast(data.published ? '已保存并公开' : '已保存，仅自己可见');
    } finally {
      if (supportsCover && $('#cover-editor')) { $('#choose-cover').disabled = false; $('#remove-cover').disabled = false; }
    }
  }, '保存', {writing, watch:true, extraChanges:() => pendingCover !== undefined || pendingFriendAvatar !== undefined});
  bindWorkStatusSelect($('#fields'));
  const visibility = $('#fields input[name=is_private]');
  const updateVisibility = () => { $('#save-hint').textContent = visibility.checked ? '保存后仅自己可见' : '保存后公开，所有访客可见'; };
  visibility.onchange = updateVisibility; updateVisibility();
  if (kind === 'friends') {
    $('#choose-friend-avatar').onclick = () => $('#friend-avatar-file').click();
    $('#remove-friend-avatar').onclick = () => { pendingFriendAvatar = null; $('#friend-avatar-preview').textContent = '友'; $('#remove-friend-avatar').hidden = true; $('#friend-image-status').textContent = '保存后移除头像。'; };
    $('#friend-avatar-file').onchange = async event => {
      const file=event.target.files[0]; if(!file)return; coverProcessing=true; $('#save').disabled=true; $('#close').disabled=true;
      try { const result=await openImageEditor(file,{title:'调整友链头像',width:256,height:256,mimeType:'image/jpeg',circular:true}); if(result){pendingFriendAvatar=result;$('#friend-avatar-preview').innerHTML=`<img src="${result}" alt="待保存的友链头像">`;$('#remove-friend-avatar').hidden=false;$('#friend-image-status').textContent='随友链一起保存。';} }
      catch(error){$('#friend-image-status').textContent=error.message;}
      finally{coverProcessing=false;$('#save').disabled=false;$('#close').disabled=false;event.target.value='';}
    };
  }
  if (!supportsCover) return;
  const editor = $('#cover-editor');
  const syncCoverSummary = () => {
    const summary = dialog.querySelector('.work-cover-settings > summary'); if (!summary) return;
    summary.querySelector('.work-cover-thumb')?.remove();
    const preview = $('#cover-preview img');
    if (preview && !$('#cover-preview').hidden) {
      const thumbnail = document.createElement('img'); thumbnail.className = 'work-cover-thumb';
      thumbnail.src = preview.src; thumbnail.alt = '待保存封面'; summary.prepend(thumbnail);
    }
    $('#cover-summary-note').textContent = preview && !$('#cover-preview').hidden ? '待保存' : '未设置';
  };
  $('#choose-cover').onclick = () => $('#cover-file').click();
  const takePastedImage = async (file, source = '已粘贴图片作为封面，点击保存后生效。') => {
    if (!file) return;
    await prepareCover(async () => file, source);
  };
  const readClipboardImage = async () => {
    if (!navigator.clipboard?.read) {
      $('#cover-status').textContent = '当前浏览器不支持读取剪贴板，请在对话框内按 Ctrl/Cmd+V 粘贴截图。';
      return;
    }
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(value => value.startsWith('image/'));
        if (type) { await takePastedImage(await item.getType(type)); return; }
      }
      $('#cover-status').textContent = '剪贴板里没有图片，可先截屏再点「粘贴封面」。';
    } catch {
      $('#cover-status').textContent = '未能读取剪贴板，请在对话框内按 Ctrl/Cmd+V 粘贴截图。';
    }
  };
  $('#paste-cover').onclick = readClipboardImage;
  dialog.addEventListener('paste', async event => {
    if ($('#cover-editor') !== editor || !dialog.open) return;
    const item = Array.from(event.clipboardData?.items || []).find(entry => entry.kind === 'file' && entry.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    await takePastedImage(item.getAsFile(), '已粘贴截图作为封面，点击保存后生效。');
  });
  $('#remove-cover').onclick = () => { pendingCover = null; $('#cover-preview').hidden = true; $('#cover-preview').innerHTML = ''; $('#cover-file').value = ''; $('#remove-cover').hidden = true; $('#cover-status').textContent = '保存后将移除封面。'; syncCoverSummary(); };
  const prepareCover = async (loadFile, message = '预览已准备好，点击保存后生效。', allowGif = false) => {
    if (coverProcessing || $('#save').disabled) return false;
    coverProcessing = true; $('#save').disabled = true; $('#close').disabled = true; editor.inert = true; $('#cover-status').textContent = '正在准备封面预览…';
    try {
      const image = await normalizedCover(await loadFile(), allowGif);
      if ($('#cover-editor') !== editor || !dialog.open) return false;
      pendingCover = image; $('#cover-preview').innerHTML = `<img src="${image}" alt="待保存的封面预览">`; $('#cover-preview').hidden = false; $('#remove-cover').hidden = false; $('#cover-status').textContent = message; syncCoverSummary();
      return true;
    } catch (error) { if ($('#cover-editor') === editor) $('#cover-status').textContent = error.message; return false; }
    finally {
      coverProcessing = false;
      if ($('#cover-editor') === editor) { $('#save').disabled = false; $('#close').disabled = false; editor.inert = false; $('#cover-file').value = ''; }
    }
  };
  $('#cover-file').onchange = event => {
    const file = event.target.files[0]; if (file) prepareCover(() => file);
  };
  if (kind === 'works') bindCoverSearch(editor, prepareCover);
}
function bindCoverSearch(editor, prepareCover) {
  const title = $('#fields [name=title]'), category = $('#fields [name=category]');
  const status = $('#cover-search-status'), candidates = $('#cover-candidates'), button = $('#search-cover');
  let timer, request, revision = 0, composing = false;
  const active = () => dialog.open && $('#cover-editor') === editor;
  const cancel = () => { clearTimeout(timer); request?.abort(); revision++; };
  dialog.addEventListener('close', cancel, {once:true});
  const search = async () => {
    cancel();
    if (!active()) return;
    const query = title.value.trim(), own = revision;
    candidates.replaceChildren(); candidates.hidden = true;
    if (!query) { status.textContent = '先填写作品名称，即可搜索封面。'; return; }
    if (Array.from(query).length > 120) { status.textContent = '名称较长，请先缩短至 120 字以内再搜索封面。'; return; }
    status.textContent = `正在查找「${query}」的封面…`;
    if ($('#cover-summary-note')) $('#cover-summary-note').textContent = '正在查找…';
    request = new AbortController();
    try {
      const params = new URLSearchParams({q:query, category:($('#fields [name=category]:checked') || category).value});
      const response = await fetch('/api/cover-search?' + params, {signal:request.signal});
      const result = await response.json();
      if (!active() || own !== revision) return;
      if (!response.ok) throw new Error(result.error || '封面搜索暂不可用，请稍后重试或上传图片。');
      const rows = result.results;
      if ($('#cover-summary-note')) $('#cover-summary-note').textContent = rows.length ? `${rows.length} 个候选` : '可手动上传';
      status.textContent = result.message || (rows.length ? '点击封面选用，请核对名称与版本。' : '没有找到封面，可以换个名称再试，或上传图片。');
      candidates.innerHTML = rows.map((row, index) => `<article class="cover-candidate"><button type="button" data-cover-index="${index}" aria-label="选用《${esc(row.title)}》的封面"><span class="candidate-image"><img src="/api/cover-search/image?${esc(new URLSearchParams({url:row.image_url}).toString())}" alt="${esc(row.title)}封面" loading="lazy"><span class="candidate-image-error" hidden>图片暂不可用</span></span><strong>${esc(row.title)}</strong><small>${esc(row.subtitle)}</small></button><a href="${esc(row.source_url)}" target="_blank" rel="noreferrer">${esc(row.source)} ↗</a></article>`).join('');
      candidates.hidden = !rows.length;
      candidates.querySelectorAll('img').forEach(img => img.onerror = () => { img.hidden = true; img.nextElementSibling.hidden = false; img.closest('button').disabled = true; });
      candidates.querySelectorAll('[data-cover-index]').forEach(choice => choice.onclick = async () => {
        const row = rows[Number(choice.dataset.coverIndex)];
        const chosen = await prepareCover(async () => {
          const response = await fetch('/api/cover-search/image?' + new URLSearchParams({url:row.image_url}));
          if (!response.ok) { const failure = await response.json(); throw new Error(failure.error || '封面读取失败，请重试或上传图片。'); }
          return response.blob();
        }, `已选用《${row.title}》的封面（${row.source}），点击保存后生效。`, true);
        if (chosen && active()) { cancel(); candidates.hidden = true; status.textContent = '封面已选好。可重新搜索或上传另一张。'; }
      });
    } catch (error) {
      if (active() && own === revision && error.name !== 'AbortError') { status.textContent = error.message; if ($('#cover-summary-note')) $('#cover-summary-note').textContent = '可手动上传'; }
    }
  };
  const schedule = () => {
    cancel(); candidates.replaceChildren(); candidates.hidden = true;
    status.textContent = title.value.trim() ? '停止输入后自动查找封面…' : '输入作品名称后，按分类查找封面，点选后随作品保存。';
    if (!composing) timer = setTimeout(search, 700);
  };
  title.addEventListener('compositionstart', () => { composing = true; cancel(); });
  title.addEventListener('compositionend', () => { composing = false; schedule(); });
  title.addEventListener('input', schedule);
  ($('#fields .category-modules') || category).addEventListener('change', schedule);
  button.onclick = search;
}
async function normalizedCover(file, allowGif = false) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && !(allowGif && file.type === 'image/gif')) throw new Error('请选择 PNG、JPG 或 WebP 图片。');
  if (file.size > 8 * 1024 * 1024) throw new Error('封面图片请小于 8 MB。');
  try {
    const url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取图片，请重新选择。')); reader.readAsDataURL(file); });
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('无法读取图片，请换一张图片。');
    const ratio = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', .85);
    if (Math.ceil(result.split(',')[1].length * 3 / 4) > 2 * 1024 * 1024) throw new Error('这张图片压缩后仍较大，请选择尺寸更小的封面。');
    return result;
  } catch (error) { throw new Error(error.message.includes('图片') || error.message.includes('封面') ? error.message : '无法读取图片，请换一张 PNG、JPG 或 WebP 图片。'); }
}
async function normalizedAvatar(file) { return openImageEditor(file, {title:'调整个人头像',width:512,height:512,circular:true}); }
async function profileSettings(version) {
  $('#private-content').innerHTML = heading('个人资料') + '<p class="loading">正在读取…</p>';
  let profile;
  try { profile = await api('profile'); } catch (error) { if (version === routeVersion) { if (error.status === 401) { authenticated = false; await workspace('profile', version); } else $('#private-content').innerHTML = empty('暂时无法读取', error.message); } return; }
  if (version !== routeVersion) return;
  site.profile = profile;
  $('#private-content').innerHTML = heading('个人资料') + `<section class="profile-settings"><div class="avatar-editor"><div id="avatar-preview">${avatarMarkup(profile, '当前头像')}</div><div><h2>头像</h2><p class="hint">PNG/JPG/WebP，最大 10 MB，可拖动缩放。</p><input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="avatar-actions"><button id="choose-avatar" class="subtle">选择图片</button><button id="upload-avatar" class="primary" hidden>保存头像</button><button id="cancel-avatar" hidden>取消更换</button><button id="remove-avatar" ${profile.avatar_url ? '' : 'hidden'}>恢复默认</button></div><p class="form-status" id="avatar-status" role="status"></p></div></div><form id="profile-form" class="form-grid">${field('name', '昵称', profile.name, 'text', true, 'maxlength="80"')}${area('bio', '座右铭 / 首页简介', profile.bio, 3, 1000)}${area('about', '自我介绍与联系方式', profile.about || '', 6, 40000)}<p class="hint">支持 Markdown。首段简短身份介绍显示在昵称下方。QQ 和邮箱分别单独写一行，如 QQ：号码、邮箱：地址，公开页会显示复制按钮。</p><output id="about-count" class="hint" for="about-text"></output>${area('experience', '个人经历与成就', profile.experience || '', 5, 10000)}<p class="hint">支持 Markdown，可补充辅导经历与真实成就。</p><output id="experience-count" class="hint" for="experience-text"></output><fieldset class="student-editor"><legend>部分学生风采</legend><p class="hint">只填写姓氏（包括复姓），公开显示为张**。主要按 2026 软科中国大学总榜排序，国防科技大学参考校友会榜单置前；同校保留录入顺序，其他未列入榜单的学校置后。辅导科目可留空。</p><input type="hidden" name="students" value="${esc(JSON.stringify(profile.students || []))}"><div id="student-editor-rows"></div><button type="button" id="add-student" class="subtle">添加学生</button></fieldset><details class="about-preview"><summary>预览关于页内容</summary><div id="about-preview-body"></div></details><p class="form-status" id="profile-status" role="status"></p><button class="primary settings-save" type="submit">保存资料</button></form><section class="background-editor"><h2>主页背景</h2><p class="hint">3:1 裁剪，取消则保留原背景。</p><div class="background-preview" id="background-preview"><img src="${esc(profile.background_url || '/cover.jpg')}" alt="主页背景预览"></div><input type="file" id="background-file" accept="image/png,image/jpeg,image/webp" hidden><div class="background-actions"><button id="choose-background">选择背景</button><button id="save-background" class="primary" hidden>保存背景</button><button id="cancel-background" hidden>取消更换</button><button id="remove-background" ${profile.background_url ? '' : 'hidden'}>恢复默认背景</button></div><p id="background-status" class="form-status" role="status"></p></section></section>`;
  let pending = null, pendingBackground = null, busy = false, selection = 0;
  const profileForm = $('#profile-form');
  const aboutInput = profileForm.elements.about; aboutInput.id = 'about-text';
  const experienceInput = profileForm.elements.experience; experienceInput.id = 'experience-text';
  const studentRows = $('#student-editor-rows');
  const readStudents = () => sortedStudents([...studentRows.children].map(row => Object.fromEntries([...row.querySelectorAll('[data-student-field]')].map(input => [input.dataset.studentField,input.value.trim()]))));
  const updateAbout = () => {
    for (const [input,maximum,label,countId] of [[aboutInput,20000,'自我介绍','about-count'],[experienceInput,5000,'个人经历','experience-count']]) {
      const count = Array.from(input.value).length;
      input.setCustomValidity(count > maximum ? `${label}最多 ${maximum.toLocaleString('zh-CN')} 字符，请缩短后再保存。` : '');
      $('#' + countId).textContent = `${count.toLocaleString('zh-CN')} / ${maximum.toLocaleString('zh-CN')} 字符`;
    }
    profileForm.elements.students.value = JSON.stringify(readStudents());
    $('#add-student').disabled = studentRows.children.length >= 60;
    if ($('.about-preview').open) {
      $('#about-preview-body').innerHTML = `<div class="markdown">${markdown(aboutInput.value)}</div>${experienceInput.value ? `<h3>教学实践</h3><div class="markdown about-experience-body">${markdown(experienceInput.value)}</div>` : ''}<h3>部分学生风采</h3>${studentWall(readStudents())}`;
      formatTeachingContent($('#about-preview-body .about-experience-body'));
    }
  };
  const appendStudent = (student = {}) => {
    const row = document.createElement('div'); row.className = 'student-editor-row';
    row.innerHTML = `<label>姓氏<input data-student-field="surname" value="${esc(student.surname || '')}" required maxlength="4" pattern="\\p{Unified_Ideograph}{1,2}" placeholder="如：张" autocomplete="off" title="只填写一字或两字姓氏"></label><label>辅导科目（选填）<input data-student-field="subjects" value="${esc(student.subjects || '')}" maxlength="80" placeholder="如：数学、物理"></label><label>大学去向<input data-student-field="university" value="${esc(student.university || '')}" required maxlength="120" placeholder="就读大学名称"></label><button type="button" class="remove-student">删除</button>`;
    studentRows.append(row);
    return row;
  };
  sortedStudents(profile.students || []).forEach(appendStudent);
  const numberStudents = () => [...studentRows.children].forEach((row,index) => row.querySelector('.remove-student').setAttribute('aria-label',`删除第 ${index + 1} 位学生`));
  $('#add-student').onclick = () => { const row = appendStudent(); numberStudents(); updateAbout(); row.querySelector('input').focus(); };
  studentRows.addEventListener('click',event => {
    if (!event.target.closest('.remove-student')) return;
    const row = event.target.closest('.student-editor-row');
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove(); numberStudents(); updateAbout();
    (next?.querySelector('input') || $('#add-student')).focus();
  });
  studentRows.addEventListener('input',updateAbout);
  aboutInput.addEventListener('input',updateAbout); experienceInput.addEventListener('input',updateAbout); $('.about-preview').addEventListener('toggle',updateAbout); numberStudents(); updateAbout();
  let savedProfileValues = formValues(profileForm);
  pageHasChanges = () => pending !== null || pendingBackground !== null || formValues(profileForm) !== savedProfileValues;
  pageIsBusy = () => busy;
  const reset = () => { pending = null; $('#avatar-preview').innerHTML = avatarMarkup(profile, '当前头像'); $('#upload-avatar').hidden = true; $('#cancel-avatar').hidden = true; $('#remove-avatar').hidden = !profile.avatar_url; $('#avatar-file').value = ''; };
  const setBusy = value => { busy = value; profileForm.inert = value; for (const id of ['choose-avatar', 'upload-avatar', 'cancel-avatar', 'remove-avatar','choose-background','save-background','cancel-background','remove-background']) $('#' + id).disabled = value; };
  $('#choose-avatar').onclick = () => $('#avatar-file').click();
  $('#avatar-file').onchange = async event => {
    const file = event.target.files[0]; if (!file) return; const own = ++selection;
    setBusy(true); $('#avatar-status').textContent = '正在准备预览…';
    try { const result = await normalizedAvatar(file); if (version !== routeVersion || selection !== own || result === null) return; pending = result; $('#avatar-preview').innerHTML = avatarMarkup({avatar_url: result}, '待保存的头像预览'); $('#upload-avatar').hidden = false; $('#cancel-avatar').hidden = false; $('#remove-avatar').hidden = true; $('#avatar-status').textContent = '预览已准备好，点击「保存头像」完成更换。'; }
    catch (error) { if (version === routeVersion) { reset(); $('#avatar-status').textContent = error.message; } }
    finally { if (version === routeVersion) { setBusy(false); $('#avatar-file').value = ''; } }
  };
  $('#cancel-avatar').onclick = () => { reset(); $('#avatar-status').textContent = ''; };
  $('#upload-avatar').onclick = async () => {
    if (!pending || busy) return; setBusy(true); $('#avatar-status').textContent = '正在保存头像…';
    try { profile = await api('avatar', 'POST', {image: pending}); site.profile = profile; if (version !== routeVersion) return; reset(); $('#avatar-status').textContent = '头像已保存，首页也已更新。'; }
    catch (error) { if (version === routeVersion) $('#avatar-status').textContent = error.message; }
    finally { if (version === routeVersion) setBusy(false); }
  };
  $('#remove-avatar').onclick = async () => {
    if (busy) return; setBusy(true);
    try { profile = await api('avatar', 'DELETE', {}); site.profile = profile; if (version !== routeVersion) return; reset(); $('#avatar-status').textContent = '已恢复默认 RG 头像。'; }
    catch (error) { if (version === routeVersion) $('#avatar-status').textContent = error.message; }
    finally { if (version === routeVersion) setBusy(false); }
  };
  $('#profile-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return; const button = event.target.querySelector('button[type=submit]'); button.disabled = true; setBusy(true);
    const submittedValues = formValues(profileForm);
    const values = Object.fromEntries(new FormData(event.target)); values.students = readStudents();
    try { profile = await api('profile', 'PUT', values); savedProfileValues = submittedValues; site.profile = profile; updateIdentity(); if (version === routeVersion) $('#profile-status').textContent = '个人资料已保存。'; }
    catch (error) { if (version === routeVersion) $('#profile-status').textContent = error.message; }
    finally { button.disabled = false; if (version === routeVersion) setBusy(false); }
  };
  const resetBackground=()=>{pendingBackground=null;$('#background-preview').innerHTML=`<img src="${esc(profile.background_url || '/cover.jpg')}" alt="主页背景预览">`;$('#save-background').hidden=true;$('#cancel-background').hidden=true;$('#remove-background').hidden=!profile.background_url;$('#background-file').value='';};
  $('#choose-background').onclick=()=>$('#background-file').click();
  $('#background-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;setBusy(true);
    try{const result=await openImageEditor(file,{title:'调整主页背景',width:1200,height:400,mimeType:'image/jpeg',maxBytes:2*1024*1024});if(!result)return;pendingBackground=result;$('#background-preview').innerHTML=`<img src="${result}" alt="待保存的主页背景">`;$('#save-background').hidden=false;$('#cancel-background').hidden=false;$('#remove-background').hidden=true;$('#background-status').textContent='预览已准备好，保存后首页生效。';}
    catch(error){$('#background-status').textContent=error.message;}
    finally{setBusy(false);event.target.value='';}
  };
  $('#cancel-background').onclick=()=>{resetBackground();$('#background-status').textContent='';};
  $('#save-background').onclick=async()=>{
    if(!pendingBackground||busy)return;setBusy(true);
    try{await api('media','POST',{owner_type:'profile',owner_key:'1',role:'background',image:pendingBackground});profile=await api('profile');site.profile=profile;resetBackground();$('#background-status').textContent='主页背景已保存。';}
    catch(error){$('#background-status').textContent=error.message;}
    finally{setBusy(false);}
  };
  $('#remove-background').onclick=async()=>{
    if(!profile.background_url||busy)return;setBusy(true);
    try{await api('media/'+profile.background_url.match(/\/media\/([a-f0-9]{32})/)[1],'DELETE',{});profile=await api('profile');site.profile=profile;resetBackground();$('#background-status').textContent='已恢复默认背景。';}
    catch(error){$('#background-status').textContent=error.message;}
    finally{setBusy(false);}
  };

}
function updateIdentity() {
  const name = site.profile.name === 'RongGuang233' ? 'RongGuang<span>233</span>' : esc(site.profile.name);
  $('.brand').innerHTML = lightMark() + `<span class="brand-text">${name}</span>`;
  $('#footer-name').textContent = site.profile.name + ' 的个人小站'; document.title = site.profile.name + ' · 个人小站';
}
async function renderRoute(override) {
  cleanupReadingNavigation(); cleanupReadingNavigation = () => {};
  cleanupAboutNavigation(); cleanupAboutNavigation = () => {};
  const version = ++routeVersion;
  pageHasChanges = () => false; pageIsBusy = () => false;
  const route = typeof override === 'string' ? override : routeFromLocation();
  const parts = route.split('?')[0].split('/'); const page = parts[0];
  document.body.dataset.page = page === 'home' ? 'home' : page === 'private' ? 'private' : 'public';
  document.body.dataset.section = page === 'read' ? parts[1] : page;
  $('#header-owner').innerHTML = page === 'home' ? '' : ownerMenu();
  updateIdentity();
  document.querySelectorAll('[data-nav]').forEach(link => { if (link.dataset.nav === (page === 'read' ? parts[1] : page)) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  if (publicLoadState !== 'ready') { showPublicLoadState(); return; }
  if (page === 'private') {
    if (sessionRequest) {
      publicLayout(empty('正在确认登录状态'));
      await sessionRequest;
      if (version !== routeVersion) return;
    }
    await workspace(kinds[parts[1]] || ['profile','drafts'].includes(parts[1]) ? parts[1] : 'posts', version);
  }
  else if (page === 'read') readRecord(parts[1], parts[2]);
  else if (kinds[page]) showCollection(page);
  else if (page === 'search') showSearch();
  else if (page === 'about') showAbout();
  else publicHome();
  main.querySelectorAll('.directory a').forEach(link => { if (link.hash === '#' + route) link.setAttribute('aria-current', 'page'); });
}
$('.skip-link').onclick = event => { event.preventDefault(); main.focus(); main.scrollIntoView(); };
document.addEventListener('click', event => {
  document.querySelectorAll('.owner-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || dialog.open) return;
  const menu = document.querySelector('.owner-menu[open]');
  if (menu) { menu.open = false; menu.querySelector('summary').focus(); event.preventDefault(); }
});
// Keep the browser's own history entries, including each list's filters and reading position.
let publicLoadState = 'loading', publicLoadError = '', publicRequest = null, sessionRequest = null;
function showPublicLoadState() {
  const failed = publicLoadState === 'failed';
  publicLayout(empty(failed ? '暂时无法读取小站' : '正在读取小站', failed ? publicLoadError : '') + (failed ? '<button class="primary" id="reload-site">重新读取</button>' : ''));
  if (failed) $('#reload-site').onclick = init;
}
function syncPublicSession() {
  const [page, kind, id] = routeFromLocation().split('?')[0].split('/');
  const header = $('#header-owner');
  if (header) header.innerHTML = page === 'home' ? '' : ownerMenu();
  if (publicLoadState !== 'ready') return;
  const tools = main.querySelector('.portal-tools');
  if (tools) {
    const menu = tools.querySelector('.owner-menu');
    if (!authenticated) menu?.remove();
    else if (!menu) tools.insertAdjacentHTML('beforeend', ownerMenu());
  }
  const entry = main.querySelector('.owner-entry');
  if (entry) entry.innerHTML = icon('lock') + (authenticated ? '内容管理' : '私人空间');
  if (page === 'read') {
    const row = (site[kind] || []).find(record => record.id === Number(id));
    const actions = main.querySelector('.reader-actions');
    if (!authenticated) $('#edit-current')?.remove();
    else if (row && actions && !$('#edit-current')) {
      const button = document.createElement('button');
      button.id = 'edit-current'; button.className = 'subtle'; button.textContent = '编辑此篇';
      actions.append(button); bindReaderEditor(kind, row);
    }
    if (!row) {
      const link = main.querySelector('.content > .read-link[href^="#private/"]');
      if (!authenticated) link?.remove();
      else if (!link) main.querySelector('.content')?.insertAdjacentHTML('beforeend', `<a class="read-link" href="#private/${['posts','notes','works','projects'].includes(kind) ? kind : 'posts'}">前往内容管理 ↗</a>`);
    }
  }
  if (page === 'about') {
    const students = main.querySelector('.about-students .about-section-heading');
    const studentEdit = main.querySelector('.about-students a[href="#private/profile"]');
    const aboutEdit = main.querySelector('.about-edit');
    if (!authenticated) { studentEdit?.remove(); aboutEdit?.remove(); }
    else {
      if (!studentEdit) students?.insertAdjacentHTML('beforeend', '<a class="read-link" href="#private/profile">编辑名单</a>');
      if (!aboutEdit) main.querySelector('.about-content')?.insertAdjacentHTML('beforeend', '<a class="read-link about-edit" href="#private/profile">编辑关于页</a>');
    }
  }
}
function routeFromLocation() {
  if (location.hash) return location.hash.slice(1);
  if (/^\/read\/(posts|notes|works)\/[1-9][0-9]*$/.test(location.pathname)) return location.pathname.slice(1);
  return location.pathname === '/private' ? 'private/posts' : 'home';
}
function publicArticleURL(kind,id) { return new URL(`/read/${kind}/${id}`,location.origin).href; }
function normalizeRouteLocation() {
  const route = routeFromLocation();
  const path = /^read\/(posts|notes|works)\/[1-9][0-9]*$/.test(route) ? '/' + route : '/#' + route;
  if (location.pathname + location.search + location.hash !== path) history.replaceState(history.state,'',path);
  return location.href;
}
history.scrollRestoration = 'manual';
let pendingFrom = null, restoringRoute = false, activeTransition, routingDestination = null;
function rememberPosition() {
  if (!restoringRoute && location.href === currentUrl) {
    const feed = routeFromLocation() === 'home' ? main.querySelector('.home-feed') : null;
    history.replaceState({...history.state,scrollY:window.scrollY,...(feed ? {homeFeedScrollTop:feed.scrollTop} : {})},'',location.href);
  }
}
window.addEventListener('scroll', rememberPosition, {passive:true});
document.addEventListener('click', async event => {
  const create = event.target.closest('[data-create]');
  if (create) {
    if (!await canLeave()) return;
    create.closest('details').open = false;
    editRecord(create.dataset.create); return;
  }
  const anchor = event.target.closest('a[href^="#"]');
  if (!anchor || anchor.classList.contains('skip-link') || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || anchor.hash === location.hash) return;
  rememberPosition();
  if (anchor.hasAttribute('data-back-list') && history.state?.from === anchor.hash.slice(1)) { event.preventDefault(); history.back(); return; }
  pendingFrom = anchor.classList.contains('reader-next') ? history.state?.from || null : routeFromLocation();
  if (anchor.classList.contains('reader-next')) { event.preventDefault(); location.replace(anchor.href); }
});
async function restoreRoute() {
  const requested = location.href;
  if (requested === currentUrl || requested === routingDestination) return;
  routingDestination = requested;
  try {
    if (!await canLeave()) { history.replaceState(null,'',currentUrl); pendingFrom = null; return; }
    if (requested !== location.href) return;
    const from = pendingFrom; pendingFrom = null;
    const position = from !== null ? 0 : history.state?.scrollY || 0;
    const homeFeedScrollTop = from !== null ? 0 : history.state?.homeFeedScrollTop || 0;
    if (from !== null) history.replaceState({from,scrollY:0},'',requested);
    const destination = normalizeRouteLocation();
    currentUrl = destination; restoringRoute = true;
    if (dialog.open) dialog.close();
    const lightbox = $('#image-lightbox');
    if (lightbox?.open) lightbox.close();
    const update = async () => {
      await renderRoute();
      if (destination !== location.href) return;
      window.scrollTo({top:position,behavior:'instant'});
      const feed = routeFromLocation() === 'home' ? main.querySelector('.home-feed') : null;
      if (feed) feed.scrollTop = homeFeedScrollTop;
      (routeFromLocation().startsWith('search') && !position ? $('#public-search') : main)?.focus({preventScroll:true});
      restoringRoute = false;
    };
    activeTransition?.skipTransition();
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      activeTransition = document.startViewTransition(update);
      activeTransition.ready.catch(()=>{}); activeTransition.finished.catch(()=>{});
    } else await update();
  } finally { if (routingDestination === requested) routingDestination = null; }
}
window.addEventListener('hashchange',restoreRoute);
window.addEventListener('popstate',restoreRoute);
async function init() {
  currentUrl = normalizeRouteLocation();
  const failed = publicLoadState === 'failed';
  publicLoadState = 'loading'; publicLoadError = '';
  if (failed) showPublicLoadState();
  const request = api('public'); publicRequest = request;
  const identity = api('session').then(() => true, () => false); sessionRequest = identity;
  identity.then(signedIn => {
    if (sessionRequest !== identity) return;
    authenticated = signedIn; sessionRequest = null;
    syncPublicSession();
  });
  try {
    const result = await request;
    if (publicRequest !== request) return;
    site = result; publicLoadState = 'ready';
  } catch (error) {
    if (publicRequest !== request) return;
    publicLoadState = 'failed';
    publicLoadError = ['TypeError', 'SyntaxError'].includes(error.name)
      ? '公开内容没有加载成功，请稍后重新读取。' : error.message;
  }
  publicRequest = null;
  const destination = location.href;
  const position = history.state?.scrollY || 0;
  const homeFeedScrollTop = history.state?.homeFeedScrollTop || 0;
  await renderRoute();
  if (destination !== location.href) return;
  window.scrollTo({top:position,behavior:'instant'});
  const feed = routeFromLocation() === 'home' ? main.querySelector('.home-feed') : null;
  if (feed) feed.scrollTop = homeFeedScrollTop;
}
init();
