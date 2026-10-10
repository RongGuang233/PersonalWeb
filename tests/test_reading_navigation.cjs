'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../public/reading-navigation.js'), 'utf8');
const grouping = source.slice(source.indexOf('  function groupHeadings('), source.indexOf('  window.mountReadingNavigation'));
const groupHeadings = vm.runInNewContext(`${grouping}\ngroupHeadings`);
const headings = levels => levels.map((level, index) => ({tagName: `H${level}`, id: `heading-${index + 1}`}));
const shape = result => Array.from(result.groups, group => ({
  heading: group.heading.id,
  children: Array.from(group.children, heading => heading.id),
}));

test('main chapters retain ordered h3 and h4 descendants until the next chapter', () => {
  const result = groupHeadings(headings([2, 3, 4, 3, 2, 4, 2]));
  assert.equal(result.topLevel, 2);
  assert.deepEqual(shape(result), [
    {heading: 'heading-1', children: ['heading-2', 'heading-3', 'heading-4']},
    {heading: 'heading-5', children: ['heading-6']},
    {heading: 'heading-7', children: []},
  ]);
});

test('documents starting at h3 use h3 as their chapter level', () => {
  const result = groupHeadings(headings([3, 4, 3, 4, 4]));
  assert.equal(result.topLevel, 3);
  assert.deepEqual(shape(result), [
    {heading: 'heading-1', children: ['heading-2']},
    {heading: 'heading-3', children: ['heading-4', 'heading-5']},
  ]);
});

test('a leading deeper heading is retained instead of dropped', () => {
  assert.deepEqual(shape(groupHeadings(headings([3, 4, 2, 3]))), [
    {heading: 'heading-1', children: ['heading-2']},
    {heading: 'heading-3', children: ['heading-4']},
  ]);
});

test('compact mode starts at fifteen entries and retains every chapter and child', () => {
  for (const [count, compact] of [[14, false], [15, true]]) {
    const input = headings(Array.from({length: count}, (_, index) => index % 5 === 0 ? 2 : 3));
    const result = groupHeadings(input);
    assert.equal(result.compact, compact);
    assert.deepEqual(Array.from(result.groups).flatMap(group => [group.heading, ...group.children]), input);
    assert.equal(result.groups.length, 3);
  }
});

function resizeFocusFixture({desktop, inlineBottom}) {
  const context = {disposed: false, readingPoint: null, resizeFocus: null, desktop: {matches: desktop}, groupViews: [], setActiveHeading() {}, revealActiveItem() {}};
  context.document = {activeElement: null};
  const entry = id => ({dataset: {tocFor: id}, focus() {context.document.activeElement = this;}});
  const surface = () => {
    const buttons = ['first', 'current'].map(entry);
    return {buttons, hidden: false, open: false,
      contains: node => buttons.includes(node),
      querySelector: () => buttons[0], querySelectorAll: () => buttons.filter(button => button.dataset?.tocFor),
      getBoundingClientRect: () => ({bottom: inlineBottom})};
  };
  context.inline = surface();
  context.side = surface();
  context.floating = surface();
  context.inlineSummary = entry('inline-summary');
  context.floatingSummary = entry('floating-summary');
  context.tocButtons = [...context.inline.buttons, ...context.side.buttons, ...context.floating.buttons];
  context.closeFloating = () => {context.floating.open = false;};
  const update = source.slice(source.indexOf('    function updateFloating('), source.indexOf('    const observer ='));
  vm.runInNewContext(update, context);
  return context;
}

test('switching to desktop moves focus from the inline directory to the same visible section', () => {
  const f = resizeFocusFixture({desktop: true, inlineBottom: 200});
  f.document.activeElement = f.inline.buttons[1];
  f.updateFloating();
  assert.equal(f.document.activeElement, f.side.buttons[1]);
});

test('a mobile directory opener moves focus to the current chapter when desktop has no opener', () => {
  for (const source of ['inline', 'floating']) {
    const f = resizeFocusFixture({desktop: true, inlineBottom: -100});
    f.activeId = 'current';
    const summary = f[`${source}Summary`];
    f[source].buttons.push(summary);
    f.document.activeElement = summary;
    f.updateFloating();
    assert.equal(f.document.activeElement, f.side.buttons[1]);
  }
});

test('summary focus migration waits for reading-point restoration and then uses the restored chapter', () => {
  const f = resizeFocusFixture({desktop: true, inlineBottom: -100});
  let changing = true, scheduled = 0, chapterUpdates = 0;
  f.readingPoint = {changing: () => changing, resize() {scheduled++;return true;}};
  f.setActiveHeading = () => {chapterUpdates++;f.activeId = changing ? 'first' : 'current';};
  f.floating.buttons.push(f.floatingSummary);
  f.document.activeElement = f.floatingSummary;
  f.updateFloating();
  assert.equal(scheduled, 1);
  assert.equal(chapterUpdates, 0);
  assert.equal(f.document.activeElement, f.floatingSummary);
  changing = false;
  f.document.activeElement = null; // CSS may blur the opener while the resize frame is pending.
  f.updateFloating();
  assert.equal(f.document.activeElement, f.side.buttons[1]);
  assert.equal(f.resizeFocus, null);
});

