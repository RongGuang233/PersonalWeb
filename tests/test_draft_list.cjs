'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

function fixture(drafts, onChanged = async () => {}) {
  const calls = [], notices = [], opened = [];
  let confirmation;
  const scope = {
    esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    kinds: {posts:{name:'博客'},notes:{name:'笔记'}},
    showForm(title, markup, submit, label) { confirmation = {title, markup, submit, label}; },
    api: async (path, method) => { calls.push([path, method]); },
    toast: message => notices.push(message)
  };
  vm.createContext(scope);
  vm.runInContext(readFileSync(require.resolve('../public/writing-editor.js'), 'utf8'), scope);
  scope.openWritingEditor = async (kind, record, key) => { opened.push([kind, key]); };
  const open = drafts.map(row => ({dataset:{draft:row.key}}));
  const discard = drafts.map(row => ({dataset:{discardDraft:row.key}}));
  const container = {querySelectorAll: selector => selector === '[data-draft]' ? open : discard};
  scope.bindDraftRows(container, drafts, onChanged);
  return {scope, calls, notices, opened, open, discard, get confirmation() {return confirmation;}, cancel() {confirmation = undefined;}};
}

const drafts = [
  {key:'new-"<&',kind:'notes',title:'<未发布 & "草稿">',updated:123},
  {key:'existing',kind:'posts',title:'',record_id:7,updated:456}
];

test('draft rows preserve state labels, optional kind labels and escaped content', () => {
  const {scope} = fixture(drafts);
  const markup = scope.draftRowsMarkup(drafts, true);
  assert.match(markup, /笔记 · 尚未发布/);
  assert.match(markup, /博客 · 已有内容的修改/);
  assert.match(markup, /未命名草稿/);
  assert.match(markup, /data-draft="new-&quot;&lt;&amp;"/);
  assert.match(markup, /&lt;未发布 &amp; &quot;草稿&quot;&gt;/);
  assert.equal((markup.match(/class="draft-row"/g) || []).length, 2);
  assert.equal((markup.match(/data-discard-draft=/g) || []).length, 2);
  assert.doesNotMatch(scope.draftRowsMarkup(drafts), /笔记 ·|博客 ·/);
  assert.equal(scope.draftRowsMarkup([]), '');
});

test('opening a mixed draft list uses each draft kind and key', async () => {
  const f = fixture(drafts);
  await f.open[0].onclick();
  await f.open[1].onclick();
  assert.deepEqual(f.opened, [['notes',drafts[0].key],['posts','existing']]);
});

test('discard cancellation never deletes or refreshes, and explains published content preservation', () => {
  let changes = 0;
  const f = fixture(drafts, async () => { changes++; });
  f.discard[1].onclick();
  assert.match(f.confirmation.markup, /已保存的正式内容不受影响/);
  assert.deepEqual(f.calls, []);
  assert.equal(changes, 0);
  f.cancel();
  assert.deepEqual(f.calls, []);
  assert.equal(changes, 0);
  assert.deepEqual(f.notices, []);
});

test('confirmed discard deletes the selected draft and awaits list refresh', async () => {
  let finishRefresh;
  const refresh = new Promise(resolve => { finishRefresh = resolve; });
  const f = fixture(drafts, () => refresh);
  f.discard[0].onclick();
  assert.match(f.confirmation.markup, /草稿中的文字和图片将被移除/);
  assert.match(f.confirmation.markup, /&lt;未发布 &amp; &quot;草稿&quot;&gt;/);
  assert.deepEqual(f.calls, []);
  const completion = f.confirmation.submit();
  await Promise.resolve();
  assert.deepEqual(f.calls, [['drafts/'+drafts[0].key,'DELETE']]);
  assert.deepEqual(f.notices, []);
  finishRefresh();
  await completion;
  assert.deepEqual(f.notices, ['草稿已丢弃']);
});
