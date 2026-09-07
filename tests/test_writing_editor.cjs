'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

// Exercise the actual editor's load/save sequence without a browser or production data.
function editorFixture(existingDraft = null, record = {id: 7, title: '已发布文章', body: '正文', published: true, updated: 123}) {
  const values = {...record, ...(existingDraft || {})};
  const calls = [], elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: true, value: values.body, textContent: '',
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, setCustomValidity() {},
      classList: {toggle() {}}, elements: {is_private: {checked: false}}
    });
    return elements.get(selector);
  };
  let stored = existingDraft, submit, markup;
  const scope = {
    crypto: {randomUUID: () => 'new-test'}, $: element, window: {innerWidth: 1280}, privateDrafts: [],
    field: () => '', area: () => '', esc: value => String(value || ''),
    kinds: {posts: {name: '博客'}}, clearTimeout, setTimeout,
    FormData: class { [Symbol.iterator]() {
      return Object.entries({title: values.title, body: values.body, summary: '', tags: '', ...(element('#form').elements.is_private.checked ? {is_private: 'on'} : {})})[Symbol.iterator]();
    } },
    dialog: {addEventListener() {}, removeEventListener() {}},
    showForm(title, fields, handler) {
      markup = fields; submit = handler;
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
