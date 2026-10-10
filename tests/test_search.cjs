'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const source=readFileSync(require.resolve('../public/app.js'),'utf8');
function fixture(){
 const scope={URLSearchParams,kinds:{posts:{},notes:{},projects:{},works:{},friends:{},bookmarks:{}},site:{posts:[{id:1,title:'记录',body:'开头。'+ '日常'.repeat(150)+'末尾补充的具体内容',summary:'固定摘要',updated:1},{id:2,title:'另一篇',body:'与搜索无关',updated:3}],notes:[{id:3,title:'补充想法',body:'一条笔记',updated:2}],projects:[],works:[{id:4,title:'作品',category:'游戏',progress:'已完成',notes:'感想',updated:4}],friends:[],bookmarks:[]},excerpt:(text,n)=>String(text||'').slice(0,n),esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
 vm.createContext(scope);
 const statusStart=source.indexOf('const workStatusLabels'),statusEnd=source.indexOf('const iconPaths');
 if(statusStart>=0)vm.runInContext(source.slice(statusStart,statusEnd),scope);
 const a=source.indexOf('function publicationTime('),b=source.indexOf('function readRecord(');
 if(a>=0)vm.runInContext(source.slice(a,b),scope);
 scope.date=value=>String(value);
 const mapStart=source.indexOf('function knowledgeMapMarkup('),mapEnd=source.indexOf('function showCollection(');
 vm.runInContext(source.slice(mapStart,mapEnd),scope);
 const noteStart=source.indexOf('function noteTags('),noteEnd=source.indexOf('function compactNote(');
 if(noteStart>=0)vm.runInContext(source.slice(noteStart,noteEnd),scope);
 return scope;
}
test('search matches work progress consistently and prioritizes title matches',()=>{
 const f=fixture(); assert.equal(typeof f.matchesSearch,'function');
 assert.equal(f.matchesSearch(f.site.works[0],'已完成'),true);
 assert.deepEqual(Array.from(f.searchRecords('补充'),r=>r.id),[3,1]);
});
test('search summary shows a body match outside the fixed summary',()=>{
 const f=fixture();assert.equal(typeof f.searchSnippet,'function');
 const snippet=f.searchSnippet(f.site.posts[0],'补充');
 assert.match(snippet,/<mark>补充<\/mark>/);assert.match(snippet,/末尾/);assert.doesNotMatch(snippet,/固定摘要/);
 assert.ok(snippet.length<160);
});
test('search snippets omit both display and inline formula source before highlighting',()=>{
 const f=fixture();
 const snippet=f.searchSnippet({body:'磁力说明。\n\n$$\n\\vec F=I\\vec L\\times\\vec B\n$$\n\n正文含 $x_1$ 的解释。'},'磁');
 assert.match(snippet,/<mark>磁<\/mark>力说明/);
 assert.match(snippet,/正文含/);
 assert.doesNotMatch(snippet,/\$|\\vec|x_1/);
});
test('pagination slices rows and keeps page numbers compact',()=>{
  const f=fixture();
  const a=source.indexOf('function pageFromParams('),b=source.indexOf('function saveListParams(');
  vm.runInContext(source.slice(a,b),f);
  const rows=Array.from({length:25},(_,i)=>({id:i+1}));
  const first=f.paginateRows(rows,1,10);
  assert.equal(first.items.length,10);
  assert.equal(first.totalPages,3);
  const last=f.paginateRows(rows,99,10);
  assert.equal(last.page,3);
  assert.equal(last.items[0].id,21);
  assert.equal(f.pageFromParams(new URLSearchParams('page=2')),2);
  assert.equal(f.pageFromParams(new URLSearchParams('page=0')),1);
  assert.match(f.paginationMarkup(3,5),/aria-current="page">3</);
  assert.equal(f.paginationMarkup(1,1),'');
});
test('note summaries remove markdown noise and stay concise',()=>{
 const f=fixture(); assert.equal(typeof f.noteSummary,'function');
 const summary=f.noteSummary({body:'# 统计与概率\n\n1. 方差公式 $x^2$。\n\n![示意图](image.png)\n\n这是一段适合列表预览的说明文字。'});
 assert.doesNotMatch(summary,/\$|!\[|^1\./);
 assert.ok(Array.from(summary).length<=73);
});
test('query highlighting escapes text and treats query metacharacters literally',()=>{
 const f=fixture();assert.equal(typeof f.highlightText,'function');
 assert.equal(f.highlightText('<img> A&B .*','A&B'),'&lt;img&gt; <mark>A&amp;B</mark> .*');
 assert.equal(f.highlightText('hello .* there','.*'),'hello <mark>.*</mark> there');
});
test('reading from search stays in matching results across content types',()=>{
 const f=fixture();assert.equal(typeof f.readingSequence,'function');
 assert.deepEqual(Array.from(f.readingSequence('notes','search?q=补充'),r=>[r.kind,r.id]),[['notes',3],['posts',1]]);
 assert.deepEqual(Array.from(f.readingSequence('posts','search?q=具体'),r=>r.id),[1]);
 assert.deepEqual(Array.from(f.readingSequence('posts','posts'),r=>r.id),[2,1]);
});
test('search type narrows the same matches and the reading sequence',()=>{
 const f=fixture();
 assert.deepEqual(Array.from(f.searchRecords('补充','posts'),r=>r.id),[1]);
 assert.deepEqual(Array.from(f.searchRecords('补充','notes'),r=>r.id),[3]);
 assert.deepEqual(Array.from(f.searchRecords('补充','works'),r=>r.id),[]);
 assert.deepEqual(Array.from(f.searchRecords('补充','invalid'),r=>r.id),[3,1]);
 assert.deepEqual(Array.from(f.readingSequence('posts','search?q=补充&type=posts'),r=>[r.kind,r.id]),[['posts',1]]);
});
test('explicit work view overrides saved preference and storage failure keeps the page usable',()=>{
 const f=fixture();f.localStorage={getItem:()=> 'list'};
 assert.equal(f.preferredWorkView(new URLSearchParams()),'list');
 assert.equal(f.preferredWorkView(new URLSearchParams('view=grid')),'grid');
 assert.equal(f.preferredWorkView(new URLSearchParams('view=list')),'list');
 assert.equal(f.preferredWorkView(new URLSearchParams('view=invalid')),'list');
 f.localStorage={getItem:()=>{throw new Error('Storage unavailable');}};
 assert.equal(f.preferredWorkView(new URLSearchParams()),'grid');
 assert.equal(f.preferredWorkView(new URLSearchParams('view=list')),'list');
});

test('publication order uses publication dates while search still ranks latest edits',()=>{
 const f=fixture();
 f.site.posts[0].published_at=1;f.site.posts[0].updated=99;
 f.site.posts[1].published_at=3;f.site.notes[0].published_at=2;
 assert.deepEqual(Array.from(f.readingSequence('posts','posts'),r=>r.id),[2,1]);
});

test('topics split comma-separated tags without splitting spaces and use exact matches',()=>{
 const f=fixture();
 f.site.posts=[
  {id:1,title:'A',tags:'生活随笔，游戏, 游戏, Personal Notes',published_at:1},
  {id:2,title:'B',tags:'游戏开发',published_at:2},
  {id:3,title:'C',tags:'游戏',published_at:3},
 ];
 assert.deepEqual(Array.from(f.postTags(f.site.posts[0])),['生活随笔','游戏','Personal Notes']);
 assert.deepEqual(Array.from(f.filteredPosts(new URLSearchParams({tag:'游戏'})),r=>r.id),[3,1]);
 assert.deepEqual(Array.from(f.readingSequence('posts','posts?tag=游戏'),r=>r.id),[3,1]);
 assert.deepEqual(Array.from(f.filteredPosts(new URLSearchParams({tag:'不存在'}))),[]);
 const markup=f.tagLinks({tags:'A&B,<示例>'});
 assert.match(markup,/A&amp;B/); assert.match(markup,/tag=A%26B/); assert.doesNotMatch(markup,/<示例>/);
});

test('visibility filters combine with keyword search and preserve legacy private records',()=>{
 const f=fixture();
 const rows=[{id:1,title:'记录',published:true},{id:2,title:'记录',published:false},{id:3,title:'旧记录'},{id:4,title:'其他',published:false}];
 assert.deepEqual(rows.filter(r=>f.matchesSearch(r,'记录')&&f.matchesVisibility(r,'private')).map(r=>r.id),[2,3]);
 assert.deepEqual(rows.filter(r=>f.matchesVisibility(r,'public')).map(r=>r.id),[1]);
 assert.equal(rows.filter(r=>f.matchesVisibility(r,'')).length,4);
});

test('work progress filtering is exact and combines with category and text',()=>{
 const f=fixture();
 f.site.works=[{id:1,title:'记录一',category:'游戏',progress:'进行中',updated:4},{id:2,title:'记录二',category:'游戏',progress:'',updated:3},{id:3,title:'记录三',category:'游戏',progress:'__empty__',updated:2},{id:4,title:'记录四',category:'动画',progress:'进行中',updated:1}];
 assert.deepEqual(Array.from(f.filteredWorks(new URLSearchParams({category:'游戏',progress:'进行中',q:'记录'})),r=>r.id),[1]);
 assert.deepEqual(Array.from(f.filteredWorks(new URLSearchParams({progressEmpty:'1'})),r=>r.id),[2]);
 assert.deepEqual(Array.from(f.filteredWorks(new URLSearchParams({progress:'__empty__'})),r=>r.id),[3]);
 assert.deepEqual(Array.from(f.readingSequence('works','works?category=游戏&progress=进行中'),r=>r.id),[1]);
});

test('new work defaults inherit the visible work category and start finished',()=>{
 const f=fixture(); f.categories=['动画','游戏','书籍'];
 f.routeFromLocation=()=> 'private/works?category=游戏'; f.routeParams=()=>new URLSearchParams({category:'游戏'});
 assert.equal(f.newRecordDefaults('works').category,'游戏');
 assert.equal(f.newRecordDefaults('works').progress,'玩过');
 assert.equal(f.newRecordDefaults('works').published,undefined);
 assert.deepEqual(Object.keys(f.newRecordDefaults('posts')),[]);
 // A category param on a non-works page must not leak into the work form.
 f.routeFromLocation=()=> 'private/posts?category=游戏';
 assert.equal(f.newRecordDefaults('works').category,'动画');
 assert.equal(f.newRecordDefaults('works').progress,'看过');
 f.routeFromLocation=()=> 'works'; f.routeParams=()=>new URLSearchParams({category:'invalid'});
 assert.equal(f.newRecordDefaults('works').progress,'看过');
 assert.equal(f.newRecordDefaults('works').category,'动画');
 // The completion verb always matches the category it will be saved with.
 for (const category of f.categories) {
   f.routeParams=()=>new URLSearchParams({category});
   assert.equal(f.newRecordDefaults('works').progress, f.statusLabelsFor(category).seen);
 }
 assert.equal(f.statusLabelsFor('书籍').seen, '读过');
});


test('notes overview is capped and follows updates while category navigation follows manual order',()=>{
 const f=fixture();
 f.site.notes=Array.from({length:8},(_,i)=>({id:i+1,title:'Note '+(i+1),body:'BODY MUST NOT APPEAR',category:'物理',updated:i+1,published_at:20-i,order:i===0?1:0}));
 const overview=f.noteCollectionBody(f.site.notes,f.site.notes,'');
 assert.equal((overview.match(/class="note-compact-row"/g)||[]).length,6);
 assert.doesNotMatch(overview,/BODY MUST NOT APPEAR|note-directory-index/);
 assert.ok(overview.indexOf('Note 8')<overview.indexOf('Note 7'));
 assert.equal(f.filteredNotes(new URLSearchParams({category:'物理'}))[0].id,1);
 const directory=f.noteCollectionBody(f.site.notes,f.site.notes,'物理');
 assert.doesNotMatch(directory,/knowledge-category-grid|BODY MUST NOT APPEAR/);
 // A category view shows the directory only: the switcher above already reports the
 // category, so the body must not repeat it with a second navigation row.
 assert.doesNotMatch(directory,/note-kind-pills|note-category-nav|全部分类/);
 assert.match(directory,/分类目录/);
 assert.equal(f.readingSequence('notes','notes?category=物理')[0].id,1);
});

test('chapter titles keep their chapter number without a second list ordinal',()=>{
 const f=fixture();
 const chapter=f.noteCompactRow({id:1,title:'第 9 章 导体与电介质',category:'物理',updated:1},1,false);
 assert.doesNotMatch(chapter,/note-directory-index/);
 assert.match(chapter,/第 9 章 导体与电介质/);
 assert.match(chapter,/aria-hidden="true">→/);
 assert.match(f.noteCompactRow({id:2,title:'导数',updated:2},2,false),/note-directory-index">02/);
});

test('duplicate note text keeps the copy with available images across lists and search without deleting records',()=>{
 const f=fixture();
 const image='1234567890abcdef1234567890abcdef';
 f.site.note_image_sizes={[image]:{width:300,height:200}};
 f.site.notes=[
  {id:1,title:'导数',category:'数学',published_at:2,body:'# 定义\n![局部变化](a.png)'},
  {id:2,title:'导数',category:'数学',published_at:1,body:`# 定义\n![局部变化](/media/${image}.jpg)`},
  {id:3,title:'导数',category:'物理',published_at:3,body:'其他内容'},
 ];
 assert.deepEqual(Array.from(f.publicNotes(),row=>row.id),[2,3]);
 assert.deepEqual(Array.from(f.filteredNotes(new URLSearchParams({category:'数学'})),row=>row.id),[2]);
 assert.deepEqual(Array.from(f.searchRecords('导数','notes'),row=>row.id).sort(),[2,3]);
 assert.equal(f.site.notes.length,3);
 assert.equal(f.noteDuplicateDetail(f.site.notes[1]),null);
 assert.equal(f.noteDuplicateDetail(f.site.notes[2]),null);
 assert.doesNotMatch(f.noteCompactRow(f.site.notes[1],2,false),/正文相同|配图链接/);
 f.site.notes[1].body='不同的正文';
 assert.equal(f.publicNotes().length,3);
 assert.equal(f.noteDuplicateDetail(f.site.notes[0]).label,'2 发布');
 assert.match(f.noteCompactRow(f.site.notes[1],2,false),/1 发布/);
});
