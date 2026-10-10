'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const source = readFileSync(require.resolve('../public/app.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const publicNotes = () => ({profile:{name:'RongGuang233',bio:''}, notes:[{id:25,title:'导数',category:'',updated:1,body:'## 1. 定义\n\n瞬时变化率：平均变化率的极限。'}], posts:[],works:[],projects:[],friends:[],bookmarks:[]});

function loadingFixture(initial = 'http://local/read/notes/25') {
  let href = initial, html = '', writes = 0;
  const nodes = new Map(), requests = {public:[],session:[]}, calls = [], workspaces = [];
  const element = selector => {
    const node = {innerHTML:'',textContent:'',children:[],remove(){nodes.delete(selector);},append(child){this.children.push(child); if(child.id) nodes.set('#'+child.id,child);},insertAdjacentHTML(_,value){this.innerHTML+=value;},setAttribute(){},focus(){scope.document.activeElement=this;}};
    return node;
  };
  for (const selector of ['#header-owner','.brand','#footer-name']) nodes.set(selector, element(selector));
  const main = {
    get innerHTML(){return html;},set innerHTML(value){html=value;writes++;for(const selector of ['.reader','.reader-actions','.reader > .markdown','#edit-current','#copy-link','#reload-site','.content']) nodes.delete(selector);
      for(const [selector,pattern] of [['.reader',/class="reader /],['.reader-actions',/class="reader-actions"/],['.reader > .markdown',/class="markdown"/],['#edit-current',/id="edit-current"/],['#copy-link',/id="copy-link"/],['#reload-site',/id="reload-site"/],['.content',/section class="content"/]]) if(pattern.test(value)) nodes.set(selector,element(selector));
    },querySelector(selector){return nodes.get(selector)||null;},querySelectorAll(){return[];},focus(){scope.document.activeElement=this;}
  };
  const scope = {
    URL,URLSearchParams,main,location:{get href(){return href;},get hash(){return new URL(href).hash;},get pathname(){return new URL(href).pathname;},get search(){return new URL(href).search;},get origin(){return new URL(href).origin;}},
    history:{state:null,replaceState(state,_,url){this.state=state;href=new URL(url,href).href;}},
    document:{body:{dataset:{}},activeElement:null,querySelectorAll(){return[];},addEventListener(){},createElement(){return element('');}},
    window:{scrollY:0,addEventListener(){},scrollTo({top}){this.scrollY=top;},mountMathScrolling:()=>()=>{}},
    $:selector=>nodes.get(selector)||null,authenticated:false,site:{...publicNotes(),notes:[]},routeVersion:0,currentUrl:href,
    dialog:{open:false},canLeave:async()=>true,cleanupReadingNavigation(){},cleanupAboutNavigation(){},
    kinds:{notes:{name:'笔记'},posts:{name:'博客'},projects:{name:'项目'},works:{name:'作品记录'}},
    icon:()=>'<svg></svg>',lightMark:()=>'',avatarMarkup:()=>'',noteCategory:row=>row.category||'',noteTagLinks:()=>'',wordCount:()=>0,
    publicLayout:content=>{main.innerHTML=`<section class="content">${content}</section>`;},empty:(title,detail='')=>`<div class="empty"><h2>${title}</h2><p>${detail}</p></div>`,
    articleBodyMarkup:row=>`<p>${row.body}</p>`,filteredNotes:()=>scope.site.notes,filteredPosts:()=>[],filteredWorks:()=>[],filteredProjects:()=>[],
    bindCoverImages(){},editRecord:(kind,row)=>calls.push(['edit',kind,row.id]),toast(){},
    workspace:async(kind)=>{workspaces.push({kind,authenticated:scope.authenticated});main.innerHTML=scope.authenticated?'内容管理':'登录私人空间';},
    showCollection:kind=>{main.innerHTML=scope.site[kind].length?scope.site[kind].map(note=>note.title).join(''):'还没有公开笔记';},
    showSearch(){main.innerHTML='搜索';},showAbout(){main.innerHTML='关于';},publicHome(){main.innerHTML='首页';},
    api:path=>{calls.push(path);return requests[path].shift() ?? Promise.reject(new Error('No queued '+path));},
  };
  vm.createContext(scope);
  vm.runInContext(source.match(/^const esc = .+;$/m)[0]+'\n'+source.match(/^const date = .+;$/m)[0],scope);
  vm.runInContext(source.slice(source.indexOf('function ownerMenu()'),source.indexOf('function updateClock()')),scope);
  vm.runInContext(source.slice(source.indexOf('function publicationTime('),source.indexOf('function showSearch(')),scope);
  // The loading checks call the actual public reader and route dispatcher.
  scope.articleBodyMarkup=row=>`<p>${row.body}</p>`;
  vm.runInContext(source.slice(source.indexOf('function updateIdentity()'),source.indexOf("$('.skip-link').onclick")),scope);
  vm.runInContext(source.slice(source.indexOf('// Keep the browser'),source.lastIndexOf('\ninit();')),scope);
  return {scope,nodes,calls,workspaces,requests,queue(path,promise){requests[path].push(promise);},navigate(route){href='http://local/#'+route;return scope.renderRoute();},writes:()=>writes};
}

test('failed public data remains an error on notes routes and can be read again',async()=>{
  const f=loadingFixture();
  f.queue('public',Promise.reject(new Error('Network request failed')));
  f.queue('session',Promise.reject(Object.assign(new Error('Not signed in'),{status:401})));
  await f.scope.init();
  assert.match(f.scope.main.innerHTML,/暂时无法读取小站/);
  await f.navigate('notes');
  assert.match(f.scope.main.innerHTML,/暂时无法读取小站/);
  assert.doesNotMatch(f.scope.main.innerHTML,/还没有公开笔记/);
  f.queue('public',Promise.resolve(publicNotes()));
  f.queue('session',Promise.reject(Object.assign(new Error('Not signed in'),{status:401})));
  await f.nodes.get('#reload-site').onclick();
  assert.match(f.scope.main.innerHTML,/导数/);
  assert.doesNotMatch(f.scope.main.innerHTML,/暂时无法读取小站/);
});

for (const error of [new TypeError('Failed to fetch'), new SyntaxError("Unexpected token '<' is not valid JSON")]) {
  test(`${error.name} during public loading gives a readable Chinese retry message`, async () => {
    const f = loadingFixture();
    f.queue('public', Promise.reject(error));
    f.queue('session', Promise.reject(new Error('Not signed in')));
    await f.scope.init();
    assert.match(f.scope.main.innerHTML, /公开内容没有加载成功，请稍后重新读取/);
    assert.doesNotMatch(f.scope.main.innerHTML, /Failed to fetch|Unexpected token|not valid JSON/);
    assert(f.nodes.has('#reload-site'));
  });
}

test('structured public service errors keep their specific explanation', async () => {
  const f = loadingFixture();
  f.queue('public', Promise.reject(Object.assign(new Error('公开内容维护中，请稍后再试'), {status: 503})));
  f.queue('session', Promise.reject(new Error('Not signed in')));
  await f.scope.init();
  assert.match(f.scope.main.innerHTML, /公开内容维护中，请稍后再试/);
});

test('public reader initializes while session remains pending and late 401 preserves its nodes',async()=>{
  const f=loadingFixture(),session=deferred();
  f.queue('public',Promise.resolve(publicNotes()));f.queue('session',session.promise);
  const init=f.scope.init();await tick();
  assert.match(f.scope.main.innerHTML,/<h1>导数<\/h1>/);
  assert.match(f.scope.main.innerHTML,/瞬时变化率/);
  await init;
  const reader=f.nodes.get('.reader'),markdown=f.nodes.get('.reader > .markdown'),writes=f.writes();
  f.scope.window.scrollY=620;f.scope.document.activeElement=markdown;
  session.reject(Object.assign(new Error('Not signed in'),{status:401}));await tick();
  assert.equal(f.scope.authenticated,false);
  assert.equal(f.nodes.get('.reader'),reader);assert.equal(f.writes(),writes);
  assert.equal(f.scope.window.scrollY,620);assert.equal(f.scope.document.activeElement,markdown);
  assert.equal(f.nodes.has('#edit-current'),false);
});

test('late signed-in session adds usable editing controls without replacing the reader',async()=>{
  const f=loadingFixture(),session=deferred();
  f.queue('public',Promise.resolve(publicNotes()));f.queue('session',session.promise);
  const init=f.scope.init();await tick();
  assert.match(f.scope.main.innerHTML,/<h1>导数<\/h1>/);await init;
  const reader=f.nodes.get('.reader'),markdown=f.nodes.get('.reader > .markdown'),writes=f.writes();
  f.scope.window.scrollY=620;f.scope.document.activeElement=markdown;
  session.resolve({username:'owner'});await tick();
  assert.equal(f.scope.authenticated,true);
  assert.match(f.nodes.get('#header-owner').innerHTML,/内容管理/);
  assert.equal(f.nodes.get('.reader'),reader);assert.equal(f.writes(),writes);
  assert.equal(f.scope.window.scrollY,620);assert.equal(f.scope.document.activeElement,markdown);
  const edit=f.nodes.get('#edit-current');assert(edit);
  f.scope.api=async path=>{assert.equal(path,'notes');return publicNotes().notes;};
  await edit.onclick();assert.deepEqual(f.calls.at(-1),['edit','notes',25]);
});

test('late 401 removes stale editing controls without replacing readable content',async()=>{
  const f=loadingFixture(),session=deferred();
  f.scope.authenticated=true;
  f.queue('public',Promise.resolve(publicNotes()));f.queue('session',session.promise);
  await f.scope.init();assert(f.nodes.has('#edit-current'));
  const reader=f.nodes.get('.reader'),writes=f.writes();
  f.scope.window.scrollY=620;
  session.reject(Object.assign(new Error('Session expired'),{status:401}));await tick();
  assert.equal(f.scope.authenticated,false);assert.equal(f.nodes.has('#edit-current'),false);
  assert.equal(f.nodes.get('#header-owner').innerHTML,'');
  assert.equal(f.nodes.get('.reader'),reader);assert.equal(f.writes(),writes);assert.equal(f.scope.window.scrollY,620);
});

for(const signedIn of [false,true]) test(`private entry waits for session before ${signedIn?'management':'login'}`,async()=>{
  const f=loadingFixture('http://local/#private/notes'),session=deferred();
  f.queue('public',Promise.resolve(publicNotes()));f.queue('session',session.promise);
  const init=f.scope.init();await tick();
  assert.deepEqual(f.workspaces,[]);
  assert.match(f.scope.main.innerHTML,/正在确认登录状态/);
  if(signedIn) session.resolve({username:'owner'});else session.reject(Object.assign(new Error('Not signed in'),{status:401}));
  await init;
  assert.deepEqual(f.workspaces,[{kind:'notes',authenticated:signedIn}]);
});

test('navigation during a pending public request never treats it as empty notes',async()=>{
  const f=loadingFixture(),publicRequest=deferred(),session=deferred();
  f.queue('public',publicRequest.promise);f.queue('session',session.promise);
  const init=f.scope.init();await f.navigate('notes');
  assert.match(f.scope.main.innerHTML,/正在读取小站/);
  assert.doesNotMatch(f.scope.main.innerHTML,/还没有公开笔记/);
  publicRequest.resolve(publicNotes());await init;
  assert.match(f.scope.main.innerHTML,/导数/);
  session.reject(Object.assign(new Error('Not signed in'),{status:401}));await tick();
});

test('leaving a private entry while session is pending does not restore its old workspace',async()=>{
  const f=loadingFixture('http://local/#private/notes'),session=deferred();
  f.queue('public',Promise.resolve(publicNotes()));f.queue('session',session.promise);
  const init=f.scope.init();await tick();
  await f.navigate('read/notes/25');
  const reader=f.nodes.get('.reader'),writes=f.writes();f.scope.window.scrollY=620;
  session.resolve({username:'owner'});await init;
  assert.deepEqual(f.workspaces,[]);
  assert.equal(f.nodes.get('.reader'),reader);assert.equal(f.writes(),writes);assert.equal(f.scope.window.scrollY,620);
});
