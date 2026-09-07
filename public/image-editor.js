(() => {
  'use strict';

  let cancelActive = null;
  let editorCount = 0;

  window.openImageEditor = (file, options = {}) => new Promise(resolve => {
    cancelActive?.();
    const {title = '调整图片', width, height, mimeType = 'image/png', maxBytes = 1048576, circular = false} = options;
    const identifier = `image-editor-${++editorCount}`;
    const previousFocus = document.activeElement;
    const listeners = new AbortController();
    const editor = document.createElement('dialog');
    editor.className = 'image-editor';
    editor.setAttribute('aria-labelledby', `${identifier}-title`);
    editor.innerHTML = `<div class="image-editor-heading"><h2 id="${identifier}-title"></h2><button type="button" class="image-editor-close" aria-label="取消裁剪">×</button></div><p class="image-editor-instructions" id="${identifier}-instructions">拖动图片调整位置，再用滑块缩放。也可选中图片后按方向键微调，按住 Shift 加快移动。</p><div class="image-editor-stage"><canvas class="image-editor-canvas" tabindex="-1" role="img" aria-label="图片裁剪预览，可拖动或用方向键调整位置" aria-describedby="${identifier}-instructions" aria-disabled="true"></canvas></div><div class="image-editor-tools"><label for="${identifier}-zoom">缩放</label><input id="${identifier}-zoom" class="image-editor-zoom" type="range" min="1" max="3" step="0.01" value="1" disabled><output class="image-editor-scale" for="${identifier}-zoom">100%</output><button type="button" class="image-editor-reset" disabled>重置</button></div><p class="image-editor-status" role="status" aria-live="polite">正在读取图片…</p><div class="image-editor-actions"><button type="button" class="image-editor-cancel">取消</button><button type="button" class="image-editor-confirm" disabled>使用这张图片</button></div>`;
    editor.querySelector('h2').textContent = String(title);
    const canvas = editor.querySelector('canvas');
    const stage = editor.querySelector('.image-editor-stage');
    const zoomInput = editor.querySelector('.image-editor-zoom');
    const scaleLabel = editor.querySelector('.image-editor-scale');
    const resetButton = editor.querySelector('.image-editor-reset');
    const confirmButton = editor.querySelector('.image-editor-confirm');
    const status = editor.querySelector('.image-editor-status');
    const context = canvas.getContext('2d');
    canvas.classList.toggle('image-editor-circular', !!circular);

    let finished = false;
    let ready = false;
    let reader = null;
    let picture = null;
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    let baseScale = 1;
    let pointer = null;

    const on = (target, event, handler) => target.addEventListener(event, handler, {signal: listeners.signal});
    const finish = result => {
      if (finished) return;
      finished = true;
      ready = false;
      if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
      pointer = null;
      if (reader?.readyState === FileReader.LOADING) reader.abort();
      picture?.removeAttribute('src');
      picture = null;
      listeners.abort();
      if (editor.open) editor.close();
      editor.remove();
      canvas.width = 0;
      canvas.height = 0;
      if (cancelActive === cancel) cancelActive = null;
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
      resolve(result);
    };
    const cancel = () => finish(null);
    cancelActive = cancel;
    const showError = message => {
      status.textContent = message;
      status.classList.add('image-editor-error');
    };
    const clampPosition = () => {
      const horizontal = Math.max(0, (picture.naturalWidth * baseScale * zoom - width) / 2);
      const vertical = Math.max(0, (picture.naturalHeight * baseScale * zoom - height) / 2);
      offsetX = Math.max(-horizontal, Math.min(horizontal, offsetX));
      offsetY = Math.max(-vertical, Math.min(vertical, offsetY));
    };
    const draw = () => {
      if (!ready || finished) return;
      clampPosition();
      const drawnWidth = picture.naturalWidth * baseScale * zoom;
      const drawnHeight = picture.naturalHeight * baseScale * zoom;
      context.clearRect(0, 0, width, height);
      if (mimeType === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
      context.drawImage(picture, (width - drawnWidth) / 2 + offsetX, (height - drawnHeight) / 2 + offsetY, drawnWidth, drawnHeight);
      scaleLabel.textContent = `${Math.round(zoom * 100)}%`;
      zoomInput.setAttribute('aria-valuetext', scaleLabel.textContent);
    };
    const setZoom = next => {
      const value = Math.max(1, Math.min(3, next));
      offsetX *= value / zoom;
      offsetY *= value / zoom;
      zoom = value;
      zoomInput.value = String(zoom);
      draw();
    };
    const dataBytes = data => {
      const encoded = data.slice(data.indexOf(',') + 1);
      return encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    };

    on(editor.querySelector('.image-editor-close'), 'click', cancel);
    on(editor.querySelector('.image-editor-cancel'), 'click', cancel);
    on(editor, 'cancel', event => { event.preventDefault(); cancel(); });
    on(editor, 'close', cancel);
    on(zoomInput, 'input', () => { if (ready) setZoom(Number(zoomInput.value)); });
    on(resetButton, 'click', () => { if (!ready) return; offsetX = 0; offsetY = 0; setZoom(1); });
    on(canvas, 'pointerdown', event => {
      if (!ready || pointer || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      canvas.focus({preventScroll: true});
      pointer = {id: event.pointerId, x: event.clientX, y: event.clientY};
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('image-editor-dragging');
    });
    on(canvas, 'pointermove', event => {
      if (!ready || pointer?.id !== event.pointerId) return;
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      offsetX += (event.clientX - pointer.x) * width / bounds.width;
      offsetY += (event.clientY - pointer.y) * height / bounds.height;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      draw();
    });
    const endPointer = event => {
      if (pointer?.id !== event.pointerId) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      pointer = null;
      canvas.classList.remove('image-editor-dragging');
    };
    on(canvas, 'pointerup', endPointer);
    on(canvas, 'pointercancel', endPointer);
    on(canvas, 'lostpointercapture', endPointer);
    on(canvas, 'keydown', event => {
      if (!ready || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const step = event.shiftKey ? 10 : 2;
      if (event.key === 'ArrowLeft') offsetX -= step * width / bounds.width;
      if (event.key === 'ArrowRight') offsetX += step * width / bounds.width;
      if (event.key === 'ArrowUp') offsetY -= step * height / bounds.height;
      if (event.key === 'ArrowDown') offsetY += step * height / bounds.height;
      draw();
    });
    on(confirmButton, 'click', () => {
      if (!ready || finished) return;
      confirmButton.disabled = true;
      status.classList.remove('image-editor-error');
      status.textContent = '正在准备裁剪后的图片…';
      try {
        draw();
        let result = canvas.toDataURL(mimeType, .9);
        if (!result.startsWith(`data:${mimeType};base64,`)) throw new Error('当前浏览器无法导出这种图片格式，请换一种格式后重试。');
        if (mimeType !== 'image/png') {
          for (const quality of [.85, .8, .75, .65, .55]) {
            if (dataBytes(result) <= maxBytes) break;
            result = canvas.toDataURL(mimeType, quality);
          }
        }
        if (dataBytes(result) > maxBytes) throw new Error(`裁剪后的图片仍超过 ${Math.round(maxBytes / 1024)} KB，请调整裁剪范围或换一张图片。`);
        finish(result);
      } catch (error) {
        showError(error.message || '图片导出失败，请调整后重试。');
        confirmButton.disabled = false;
      }
    });

    document.body.append(editor);
    editor.showModal();
    (async () => {
      try {
        if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || !Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('裁剪尺寸或文件大小设置无效，请取消后重试。');
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('不支持这种输出格式，请使用 PNG、JPG 或 WebP。');
        if (!(file instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片。');
        if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10 MB，请选择较小的图片。');
        const data = await new Promise((accept, reject) => {
          reader = new FileReader();
          reader.onload = () => accept(reader.result);
          reader.onerror = () => reject(new Error('无法读取图片，请取消后重新选择。'));
          reader.onabort = () => reject(new Error('图片读取已取消。'));
          reader.readAsDataURL(file);
        });
        if (reader) { reader.onload = null; reader.onerror = null; reader.onabort = null; reader = null; }
        if (finished) return;
        picture = new Image();
        picture.src = data;
        await picture.decode();
        if (finished) return;
        if (!picture.naturalWidth || !picture.naturalHeight || !context) throw new Error('无法显示这张图片，请换一张图片。');
        canvas.width = width;
        canvas.height = height;
        baseScale = Math.max(width / picture.naturalWidth, height / picture.naturalHeight);
        ready = true;
        canvas.tabIndex = 0;
        canvas.removeAttribute('aria-disabled');
        stage.classList.add('image-editor-ready');
        zoomInput.disabled = false;
        resetButton.disabled = false;
        confirmButton.disabled = false;
        draw();
        status.textContent = circular ? '圆形区域是头像的展示效果，确认后再由页面保存。' : '裁剪范围已铺满，确认后再由页面保存。';
        canvas.focus({preventScroll: true});
      } catch (error) { if (!finished) showError(error.message?.includes('图片') || error.message?.includes('裁剪') || error.message?.includes('格式') ? error.message : '无法解析图片，请取消后重新选择 PNG、JPG 或 WebP 图片。'); }
      finally { if (reader) { reader.onload = null; reader.onerror = null; reader.onabort = null; reader = null; } }
    })();
  });
})();