test('switching to mobile opens the visible directory and keeps focus on the same section', () => {
  for (const inlineBottom of [200, -100]) {
    const f = resizeFocusFixture({desktop: false, inlineBottom});
    f.document.activeElement = f.side.buttons[1];
    f.updateFloating();
    const destination = inlineBottom < 0 ? f.floating : f.inline;
    assert.equal(f.document.activeElement, destination.buttons[1]);
    assert.equal(destination.open, true);
    assert.equal(f.floating.hidden, inlineBottom >= 0);
  }
});

test('a floating directory that becomes hidden returns focus to the matching visible section', () => {
  for (const desktop of [true, false]) {
    const f = resizeFocusFixture({desktop, inlineBottom: 200});
    f.floating.open = true;
    f.document.activeElement = f.floating.buttons[1];
    f.updateFloating();
    assert.equal(f.document.activeElement, desktop ? f.side.buttons[1] : f.inline.buttons[1]);
    assert.equal(f.floating.open, false);
  }
});

test('a chapter expansion control keeps its keyboard action when the directory surface changes', () => {
  const f = resizeFocusFixture({desktop: true, inlineBottom: 200});
  const toggle = () => ({disabled: false, focus() {f.document.activeElement = this;}});
  const original = toggle(), replacement = toggle();
  f.inline.buttons.push(original);
  f.side.buttons.push(replacement);
  f.groupViews = [{toggle: original, entry: f.inline.buttons[1]}, {toggle: replacement, entry: f.side.buttons[1]}];
  f.document.activeElement = original;
  f.updateFloating();
  assert.equal(f.document.activeElement, replacement);
});

test('an open floating directory reveals its active row by scrolling only its own menu', () => {
  let item = {top: 390, bottom: 440};
  const menu = {scrollTop: 25, querySelector: () => ({getBoundingClientRect: () => item}),
    getBoundingClientRect: () => ({top: 100, bottom: 400})};
  const context = {desktop: {matches: false}, floating: {open: true, hidden: false, querySelector: () => menu},
    window: {scrollTo() {assert.fail('directory positioning must not scroll the article');}}};
  const positioning = source.slice(source.indexOf('    function revealActiveItem('), source.indexOf('    function setActiveHeading('));
  vm.runInNewContext(positioning, context);
  context.revealFloatingActive();
  assert.equal(menu.scrollTop, 73);
  item = {top: 160, bottom: 210};
  context.revealFloatingActive();
  assert.equal(menu.scrollTop, 73, 'a visible item must keep the menu position stable');
  item = {top: 80, bottom: 120};
  context.revealFloatingActive();
  assert.equal(menu.scrollTop, 45);
  context.floating.open = false;
  context.revealFloatingActive();
  assert.equal(menu.scrollTop, 45, 'a closed menu must not move');
});

function activeHeadingFixture({scrollY, viewportHeight, documentHeight, lastTop}) {
  const items = [
    {id: 'section-36', getBoundingClientRect: () => ({top: 50, bottom: 80})},
    {id: 'section-37', getBoundingClientRect: () => ({top: lastTop, bottom: lastTop + 30})},
  ];
  const context = {disposed: false, readingPoint: null, activeId: '', activeGroup: 0, headings: items,
    headingGroups: new Map(items.map((heading, index) => [heading, index])),
    window: {scrollY, innerHeight: viewportHeight}, document: {documentElement: {scrollHeight: documentHeight}},
    updateGroups() {}, revealSideActive() {}, revealFloatingActive() {},
    tocButtons: items.map(heading => ({dataset: {tocFor: heading.id}, classList: {toggle() {}},
      attributes: {}, setAttribute(name, value) {this.attributes[name] = value;}, removeAttribute(name) {delete this.attributes[name];}}))};
  const update = source.slice(source.indexOf('    function setActiveHeading('), source.indexOf('    function updateFloating('));
  vm.runInNewContext(update, context);
  context.setActiveHeading();
  return context;
}

test('the final visible chapter becomes active at the document bottom despite the normal 96px threshold', () => {
  for (const scrollY of [25423.5, 25422.25]) {
    const f = activeHeadingFixture({scrollY, viewportHeight: 900, documentHeight: 26323, lastTop: 155.34});
    assert.equal(f.activeId, 'section-37');
    assert.equal(f.activeGroup, 1);
    assert.equal(f.tocButtons[1].attributes['aria-current'], 'location');
    assert.equal(f.tocButtons[0].attributes['aria-current'], undefined);
  }
});

