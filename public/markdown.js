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
  const renderImage = (href, description, title) => {
    const address = String(href || '');
    if (/^\/media\/[a-f0-9]{32}\.jpg$/.test(address)) {
      return `<img src="${escape(address)}" alt="${escape(description)}"${title ? ` title="${escape(title)}"` : ''} loading="lazy" decoding="async">`;
    }
    if (address && !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(address)) {
      let filename = address.split(/[?#]/)[0].replaceAll('\\', '/').split('/').pop();
      try { filename = decodeURIComponent(filename); } catch {}
      return `<span class="missing-image" role="img" aria-label="图片未导入：${escape(filename)}">图片未导入：${escape(filename)}${description && description !== filename ? `（${escape(description)}）` : ''}</span>`;
    }
    return escape(description);
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
    heading(token) {
      // Reading pages own the single page H1, so body headings shift down one level
      // (source `#` → h2) and the document never ends up with several H1s.
      const depth = Math.min(6, Math.max(2, Number(token.depth || 1) + 1));
      return `<h${depth}>${this.parser.parseInline(token.tokens)}</h${depth}>\n`;
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
      return renderImage(href, description, title);
    }
  };
  const parser = new window.marked.Marked({gfm: true, breaks: false, async: false, renderer});
  parser.use({extensions: [{
    name: 'wikiImage', level: 'inline', start: source => source.indexOf('![['),
    tokenizer(source) {
      const match = /^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(source);
      if (match) return {type: 'wikiImage', raw: match[0], href: match[1].trim(), alt: (match[2] || '').trim()};
    },
    renderer(token) { return renderImage(token.href, token.alt || token.href.replaceAll('\\', '/').split('/').pop()); }
  }]});
  const math = window.markedKatex({nonStandard: true, throwOnError: false, strict: 'ignore', trust: false});
  for (const extension of math.extensions) {
    const render = extension.renderer;
    extension.renderer = token => token.displayMode
      ? `<span class="math-block">${render(token)}</span>`
      : render(token);
  }
  parser.use(math);

  window.renderMarkdown = text => parser.parse(String(text ?? ''));
  window.mountMathScrolling = root => {
    const notes = root.classList?.contains('reader-notes');
    const blocks = [...root.querySelectorAll(notes ? '.math-block, .table-wrap' : '.math-block')];
    const inline = notes ? [...root.querySelectorAll('.markdown .katex')].filter(formula => !formula.closest('.math-block, .table-wrap, button, a')) : [];
    if (!blocks.length && !inline.length) return () => {};
    const body = inline.length ? root.querySelector('.markdown') : null;
    const inlineScrollers = new Set();
    let inlineWidth = -1;
    let disposed = false;
    const clear = block => ['tabindex', 'role', 'aria-label', 'data-math-scroll-hint'].forEach(name => block.removeAttribute(name));
    const mark = block => {
      block.setAttribute('tabindex', '0');
      block.setAttribute('role', 'region');
      block.setAttribute('aria-label', block.classList?.contains('table-wrap') ? '表格，可横向滚动' : '数学公式，可横向滚动');
      block.setAttribute('data-math-scroll-hint', '左右滑动');
    };
    const updateInline = () => {
      if (disposed) return;
      inlineWidth = body.clientWidth;
      inline.forEach(formula => {
        // Measure natural inline wrapping before deciding whether scrolling is
        // still needed. The formula node itself keeps its DOM identity.
        if (inlineScrollers.has(formula)) formula.classList.remove('math-inline-scroll');
        const container = formula.closest('p, li, h2, h3, h4, h5, h6, blockquote') || formula.parentElement;
        if (container.clientWidth > 0 && formula.getBoundingClientRect().width > container.clientWidth + 1) {
          formula.classList.add('math-inline-scroll');
          inlineScrollers.add(formula);
          mark(formula);
        } else if (inlineScrollers.delete(formula)) clear(formula);
      });
    };
    const update = entries => {
      if (disposed) return;
      blocks.forEach(block => {
        if (block.clientWidth > 0 && block.scrollWidth > block.clientWidth + 1) mark(block);
        else clear(block);
      });
      // Hint height and ordinary scrolling never rescan thousands of formulas.
      if (body && (!entries || body.clientWidth !== inlineWidth)) updateInline();
    };
    const observer = new ResizeObserver(update);
    blocks.forEach(block => {
      observer.observe(block);
      // Font loading can resize the formula without changing its container.
      const content = block.querySelector('.katex-display, table');
      if (content) observer.observe(content);
    });
    if (body) observer.observe(body);
    update();
    if (body) window.document?.fonts?.ready.then(updateInline);
    return () => {
      disposed = true;
      observer.disconnect();
      blocks.forEach(clear);
      inlineScrollers.forEach(formula => {formula.classList.remove('math-inline-scroll');clear(formula);});
      inlineScrollers.clear();
    };
  };
  window.markdownExcerpt = (value, length = 120) => {
    let hasMath = false;
    // Use the same tokens as the reader: math inside code stays code, not a formula.
    const plain = tokens => tokens.map(token => {
      if (token.type === 'inlineKatex' || token.type === 'blockKatex') { hasMath = true; return ' '; }
      if (token.type === 'image' || token.type === 'wikiImage') return '';
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
