'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const source = readFileSync(require.resolve('../public/app.js'),'utf8');

function navigationFixture(initial='http://local/#works?category=游戏&sort=rating&q=记录',initialState=null) {
  const handlers = {}, entries = [{url:initial, state:initialState}];
  let index = 0, feed = null, pendingBack, categoryButtons = null;
  const feedWrap = {classList:{toggle(){}}}, feedHint = {hidden:true};
  const notePreview = {innerHTML:''};
  const homeButtons = () => categoryButtons ||= [...scope.main.innerHTML.matchAll(/data-home-note-category="([^"]*)" aria-pressed="(true|false)"/g)].map(([,category,pressed]) => ({dataset:{homeNoteCategory:category},pressed,setAttribute(name,value){if(name === 'aria-pressed') this.pressed=value;}}));
  const makeFeed = () => {
    const listeners = {};
    return {scrollTop:0,scrollHeight:700,clientHeight:387,isConnected:true,
      addEventListener(name,cb){(listeners[name] ||= []).push(cb);},
      scrollTo(top){this.scrollTop=top;for(const cb of listeners.scroll || []) cb();},
    };
  };
  const scope = {
    URL, URLSearchParams,
    location: {get href(){return entries[index].url;},get hash(){return new URL(entries[index].url).hash;},get pathname(){return new URL(entries[index].url).pathname;},get origin(){return new URL(entries[index].url).origin;},get search(){return new URL(entries[index].url).search;},replace(url){entries[index]={...entries[index],url:new URL(url,entries[index].url).href};}},
    history: {get state(){return entries[index].state;}, replaceState(state,_,url){entries[index]={state,url:new URL(url,entries[index].url).href};},back(){pendingBack=back();}},
    window: {scrollY:341,addEventListener(name,cb){handlers[name]=cb;},scrollTo({top}){this.scrollY=top;}},
    document:{documentElement:{dataset:{theme:'light'}},addEventListener(name,cb){handlers[name]=cb;}},
    main:{innerHTML:'',focus(){},querySelector(selector){return selector === '.home-feed' ? feed : selector === '.home-feed-wrap' ? feedWrap : selector === '.home-feed-hint' ? feedHint : selector === '#home-note-preview' ? notePreview : null;},querySelectorAll(selector){return selector === '[data-home-note-category]' ? homeButtons() : [];}}, $(){return {focus(){}};},
    canLeave:async()=>true,dialog:{open:false},renderRoute:async()=>{},
    site:{profile:{name:'RongGuang233'},posts:[],notes:[],projects:[],works:[],friends:[],bookmarks:[]},
    kinds:{posts:{name:'博客'},notes:{name:'笔记'},projects:{name:'项目'},works:{name:'作品记录'},friends:{name:'友链'},bookmarks:{name:'收藏'}},
    authenticated:false,icon:()=>'',lightMark:()=>'',ownerMenu:()=>'',updateClock:()=>{},
    getComputedStyle:()=>({overflowY:'auto'}),ResizeObserver:class {observe(){} disconnect(){}},
    currentUrl:entries[0].url,
  };
  vm.createContext(scope);
  vm.runInContext(source.match(/^const esc = .+;$/m)[0] + '\n' + source.match(/^const date = .+;$/m)[0] + '\n' + source.match(/^function publicationTime\(record\).+$/m)[0],scope);
  vm.runInContext(source.slice(source.indexOf('function noteCategory('),source.indexOf('function noteSummary(')),scope);
  vm.runInContext(source.slice(source.indexOf('function publicHome()'),source.indexOf('function recordBody(')),scope);
  vm.runInContext(source.slice(source.indexOf('// Keep the browser'),source.indexOf('async function init()')),scope);
  vm.runInContext(source.slice(source.indexOf('async function init()'),source.lastIndexOf('\ninit();')),scope);
  scope.api=async path=>{if(path === 'public') return scope.site;throw new Error('not signed in');};
  scope.renderRoute=async()=>{feed=scope.routeFromLocation() === 'home' ? makeFeed() : null;if(feed) {categoryButtons=null;scope.publicHome();notePreview.innerHTML=scope.main.innerHTML.match(/id="home-note-preview"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';}};
  scope.renderRoute();
  const back = async()=>{index--;await handlers.popstate();await handlers.hashchange();};
  const click = async (hash,{backList=false,readerNext=false}={}) => {
    let prevented=false;
    const anchor = {hash,href:new URL(hash,scope.location.href).href,hasAttribute:name=>name === 'data-back-list' && backList,classList:{contains:name=>name === 'reader-next' && readerNext}};
    await handlers.click({target:{closest:selector=>selector.startsWith('a[')?anchor:null},button:0,preventDefault(){prevented=true;}});
    if(pendingBack) {await pendingBack;pendingBack=null;return;}
    if(!prevented) {entries.splice(index+1);entries.push({url:new URL(hash,scope.location.href).href,state:null});index++;}
    await handlers.hashchange();
  };
  return {scope,click,back,feed:()=>feed,notePreview,homeButtons,selectCategory:category=>homeButtons().find(button=>button.dataset.homeNoteCategory === category).onclick(),historyLength:()=>entries.length,scrollFeed:top=>feed.scrollTo(top),scrollWindow:top=>{scope.window.scrollY=top;handlers.scroll();}};
}

function installHomeNotes(f) {
  f.scope.site.notes=[
    ...Array.from({length:5},(_,index)=>({id:index+1,title:'数学'+index,category:'数学',updated:index+1})),
    ...Array.from({length:4},(_,index)=>({id:index+10,title:'物理'+index,category:'物理',updated:index+10})),
    {id:20,title:'新分类笔记',category:'新分类',updated:0},
  ];
  return f.scope.renderRoute();
}

test('browser back closes an open reader image before restoring the filtered list', async () => {
  const f = navigationFixture('http://local/#notes?category=数学&q=导数');
  const fallback = f.scope.$;
  const lightbox = {open: false, closes: 0, close() { this.open = false; this.closes++; }};
  f.scope.$ = selector => selector === '#image-lightbox' ? lightbox : fallback(selector);
  f.scrollWindow(420);
  await f.click('#read/notes/19');
  f.scrollWindow(1200);
  lightbox.open = true;
  await f.back();
  assert.equal(lightbox.open, false);
  assert.equal(lightbox.closes, 1);
  const params = new URLSearchParams(f.scope.routeFromLocation().split('?')[1]);
  assert.equal(params.get('category'), '数学');
  assert.equal(params.get('q'), '导数');
  assert.equal(f.scope.window.scrollY, 420);
});

test('reading progress updates after a height-only resize without scrolling', () => {
  const progress = {style: {}}, top = {hidden: true}, handlers = {};
  const scope = {
    main: {innerHTML: ''}, bindCoverImages() {},
    $: selector => selector === '#back-top' ? top : selector === '#reading-progress span' ? progress : null,
    document: {documentElement: {scrollHeight: 3816}},
    window: {scrollY: 2916, innerHeight: 900, addEventListener(name, callback) { handlers[name] = callback; }},
  };
  vm.createContext(scope);
  vm.runInContext(source.match(/^function publicLayout\(.+$/m)[0], scope);
  scope.publicLayout('', true);
  assert.equal(progress.style.transform, 'scaleX(1)');
  scope.window.innerHeight = 600;
  scope.window.onresize?.();
  handlers.resize?.();
  assert.equal(progress.style.transform, `scaleX(${2916 / 3216})`);
});

test('returning to the top follows the current reduced-motion preference', () => {
  const top = {hidden: true}, calls = [];
  let reduced = false;
  const scope = {
    main: {innerHTML: ''}, bindCoverImages() {},
    $: selector => selector === '#back-top' ? top : null,
    matchMedia: () => ({matches: reduced}),
    window: {scrollY: 600, scrollTo(options) { calls.push([options.top, options.behavior]); }},
  };
  vm.createContext(scope);
  vm.runInContext(source.match(/^function publicLayout\(.+$/m)[0], scope);
  scope.publicLayout('');
  top.onclick();
  reduced = true;
  top.onclick();
  assert.deepEqual(calls, [[0, 'smooth'], [0, 'instant']]);
});

test('home category preview filters the latest four notes in place and keeps all categories discoverable',async()=>{
  const f=navigationFixture('http://local/#home');
  await installHomeNotes(f);
  assert.deepEqual(f.homeButtons().map(button=>button.dataset.homeNoteCategory).sort(),['','数学','新分类','物理'].sort());
  assert(f.notePreview.innerHTML.includes('物理3'));
  assert(!f.notePreview.innerHTML.includes('数学'));
  f.scrollFeed(120);
  f.selectCategory('数学');
  assert.equal(f.scope.location.hash,'#home');
  assert.equal(f.historyLength(),1);
  assert.equal(f.feed().scrollTop,120);
  assert.equal(f.scope.window.scrollY,341);
  assert.deepEqual([...f.notePreview.innerHTML.matchAll(/href="#read\/notes\/(\d+)"/g)].map(match=>Number(match[1])),[5,4,3,2]);
  assert(!f.notePreview.innerHTML.includes('物理'));
  assert.equal(f.homeButtons().find(button=>button.pressed === 'true').dataset.homeNoteCategory,'数学');
  f.selectCategory('');
  assert(f.notePreview.innerHTML.includes('物理3'));
  assert.equal(f.homeButtons().find(button=>button.pressed === 'true').dataset.homeNoteCategory,'');
});

test('home note selection survives reading and reload while a normal new home entry starts with recent notes',async()=>{
  const f=navigationFixture('http://local/#home');
  await installHomeNotes(f);
  f.selectCategory('数学');
  f.scrollFeed(240);
  await f.click('#read/notes/5');
  await f.click('#home',{backList:true});
  assert(f.notePreview.innerHTML.includes('数学4'));
  assert.equal(f.homeButtons().find(button=>button.pressed === 'true').dataset.homeNoteCategory,'数学');
  assert.equal(f.feed().scrollTop,240);
  await f.scope.init();
  assert(f.notePreview.innerHTML.includes('数学4'));
  assert.equal(f.feed().scrollTop,240);
  await f.click('#notes');
  await f.click('#home');
  assert(f.notePreview.innerHTML.includes('物理3'));
  assert.equal(f.homeButtons().find(button=>button.pressed === 'true').dataset.homeNoteCategory,'');
  assert.equal(f.feed().scrollTop,0);
});

test('home preview picks up edited content and falls back to recent when a category is removed',async()=>{
  const f=navigationFixture('http://local/#home');
  await installHomeNotes(f);
  f.selectCategory('数学');
  f.scope.site.notes.push({id:21,title:'新建的数学笔记',category:'数学',updated:30});
  await f.scope.init();
  assert(f.notePreview.innerHTML.includes('新建的数学笔记'));
  f.scope.site.notes.at(-1).title='修改后的数学笔记';
  await f.scope.init();
  assert(f.notePreview.innerHTML.includes('修改后的数学笔记'));
  f.scope.site.notes=f.scope.site.notes.filter(row=>row.category !== '数学');
  await f.scope.init();
  assert(f.notePreview.innerHTML.includes('物理3'));
  assert.equal(f.homeButtons().find(button=>button.pressed === 'true').dataset.homeNoteCategory,'');
  assert.equal(f.scope.history.state.homeNoteCategory,'');
  f.scope.site.notes=[];
  await f.scope.init();
  assert(f.notePreview.innerHTML.includes('还没有公开笔记'));
  assert.deepEqual(f.homeButtons().map(button=>button.dataset.homeNoteCategory),['']);
});

function installReaderFixture(f) {
  const scope=f.scope, renderHome=scope.renderRoute;
  Object.assign(scope,{
    cleanupReadingNavigation:()=>{},cleanupAboutNavigation:()=>{},routeVersion:0,
    site:{profile:{name:'RongGuang233',bio:''},posts:[{id:1,title:'博客甲',updated:1,body:''}],notes:[{id:25,title:'笔记甲',updated:2,category:'物理',body:''},{id:26,title:'笔记乙',updated:1,category:'物理',body:''}],works:[{id:7,title:'作品甲',updated:1,category:'游戏'}],projects:[{id:8,title:'项目甲',updated:1,body:''}],friends:[],bookmarks:[]},
    publicLayout:html=>{scope.main.innerHTML=html;},noteCategory:row=>row.category || '',filteredNotes:()=>scope.site.notes,
    avatarMarkup:()=>'',coverMarkup:()=>'',ratingMarkup:()=>'',wordCount:()=>0,tagLinks:()=>'',noteTagLinks:()=>'',projectTagLinks:()=>'',articleBodyMarkup:row=>row.body || '',
  });
  scope.window.mountMathScrolling=()=>()=>{};
  scope.main.querySelectorAll=()=>[];
  vm.runInContext(source.slice(source.indexOf('function publicationTime('),source.indexOf('function showSearch(')),scope);
  scope.renderRoute=async()=>{const route=scope.routeFromLocation();if(route.startsWith('read/')) {const [,kind,id]=route.split('/');scope.readRecord(kind,id);} else await renderHome();};
}

test('a missing note offers a direct return to the notes list', () => {
  const f = navigationFixture('http://local/read/notes/999999');
  installReaderFixture(f);
  vm.runInContext(source.match(/^function empty\(.+$/m)[0], f.scope);
  f.scope.readRecord('notes', 999999);
  assert.match(f.scope.main.innerHTML, /内容不存在或尚未公开/);
  assert.match(f.scope.main.innerHTML, /href="#notes">返回笔记列表/);
});

test('note paths retain a separate return link for a filtered note origin',async()=>{
  const f=navigationFixture('http://local/#notes?tag=磁场&q=线圈');
  installReaderFixture(f);
  await f.click('#read/notes/25');
  assert.match(f.scope.main.innerHTML,/aria-label="笔记路径"/);
  assert.match(f.scope.main.innerHTML,/href="#notes\?category=/);
  const returnLink=f.scope.main.innerHTML.match(/class="back note-source-back" data-back-list href="([^"]+)"/)[1].replaceAll('&amp;','&');
  const params=new URLSearchParams(returnLink.split('?')[1]);
  assert.equal(params.get('tag'),'磁场');
  assert.equal(params.get('q'),'线圈');
  await f.click(returnLink,{backList:true});
  assert.equal(new URLSearchParams(f.scope.location.hash.split('?')[1]).get('q'),'线圈');
});

test('a denied clipboard exposes a usable public note link instead of a nonexistent control',async()=>{
  const f=navigationFixture('http://local/#notes');
  installReaderFixture(f);
  const inserted=[];
  const button={after:element=>inserted.push(element)};
  f.scope.$=()=>button;
  f.scope.document.getElementById=()=>inserted[0] || null;
  f.scope.document.createElement=()=>({});
  f.scope.navigator={clipboard:{writeText:async()=>{throw new Error('Clipboard denied');}}};
  f.scope.toast=()=>{};
  await f.click('#read/notes/25');
  await button.onclick();
  assert.equal(inserted[0]?.href,'http://local/read/notes/25');
  assert.equal(inserted[0]?.textContent,'公开地址');
  await button.onclick();
  assert.equal(inserted.length,1);
});

test('browser back restores the independent home feed position saved by scrolling',async()=>{
  const f=navigationFixture('http://local/#home');
  f.scrollFeed(313);
  assert.equal(f.scope.history.state?.homeFeedScrollTop,313);
  await f.click('#read/notes/25');
  await f.back();
  assert.equal(f.scope.location.hash,'#home');
  assert.equal(f.feed().scrollTop,313);
  assert.equal(f.scope.window.scrollY,341);
});

test('in-page return to home restores the existing history entry and feed position',async()=>{
  const f=navigationFixture('http://local/#home');
  f.scrollFeed(313);
  await f.click('#read/notes/25');
  await f.click('#home',{backList:true});
  assert.equal(f.feed().scrollTop,313);
  assert.equal(f.scope.history.state.homeFeedScrollTop,313);
  assert.equal(f.scope.window.scrollY,341);
});

test('a new home history entry starts at zero instead of inheriting a previous feed position',async()=>{
  const f=navigationFixture('http://local/#notes?category=物理',{scrollY:341,homeFeedScrollTop:313});
  await f.click('#home');
  assert.equal(f.feed().scrollTop,0);
  assert.equal(f.scope.window.scrollY,0);
  assert.equal(f.scope.history.state.from,'notes?category=%E7%89%A9%E7%90%86');
});

test('reloading home restores its feed and window positions from the current history entry',async()=>{
  const f=navigationFixture('http://local/#home',{scrollY:47,homeFeedScrollTop:313});
  await f.scope.init();
  assert.equal(f.feed().scrollTop,313);
  assert.equal(f.scope.window.scrollY,47);
});

test('opening home without saved history starts both scroll positions at zero',async()=>{
  const f=navigationFixture('http://local/#home');
  await f.scope.init();
  assert.equal(f.feed().scrollTop,0);
  assert.equal(f.scope.window.scrollY,0);
});

test('home feed position stays independent of another list query and window position',async()=>{
  const f=navigationFixture('http://local/#home');
  f.scrollFeed(313);
  await f.click('#works?category=游戏&sort=rating&q=记录');
  f.scrollWindow(219);
  await f.click('#read/works/7');
  await f.back();
  assert.equal(decodeURIComponent(f.scope.location.hash),'#works?category=游戏&sort=rating&q=记录');
  assert.equal(f.scope.window.scrollY,219);
  assert.equal(f.scope.history.state.homeFeedScrollTop,undefined);
  await f.back();
  assert.equal(f.feed().scrollTop,313);
  assert.equal(f.scope.window.scrollY,341);
});

test('all supported reader kinds return to home when opened from home',()=>{
  const f=navigationFixture('http://local/#home');
  installReaderFixture(f);
  f.scope.history.replaceState({from:'home'},'',f.scope.location.href);
  for(const [kind,id] of [['posts',1],['notes',25],['works',7],['projects',8]]) {
    f.scope.readRecord(kind,id);
    assert.equal([...f.scope.main.innerHTML.matchAll(/data-back-list href="#home">← 返回首页<\/a>/g)].length,2,kind);
  }
});

test('direct reader URLs keep their original collection return links',()=>{
  const f=navigationFixture('http://local/read/notes/25');
  installReaderFixture(f);
  for(const [kind,id] of [['posts',1],['notes',25],['works',7],['projects',8]]) {
    f.scope.readRecord(kind,id);
    assert(f.scope.main.innerHTML.includes(`data-back-list href="#${kind}">← 返回${f.scope.kinds[kind].name}</a>`),kind);
  }
});

test('category, search and management origins retain their existing reader return rules',()=>{
  const f=navigationFixture('http://local/read/notes/25');
  installReaderFixture(f);
  for(const [kind,id,from,label,authenticated] of [
    ['notes',25,'notes?category=物理','笔记',false],
    ['posts',1,'search?q=甲&type=posts','搜索结果',false],
    ['posts',1,'private/posts?q=甲','内容管理',true],
  ]) {
    f.scope.authenticated=authenticated;
    f.scope.history.replaceState({from},'',f.scope.location.href);
    f.scope.readRecord(kind,id);
    const escapedFrom=vm.runInContext('esc(history.state.from)',f.scope);
    assert(f.scope.main.innerHTML.includes(`data-back-list href="#${escapedFrom}">← 返回${label}</a>`),from);
  }
});

test('next and previous note navigation preserve home origin and return to its feed position',async()=>{
  const f=navigationFixture('http://local/#home');
  installReaderFixture(f);
  f.scrollFeed(313);
  await f.click('#read/notes/25');
  assert(f.scope.main.innerHTML.includes('href="#read/notes/26"'));
  await f.click('#read/notes/26',{readerNext:true});
  assert.equal(f.scope.history.state.from,'home');
  assert(f.scope.main.innerHTML.includes('reader-next reader-previous" href="#read/notes/25"'));
  await f.click('#read/notes/25',{readerNext:true});
  assert.equal(f.scope.history.state.from,'home');
  assert(f.scope.main.innerHTML.includes('data-back-list href="#home">← 返回首页</a>'));
  await f.click('#home',{backList:true});
  assert.equal(f.feed().scrollTop,313);
});

test('returning from a work detail restores the exact list query and scroll position',async()=>{
  const f=navigationFixture();
  await f.click('#read/works/7');
  assert.equal(f.scope.window.scrollY,0);
  assert.equal(decodeURIComponent(f.scope.history.state.from),'works?category=游戏&sort=rating&q=记录');
  await f.back();
  assert.equal(decodeURIComponent(f.scope.location.hash),'#works?category=游戏&sort=rating&q=记录');
  assert.equal(f.scope.window.scrollY,341);
});

test('search filters survive URL serialization without adding a history entry',()=>{
  let saved;
  const scope={URLSearchParams,location:{hash:'#search',href:'http://local/#search'},history:{state:{from:'home'},replaceState(state,_,url){saved={state,url};}},window:{scrollY:27},currentUrl:''};
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('function saveListParams('),source.indexOf('function filteredWorks(')),scope);
  scope.saveListParams({q:'A&B / 游戏',sort:'updated',type:'works'});
  assert.equal(new URLSearchParams(saved.url.split('?')[1]).get('q'),'A&B / 游戏');
  assert.equal(new URLSearchParams(saved.url.split('?')[1]).get('type'),'works');
  assert.equal(saved.state.scrollY,27);
  assert.equal(saved.state.from,'home');
});

test('work filtering combines category and text, rating order puts unrated last',()=>{
  const scope={site:{works:[
    {id:1,category:'游戏',title:'记录甲',rating:null,updated:3},
    {id:2,category:'游戏',title:'记录乙',rating:8,updated:1},
    {id:3,category:'小说',title:'记录丙',rating:10,updated:4},
    {id:4,category:'游戏',title:'其他',rating:9,updated:2},
  ]}};
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('function publicationTime('),source.indexOf('function readRecord(')),scope);
  const rows=scope.filteredWorks(new URLSearchParams({category:'游戏',q:'记录',sort:'rating'}));
  assert.deepEqual(Array.from(rows,row=>row.id),[2,1]);
});

test('private preview restores management query and scroll after canonical article navigation',async()=>{
 const f=navigationFixture('http://local/#private/posts?q=旧文');
 await f.click('#read/posts/1');
 assert.equal(f.scope.location.pathname,'/read/posts/1');
 assert.equal(f.scope.history.state.from,'private/posts?q=%E6%97%A7%E6%96%87');
 assert.equal(f.scope.publicArticleURL('posts',1),'http://local/read/posts/1');
 await f.back();
 assert.equal(decodeURIComponent(f.scope.location.hash),'#private/posts?q=旧文');
 assert.equal(f.scope.window.scrollY,341);
});
test('legacy management paths normalize without leaking into the public share URL',()=>{
 const f=navigationFixture('http://local/private#read/posts/1');
 assert.equal(f.scope.normalizeRouteLocation(),'http://local/read/posts/1');
 assert.equal(f.scope.routeFromLocation(),'read/posts/1');
 assert.equal(f.scope.publicArticleURL('posts',1),'http://local/read/posts/1');
});

test('project detail links keep their canonical route when opened directly, clicked and reloaded',async()=>{
 const direct=navigationFixture('http://local/read/projects/913');
 assert.equal(direct.scope.routeFromLocation(),'read/projects/913');
 assert.equal(direct.scope.normalizeRouteLocation(),'http://local/read/projects/913');
 const f=navigationFixture('http://local/#projects');
 await f.click('#read/projects/913');
 assert.equal(f.scope.location.pathname,'/read/projects/913');
 assert.equal(f.scope.routeFromLocation(),'read/projects/913');
 assert.equal(f.scope.history.state.from,'projects');
 await f.scope.init();
 assert.equal(f.scope.location.href,'http://local/read/projects/913');
});

test('short notes with multiple sections get navigation while short posts keep their original threshold',()=>{
 const f=navigationFixture('http://local/read/notes/25');
 installReaderFixture(f);
 let mounts=0;
 f.scope.main.querySelectorAll=()=>Array.from({length:3},()=>({}));
 f.scope.mountReadingNavigation=()=>{mounts++;return ()=>{};};
 f.scope.readRecord('notes',25);
 assert.equal(mounts,1);
 f.scope.readRecord('posts',1);
 assert.equal(mounts,1);
});

test('note footer keeps mixed search results and removes duplicate sharing controls',()=>{
 const f=navigationFixture('http://local/read/notes/25');
 installReaderFixture(f);
 f.scope.history.replaceState({from:'search?q=甲'},'',f.scope.location.href);
 f.scope.readRecord('notes',25);
 assert.match(f.scope.main.innerHTML,/reader-next" href="#read\/posts\/1"/);
 assert.match(f.scope.main.innerHTML,/下一个结果 →/);
 assert.match(f.scope.main.innerHTML,/aria-label="相邻笔记"/);
 assert.doesNotMatch(f.scope.main.innerHTML,/公开地址/);
});
