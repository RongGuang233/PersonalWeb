'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const app = readFileSync(require.resolve('../public/app.js'), 'utf8');
const browser = readFileSync(require.resolve('../public/work-browser.js'), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fixture(query = '') {
  const elements = new Map(), writes = [], storage = new Map();
  let markup = '';
  const element = id => {
    const node = {value:'', textContent:'', hidden:false, dataset:{}, setAttribute() {}};
    let html = '';
    Object.defineProperty(node, 'innerHTML', {get:() => html, set(value) { html = value; }});
    node.querySelectorAll = () => [];
    return node;
  };
  const alias = {'动漫':'动画','电影':'影视','电视剧':'影视','出版书籍':'书籍'};
  const labels = {动画:{seen:'看过',watching:'在看',want:'想看'},影视:{seen:'看过',watching:'在看',want:'想看'},漫画:{seen:'读过',watching:'在读',want:'想读'},小说:{seen:'读过',watching:'在读',want:'想读'},书籍:{seen:'读过',watching:'在读',want:'想读'},游戏:{seen:'玩过',watching:'在玩',want:'想玩'}};
  const workCategory = work => alias[work.category] || work.category || '';
  const statusLabelsFor = category => labels[category] || labels['动画'];
  const workStatus = work => {
    const p = String(work.progress || '').trim();
    const lab = statusLabelsFor(workCategory(work));
    if (!p || p === lab.want) return 'want';
    if (p === lab.seen || /已看完|已通关|已读完/.test(p)) return 'seen';
    return 'watching';
  };
  const scope = {
    URLSearchParams, esc, categories:['动画','漫画','游戏','小说','书籍','影视'],
    workCategoryAlias:alias,
    workStatusLabels:labels,
    workCategory,
    statusLabelsFor,
    workStatus,
    site:{works:[
      {id:1,title:'夏日故事',category:'动画',progress:'已看完',rating:8,updated:2},
      {id:2,title:'夏日续篇',category:'动画',progress:'看到第 3 集',rating:9,updated:3},
      {id:3,title:'夏日小说',category:'小说',progress:'已看完',rating:10,updated:4},
      {id:4,title:'冬日故事',category:'动画',progress:'想看',rating:6,updated:5},
      {id:5,title:'自由文本',category:'游戏',progress:'',rating:7,updated:1},
      {id:6,title:'另一个故事',category:'动画',progress:'已看完',rating:7,updated:1}
    ]},
    location:{hash:'#works' + (query ? '?' + query : ''), href:''}, window:{scrollY:0, scrollTo() {}},
    history:{state:{}, replaceState(state, _, hash) { this.state = state; scope.location.hash = hash; writes.push(hash); }},
    localStorage:{getItem:key => storage.get(key), setItem:(key,value) => storage.set(key,value)},
    $:selector => elements.get(selector.slice(1)),
    document:{querySelectorAll:() => []},
    heading:(title, more) => `<h1>${title}</h1>${more}`, empty:title => `<p>${title}</p>`,
    workCard:work => `<article data-work="${work.id}"></article>`,
    publicLayout(html) {
      markup = html;
      for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element(match[1]));
      if (elements.get('work-search')) elements.get('work-search').value = (html.match(/id="work-search"[^>]+value="([^"]*)"/) || [])[1] || '';
    }
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf('function routeParams('), app.indexOf('function readRecord(')), scope);
  vm.runInContext(browser, scope);
  scope.showWorks();
  return {scope, elements, writes, get markup() { return markup; },
    params:() => new URLSearchParams(scope.location.hash.split('?')[1] || ''),
    ids:() => [...elements.get('work-results').innerHTML.matchAll(/data-work="(\d+)"/g)].map(match => Number(match[1]))
  };
}

test('sections show bangumi-style seen watching want counts', () => {
  const f = fixture();
  const html = f.elements.get('work-results').innerHTML;
  assert.match(html, /看过/);
  assert.match(html, /在看/);
  assert.match(html, /想看/);
  assert.match(html, /status=seen/);
  assert.doesNotMatch(f.markup, /紧凑/);
});

test('public work cards hide completed progress verbs', () => {
  const scope = {
    site: {hidden_work_categories: []},
    esc: v => String(v ?? ''),
    categories: ['动画','漫画','游戏','小说','书籍','影视'],
    workCategoryAlias: {},
    workStatusLabels: {动画:{seen:'看过',watching:'在看',want:'想看'},影视:{seen:'看过',watching:'在看',want:'想看'},漫画:{seen:'读过',watching:'在读',want:'想读'},小说:{seen:'读过',watching:'在读',want:'想读'},书籍:{seen:'读过',watching:'在读',want:'想读'},游戏:{seen:'玩过',watching:'在玩',want:'想玩'}},
    coverMarkup: () => '',
    ratingMarkup: () => '',
    excerpt: (t, n) => String(t || '').slice(0, n),
    workCategory: w => w.category || '',
    statusLabelsFor: c => scope.workStatusLabels[c] || scope.workStatusLabels['动画'],
    workStatus: w => {
      const p = String(w.progress || '').trim();
      const lab = scope.statusLabelsFor(w.category);
      if (!p || p === lab.want) return 'want';
      if (p === lab.seen || /已看完|看完了|已通关|已读完/.test(p)) return 'seen';
      return 'watching';
    },
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf('function workCard('), app.indexOf('function friendCard(')), scope);
  const done = scope.workCard({id:1,title:'完',category:'动画',progress:'看过',rating:9});
  const watching = scope.workCard({id:2,title:'在',category:'动画',progress:'在看',rating:8});
  const managed = scope.workCard({id:3,title:'管',category:'动画',progress:'看过',rating:7}, true);
  assert.doesNotMatch(done, /work-progress/);
  assert.match(watching, /work-progress/);
  assert.match(managed, /work-progress/);
  scope.site.hidden_work_categories = ['动画'];
  assert.match(scope.workCard({id:3,title:'管',category:'动画',published:true}, true), /分类已隐藏/);
  assert.doesNotMatch(scope.workCard({id:3,title:'管',category:'动画',published:true}, true), /已公开/);
});

test('category status opens collection detail list', () => {
  const f = fixture('category=动画&status=seen');
  assert.deepEqual(f.ids().slice().sort(), [1, 6]);
  // The position line is a breadcrumb now; the results must not repeat it.
  const crumb = f.elements.get('work-crumb');
  assert.equal(crumb.hidden, false);
  assert.match(crumb.innerHTML, /作品记录/);
  assert.match(crumb.innerHTML, /aria-current="location">看过/);
  assert.doesNotMatch(f.elements.get('work-results').innerHTML, /←/);
});

test('the breadcrumb is the way back and stays hidden with nothing filtered', () => {
  assert.equal(fixture().elements.get('work-crumb').hidden, true);
  const f = fixture('category=动画');
  assert.equal(f.elements.get('work-crumb').hidden, false);
  assert.match(f.elements.get('work-crumb').innerHTML, /href="#works">作品记录<\/a>/);
  const search = fixture('q=夏日');
  assert.match(search.elements.get('work-crumb').innerHTML, /搜索“夏日”/);
});

test('watching and want buckets partition progress', () => {
  assert.deepEqual(fixture('category=动画&status=watching').ids(), [2]);
  const want = fixture('status=want').ids();
  assert.ok(want.includes(4) && want.includes(5));
});
