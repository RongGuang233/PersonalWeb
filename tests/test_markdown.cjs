'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');
const marked = require('../public/marked.umd.js');
const scope = {window: {marked, markedKatex: require('../public/marked-katex.umd.js')}, URL};
vm.runInNewContext(readFileSync(resolve(__dirname, '../public/markdown.js'), 'utf8'), scope);
const render = scope.window.renderMarkdown;

test('math is parsed before Markdown so subscripts and Chinese labels remain formulas', () => {
  const html = render('$$\n\\underbrace{\\frac{2}{\\frac{1}{a}+\\frac{1}{b}}}_{\\text{调和平均数}} \\le \\sqrt{ab}\n$$\n\n其中$a_1+b^2$是行内公式。');
  assert.match(html, /class="katex-display"/);
  assert.match(html, /<math[\s\S]*调和平均数/);
  assert.match(html, /<msub>/);
  assert.doesNotMatch(html, /<em>/);
});

test('formula examples inside code and escaped dollars remain literal', () => {
  const html = render('`$x_1$`\n\n```tex\n$$x^2$$\n```\n\n价格 \\$20，另一件 \\$30。');
  assert.match(html, /<code>\$x_1\$<\/code>/);
  assert.match(html, /<code class="language-tex">\$\$x\^2\$\$/);
  assert.doesNotMatch(html, /class="katex/);
});

test('summaries omit formula source without losing ordinary prose or code', () => {
  const excerpt = scope.window.markdownExcerpt;
  assert.equal(excerpt('$$\n\\frac{a+b}{2}\n$$'), '数学公式笔记');
  assert.equal(excerpt('先比较 $a_1$ 与 $b^2$，再讨论结论。'), '先比较 与 ，再讨论结论。');
  assert.equal(excerpt('**结论**：[查看解释](https://example.com)\n\n$$a<b$$\n\n后续讨论'), '结论：查看解释 后续讨论');
  assert.equal(excerpt('`$PATH` 与代码'), '$PATH 与代码');
});

test('GFM tables, nested lists, tasks, blockquotes and strikethrough render as elements', () => {
  const html = render('# 阅读清单\n\n| 作品 | 评分 |\n| :--- | ---: |\n| **作品甲** | 8.5 |\n\n3. 第一项\n   - 子项\n4. 第二项\n\n- [x] 已读\n- [ ] 待读\n\n> 引用 ~~旧内容~~');
  assert.match(html, /<h2>阅读清单<\/h2>/);
  assert.doesNotMatch(html, /<h1>/);
  assert.match(html, /<table>[\s\S]*<th align="left">作品<\/th>[\s\S]*<td align="right">8.5<\/td>/);
  assert.match(html, /<div class="table-wrap"><table>[\s\S]*<\/table>\n<\/div>/);
  assert.match(html, /<ol start="3">[\s\S]*<ul>[\s\S]*子项/);
  assert.match(html, /<input checked="" disabled="" type="checkbox"> 已读/);
  assert.match(html, /<input disabled="" type="checkbox"> 待读/);
  assert.match(html, /<blockquote>[\s\S]*<del>旧内容<\/del>/);
});

test('fenced and inline code preserve literal markup, ampersands and quotes', () => {
  const html = render('```javascript\nconst value = "<img src=x>";\nif (a & b) {}\n```\n\n`<script> & "code"`');
  assert.match(html, /<pre><code class="language-javascript">const value = &quot;&lt;img src=x&gt;&quot;;/);
  assert.match(html, /if \(a &amp; b\) \{\}/);
  assert.match(html, /<code>&lt;script&gt; &amp; &quot;code&quot;<\/code>/);
  assert.doesNotMatch(html, /<img|<script/);
});

test('raw block and inline HTML remain visible source, including raw-block text', () => {
  const html = render('<div onclick="run()"><img src=x onerror=run()></div>\n\n文字 <script>"<svg/onload=run()>"</script> 结束\n\n<iframe src="https://example.com"></iframe>');
  assert.match(html, /&lt;div onclick=&quot;run\(\)&quot;&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;svg\/onload=run\(\)&gt;/);
  assert.match(html, /&lt;iframe/);
  assert.doesNotMatch(html, /<(?:div|img|script|svg|iframe)\b/i);
});

test('HTTP links, references, bare URLs and site hashes retain text and escaped attributes', () => {
  const html = render('[**示例**](https://example.com/path?a=1&b=2 \'标题 "引号"\')\n\n[站内](#read/posts/42)\n\n[引用][site]\n\n[site]: http://example.org/read\n\nhttps://example.net/');
  assert.match(html, /href="https:\/\/example.com\/path\?a=1&amp;b=2" title="标题 &quot;引号&quot;" target="_blank" rel="noopener noreferrer"><strong>示例<\/strong>/);
  assert.match(html, /href="#read\/posts\/42"/);
  assert.match(html, /href="http:\/\/example.org\/read"/);
  assert.match(html, /href="https:\/\/example.net\/"/);
});

test('unsupported link schemes and disguised schemes retain labels without links', () => {
  const addresses = ['javascript:alert(1)', 'data:text/html,hello', 'vbscript:msgbox(1)', 'mailto:user@example.com', 'ftp://example.com/file', '//example.com/path', '/private', 'jav&#x61;script:alert(1)', 'javascript&colon;alert(1)', 'java&#10;script:alert(1)'];
  for (const address of addresses) {
    const html = render(`[**保留文字**](${address})`);
    assert.match(html, /<strong>保留文字<\/strong>/, address);
    assert.doesNotMatch(html, /<a\b/, address);
  }
});

test('local uploaded images render, while alt and title cannot become attributes', () => {
  const html = render('![**头像** " onerror="run() <tag>](/media/0123456789abcdef0123456789abcdef.jpg \'标题 "引号"\')');
  assert.match(html, /<img src="\/media\/0123456789abcdef0123456789abcdef.jpg" alt="头像 &quot; onerror=&quot;run\(\) &lt;tag&gt;" title="标题 &quot;引号&quot;" loading="lazy" decoding="async">/);
  assert.doesNotMatch(html, /<tag>|<strong>|" onerror="/);
});

test('images outside exact local media paths are shown as descriptions', () => {
  const addresses = ['https://example.com/image.jpg', 'http://example.com/image.jpg', '//example.com/image.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', '/media/../avatar.jpg', '/media/0123456789abcdef0123456789abcdef.jpg?x=1', '/media/0123456789abcdef0123456789abcdef.svg', '/media/42.jpg', '/media/0123456789abcdef0123456789abcdeg.jpg', '/covers/42.jpg'];
  for (const address of addresses) {
    const html = render(`![图像说明](${address})`);
    assert.match(html, /图像说明/, address);
    assert.doesNotMatch(html, /<img\b/, address);
  }
});

test('unimported relative images remain visible as filename placeholders', () => {
  const html = render('![示意图](assets/函数图.png)\n\n![[附件/表格.webp|表格]]');
  assert.match(html, /图片未导入：函数图\.png/);
  assert.match(html, /图片未导入：表格\.webp（表格）/);
  assert.doesNotMatch(html, /<img\b/);
});

test('unsafe reference links and code info strings do not add active attributes', () => {
  const html = render('[引用][bad]\n\n[bad]: javascript:alert(1)\n\n```a"onmouseover="run\n<svg>\n```');
  assert.doesNotMatch(html, /<a\b|<svg>|"onmouseover="/);
  assert.match(html, /class="language-a&quot;onmouseover=&quot;run"/);
});

test('renderer is synchronous, keeps ordinary entities, and does not mutate marked defaults', () => {
  assert.equal(render(null), '');
  assert.equal(typeof render('普通文本'), 'string');
  assert.match(render('Fish &amp; chips &copy;'), /Fish &amp; chips &copy;/);
  assert.match(marked.parse('<b>原始默认行为</b>'), /<b>原始默认行为<\/b>/);
});

test('removing a repeated page title preserves the following heading and longer titles', () => {
  const source = readFileSync(resolve(__dirname, '../public/app.js'), 'utf8');
  const context = {markdown: render};
  vm.runInNewContext(source.slice(source.indexOf('function articleBodyMarkup('), source.indexOf('function noteCard(')), context);
  for (const title of ['导数', '函数 $x_1^2$ 的性质']) {
    const html = context.articleBodyMarkup({title, body: `# ${title}\n\n## 下一节 $x_1^2$\n正文`});
    assert.match(html, /<h3>下一节 /);
    assert.match(html, /class="katex"/);
    assert.doesNotMatch(html, /<h2>/);
    assert.match(context.articleBodyMarkup({title, body: `# ${title}补充\n\n## 下一节`}), /<h2>/);
    assert.match(context.articleBodyMarkup({title, body: `# ${title} ###\r\n## 下一节`}), /<h3>下一节<\/h3>/);
  }
});

test('note readers start body sections at h2 without changing relative depth or code examples', () => {
  const source = readFileSync(resolve(__dirname, '../public/app.js'), 'utf8');
  const context = {markdown: render};
  vm.runInNewContext(source.slice(source.indexOf('function articleBodyMarkup('), source.indexOf('function noteCard(')), context);
  const record = {title: '导数', body: '# 导数\n\n## 定义 $x_0$\n\n### 例子\n\n#### 推导\n\n```html\n<h3>代码示例</h3>\n```'};
  const html = context.articleBodyMarkup(record, 'notes');
  assert.match(html, /<h2>定义 /);
  assert.match(html, /<h3>例子<\/h3>/);
  assert.match(html, /<h4>推导<\/h4>/);
  assert.match(html, /&lt;h3&gt;代码示例&lt;\/h3&gt;/);
  assert.match(html, /class="katex"/);
  assert.match(context.articleBodyMarkup(record, 'posts'), /<h3>定义 /);
  assert.equal(record.body.startsWith('# 导数'), true);
});

test('note images reserve their actual size before loading and support keyboard preview', () => {
  const source = readFileSync(resolve(__dirname, '../public/app.js'), 'utf8');
  const handlers = {}, attributes = {};
  const image = {alt:'局部变化',complete:false,
    getAttribute:name=>name === 'src' ? '/media/1234567890abcdef1234567890abcdef.jpg' : attributes[name],
    setAttribute:(name,value)=>{attributes[name]=value;},
    addEventListener:(name,handler)=>{handlers[name]=handler;}
  };
  let opened=null;
  const context={site:{note_image_sizes:{'1234567890abcdef1234567890abcdef':{width:1200,height:390}}},openImageLightbox:value=>{opened=value;}};
  vm.runInNewContext(source.slice(source.indexOf('function bindNoteImages('),source.indexOf('function readRecord(')),context);
  context.bindNoteImages({querySelectorAll:()=>[image]});
  assert.equal(image.width,1200);
  assert.equal(image.height,390);
  assert.equal(image.tabIndex,0);
  handlers.keydown({key:'Enter',preventDefault(){}});
  assert.equal(opened,image);
  opened=null;
  handlers.keydown({key:'ArrowRight',preventDefault(){throw new Error('Normal navigation must stay native');}});
  assert.equal(opened,null);
});

test('only overflowing formulas become keyboard scroll regions, and resize updates them', () => {
  const block = (width, scrollWidth) => ({clientWidth: width, scrollWidth, attributes: {}, content: {},
    setAttribute(key, value) {this.attributes[key] = value;},
    removeAttribute(key) {delete this.attributes[key];},
    querySelector() {return this.content;}
  });
  const short = block(300, 300), wide = block(300, 600), rounding = block(300, 301), hidden = block(0, 600);
  let resize, disconnected = false;
  const observed = [];
  const local = {window: {marked, markedKatex: require('../public/marked-katex.umd.js')}, URL,
    ResizeObserver: class {constructor(callback) {resize = callback;} observe(target) {observed.push(target);} disconnect() {disconnected = true;}}
  };
  vm.runInNewContext(readFileSync(resolve(__dirname, '../public/markdown.js'), 'utf8'), local);
  const dispose = local.window.mountMathScrolling({querySelectorAll: () => [short, wide, rounding, hidden]});
  assert.equal(short.attributes.tabindex, undefined);
  assert.equal(short.attributes.role, undefined);
  assert.equal(short.attributes['data-math-scroll-hint'], undefined);
  assert.equal(wide.attributes.tabindex, '0');
  assert.equal(wide.attributes.role, 'region');
  assert.equal(wide.attributes['data-math-scroll-hint'], '左右滑动');
  assert.equal(rounding.attributes['data-math-scroll-hint'], undefined);
  assert.equal(hidden.attributes.tabindex, undefined);
  assert.equal(hidden.attributes['data-math-scroll-hint'], undefined);
  assert.ok(observed.includes(wide.content), 'formula content resizes are observed even when its container width stays fixed');
  wide.clientWidth = 700;
  short.clientWidth = 100; short.scrollWidth = 300;
  resize();
  assert.equal(wide.attributes.tabindex, undefined);
  assert.equal(wide.attributes['data-math-scroll-hint'], undefined);
  assert.equal(short.attributes.tabindex, '0');
  assert.equal(short.attributes['data-math-scroll-hint'], '左右滑动');
  // A font/content change can make the formula fit without resizing its box.
  short.scrollWidth = 100;
  resize();
  assert.equal(short.attributes['data-math-scroll-hint'], undefined);
  assert.equal(short.attributes.role, undefined);
  assert.equal(short.attributes['aria-label'], undefined);
  short.scrollWidth = 400;
  resize();
  dispose();
  assert.equal(disconnected, true);
  assert.equal(short.attributes['data-math-scroll-hint'], undefined);
  resize();
  assert.equal(short.attributes.tabindex, undefined, 'a queued resize callback cannot restore disposed controls');
});

test('an article without display formulas requires no observer or scroll hints', () => {
  const dispose = scope.window.mountMathScrolling({querySelectorAll: () => []});
  assert.equal(typeof dispose, 'function');
  assert.doesNotThrow(dispose);
  assert.doesNotMatch(render('普通文字与 $x_1$。'), /data-math-scroll-hint|tabindex|role="region"/);
});

test('wide note tables become native keyboard scroll regions and return to normal when they fit', () => {
  const table = {clientWidth:326, scrollWidth:590, attributes:{}, content:{},
    classList:{contains: name => name === 'table-wrap'},
    setAttribute(key,value){this.attributes[key]=value;},
    removeAttribute(key){delete this.attributes[key];},
    querySelector(){return this.content;}};
  let resize;
  const observed=[];
  const local={window:{marked,markedKatex:require('../public/marked-katex.umd.js')},URL,
    ResizeObserver:class {constructor(callback){resize=callback;} observe(target){observed.push(target);} disconnect(){}}};
  vm.runInNewContext(readFileSync(resolve(__dirname,'../public/markdown.js'),'utf8'),local);
  const root={classList:{contains:name=>name==='reader-notes'},
    querySelectorAll:selector=>selector.includes('.table-wrap')?[table]:[]};
  const dispose=local.window.mountMathScrolling(root);
  assert.equal(table.attributes.tabindex,'0');
  assert.equal(table.attributes['aria-label'],'表格，可横向滚动');
  assert.equal(table.attributes['data-math-scroll-hint'],'左右滑动');
  assert.ok(observed.includes(table.content));
  table.clientWidth=700;
  resize();
  assert.equal(table.attributes.tabindex,undefined);
  assert.equal(table.attributes['aria-label'],undefined);
  table.clientWidth=326;
  resize();
  dispose();
  assert.deepEqual(table.attributes,{});
});

function inlineMathFixture(notes = true, fonts = null, naturalWidth = 301) {
  const container = {clientWidth: 274};
  const formula = (naturalWidth, interactive = false) => {
    const classes = new Set(), writes = [];
    return {naturalWidth, attributes: {}, writes, parentElement: container,
      classList: {contains: name => classes.has(name), add(name) {classes.add(name);writes.push(name);}, remove(name) {classes.delete(name);writes.push(name);}},
      closest(selector) {return selector.includes('.math-block') ? (interactive ? {} : null) : container;},
      getBoundingClientRect() {return {width: classes.has('math-inline-scroll') ? Math.min(this.naturalWidth, container.clientWidth) : this.naturalWidth};},
      setAttribute(key, value) {this.attributes[key] = value;writes.push(key);},
      removeAttribute(key) {delete this.attributes[key];writes.push(key);},
    };
  };
  const wide = formula(naturalWidth), short = formula(110), toc = formula(338, true);
  const observed = [], selectors = [];
  let resize, disconnected = false;
  const local = {window: {marked, markedKatex: require('../public/marked-katex.umd.js'), document: fonts ? {fonts} : undefined}, URL,
    ResizeObserver: class {constructor(callback) {resize = callback;} observe(target) {observed.push(target);} disconnect() {disconnected = true;}}};
  vm.runInNewContext(readFileSync(resolve(__dirname, '../public/markdown.js'), 'utf8'), local);
  const root = {classList: {contains: name => notes && name === 'reader-notes'},
    querySelector: () => container,
    querySelectorAll(selector) {selectors.push(selector);return selector.includes('.markdown .katex') ? [wide, short, toc] : [];}};
  const dispose = local.window.mountMathScrolling(root);
  return {wide, short, toc, container, observed, selectors, dispose,
    resize: () => resize([{target: container}]), disconnected: () => disconnected};
}

test('only truly oversized note inline formulas scroll locally and regain natural inline layout on wide screens', () => {
  const f = inlineMathFixture();
  assert.equal(f.wide.classList.contains('math-inline-scroll'), true);
  assert.equal(f.wide.attributes.tabindex, '0');
  assert.equal(f.wide.attributes['data-math-scroll-hint'], '左右滑动');
  assert.equal(f.wide.attributes.role, 'region');
  assert.equal(f.wide.getBoundingClientRect().width, 274);
  assert.deepEqual(f.short.writes, [], 'short inline formulas must retain their original DOM behavior');
  assert.deepEqual(f.toc.writes, [], 'interactive labels must not gain nested focus regions');
  f.container.clientWidth = 700;
  f.resize();
  assert.equal(f.wide.classList.contains('math-inline-scroll'), false);
  assert.deepEqual(f.wide.attributes, {});
  assert.equal(f.wide.getBoundingClientRect().width, 301);
  f.container.clientWidth = 274;
  f.resize();
  assert.equal(f.wide.attributes.tabindex, '0');
  f.dispose();
  assert.equal(f.disconnected(), true);
  assert.equal(f.wide.classList.contains('math-inline-scroll'), false);
  assert.deepEqual(f.wide.attributes, {});
  f.resize();
  assert.deepEqual(f.wide.attributes, {}, 'a queued observer callback cannot revive disposed inline controls');
});

test('inline scrolling does not scan ordinary posts or repeat on hint-only height changes', () => {
  const article = inlineMathFixture(false);
  assert.equal(article.selectors.some(selector => selector.includes('.markdown .katex')), false);
  assert.deepEqual(article.wide.writes, []);
  const f = inlineMathFixture();
  const writes = f.wide.writes.length;
  f.resize(); // Same available width: a new hint line must not trigger another fit/overflow cycle.
  assert.equal(f.wide.writes.length, writes);
  f.dispose();
});

test('font loading rechecks inline geometry without a container resize and respects cleanup', async () => {
  for (const disposeBeforeReady of [false, true]) {
    let release;
    const fonts = {ready: new Promise(resolve => {release = resolve;})};
    const f = inlineMathFixture(true, fonts, 260);
    assert.deepEqual(f.wide.attributes, {});
    if (disposeBeforeReady) f.dispose();
    f.wide.naturalWidth = 301;
    release();
    await fonts.ready;
    assert.equal(f.wide.classList.contains('math-inline-scroll'), !disposeBeforeReady);
    assert.equal(f.wide.attributes.tabindex, disposeBeforeReady ? undefined : '0');
    assert.deepEqual(f.short.writes, []);
    f.dispose();
  }
});
