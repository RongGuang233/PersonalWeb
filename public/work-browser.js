'use strict';

function showWorks() {
  const params = routeParams();
  const rawCat = params.get('category') || '';
  const selectedCategory = categories.includes(workCategoryAlias[rawCat] || rawCat) ? (workCategoryAlias[rawCat] || rawCat) : '';
  const selectedStatus = ['seen','watching','want'].includes(params.get('status') || '') ? params.get('status') : '';
  const sortDefault = params.get('sort') === 'updated' ? 'updated' : 'rating';
  publicLayout(`<div class="works-browser">${heading('作品记录', '<span id="work-count" role="status"></span>')}
    <div class="work-filters">
      <input id="work-search" type="search" aria-label="搜索作品" placeholder="搜索名称或短评…" value="${esc(params.get('q') || '')}">
      <div class="work-browser-controls">
        <select id="work-sort" aria-label="作品排序"><option value="rating">评分从高到低</option><option value="updated">最近更新</option></select>
      </div>
      <div id="work-crumb" class="work-crumb" aria-label="当前位置" hidden></div>
    </div><div id="work-results"></div></div>`);
  $('#work-sort').value = sortDefault;
  const render = (persist = true, resetPage = true) => {
    const values = {category: selectedCategory, status: selectedStatus, sort: $('#work-sort').value, q: $('#work-search').value};
    let page = pageFromParams(routeParams());
    if (resetPage) page = 1;
    let rows = filteredWorks(new URLSearchParams({category: values.category, sort: values.sort, q: values.q}));
    if (values.status) rows = rows.filter(work => workStatus(work) === values.status);
    const paged = paginateRows(rows, page, 24);
    if (persist) saveListParams({...values, sort: values.sort === 'rating' ? '' : values.sort, page: paged.page > 1 ? paged.page : ''});
    $('#work-count').innerHTML = `<a class="work-count-link" href="#works">${rows.length} 部作品</a>`;
    // A quiet breadcrumb instead of removable chips: this line reports where you are,
    // and the 「作品记录」 crumb is the way back to everything.
    const crumbHref = extra => {
      const next = new URLSearchParams();
      Object.entries({sort: values.sort === 'rating' ? '' : values.sort, category: values.category, status: values.status, q: values.q, ...extra})
        .forEach(([key, value]) => { if (value) next.set(key, value); });
      return '#works' + (next.size ? '?' + next : '');
    };
    const segments = [{label: '作品记录', href: '#works'}];
    if (values.category) segments.push({label: values.category, href: crumbHref({status: '', q: ''})});
    if (values.status) segments.push({label: statusLabelsFor(values.category || '动画')[values.status], href: crumbHref({q: ''})});
    if (values.q) segments.push({label: `搜索“${values.q}”`, href: crumbHref({})});
    const crumb = $('#work-crumb');
    crumb.hidden = segments.length < 2;
    crumb.innerHTML = segments.map((segment, index) => index === segments.length - 1
      ? `<span class="here" aria-current="location">${esc(segment.label)}</span>`
      : `<a href="${esc(segment.href)}">${esc(segment.label)}</a>`).join('<span class="sep" aria-hidden="true">/</span>');
    const statusLinksFor = (catName, list) => {
      const labels = statusLabelsFor(catName);
      return ['watching', 'seen', 'want'].map(key => {
        const n = list.filter(work => workStatus(work) === key).length;
        const cls = n === 0 ? ' class="is-zero"' : '';
        return `<a${cls} href="#works?category=${encodeURIComponent(catName)}&status=${key}">${labels[key]} ${n}</a>`;
      }).join('');
    };
    if ((values.category && values.status) || (values.status && !values.category)) {
      $('#work-results').innerHTML = paged.items.length ? `<div class="work-grid work-grid-compact">${paged.items.map(work => workCard(work)).join('')}</div>${paginationMarkup(paged.page, paged.totalPages)}` : empty('这个状态下还没有作品', '换一个状态看看。');
    } else if (!values.category && !values.q) {
      const sections = categories.map(name => {
        const list = rows.filter(work => workCategory(work) === name);
        if (!list.length) return '';
        const rated = list.map(work => Number(work.rating)).filter(v => Number.isFinite(v));
        const avg = rated.length ? (rated.reduce((a,b) => a+b, 0) / rated.length).toFixed(1) : '—';
        return `<section class="work-category-section"><div class="work-category-heading"><h2>${esc(name)}</h2><span class="work-status-links">${statusLinksFor(name, list)}</span><span>${list.length} 部 · 均分 ${avg}</span><a href="#works?category=${encodeURIComponent(name)}">查看全部 ↗</a></div><div class="work-grid work-grid-compact">${list.slice(0, 8).map(work => workCard(work)).join('')}</div></section>`;
      }).join('');
      $('#work-results').innerHTML = sections || empty('没有作品', '');
    } else {
      $('#work-results').innerHTML = paged.items.length ? `<div class="work-grid work-grid-compact">${paged.items.map(work => workCard(work)).join('')}</div>${paginationMarkup(paged.page, paged.totalPages)}` : empty('没有匹配的作品', '');
    }
    bindPagination($('#work-results'), paged.page, next => {
      saveListParams({...values, sort: values.sort === 'rating' ? '' : values.sort, page: next > 1 ? next : ''});
      render(false, false);
      window.scrollTo(0, 0);
    });
    if (typeof bindCoverImages === 'function') bindCoverImages($('#work-results'));
  };
  $('#work-sort').onchange = () => render();
  $('#work-search').oninput = () => render();
  render(false, false);
}
