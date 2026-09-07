'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

// Exercise the actual editor's load/save sequence without a browser or production data.
function editorFixture(existingDraft = null) {
  const record = {id: 7, title: '已发布文章', body: '正文', published: true, updated: 123};
  const values = {...record, ...(existingDraft || {})};
  const calls = [], elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: true, value: values.body, textContent: '',
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, setCustomValidity() {},
      classList: {toggle() {}}, elements: {published: {checked: values.published}}
    });
    return elements.get(selector);
  };
  let stored = existingDraft, submit, markup;
  const scope = {
    $: element, window: {innerWidth: 1280}, privateDrafts: [],
    field: () => '', area: () => '', esc: value => String(value || ''),
    kinds: {posts: {name: '博客'}}, clearTimeout, setTimeout,
    FormData: class { [Symbol.iterator]() {
      return Object.entries({title: values.title, body: values.body, summary: '', tags: '', ...(values.published ? {published: 'on'} : {})})[Symbol.iterator]();
    } },
    dialog: {addEventListener() {}, removeEventListener() {}},
    showForm(title, fields, handler) { markup = fields; submit = handler; },
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
  return {calls, record, scope, get markup() {return markup;}, submit: () => submit()};
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
