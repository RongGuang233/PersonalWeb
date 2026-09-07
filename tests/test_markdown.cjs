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
  assert.match(html, /<h1>阅读清单<\/h1>/);
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
