(() => {
  'use strict';

  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  const baseRenderer = new window.marked.Renderer();
  const linkUrl = value => {
    const href = String(value || '');
    if (/[\u0000-\u0020\u007f]/.test(href)) return null;
    if (href.startsWith('#')) return href;
    if (!/^https?:\/\//i.test(href)) return null;
    try {
      const url = new URL(href);
      return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null;
    } catch { return null; }
  };
  const renderer = {
    html(token) {
      const source = escape(token.text);
      return token.block ? `<pre class="markdown-html"><code>${source}</code></pre>\n` : source;
    },
    text(token) {
      // Marked normally passes raw-block text through; this site displays all HTML as text.
      return baseRenderer.text.call(this, {...token, escaped: false});
    },
    code({text, lang}) {
      const language = String(lang || '').trim().split(/\s+/)[0];
      return `<pre><code${language ? ` class="language-${escape(language)}"` : ''}>${escape(text.replace(/\n$/, ''))}\n</code></pre>\n`;
    },
    table(token) {
      return `<div class="table-wrap">${baseRenderer.table.call(this, token)}</div>\n`;
    },
    link({href, title, tokens}) {
      const content = this.parser.parseInline(tokens);
      const address = linkUrl(href);
      if (address === null) return content;
      return `<a href="${escape(address)}"${title ? ` title="${escape(title)}"` : ''} target="_blank" rel="noopener noreferrer">${content}</a>`;
    },
    image({href, title, text, tokens}) {
      const description = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
      if (!/^\/media\/[a-f0-9]{32}\.jpg$/.test(String(href || ''))) return escape(description);
      return `<img src="${escape(href)}" alt="${escape(description)}"${title ? ` title="${escape(title)}"` : ''} loading="lazy" decoding="async">`;
    }
  };
  const parser = new window.marked.Marked({gfm: true, breaks: false, async: false, renderer});
  const math = window.markedKatex({nonStandard: true, throwOnError: false, strict: 'ignore', trust: false});
  for (const extension of math.extensions) {
    const render = extension.renderer;
    extension.renderer = token => token.displayMode
      ? `<span class="math-block" tabindex="0" role="region" aria-label="数学公式，可横向滚动">${render(token)}</span>`
      : render(token);
  }
  parser.use(math);

  window.renderMarkdown = text => parser.parse(String(text ?? ''));
  window.markdownExcerpt = (value, length = 120) => {
    let hasMath = false;
    // Use the same tokens as the reader: math inside code stays code, not a formula.
    const plain = tokens => tokens.map(token => {
      if (token.type === 'inlineKatex' || token.type === 'blockKatex') { hasMath = true; return ' '; }
      if (token.type === 'image') return '';
      if (token.type === 'space' || token.type === 'br' || token.type === 'hr') return ' ';
      if (token.type === 'list') return token.items.map(item => plain(item.tokens)).join(' ');
      if (token.type === 'table') return [...token.header, ...token.rows.flat()].map(cell => plain(cell.tokens)).join(' ');
      const text = token.tokens ? plain(token.tokens) : (token.text || '');
      return ['paragraph', 'heading', 'blockquote', 'code'].includes(token.type) ? text + ' ' : text;
    }).join('');
    const text = plain(parser.lexer(String(value || ''))).replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, length) + (text.length > length ? '…' : '') : hasMath ? '数学公式笔记' : '';
  };
})();
