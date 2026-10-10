/* Reading navigation. The caller decides when a document needs a directory. */
(() => {
  'use strict';

  function groupHeadings(headings) {
    const topLevel = headings.reduce((min, heading) => Math.min(min, Number(heading.tagName[1])), 6);
    const groups = [];
    headings.forEach(heading => {
      if (!groups.length || Number(heading.tagName[1]) === topLevel) groups.push({heading, children: []});
      else groups[groups.length - 1].children.push(heading);
    });
    return {topLevel, groups, compact: headings.length >= 15};
  }

  function createReadingPoint(reader, markdown, signal, refresh) {
    if (!reader.classList.contains('reader-notes')) return null;
    let width = window.innerWidth, height = window.innerHeight;
    let point = null, frame = 0, stopped = false;
    const changing = () => width !== window.innerWidth || height !== window.innerHeight;
    function remember() {
      if (stopped || changing()) return;
      point = null;
      if (window.scrollY <= 0) return;
      const bounds = markdown.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
      const x = Math.max(1, Math.min(window.innerWidth - 1, bounds.left + bounds.width / 2));
      const start = Math.min(window.innerHeight - 1, Math.max(96, bounds.top + 1));
      // Native hit testing avoids walking every paragraph and KaTeX descendant.
      for (const y of [start, start + 24, start + 48]) {
        if (y >= window.innerHeight) break;
        const element = document.elementsFromPoint(x, y)
          .map(hit => hit.closest('img, .math-block, .table-wrap, p, li, h2, h3, h4, h5, h6, pre, blockquote'))
          .find(candidate => candidate && markdown.contains(candidate));
        if (!element) continue;
        const box = element.getBoundingClientRect();
        if (box.height > 0 && box.top <= y && box.top + box.height > y) {
          point = {element, ratio: (y - box.top) / box.height, y};
          return;
        }
      }
    }
    function resize() {
      if (stopped || !changing()) return false;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (stopped) return;
        width = window.innerWidth; height = window.innerHeight;
        if (point?.element.isConnected && markdown.contains(point.element)) {
          const box = point.element.getBoundingClientRect();
          // The same fraction of an image remains visible when its size changes.
          const delta = box.top + point.ratio * box.height - point.y;
          if (Math.abs(delta) > 1) window.scrollBy({top: delta, behavior: 'instant'});
        }
        refresh();
        remember();
      });
      return true;
    }
    signal.addEventListener('abort', () => {
      stopped = true;
      cancelAnimationFrame(frame);
      point = null;
    }, {once: true});
    remember();
    return {remember, resize, changing};
  }

  window.mountReadingNavigation = function mountReadingNavigation(reader) {
    const markdown = reader?.querySelector(':scope > .markdown');
    const headings = markdown ? [...markdown.querySelectorAll('h2, h3, h4')] : [];
    if (!reader?.parentElement || headings.length < 3) return () => {};
    // Body headings shifted down a level, so the shallowest heading present is the top level.
    const {topLevel, groups, compact: longDirectory} = groupHeadings(headings);
    const compact = longDirectory && reader.classList.contains('reader-notes');
    const directoryLabel = reader.classList.contains('reader-notes') ? '本篇目录' : '文章目录';
    const headingGroups = new Map();
    groups.forEach((group, index) => [group.heading, ...group.children].forEach(heading => headingGroups.set(heading, index)));
    const expandedGroups = new Set();
    const groupViews = [];
    let activeGroup = 0;

    const layout = reader.closest('.reading-layout');
    const controller = new AbortController();
    const listen = (element, type, handler) => element.addEventListener(type, handler, {signal: controller.signal});
    const desktop = matchMedia('(min-width: 1120px)');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const originalTabIndexes = new Map();
    let frame = 0;
    let disposed = false;
    let readingPoint = null;
    let resizeFocus = null;

    const wrapper = document.createElement('div');
    wrapper.className = 'reading-navigation-layout';
    reader.before(wrapper);
    wrapper.append(reader);
    layout?.classList.add('has-reading-navigation');

    const inline = document.createElement('details');
    inline.className = 'reading-toc reading-navigation-inline';
    const inlineSummary = document.createElement('summary');
    inlineSummary.textContent = directoryLabel;
    inline.append(inlineSummary);

    const floating = document.createElement('details');
    floating.className = 'reading-navigation-floating';
    floating.hidden = true;
    const floatingSummary = document.createElement('summary');
    floatingSummary.textContent = '目录';
    floatingSummary.setAttribute('aria-label', `打开或收起${directoryLabel}`);
    floating.append(floatingSummary);

    function closeFloating(restoreFocus = false) {
      floating.open = false;
      if (restoreFocus) floatingSummary.focus({preventScroll: true});
    }

    const tocButtons = [];

    function headingButton(heading) {
      const button = document.createElement('button');
      button.type = 'button';
      // Keep rendered formulas and their MathML instead of flattening KaTeX's
      // accessible and visual representations into one duplicated text label.
      const content = heading.cloneNode(true);
      // The navigation button owns interaction; copied links and scrollable
      // formula regions must not introduce nested links or focus stops.
      content.querySelectorAll('a, .math-block').forEach(element => element.replaceWith(...element.childNodes));
      const label = document.createElement('span');
      label.className = 'reading-navigation-label';
      label.append(...content.childNodes);
      button.append(label);
      button.className = 'toc-entry';
      if (Number(heading.tagName[1]) > topLevel) button.classList.add('toc-sub');
      if (Number(heading.tagName[1]) > topLevel + 1) button.classList.add('toc-deep');
      button.dataset.tocFor = heading.id || '';
      listen(button, 'click', () => {
        closeFloating();
        inline.open = false;
        if (!originalTabIndexes.has(heading)) originalTabIndexes.set(heading, heading.getAttribute('tabindex'));
        heading.tabIndex = -1;
        heading.focus({preventScroll: true});
        heading.scrollIntoView({behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start'});
      });
      tocButtons.push(button);
      return button;
    }

    function updateGroups() {
      groupViews.forEach(({index, element, children, toggle, entry}) => {
        const current = index === activeGroup;
        const expanded = !compact || current || expandedGroups.has(index);
        element.classList.toggle('is-current', current);
        if (!expanded && children.contains(document.activeElement)) entry.focus({preventScroll: true});
        children.hidden = !expanded;
        if (toggle) {
          if (current && toggle === document.activeElement) entry.focus({preventScroll: true});
          toggle.disabled = current;
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.setAttribute('aria-label', current ? '当前章节子标题已展开' : expanded ? '收起本章子标题' : '展开本章子标题');
          toggle.textContent = expanded ? '−' : '+';
        }
      });
    }

    function sectionNavigation(label, prefix) {
      const nav = document.createElement('nav');
      nav.setAttribute('aria-label', label);
      groups.forEach((group, index) => {
        const element = document.createElement('div');
        element.className = 'toc-group';
        const header = document.createElement('div');
        header.className = 'toc-group-heading';
        const entry = headingButton(group.heading);
        header.append(entry);
        const children = document.createElement('div');
        children.className = 'toc-group-children';
        children.id = `${prefix}-group-${index + 1}`;
        group.children.forEach(heading => children.append(headingButton(heading)));
        let toggle = null;
        if (compact && group.children.length) {
          toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'toc-group-toggle';
          toggle.setAttribute('aria-controls', children.id);
          listen(toggle, 'click', () => {
            if (expandedGroups.has(index)) expandedGroups.delete(index);
            else expandedGroups.add(index);
            updateGroups();
          });
          header.append(toggle);
        }
        element.append(header, children);
        groupViews.push({index, element, children, toggle, entry});
        nav.append(element);
      });
      return nav;
    }

    headings.forEach((heading, index) => { if (!heading.id) heading.id = `section-${index + 1}`; });

    inline.append(sectionNavigation(directoryLabel, 'reading-inline'));
    markdown.before(inline);
    floating.append(sectionNavigation(`浮动${directoryLabel}`, 'reading-floating'));
    document.body.append(floating);

    const side = document.createElement('aside');
    side.className = 'reading-navigation-side';
    const caption = document.createElement('p');
    caption.className = 'reading-navigation-caption';
    caption.textContent = directoryLabel;
    side.append(caption, sectionNavigation(`侧栏${directoryLabel}`, 'reading-side'));
    wrapper.append(side);

    let activeId = '';
    function revealActiveItem(container, button = container?.querySelector('[aria-current="location"]')) {
      if (!container || !button) return;
      const item = button.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      // Only scroll the directory container, never the article or page.
      if (item.top < bounds.top + 8) container.scrollTop += item.top - bounds.top - 8;
      else if (item.bottom > bounds.bottom - 8) container.scrollTop += item.bottom - bounds.bottom + 8;
    }

    function revealSideActive() {
      if (desktop.matches) revealActiveItem(side);
    }

    function revealFloatingActive() {
      if (!desktop.matches && floating.open && !floating.hidden) revealActiveItem(floating.querySelector('nav'));
    }

    function setActiveHeading() {
      if (disposed || readingPoint?.changing()) return;
      const offset = 96;
      let current = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top - offset <= 0) current = heading;
        else break;
      }
      // The final section may be too short to reach the normal top threshold.
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1) {
        const last = headings[headings.length - 1];
        const bounds = last.getBoundingClientRect();
        if (bounds.top < window.innerHeight && bounds.bottom > 0) current = last;
      }
      if (!current || current.id === activeId) return;
      activeId = current.id;
      activeGroup = headingGroups.get(current);
      updateGroups();
      tocButtons.forEach(button => {
        const on = button.dataset.tocFor === activeId;
        button.classList.toggle('is-active', on);
        if (on) button.setAttribute('aria-current', 'location');
        else button.removeAttribute('aria-current');
      });
      revealSideActive();
      revealFloatingActive();
    }

    function updateFloating() {
      if (disposed) return;
      if (readingPoint?.changing()) {
        const focused = document.activeElement;
        if (!resizeFocus && (inline.contains(focused) || floating.contains(focused) || side.contains(focused))) resizeFocus = focused;
        readingPoint.resize();
        return;
      }
      setActiveHeading();
      const visible = !desktop.matches && inline.getBoundingClientRect().bottom < 0;
      const focused = resizeFocus || document.activeElement;
      resizeFocus = null;
      const focusDisappears = desktop.matches
        ? inline.contains(focused) || floating.contains(focused)
        : side.contains(focused) || (!visible && floating.contains(focused));
      floating.hidden = !visible;
      if (!visible) closeFloating();
      // Crossing the layout breakpoint can hide any one of the three surfaces.
      // Continue keyboard navigation at the same section in the visible surface.
      if (focusDisappears) {
        const sourceGroup = groupViews.find(view => view.toggle === focused);
        const sourceEntry = tocButtons.find(button => button === focused) || sourceGroup?.entry;
        const destination = desktop.matches ? side : visible ? floating : inline;
        // Desktop has no opener: continue at the chapter the reader is viewing.
        const targetId = sourceEntry?.dataset.tocFor || (desktop.matches ? activeId : '');
        let target = [...destination.querySelectorAll('button[data-toc-for]')].find(button => button.dataset.tocFor === targetId);
        if (sourceGroup) {
          const targetGroup = groupViews.find(view => view.entry === target);
          if (targetGroup?.toggle && !targetGroup.toggle.disabled) target = targetGroup.toggle;
        }
        if (!desktop.matches) destination.open = true;
        target ||= desktop.matches ? side.querySelector('button') : visible ? floatingSummary : inlineSummary;
        target.focus({preventScroll: true});
        revealActiveItem(desktop.matches ? side : destination.querySelector('nav'), target);
      }
    }

    const observer = new IntersectionObserver(updateFloating, {threshold: 0});
    observer.observe(inline);
    listen(desktop, 'change', () => { updateFloating(); if (!side.contains(document.activeElement)) revealSideActive(); });
    listen(window, 'scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { setActiveHeading(); readingPoint?.remember(); });
    }, {passive: true});
    listen(inline, 'toggle', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateFloating);
    });
    listen(floating, 'toggle', () => {
      if (!floating.open) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { setActiveHeading(); revealFloatingActive(); });
    });
    listen(document, 'pointerdown', event => {
      if (floating.open && !floating.contains(event.target)) closeFloating();
    });
    listen(document, 'keydown', event => {
      if (event.key === 'Escape' && floating.open) {
        event.preventDefault();
        closeFloating(true);
      }
    });
    listen(floating, 'focusout', event => {
      if (!floating.contains(event.relatedTarget)) closeFloating();
    });
    readingPoint = createReadingPoint(reader, markdown, controller.signal, () => {
      updateFloating();
      if (!side.contains(document.activeElement)) revealSideActive();
    });
    if (readingPoint) listen(window, 'resize', updateFloating);
    updateFloating();

    return function cleanupReadingNavigation() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      resizeFocus = null;
      observer.disconnect();
      cancelAnimationFrame(frame);
      originalTabIndexes.forEach((value, heading) => {
        if (value === null) heading.removeAttribute('tabindex');
        else heading.setAttribute('tabindex', value);
      });
      inline.remove();
      floating.remove();
      wrapper.replaceWith(reader);
      layout?.classList.remove('has-reading-navigation');
    };
  };
})();
