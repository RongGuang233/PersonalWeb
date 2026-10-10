'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

// Exercise the actual editor's load/save sequence without a browser or production data.
function editorFixture(existingDraft = null, record = {id: 7, title: '已发布文章', body: '正文', published: true, updated: 123}) {
  const values = {...record, ...(existingDraft || {})};
  const calls = [], elements = new Map(), closeHandlers = new Set();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: true, value: values.body, textContent: '', removed: false,
      remove() {this.removed = true;},
      parentElement: {insertBefore(node) {node.inHeader = true;}},
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, setCustomValidity() {},
      classList: {toggle() {}}, elements: {is_private: {checked: false}}
    });
    return elements.get(selector);
  };
  let stored = existingDraft, submit, markup;
  const scope = {
    crypto: {randomUUID: () => 'new-test'}, $: element, window: {innerWidth: 1280}, privateDrafts: [],
    field: (name, label, value = '', type = 'text') => `<label>${label}<input name="${name}" type="${type}" value="${value}"></label>`, area: () => '', esc: value => String(value || ''),
    kinds: {posts: {name: '博客'}, notes: {name: '笔记'}}, clearTimeout, setTimeout,
    FormData: class { [Symbol.iterator]() {
      return Object.entries({title: values.title, body: values.body, summary: '', tags: '', publication_date: element('[name=publication_date]').value, ...(element('#form').elements.is_private.checked ? {is_private: 'on'} : {})})[Symbol.iterator]();
    } },
    dialog: {
      addEventListener(type, handler) {if(type === 'close') closeHandlers.add(handler);},
      removeEventListener(type, handler) {closeHandlers.delete(handler);},
      close() {for(const handler of [...closeHandlers]) handler();}
    },
    showForm(title, fields, handler) {
      markup = fields; submit = handler;
      element('[name=publication_date]').value = fields.match(/name="publication_date"[^>]*value="([^"]*)"/)?.[1] || '';
      element('#form').elements.is_private.checked = /name="is_private"[^>]*checked/.test(fields);
    },
    refreshContent: async () => {}, toast() {},
    api: async (path, method = 'GET', body) => {
      calls.push([method, path]);
      if (method === 'GET') {
        if (!stored) throw Object.assign(new Error('草稿不存在'), {status: 404});
        return stored;
      }
      if (method === 'PUT') return stored = {...body, updated: 456};
      if (!stored) throw Object.assign(new Error('没有可提交的草稿'), {status: 404});
      return {id: 7};
    }
  };
  vm.createContext(scope);
  vm.runInContext(readFileSync(require.resolve('../public/writing-editor.js'), 'utf8'), scope);
  return {calls, record, scope, get markup() {return markup;}, get stored() {return stored;}, element, submit: () => submit()};
}

test('opening a published record without a draft does not claim to restore one', async () => {
  const fixture = editorFixture();
  await fixture.scope.openWritingEditor('posts', fixture.record);
  assert.doesNotMatch(fixture.markup, /已恢复服务器草稿/);
  assert.match(fixture.markup, /已载入当前内容/);
  assert.deepEqual(fixture.calls, [['GET', 'drafts/record-posts-7']]);
});

test('submitting an unchanged published record creates a draft before committing', async () => {
  const fixture = editorFixture();
  await fixture.scope.openWritingEditor('posts', fixture.record);
  await fixture.submit();
  assert.deepEqual(fixture.calls, [
    ['GET', 'drafts/record-posts-7'], ['PUT', 'drafts/record-posts-7'], ['POST', 'drafts/record-posts-7/commit']
  ]);
});

test('an actual restored draft can commit without a redundant save', async () => {
  const fixture = editorFixture({record_id: 7, title: '已发布文章', body: '正文', published: true, updated: 456});
  await fixture.scope.openWritingEditor('posts', fixture.record);
  assert.match(fixture.markup, /已恢复服务器草稿/);
  await fixture.submit();
  assert.deepEqual(fixture.calls, [['GET', 'drafts/record-posts-7'], ['POST', 'drafts/record-posts-7/commit']]);
});