test('bottom detection does not select the final chapter before scrolling or before it enters the viewport', () => {
  for (const geometry of [
    {scrollY: 0, viewportHeight: 900, documentHeight: 600, lastTop: 155},
    {scrollY: 25423, viewportHeight: 900, documentHeight: 26323, lastTop: 950},
    {scrollY: 25423, viewportHeight: 900, documentHeight: 26323, lastTop: 900},
    {scrollY: 25400, viewportHeight: 900, documentHeight: 26323, lastTop: 155},
  ]) {
    assert.equal(activeHeadingFixture(geometry).activeId, 'section-36');
  }
});

function readingPointFixture(notes = true) {
  const controller = new AbortController(), frames = new Map(), moves = [], refreshes = [];
  let nextFrame = 1;
  const image = {isConnected: true, bounds: {top: 80, height: 200}, closest() {return this;}, getBoundingClientRect() {return this.bounds;}};
  const paragraph = {isConnected: true, bounds: {top: 60, height: 120}, closest() {return this;}, getBoundingClientRect() {return this.bounds;}};
  let hit = image;
  const markdown = {contains: element => element === image || element === paragraph,
    getBoundingClientRect: () => ({left: 20, width: 350, top: -1000, bottom: 30000})};
  const context = {
    window: {innerWidth: 390, innerHeight: 844, scrollY: 1000,
      scrollBy({top}) {moves.push(top);this.scrollY += top;image.bounds.top -= top;paragraph.bounds.top -= top;}},
    document: {elementsFromPoint: () => [hit]},
    requestAnimationFrame(callback) {const id = nextFrame++;frames.set(id, callback);return id;},
    cancelAnimationFrame(id) {frames.delete(id);},
  };
  const implementation = source.slice(source.indexOf('  function createReadingPoint('), source.indexOf('  window.mountReadingNavigation'));
  vm.runInNewContext(implementation, context);
  const reader = {classList: {contains: () => notes}};
  const point = context.createReadingPoint(reader, markdown, controller.signal, () => refreshes.push(image.bounds.top));
  return {point, controller, context, image, paragraph, moves, refreshes,
    hit: element => {hit = element;}, flush() {const callbacks = [...frames.values()];frames.clear();callbacks.forEach(callback => callback());},
    pending: () => frames.size};
}

test('note resize retains the same visible point inside a scaled image before refreshing navigation', () => {
  const f = readingPointFixture();
  assert.deepEqual(f.moves, [], 'mount must never scroll');
  f.context.window.innerWidth = 1366; f.context.window.innerHeight = 900;
  f.image.bounds = {top: 1000, height: 400};
  f.point.remember(); // Native reflow scroll events must not replace the old reading point.
  f.point.resize();
  f.point.resize(); // media-query and resize callbacks share one pending restore.
  assert.equal(f.pending(), 1);
  f.flush();
  assert.equal(f.moves[0], 936);
  assert.equal(f.image.bounds.top + 0.08 * f.image.bounds.height, 96);
  assert.deepEqual(f.refreshes, [64], 'directory refresh must run after the reading point is restored');
  f.context.window.innerWidth = 390; f.context.window.innerHeight = 844;
  f.image.bounds = {top: -300, height: 200};
  f.point.resize(); f.flush();
  assert.equal(f.image.bounds.top + 0.08 * f.image.bounds.height, 96, 'resizing back must retain the same image fraction');
});

test('ordinary scrolling only updates the anchor and height-only resize uses the newest paragraph', () => {
  const f = readingPointFixture();
  f.context.window.scrollY += 500;
  f.hit(f.paragraph);
  f.point.remember();
  assert.equal(f.point.resize(), false);
  assert.equal(f.pending(), 0);
  assert.deepEqual(f.moves, []);
  f.context.window.innerHeight = 600;
  f.paragraph.bounds = {top: 500, height: 240};
  f.point.resize(); f.flush();
  assert.equal(f.moves[0], 476);
  assert.equal(f.paragraph.bounds.top + 0.3 * f.paragraph.bounds.height, 96);
});

test('aborting note navigation cancels a pending resize and ordinary articles do not gain anchoring', () => {
  const f = readingPointFixture();
  f.context.window.innerWidth = 1366;
  f.image.bounds.top = 1000;
  f.point.resize();
  f.controller.abort();
  assert.equal(f.pending(), 0);
  f.flush();
  assert.deepEqual(f.moves, []);
  assert.deepEqual(f.refreshes, []);
  assert.equal(f.point.resize(), false);
  const article = readingPointFixture(false);
  assert.equal(article.point, null);
  assert.deepEqual(article.moves, []);
});
