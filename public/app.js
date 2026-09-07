'use strict';
const $ = s => document.querySelector(s);
const main = $('#main'), dialog = $('#dialog');
const kinds = {
  posts: {name: '博客', intro: '整理想法，写成完整的文章。', icon: 'post'},
  notes: {name: '笔记', intro: '记录想法，也整理值得反复阅读的知识。', icon: 'note'},
  friends: {name: '友链', intro: '收录朋友的网站，保持彼此的连接。', icon: 'friends'},
  works: {name: '作品记录', intro: '记录看过、读过与玩过的作品。', icon: 'works'},
  bookmarks: {name: '收藏', intro: '保存文章、资源，以及再次打开它的理由。', icon: 'bookmark'}
};
const categories = ['动漫', '漫画', '游戏', '小说', '电影', '电视剧', '出版书籍'];
const iconPaths = {
  post: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8"/>',
  note: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
  works: '<path d="M4 4v16M8 5v15M13 4l3 16M18 4l3 16"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  archive: '<path d="M4 8h16v13H4zM3 3h18v5H3zM9 12h6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  friends: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.note}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const date = value => new Date(value * 1000).toLocaleDateString('zh-CN');
const excerpt = (value, length = 120) => window.markdownExcerpt(value, length);
let authenticated = false;
let site = {profile: {name: 'RongGuang233', bio: '写下想法，记录生活中的喜欢。', avatar_url: null}, posts: [], notes: [], friends: [], works: [], bookmarks: []};
let privateRecords = [], privateKind = 'posts', search = '', category = '', sort = 'updated', routeVersion = 0, toastTimer;
let dialogHasChanges = () => false, pageHasChanges = () => false, pageIsBusy = () => false, currentUrl = location.href;
let leaveDecision = null, resolveLeave, dialogBeforeLeave = null;
let privateDrafts = [];
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
function theme(value) {
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('appearance', value); } catch {}
  $('#theme-toggle').textContent = value === 'dark' ? '☀' : '☾';
  $('#theme-toggle').setAttribute('aria-label', value === 'dark' ? '切换浅色外观' : '切换深色外观');
  $('#theme-toggle').title = $('#theme-toggle').getAttribute('aria-label');
}
let savedTheme;
try { savedTheme = localStorage.getItem('appearance'); } catch {}
theme(savedTheme === 'dark' ? 'dark' : 'light');
$('#theme-toggle').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#search-toggle').onclick = () => go('search');
function go(route) { if (location.hash === '#' + route) renderRoute(); else location.hash = route; }
function avatarMarkup(profile, label = '个人头像') { return `<div class="avatar">${profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="${esc(label)}">` : '<span aria-label="默认 RG 头像">RG</span>'}</div>`; }
function sidebar() {
  const profile = site.profile;
  return `<aside class="sidebar"><section class="profile-card"><div class="profile-cover" aria-hidden="true">${profile.background_url ? `<img src="${esc(profile.background_url)}" alt="">` : ''}</div><div class="person">${avatarMarkup(profile)}<div><h2>${esc(profile.name)}</h2><p>${esc(profile.bio)}</p></div></div><div class="profile-links"><a class="about-link" href="#about">关于我 ↗</a>${authenticated ? '<a class="about-link" href="#private/profile">编辑资料</a>' : ''}</div></section><nav class="directory" aria-label="内容目录"><a href="#works">${icon('works')}作品记录<span>↗</span></a><a href="#bookmarks">${icon('bookmark')}收藏<span>↗</span></a><a href="#archive">${icon('archive')}归档<span>↗</span></a></nav><a class="owner-link" href="#private/posts">${icon('lock')}${authenticated ? '内容管理' : '私人空间'}</a></aside>`;
}
function publicLayout(content, reading = false) { main.innerHTML = `<div class="layout${reading ? ' reading-layout' : ''}">${sidebar()}<section class="content">${content}</section></div>`; }
function heading(title, more = '') { return `<div class="heading"><h1>${esc(title)}</h1>${more}</div>`; }
function empty(title, detail = '') { return `<div class="empty"><h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ''}</div>`; }
function coverMarkup(record, type, eager = false) {
  const tone = Math.max(0, categories.indexOf(record.category)) % 4;
  return `<div class="${type}-cover ${record.cover_url ? 'has-cover' : 'cover-placeholder cover-tone-' + tone}">${record.cover_url ? `<img src="${esc(record.cover_url)}" alt="${esc(record.title)}的封面" loading="${eager ? 'eager' : 'lazy'}" decoding="async">` : `<span class="cover-category">${esc(record.category || '文字与记录')}</span><span class="cover-title">${esc(record.title)}</span><span class="cover-line" aria-hidden="true"></span>`}</div>`;
}
function postCard(post, cover = false) {
  return `<article class="blog-card${post.cover_url ? ' illustrated-post' : ' text-post'}">${post.cover_url ? `<a class="cover-link" href="#read/posts/${post.id}" tabindex="-1" aria-hidden="true">${coverMarkup(post, 'post', cover)}</a>` : ''}<div class="blog-copy"><div class="article-meta">${post.tags ? `<span class="tag">${esc(post.tags)}</span>` : '<span class="tag">博客</span>'}<time>${date(post.updated)}</time>${post.pinned ? '<span class="tag">置顶</span>' : ''}</div><h2><a class="blog-title" href="#read/posts/${post.id}">${esc(post.title)}</a></h2><p class="summary">${esc(excerpt(post.summary || post.body))}</p><a class="read-link" href="#read/posts/${post.id}">阅读全文 ↗</a></div></article>`;
}
function noteCard(note) { return `<article class="note note-list-item"><div class="note-date">${icon('note')}<time>${date(note.updated)}</time></div><h2><a href="#read/notes/${note.id}">${esc(note.title)}</a></h2><p class="summary">${esc(excerpt(note.body, 160))}</p><a class="read-link" href="#read/notes/${note.id}">阅读笔记 ↗</a></article>`; }
function compactNote(note) { return `<a class="note compact-note" href="#read/notes/${note.id}"><span class="note-date">${icon('note')}<time>${date(note.updated)}</time></span><h3>${esc(note.title)}</h3><p>${esc(excerpt(note.body, 130))}</p><span class="note-more">读这条笔记 ↗</span></a>`; }
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
  return `<article class="work-card">${managed ? cover : `<a class="cover-link" href="#read/works/${work.id}" tabindex="-1" aria-hidden="true">${cover}</a>`}<div class="work-copy"><div class="work-meta"><span>${esc(work.category)}</span>${ratingMarkup(work.rating)}</div><h2>${managed ? esc(work.title) : `<a href="#read/works/${work.id}">${esc(work.title)}</a>`}</h2><p class="work-progress">${esc(work.progress || '未填写进度')}</p>${work.notes ? `<p class="work-review">${esc(excerpt(work.notes, 120))}</p>` : ''}${managed ? `<span class="visibility ${work.published ? '' : 'private'}">${work.published ? '已公开' : '仅自己可见'}</span><div class="work-actions"><button data-edit="${work.id}">编辑</button><button data-delete="${work.id}">删除</button></div>` : ''}</div></article>`;
}
function friendCard(friend) { return `<a class="friend" href="${esc(friend.url)}" target="_blank" rel="noreferrer"><span class="friend-avatar">${friend.avatar_url ? `<img src="${esc(friend.avatar_url)}" alt="" loading="lazy">` : esc(Array.from(friend.title)[0] || '友')}</span><span><span class="friend-title">${esc(friend.title)} ↗</span><span class="friend-desc">${esc(friend.notes || new URL(friend.url).hostname)}</span></span></a>`; }
function welcome() { return '<article class="blog-card welcome"><div class="blog-cover" role="img" aria-label="暮色书桌与窗外城市插画"></div><div class="blog-copy"><div class="article-meta"><span class="tag">个人小站</span></div><h2>从这里，慢慢记录。</h2><p class="summary">文章、片刻的想法，还有生活中喜欢的作品。第一篇博客还在路上。</p></div></article>'; }
function publicHome() {
  const selected = site.posts.filter(post => post.featured || post.pinned).sort((a,b) => Number(!!b.pinned)-Number(!!a.pinned) || b.updated-a.updated).slice(0,3);
  const homePosts = selected.length ? selected : site.posts.slice(0,1);
  const shelf = site.works.length ? `<section class="section"><div class="heading"><h2>最近在看 · 在玩</h2><a href="#works">全部作品 ↗</a></div><div class="work-grid home-shelf">${site.works.slice(0, 4).map(work => workCard(work)).join('')}</div></section>` : '';
  publicLayout(heading(selected.length ? '精选文章' : '最近更新', '<a href="#posts">全部文章 ↗</a>') + (homePosts.length ? homePosts.map((post,i) => postCard(post,i===0)).join('') : welcome()) + `<section class="section"><div class="heading"><h2>最近的笔记</h2><a href="#notes">全部笔记 ↗</a></div>${site.notes.length ? `<div class="note-grid">${site.notes.slice(0, 2).map(compactNote).join('')}</div>` : empty('还没有公开笔记', '有值得记下的片刻时，就从这里开始。')}</section>${shelf}<section class="section"><div class="heading"><h2>朋友们的站点</h2><a href="#friends">友链 ↗</a></div>${site.friends.length ? `<div class="friend-grid">${site.friends.slice(0, 4).map(friendCard).join('')}</div>` : empty('朋友的席位，留在这里。')}</section>`);
}
function recordBody(record, kind) {
  return `${record.category ? `<p class="meta">${esc(record.category)} · ${esc(record.progress || '未填写进度')}</p>` : ''}${record.tags ? `<p class="tags"><span class="tag">${esc(record.tags)}</span></p>` : ''}${record.summary ? `<p class="summary">${esc(record.summary)}</p>` : ''}${record.body ? `<div class="markdown">${markdown(record.body)}</div>` : ''}${record.notes ? `<p class="notes-text">${esc(record.notes)}</p>` : ''}`;
}
function publicRecord(record, kind) { return `<article class="record"><div class="record-top"><h2>${record.url ? `<a href="${esc(record.url)}" target="_blank" rel="noreferrer">${esc(record.title)} ↗</a>` : esc(record.title)}</h2>${kind === 'works' ? `${ratingMarkup(record.rating)}` : ''}</div>${recordBody(record, kind)}<p class="meta">${date(record.updated)}</p></article>`; }
function showCollection(kind) {
  if (kind === 'works') { showWorks(); return; }
  const rows = kind === 'posts' ? site.posts.slice().sort((a,b) => Number(!!b.pinned)-Number(!!a.pinned) || b.updated-a.updated) : site[kind];
  const content = kind === 'posts' ? rows.map((p, i) => postCard(p, i === 0)).join('') : kind === 'notes' ? rows.map(noteCard).join('') : kind === 'friends' ? `<div class="friend-grid">${rows.map(friendCard).join('')}</div>` : rows.map(r => publicRecord(r, kind)).join('');
  publicLayout(heading(kinds[kind].name) + `<p class="intro">${esc(kinds[kind].intro)}</p>` + (rows.length ? content : empty('还没有公开的' + kinds[kind].name, authenticated ? '可以在私人空间新增内容，并勾选公开。' : '稍后再来看看。')));
}
function showWorks() {
  publicLayout(heading('作品记录') + `<p class="intro">${esc(kinds.works.intro)}</p><div class="work-filters"><div class="category-tabs" aria-label="作品分类">${['全部', ...categories].map((name, i) => `<button type="button" data-category="${i ? esc(name) : ''}" aria-pressed="${i === 0}">${esc(name)}</button>`).join('')}</div><div class="work-sort"><span id="work-count"></span><select id="work-sort" aria-label="作品排序"><option value="updated">最近更新</option><option value="rating">评分从高到低</option></select></div></div><div id="work-results" aria-live="polite"></div>`);
  let chosen = '';
  const render = () => {
    const rows = site.works.filter(work => !chosen || work.category === chosen).slice().sort((a, b) => $('#work-sort').value === 'rating' ? ((b.rating ?? -1) - (a.rating ?? -1)) || b.updated - a.updated : b.updated - a.updated);
    $('#work-count').textContent = `${rows.length} 部作品`;
    $('#work-results').innerHTML = rows.length ? `<div class="work-grid">${rows.map(work => workCard(work)).join('')}</div>` : empty(chosen ? '这个分类还没有公开记录' : '还没有公开的作品记录', authenticated ? '可以在私人空间记录作品、上传封面并勾选公开。' : '看过、读过、玩过的作品，会慢慢收录在这里。');
  };
  document.querySelectorAll('[data-category]').forEach(button => button.onclick = () => { chosen = button.dataset.category; document.querySelectorAll('[data-category]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); render(); });
  $('#work-sort').onchange = render; render();
}
function readRecord(kind, id) {
  const row = (site[kind] || []).find(r => r.id === Number(id));
  if (!row || !['posts', 'notes', 'works'].includes(kind)) { publicLayout(empty('内容不存在或尚未公开') + (authenticated ? `<a class="read-link" href="#private/${['posts', 'notes', 'works'].includes(kind) ? kind : 'posts'}">前往内容管理 ↗</a>` : ''), true); return; }
  const author = `<footer class="reader-author">${avatarMarkup(site.profile)}<div><a href="#about">${esc(site.profile.name)}</a><p>${esc(site.profile.bio)}</p></div></footer>`;
  publicLayout(`<article class="reader ${kind === 'works' ? 'work-reader' : ''}"><div class="reader-actions"><a class="back" href="#${kind}">← 返回${kinds[kind].name}</a>${authenticated ? '<button id="edit-current" class="subtle">编辑此篇</button>' : ''}</div>${kind === 'works' ? `<div class="work-detail">${coverMarkup(row, 'work')}<div><h1>${esc(row.title)}</h1><p class="meta">${esc(row.category)} · ${date(row.updated)}</p><p class="work-detail-rating">${ratingMarkup(row.rating)}</p><p>${esc(row.progress || '未填写进度')}</p></div></div>${row.notes ? `<div class="markdown"><p>${esc(row.notes)}</p></div>` : '<p class="intro">还没有填写短评。</p>'}${row.url ? `<a class="read-link" href="${esc(row.url)}" target="_blank" rel="noreferrer">作品相关链接 ↗</a>` : ''}` : `<h1>${esc(row.title)}</h1><div class="article-meta"><span>${kinds[kind].name}</span><time>${date(row.updated)}</time>${row.tags ? `<span class="tag">${esc(row.tags)}</span>` : ''}</div>${row.cover_url ? coverMarkup(row, 'post', true) : ''}<div class="markdown">${markdown(row.body)}</div>`}${author}</article>`, true);
  if (authenticated) {
    const button = $('#edit-current'), version = routeVersion;
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
  document.title = row.title + ' · ' + site.profile.name;
}
function showArchive() {
  const rows = ['posts', 'notes'].flatMap(kind => site[kind].map(r => ({...r, kind}))).sort((a, b) => b.updated - a.updated);
  publicLayout(heading('归档') + '<p class="intro">按时间，翻一翻过去的记录。</p>' + (rows.length ? `<div class="list">${rows.map(r => `<a class="list-row" href="#read/${r.kind}/${r.id}"><h2>${esc(r.title)}</h2><p>${date(r.updated)} · ${kinds[r.kind].name}</p></a>`).join('')}</div>` : empty('记录会慢慢积累。')));
}
function showSearch() {
  publicLayout(heading('搜索') + '<div class="search-panel"><label>搜索公开内容<input id="public-search" type="search" placeholder="文章、笔记、作品或朋友的网站…" autocomplete="off"></label></div><div id="search-results" aria-live="polite"><p class="intro">输入关键词，找回想看的内容。</p></div>');
  const input = $('#public-search'); input.focus();
  input.oninput = () => {
    const value = input.value.trim().toLowerCase();
    if (!value) { $('#search-results').innerHTML = '<p class="intro">输入关键词，找回想看的内容。</p>'; return; }
    const rows = Object.keys(kinds).flatMap(kind => site[kind].map(r => ({...r, kind}))).filter(r => [r.title, r.body, r.summary, r.notes, r.tags, r.category].some(v => String(v || '').toLowerCase().includes(value)));
    $('#search-results').innerHTML = `<p class="search-count">找到 ${rows.length} 条内容</p>` + (rows.length ? `<div class="list">${rows.map(r => { const readable = ['posts', 'notes', 'works'].includes(r.kind); return `<a class="list-row" href="${readable ? '#read/' + r.kind + '/' + r.id : esc(r.url)}" ${readable ? '' : 'target="_blank" rel="noreferrer"'}><h2>${esc(r.title)}</h2><p>${kinds[r.kind].name} · ${esc(excerpt(r.summary || r.body || r.notes, 80))}</p></a>`; }).join('')}</div>` : empty('没有匹配内容', '试试更短的关键词。'));
  };
}
function showAbout() { publicLayout(`<article class="reader"><a class="back" href="#home">← 返回首页</a><h1>关于 ${esc(site.profile.name)}</h1><div class="markdown"><p>${esc(site.profile.bio || '还没有填写个人介绍。')}</p></div>${authenticated ? '<a class="read-link" href="#private/profile">编辑个人资料 ↗</a>' : ''}</article>`, true); }
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
  return `<div class="layout"><aside class="sidebar private-sidebar"><p class="private-label">内容管理</p><nav class="directory private-nav" aria-label="私人功能">${Object.entries(kinds).map(([key, value]) => `<a href="#private/${key}" ${kind === key ? 'aria-current="page"' : ''}>${icon(value.icon)}<span>${value.name}</span></a>`).join('')}<a href="#private/profile" ${kind === 'profile' ? 'aria-current="page"' : ''}>${icon('profile')}<span>个人资料</span></a></nav><a class="export-all" href="/api/export.zip" download>导出全部内容 ↓</a><button class="logout" id="logout">退出登录 ↗</button></aside><section class="content" id="private-content"></section></div>`;
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
  if (kind === 'profile') { await profileSettings(version); return; }
  privateKind = kind; search = ''; category = '';
  $('#private-content').innerHTML = `<div class="heading manage-head"><div><h1>${kinds[kind].name}</h1><p>${kinds[kind].intro}</p></div><button class="primary" id="add">＋ 新增</button></div><div class="filters"><input id="private-search" type="search" aria-label="搜索${kinds[kind].name}" placeholder="搜索${kinds[kind].name}…">${kind === 'works' ? `<select id="category" aria-label="分类筛选"><option value="">全部分类</option>${categories.map(c => `<option>${c}</option>`).join('')}</select><select id="sort" aria-label="排序"><option value="updated">最近更新</option><option value="rating">评分从高到低</option></select>` : ''}<span id="count"></span></div><div id="draft-list"></div><div id="private-list" aria-live="polite"><p class="loading">正在读取…</p></div>`;
  $('#add').onclick = () => editRecord(kind);
  $('#private-search').oninput = event => { search = event.target.value; renderPrivate(); };
  if (kind === 'works') { $('#category').onchange = event => { category = event.target.value; renderPrivate(); }; $('#sort').value = sort; $('#sort').onchange = event => { sort = event.target.value; renderPrivate(); }; }
  try { const [rows, drafts] = await Promise.all([api(kind), ['posts','notes'].includes(kind) ? api('drafts') : Promise.resolve([])]); if (version !== routeVersion) return; privateRecords = rows; privateDrafts = drafts; renderPrivate(); }
  catch (error) { if (version !== routeVersion) return; if (error.status === 401) { authenticated = false; await workspace(kind, version); } else { $('#private-list').innerHTML = empty('暂时无法读取', error.message) + '<button id="retry">重新读取</button>'; $('#retry').onclick = renderRoute; } }
}
function renderPrivate() {
  if (!$('#private-list')) return;
  renderDrafts();
  const rows = privateRecords.filter(r => (!category || r.category === category) && [r.title, r.body, r.summary, r.notes, r.tags, r.category].some(v => String(v || '').toLowerCase().includes(search.toLowerCase()))).sort((a, b) => privateKind === 'friends' ? (a.order||0)-(b.order||0) || b.updated-a.updated : privateKind === 'works' && sort === 'rating' ? ((b.rating ?? -1) - (a.rating ?? -1)) || b.updated - a.updated : b.updated - a.updated);
  $('#count').textContent = `${rows.length} 条`;
  $('#private-list').innerHTML = rows.length ? (privateKind === 'works' ? `<div class="work-grid managed-shelf">${rows.map(r => workCard(r, true)).join('')}</div>` : rows.map(r => managedRecord(r, privateKind)).join('')) : empty(search || category ? '没有匹配的记录' : '还没有' + kinds[privateKind].name, search || category ? '换个关键词或分类试试。' : '点击「新增」，从第一条开始。');
  $('#private-list').querySelectorAll('[data-edit]').forEach(button => button.onclick = () => editRecord(privateKind, privateRecords.find(r => r.id === Number(button.dataset.edit))));
  $('#private-list').querySelectorAll('[data-delete]').forEach(button => button.onclick = () => {
    const kind = privateKind, row = privateRecords.find(r => r.id === Number(button.dataset.delete));
    showForm('删除记录', `<p>确定删除「${esc(row.title)}」？删除后无法恢复。</p>`, async () => { await api(kind + '/' + row.id, 'DELETE', {}); await refreshContent(kind); toast('已删除'); }, '确认删除');
  });
}
function managedRecord(record, kind) {
  const writing = ['posts', 'notes'].includes(kind);
  return `<article class="record ${writing ? 'managed-writing' : ''}"><div class="record-top"><h2>${record.url ? `<a href="${esc(record.url)}" target="_blank" rel="noreferrer">${esc(record.title)} ↗</a>` : esc(record.title)}</h2><span class="visibility ${record.published ? '' : 'private'}">${record.published ? '已公开' : '仅自己可见'}</span></div>${writing ? `<p class="managed-excerpt">${esc(excerpt(record.summary || record.body, 160)) || '还没有正文。'}</p>${record.tags ? `<p class="meta">${esc(record.tags)}</p>` : ''}` : recordBody(record, kind)}<div class="record-bottom"><time>${date(record.updated)}</time><div>${writing && record.published ? `<a href="#read/${kind}/${record.id}">查看公开页 ↗</a>` : ''}${writing ? `<a href="/api/export/${kind}/${record.id}.zip" download>导出 ↓</a>` : ''}<button data-edit="${record.id}">编辑</button><button data-delete="${record.id}">删除</button></div></div></article>`;
}
async function refreshContent(kind) {
  site = await api('public');
  if (privateKind === kind && $('#private-list')) {
    [privateRecords, privateDrafts] = await Promise.all([api(kind), ['posts','notes'].includes(kind) ? api('drafts') : Promise.resolve([])]);
    renderPrivate();
  } else {
    const [page, type, id] = location.hash.slice(1).split('/');
    if (page === 'read' && type === kind) readRecord(kind, id);
  }
}
function editRecord(kind, record = {}) {
  if (['posts','notes'].includes(kind)) { openWritingEditor(kind, record).catch(error => toast(error.message)); return; }
  const supportsCover = ['posts', 'works'].includes(kind);
  const writing = ['posts', 'notes'].includes(kind);
  let savedId = record.id, pendingCover, pendingFriendAvatar, coverProcessing = false;
  const titleField = field('title', kind === 'works' ? '作品名称' : kind === 'friends' ? '站点名称' : '标题', record.title, 'text', true, 'maxlength="4000"');
  let fields = '';
  if (supportsCover) fields += `<section class="cover-editor" id="cover-editor" aria-labelledby="cover-label"><span id="cover-label">${kind === 'works' ? '作品封面' : '文章封面'}</span><div class="cover-preview ${kind === 'works' ? 'portrait-preview' : ''}" id="cover-preview" ${record.cover_url ? '' : 'hidden'}>${record.cover_url ? `<img src="${esc(record.cover_url)}" alt="当前封面">` : ''}</div><input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="cover-editor-actions"><button type="button" id="choose-cover" class="subtle">上传封面</button>${kind === 'works' ? '<button type="button" id="search-cover" class="subtle">搜索封面</button>' : ''}<button type="button" id="remove-cover" ${record.cover_url ? '' : 'hidden'}>移除封面</button></div><p class="hint">PNG、JPG 或 WebP，最大 8 MB。${kind === 'works' ? '竖版封面展示效果更好。' : '横版图片展示效果更好。'}随这条内容一起保存。</p><p class="form-status" id="cover-status" role="status"></p>${kind === 'works' ? '<div class="cover-search"><p id="cover-search-status" class="hint" role="status">输入作品名称后，按分类查找封面，点选后随作品保存。</p><div id="cover-candidates" class="cover-candidates" aria-label="候选封面" hidden></div></div>' : ''}</section>`;
  if (kind === 'friends') fields += `<section class="friend-image-editor"><span class="friend-avatar" id="friend-avatar-preview">${record.avatar_url ? `<img src="${esc(record.avatar_url)}" alt="友链头像">` : esc(Array.from(record.title || '友')[0])}</span><input type="file" id="friend-avatar-file" accept="image/png,image/jpeg,image/webp" hidden><button type="button" id="choose-friend-avatar">选择头像</button><button type="button" id="remove-friend-avatar" ${record.avatar_url ? '' : 'hidden'}>移除头像</button><p id="friend-image-status" class="hint" role="status"></p></section><label>显示顺序<input name="order" type="number" step="1" min="-100000" max="100000" value="${esc(record.order || 0)}"><small>数字越小越靠前，相同顺序按最近更新排列。</small></label>`;
  if (['friends', 'bookmarks'].includes(kind)) fields += field('url', '链接', record.url, 'url', true);
  if (['posts', 'bookmarks'].includes(kind)) fields += field('tags', '标签（逗号分隔，可留空）', record.tags);
  if (kind === 'posts') fields += area('summary', '摘要（可留空，默认取正文开头）', record.summary, 3, 4000);
  if (kind === 'works') fields += field('progress', '进度', record.progress) + field('rating', '评分（0–10，可留空）', record.rating, 'number');
  if (!['posts', 'notes'].includes(kind)) fields += area('notes', kind === 'works' ? '短评' : kind === 'friends' ? '站点简介' : '备注', record.notes, 4, 4000);
  fields += `<label class="checkbox-label"><input type="checkbox" name="published" ${record.published ? 'checked' : ''}><span>公开到个人主页<small>勾选后，所有访客都可以看到这条内容。</small></span></label>`;
  fields = titleField + (kind === 'works' ? `<label>分类<select name="category">${categories.map(c => `<option ${c === record.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>` : '') + fields;
  showForm((record.id ? '编辑' : '新增') + kinds[kind].name, fields, async data => {
    if (coverProcessing) throw new Error('正在处理封面，请稍候再保存。');
    data.published = data.published === 'on';
    if (kind === 'friends') data.order = Number(data.order);
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
  const visibility = $('#fields input[name=published]');
  const updateVisibility = () => { $('#save-hint').textContent = visibility.checked ? '保存后公开，所有访客可见' : '保存后仅自己可见'; };
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
  $('#choose-cover').onclick = () => $('#cover-file').click();
  $('#remove-cover').onclick = () => { pendingCover = null; $('#cover-preview').hidden = true; $('#cover-preview').innerHTML = ''; $('#cover-file').value = ''; $('#remove-cover').hidden = true; $('#cover-status').textContent = '保存后将移除封面。'; };
  const prepareCover = async (loadFile, message = '预览已准备好，点击保存后生效。', allowGif = false) => {
    if (coverProcessing || $('#save').disabled) return false;
    coverProcessing = true; $('#save').disabled = true; $('#close').disabled = true; editor.inert = true; $('#cover-status').textContent = '正在准备封面预览…';
    try {
      const image = await normalizedCover(await loadFile(), allowGif);
      if ($('#cover-editor') !== editor || !dialog.open) return false;
      pendingCover = image; $('#cover-preview').innerHTML = `<img src="${image}" alt="待保存的封面预览">`; $('#cover-preview').hidden = false; $('#remove-cover').hidden = false; $('#cover-status').textContent = message;
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
    request = new AbortController();
    try {
      const params = new URLSearchParams({q:query, category:category.value});
      const response = await fetch('/api/cover-search?' + params, {signal:request.signal});
      const result = await response.json();
      if (!active() || own !== revision) return;
      if (!response.ok) throw new Error(result.error || '封面搜索暂不可用，请稍后重试或上传图片。');
      const rows = result.results;
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
      if (active() && own === revision && error.name !== 'AbortError') status.textContent = error.message;
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
  category.addEventListener('change', schedule);
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
  $('#private-content').innerHTML = heading('个人资料') + '<p class="intro">让来访的人，更容易认出你。</p><p class="loading">正在读取…</p>';
  let profile;
  try { profile = await api('profile'); } catch (error) { if (version === routeVersion) { if (error.status === 401) { authenticated = false; await workspace('profile', version); } else $('#private-content').innerHTML = empty('暂时无法读取', error.message); } return; }
  if (version !== routeVersion) return;
  site.profile = profile;
  $('#private-content').innerHTML = heading('个人资料') + `<p class="intro">头像、昵称和简介会显示在公开主页。</p><section class="profile-settings"><div class="avatar-editor"><div id="avatar-preview">${avatarMarkup(profile, '当前头像')}</div><div><h2>头像</h2><p class="hint">支持 PNG、JPG、WebP，最大 10 MB。可拖动图片、调整缩放，再查看圆形预览。</p><input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="avatar-actions"><button id="choose-avatar" class="subtle">选择图片</button><button id="upload-avatar" class="primary" hidden>保存头像</button><button id="cancel-avatar" hidden>取消更换</button><button id="remove-avatar" ${profile.avatar_url ? '' : 'hidden'}>恢复默认</button></div><p class="form-status" id="avatar-status" role="status"></p></div></div><form id="profile-form" class="form-grid">${field('name', '昵称', profile.name, 'text', true, 'maxlength="80"')}${area('bio', '个人简介', profile.bio, 4, 1000)}<p class="form-status" id="profile-status" role="status"></p><button class="primary settings-save" type="submit">保存资料</button></form><section class="background-editor"><h2>侧栏背景</h2><p class="hint">选择喜欢的图片，调整 3:1 裁剪。取消时保留原背景。</p><div class="background-preview" id="background-preview"><img src="${esc(profile.background_url || '/cover.jpg')}" alt="侧栏背景预览"></div><input type="file" id="background-file" accept="image/png,image/jpeg,image/webp" hidden><div class="background-actions"><button id="choose-background">选择背景</button><button id="save-background" class="primary" hidden>保存背景</button><button id="cancel-background" hidden>取消更换</button><button id="remove-background" ${profile.background_url ? '' : 'hidden'}>恢复默认背景</button></div><p id="background-status" class="form-status" role="status"></p></section></section>`;
  let pending = null, pendingBackground = null, busy = false, selection = 0;
  const profileForm = $('#profile-form');
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
    try { profile = await api('profile', 'PUT', Object.fromEntries(new FormData(event.target))); savedProfileValues = submittedValues; site.profile = profile; updateIdentity(); if (version === routeVersion) $('#profile-status').textContent = '个人资料已保存。'; }
    catch (error) { if (version === routeVersion) $('#profile-status').textContent = error.message; }
    finally { button.disabled = false; if (version === routeVersion) setBusy(false); }
  };
  const resetBackground=()=>{pendingBackground=null;$('#background-preview').innerHTML=`<img src="${esc(profile.background_url || '/cover.jpg')}" alt="侧栏背景预览">`;$('#save-background').hidden=true;$('#cancel-background').hidden=true;$('#remove-background').hidden=!profile.background_url;$('#background-file').value='';};
  $('#choose-background').onclick=()=>$('#background-file').click();
  $('#background-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;setBusy(true);
    try{const result=await openImageEditor(file,{title:'调整侧栏背景',width:1200,height:400,mimeType:'image/jpeg',maxBytes:2*1024*1024});if(!result)return;pendingBackground=result;$('#background-preview').innerHTML=`<img src="${result}" alt="待保存的侧栏背景">`;$('#save-background').hidden=false;$('#cancel-background').hidden=false;$('#remove-background').hidden=true;$('#background-status').textContent='预览已准备好，保存后首页生效。';}
    catch(error){$('#background-status').textContent=error.message;}
    finally{setBusy(false);event.target.value='';}
  };
  $('#cancel-background').onclick=()=>{resetBackground();$('#background-status').textContent='';};
  $('#save-background').onclick=async()=>{
    if(!pendingBackground||busy)return;setBusy(true);
    try{await api('media','POST',{owner_type:'profile',owner_key:'1',role:'background',image:pendingBackground});profile=await api('profile');site.profile=profile;resetBackground();$('#background-status').textContent='侧栏背景已保存。';}
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
function updateIdentity() { if (site.profile.name === 'RongGuang233') $('.brand').innerHTML = 'RongGuang<span>233</span>'; else $('.brand').textContent = site.profile.name; $('#footer-name').textContent = site.profile.name + ' 的个人小站'; document.title = site.profile.name + ' · 个人小站'; }
async function renderRoute(override) {
  const version = ++routeVersion;
  pageHasChanges = () => false; pageIsBusy = () => false;
  const route = typeof override === 'string' ? override : location.hash.slice(1) || (location.pathname === '/private' ? 'private/posts' : 'home');
  const parts = route.split('/'); const page = parts[0];
  updateIdentity();
  document.querySelectorAll('[data-nav]').forEach(link => { if (link.dataset.nav === (page === 'read' ? parts[1] : page)) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  if (page === 'private') await workspace(kinds[parts[1]] || parts[1] === 'profile' ? parts[1] : 'posts', version);
  else if (page === 'read') readRecord(parts[1], parts[2]);
  else if (kinds[page]) showCollection(page);
  else if (page === 'archive') showArchive();
  else if (page === 'search') showSearch();
  else if (page === 'about') showAbout();
  else publicHome();
  main.querySelectorAll('.directory a').forEach(link => { if (link.hash === '#' + route) link.setAttribute('aria-current', 'page'); });
}
$('.skip-link').onclick = event => { event.preventDefault(); main.focus(); main.scrollIntoView(); };
window.addEventListener('hashchange', async () => {
  if (!await canLeave()) { history.replaceState(null, '', currentUrl); return; }
  currentUrl = location.href;
  if (dialog.open) dialog.close();
  renderRoute(); window.scrollTo(0, 0);
});
async function init() {
  const [publicResult, sessionResult] = await Promise.allSettled([api('public'), api('session')]);
  authenticated = sessionResult.status === 'fulfilled';
  if (publicResult.status === 'rejected') { main.innerHTML = `<div class="layout"><section class="content">${empty('暂时无法读取小站', publicResult.reason.message)}<button class="primary" id="reload-site">重新读取</button></section></div>`; $('#reload-site').onclick = init; return; }
  site = publicResult.value; await renderRoute();
}
init();