test('new writing defaults public and selecting private reverses the submitted flag', async () => {
  for (const privateChoice of [false, true]) {
    const fixture = editorFixture(null, {title:'新文章',body:'正文'});
    await fixture.scope.openWritingEditor('posts', fixture.record);
    assert.equal(fixture.element('#form').elements.is_private.checked, false);
    assert.equal(fixture.element('#save').textContent, '发布内容');
    fixture.element('#form').elements.is_private.checked = privateChoice;
    await fixture.submit();
    assert.equal(fixture.stored.published, !privateChoice);
  }
});

test('existing private content and restored private drafts retain their setting', async () => {
  for (const existingDraft of [null, {record_id:7,title:'草稿',body:'正文',published:false}]) {
    const fixture = editorFixture(existingDraft, {id:7,title:'私密文章',body:'正文',published:false});
    await fixture.scope.openWritingEditor('posts', fixture.record);
    assert.equal(fixture.element('#form').elements.is_private.checked, true);
    assert.equal(fixture.element('#save').textContent, '保存为私密内容');
    await fixture.submit();
    assert.equal(fixture.stored.published, false);
  }
});


test('writing settings open before the body and draft controls move to the header until close', async () => {
  const fixture = editorFixture();
  await fixture.scope.openWritingEditor('posts', fixture.record);
  assert.match(fixture.markup, /<details class="writing-settings" open>/);
  const settingsAt = fixture.markup.indexOf('class="writing-settings"');
  const bodyAt = fixture.markup.indexOf('id="record-body"');
  assert.ok(settingsAt >= 0 && bodyAt > settingsAt);
  assert.equal(fixture.element('#draft-header-status').inHeader, true);
  fixture.scope.dialog.close();
  assert.equal(fixture.element('#draft-header-status').removed, true);
});

test('markdown import extracts front matter tags and uses the first heading as the note title', () => {
  const fixture = editorFixture(null, {title:'旧内容', body:'旧正文'});
  const parsed = fixture.scope.parseMarkdownImport('---\ntags: [数学, 阅读]\n---\n# 新的笔记\n\n正文内容\n', 'fallback.md');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {title:'新的笔记', body:'正文内容\n', tags:'数学, 阅读', category:''});
});

test('markdown import falls back to the filename when no heading exists', () => {
  const fixture = editorFixture(null, {title:'旧内容', body:'旧正文'});
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.scope.parseMarkdownImport('没有标题的正文', '我的笔记.md'))), {title:'我的笔记', body:'没有标题的正文', tags:'', category:''});
});

test('markdown import reads category front matter and relative folder category', () => {
  const fixture = editorFixture(null, {title:'旧内容', body:'旧正文'});
  assert.equal(fixture.scope.parseMarkdownImport('---\n分类: 高中数学\n---\n# 函数\n正文', '函数.md').category, '高中数学');
  assert.equal(fixture.scope.parseMarkdownImport('# 函数\n正文', '高中数学笔记/函数.md').category, '高中数学');
});

test('markdown import rewrites Obsidian and standard local image references', () => {
  const fixture = editorFixture(null, {title:'旧内容', body:'旧正文'});
  const source = '![图一](高中数学-page002-hyperbolic.png)\n\n![[高中数学-page005-powers.png|幂函数]]';
  assert.equal(JSON.stringify(fixture.scope.markdownImageRefs(source).map(ref => ref.href)), JSON.stringify(['高中数学-page002-hyperbolic.png', '高中数学-page005-powers.png']));
  const replacements = new Map([
    ['高中数学-page002-hyperbolic.png', '/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'],
    ['高中数学-page005-powers.png', '/media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg']
  ]);
  assert.equal(fixture.scope.rewriteMarkdownImages(source, replacements), '![图一](/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg)\n\n![幂函数](/media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg)');
});

test('markdown image import resolves a relative path before falling back to a unique filename', () => {
  const fixture = editorFixture(null, {title:'旧内容', body:'旧正文'});
  const image = name => ({name, type:'image/png', webkitRelativePath:name});
  const files = [image('笔记/附件/图.png'), image('其他/图.png'), image('笔记/封面.png')];
  assert.equal(fixture.scope.markdownImageFile({href:'附件/图.png'}, '笔记/正文.md', files), files[0]);
  assert.equal(fixture.scope.markdownImageFile({href:'封面.png'}, '笔记/正文.md', files), files[2]);
  assert.equal(fixture.scope.markdownImageFile({href:'图.png'}, '笔记/正文.md', files), null);
  assert.equal(fixture.scope.markdownImageFile({href:'../其他/图.png'}, '笔记/子目录/正文.md', [files[1]]), files[1]);
});

test('markdown import does not treat absolute or remote image URLs as local files', () => {
  const fixture = editorFixture(null, {title:'旧内容', body:'旧正文'});
  const refs = fixture.scope.markdownImageRefs('![a](https://example.com/a.png) ![b](/media/0123456789abcdef0123456789abcdef.jpg) ![c](//cdn.example/c.png) ![d](附件/d.png)');
  assert.equal(JSON.stringify(refs.map(ref => ref.href)), JSON.stringify(['附件/d.png']));
});

test('unchanged publication date retains its original seconds when other fields save', async () => {
  const publishedAt = 1704208023;
  for (const kind of ['posts', 'notes']) {
    const fixture = editorFixture(null, {id:7,title:'旧内容',body:'正文',published:true,published_at:publishedAt});
    await fixture.scope.openWritingEditor(kind, fixture.record);
    const date = new Date(publishedAt * 1000);
    const displayed = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    assert.equal(fixture.element('[name=publication_date]').value, displayed);
    await fixture.submit();
    assert.equal(fixture.stored.published_at, publishedAt);
  }
});

test('an intentional date correction saves local midnight in Unix seconds', async () => {
  const fixture = editorFixture();
  await fixture.scope.openWritingEditor('posts', fixture.record);
  fixture.element('[name=publication_date]').value = '2020-03-04';
  await fixture.submit();
  assert.equal(fixture.stored.published_at, new Date(2020, 2, 4).getTime()/1000);
});

test('empty dates preserve existing timestamps and leave new timestamps to the server', async () => {
  for (const publishedAt of [null, 1704208023]) {
    const fixture = editorFixture(null, {id:7,title:'内容',body:'正文',published:true,published_at:publishedAt});
    await fixture.scope.openWritingEditor('notes', fixture.record);
    fixture.element('[name=publication_date]').value = '';
    await fixture.submit();
    if (publishedAt === null) assert.equal(Object.hasOwn(fixture.stored, 'published_at'), false);
    else assert.equal(fixture.stored.published_at, publishedAt);
  }
});

test('restored drafts retain their deliberate publication date instead of the record date', async () => {
  const fixture = editorFixture({record_id:7,title:'草稿',body:'正文',published:true,published_at:1583251200}, {id:7,title:'已发布',body:'正文',published:true,published_at:1704208023});
  await fixture.scope.openWritingEditor('posts', fixture.record);
  fixture.element('#form').elements.is_private.checked = true;
  await fixture.submit();
  assert.equal(fixture.stored.published_at, 1583251200);
});


test('legacy drafts missing the date inherit a supplied record date, while explicit null stays blank', async () => {
  for (const dateFields of [{}, {published_at:null}]) {
    const fixture = editorFixture({record_id:7,title:'草稿',body:'正文',published:true,...dateFields}, {id:7,title:'已发布',body:'正文',published:true,published_at:1704208023});
    await fixture.scope.openWritingEditor('posts', fixture.record);
    assert.equal(fixture.element('[name=publication_date]').value === '', Object.hasOwn(dateFields, 'published_at'));
    fixture.element('#form').elements.is_private.checked = true;
    await fixture.submit();
    if (Object.hasOwn(dateFields, 'published_at')) assert.equal(Object.hasOwn(fixture.stored, 'published_at'), false);
    else assert.equal(fixture.stored.published_at, 1704208023);
  }
});
