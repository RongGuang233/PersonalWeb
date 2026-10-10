'use strict';
function draftRowsMarkup(drafts, showKind = false) {
  return drafts.map(row => `<div class="draft-row"><button class="draft-open" data-draft="${esc(row.key)}"><strong>${esc(row.title || '未命名草稿')}</strong><span>${showKind ? esc(kinds[row.kind].name)+' · ' : ''}${row.record_id ? '已有内容的修改' : '尚未发布'} · ${new Date(row.updated*1000).toLocaleString('zh-CN')}</span></button><button data-discard-draft="${esc(row.key)}" aria-label="丢弃草稿：${esc(row.title || '未命名草稿')}">丢弃</button></div>`).join('');
}
function bindDraftRows(container, drafts, onChanged) {
  container.querySelectorAll('[data-draft]').forEach(button => button.onclick = () => {
    const draft = drafts.find(row => row.key === button.dataset.draft);
    return openWritingEditor(draft.kind, {}, draft.key).catch(error => toast(error.message));
  });
  container.querySelectorAll('[data-discard-draft]').forEach(button => button.onclick = () => {
    const draft = drafts.find(row => row.key === button.dataset.discardDraft);
    showForm('丢弃草稿', `<p>确定丢弃「${esc(draft.title || '未命名草稿')}」？${draft.record_id ? '已保存的正式内容不受影响。' : '草稿中的文字和图片将被移除。'}</p>`, async () => { await api('drafts/'+draft.key,'DELETE',{}); await onChanged(); toast('草稿已丢弃'); }, '丢弃草稿');
  });
}
function parseMarkdownImport(source, filename) {
  source = String(source || '').replace(/^\uFEFF/, '');
  let tags = '', category = '';
  const frontMatter = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (frontMatter) {
    const tagLine = frontMatter[1].match(/^(?:tags?|标签)\s*:\s*(.+)$/mi);
    if (tagLine) tags = tagLine[1].replace(/[\[\]]/g, '').split(/[,，]/).map(value => value.trim()).filter(Boolean).join(', ');
    const categoryLine = frontMatter[1].match(/^(?:category|分类)\s*:\s*(.+)$/mi);
    if (categoryLine) category = categoryLine[1].replace(/^['"]|['"]$/g, '').trim();
    source = source.slice(frontMatter[0].length);
  }
  const heading = source.match(/^#\s+(.+?)\s*$/m);
  const fallback = String(filename || '未命名笔记').replace(/\.[^.]+$/, '').trim() || '未命名笔记';
  if (!category) {
    const pathParts = String(filename || '').replaceAll('\\', '/').split('/').filter(Boolean);
    const parent = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
    category = parent.replace(/笔记$/, '').trim();
  }
  const title = heading ? heading[1].replace(/[*_`]/g, '').trim() : fallback;
  const body = heading ? source.slice(heading.index + heading[0].length).replace(/^\s+/, '') : source;
  return {title, body, tags, category};
}

function markdownImageName(value) {
  let name = String(value || '').trim().replace(/^<|>$/g, '');
  try { name = decodeURIComponent(name); } catch {}
  return name.split(/[?#]/)[0].replaceAll('\\', '/').split('/').pop().trim().toLowerCase();
}

function markdownImagePath(value) {
  let path = String(value || '').trim().replace(/^<|>$/g, '').replaceAll('\\', '/');
  try { path = decodeURIComponent(path); } catch {}
  path = path.split(/[?#]/)[0].replace(/\/+/g, '/');
  const absolute = path.startsWith('/');
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (parts.length) parts.pop(); else if (!absolute) parts.push(part); }
    else parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`;
}

function markdownImageFile(ref, markdownPath, imageFiles) {
  const target = markdownImagePath(ref.href);
  const notePath = markdownImagePath(markdownPath);
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  const candidates = imageFiles.map(file => ({file, path: markdownImagePath(file.webkitRelativePath || file.name)}));
  const relativeTarget = noteDir ? markdownImagePath(`${noteDir}/${target}`) : target;
  const exact = candidates.find(item => item.path === target || item.path === relativeTarget);
  if (exact) return exact.file;
  const basename = markdownImageName(target);
  const matches = candidates.filter(item => markdownImageName(item.path) === basename);
  return matches.length === 1 ? matches[0].file : null;
}

function markdownImageRefs(source) {
  const refs = [];
  String(source || '').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, href) => {
    refs.push({syntax: 'markdown', alt: String(alt || '').trim(), href: String(href || '').trim()});
    return _;
  });
  String(source || '').replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, href, alt) => {
    refs.push({syntax: 'wikilink', alt: String(alt || '').trim(), href: String(href || '').trim()});
    return _;
  });
  return refs.filter(ref => ref.href && !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(ref.href));
}

function rewriteMarkdownImages(source, replacements) {
  const replaceRef = (href, alt) => {
    const url = replacements.get(markdownImagePath(href)) || replacements.get(markdownImageName(href));
    return url ? `![${alt || markdownImageName(href)}](${url})` : null;
  };
  let result = String(source || '').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, href) => replaceRef(href, alt) || full);
  return result.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (full, href, alt) => replaceRef(href, alt) || full);
}
function renderDrafts() {
  const target = $('#draft-list'); if (!target) return;
  const drafts = privateDrafts.filter(row => row.kind === privateKind && [row.title,row.body].some(value => String(value || '').toLowerCase().includes(search.toLowerCase())));
  target.innerHTML = drafts.length ? `<section class="drafts"><div class="heading"><h2>继续草稿 <span>${drafts.length}</span></h2><span class="hint">仅自己可见</span></div>${draftRowsMarkup(drafts)}</section>` : '';
  bindDraftRows(target, drafts, () => refreshContent(privateKind));
}
async function openWritingEditor(kind, record = {}, requestedKey) {
  const key = requestedKey || (record.id ? `record-${kind}-${record.id}` : crypto.randomUUID());
  let draft, persisted = false;
  try { draft = await api('drafts/'+key); persisted = true; }
  catch(error) { if(error.status !== 404) throw error; draft = {kind,record_id:record.id || null,published:!record.id,...record}; }
  const originalPublishedAt = draft.published_at === undefined ? (record.published_at ?? null) : draft.published_at;
  const dateValue = timestamp => {
    if (timestamp === null) return '';
    const date = new Date(timestamp * 1000);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  };
  const originalDate = dateValue(originalPublishedAt);
  const publicationDate = field('publication_date','发表日期',originalDate,'date',false,'aria-describedby="publication-date-hint"') + '<p id="publication-date-hint" class="hint">留空保留原发表日期。</p>';
  const titleField = field('title','标题',draft.title,'text',true,'maxlength="4000"');
  const noteCategories = kind === 'notes' ? [...new Set(((typeof site !== 'undefined' && site.notes) || []).map(row => String(row.category || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'zh-CN')) : [];
  const noteCategoryField = kind === 'notes' ? `<label>分类<input name="category" type="text" list="note-category-options" maxlength="120" value="${esc(draft.category || '')}" placeholder="例如：高中数学"><datalist id="note-category-options">${noteCategories.map(value => `<option value="${esc(value)}">`).join('')}</datalist></label>` : '';
  const settings = publicationDate + (kind === 'posts' ? `<section class="cover-editor"><span>文章封面</span><div class="cover-preview" id="draft-cover-preview" ${draft.cover_url ? '' : 'hidden'}>${draft.cover_url ? `<img src="${esc(draft.cover_url)}" alt="草稿封面">` : ''}</div><input id="draft-cover-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="cover-editor-actions"><button type="button" id="draft-choose-cover">选择封面</button><button type="button" id="draft-remove-cover" ${draft.cover_url ? '' : 'hidden'}>移除</button></div></section>`+field('tags','标签（逗号分隔，可留空）',draft.tags)+area('summary','摘要（可留空）',draft.summary,3,4000) : kind === 'notes' ? noteCategoryField + field('tags','主题标签（逗号分隔，可留空）',draft.tags) : kind === 'projects' ? `<section class="cover-editor"><span>项目封面</span><div class="cover-preview" id="draft-cover-preview" ${draft.cover_url ? '' : 'hidden'}>${draft.cover_url ? `<img src="${esc(draft.cover_url)}" alt="草稿封面">` : ''}</div><input id="draft-cover-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="cover-editor-actions"><button type="button" id="draft-choose-cover">选择封面</button><button type="button" id="draft-paste-cover">粘贴封面</button><button type="button" id="draft-remove-cover" ${draft.cover_url ? '' : 'hidden'}>移除</button></div><p class="hint">可上传或粘贴截屏。</p></section><label>状态<select name="status">${(typeof projectStatuses !== 'undefined' ? projectStatuses : ['进行中','已完成','归档']).map(status => `<option ${status === (draft.status || '进行中') ? 'selected' : ''}>${status}</option>`).join('')}</select></label>`+field('tags','技术标签（逗号分隔，可留空）',draft.tags)+field('repo_url','仓库链接（可留空）',draft.repo_url,'url')+field('demo_url','演示链接（可留空）',draft.demo_url,'url')+area('summary','一句话简介（可留空）',draft.summary,3,4000) : '') + `<label class="checkbox-label"><input type="checkbox" name="is_private" ${draft.published !== true ? 'checked' : ''}><span>仅自己可见<small>勾选后设为私密。</small></span></label>` + (kind === 'posts' ? `<label class="checkbox-label"><input type="checkbox" name="featured" ${draft.featured ? 'checked' : ''}><span>首页精选</span></label><label class="checkbox-label"><input type="checkbox" name="pinned" ${draft.pinned ? 'checked' : ''}><span>置顶文章</span></label>` : kind === 'projects' ? `<label class="checkbox-label"><input type="checkbox" name="featured" ${draft.featured ? 'checked' : ''}><span>首页精选</span></label>` : '');
  const fields = `<div class="draft-status-row" id="draft-header-status"><span id="draft-status" role="status">${persisted ? '已恢复服务器草稿' : draft.record_id ? '已载入当前内容，修改后自动保存草稿' : '输入后自动保存草稿'}</span><button type="button" id="draft-retry" hidden>重试保存</button><button type="button" id="draft-close">保存草稿并关闭</button></div>`+titleField+`<details class="writing-settings" open><summary>发布设置${kind === 'posts' ? ' · 封面与摘要' : ''}</summary><div class="writing-settings-fields">${settings}</div></details><div class="writing-layout"><section class="writing-main" aria-label="正文编辑"><div class="writing-toolbar"><div class="writing-switch"><button type="button" id="write-mode" aria-pressed="true">编辑</button><button type="button" id="preview-mode" aria-pressed="false">预览</button></div><button type="button" id="insert-image">插入图片</button><output id="body-count" for="record-body"></output></div><input id="inline-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><label id="body-label">正文<textarea id="record-body" name="body" rows="6" maxlength="100000" aria-describedby="body-count">${esc(draft.body)}</textarea></label><div id="body-preview" class="markdown writing-preview" hidden></div><p class="hint">支持 Markdown 与数学公式：行内 $…$，独立公式用单独成行的 $$。</p></section></div>`;
  let timer, active=true, busy=false, queue=Promise.resolve(), committed=false;
  let lastSaved = '';
  const snapshot = () => {
    const data=Object.fromEntries(new FormData($('#form')));
    const selectedDate = data.publication_date || '';
    const publishedAt = selectedDate && selectedDate !== originalDate ? Math.floor(new Date(selectedDate+'T00:00:00').getTime()/1000) : originalPublishedAt;
    return {...(publishedAt !== null ? {published_at:publishedAt} : {}),kind,record_id:draft.record_id || null,title:data.title || '',body:data.body || '',summary:data.summary || '',tags:data.tags || '',category:data.category || '',status:data.status || '进行中',repo_url:data.repo_url || '',demo_url:data.demo_url || '',published:data.is_private!=='on',featured:data.featured==='on',pinned:data.pinned==='on'};
  };
  const status = (message, failed=false) => { if(active){$('#draft-status').textContent=message;$('#draft-status').classList.toggle('save-failed',failed);$('#draft-retry').hidden=!failed;} };
  const flush = () => {
    clearTimeout(timer);
    const data=snapshot(), serialized=JSON.stringify(data);
    const operation=queue.catch(()=>{}).then(async () => {
      if (committed || (persisted && serialized===lastSaved)) return;
      status('正在保存草稿…');
      try {
        draft=await api('drafts/'+key,'PUT',data); persisted=true;lastSaved=serialized;
        status(JSON.stringify(snapshot())===lastSaved ? '草稿已保存 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) : '有新修改，等待保存…');
      } catch(error) {status(error.status===401 ? '登录已过期，输入仍保留。请先复制正文，再重新登录。' : '草稿未保存：'+error.message,true);throw error;}
    });
    queue=operation;return operation;
  };
  showForm(draft.record_id ? '编辑'+kinds[kind].name : '撰写'+kinds[kind].name,fields,async()=>{
    if(busy)throw new Error('图片正在处理，请稍候。');
    await flush();const result=await api('drafts/'+key+'/commit','POST',{});committed=true;clearTimeout(timer);
    await refreshContent(kind).catch(()=>toast('内容已保存，列表稍后刷新。'));toast(snapshot().published ? '已更新公开内容' : '内容已保存，仅自己可见');return result;
  },'保存内容',{writing:true});
  const headerStatus = $('#draft-header-status');
  $('#close').parentElement.insertBefore(headerStatus,$('#close'));
  lastSaved=JSON.stringify(snapshot());
  const body=$('#record-body'), form=$('#form');
  if(kind==='notes' && typeof document !== 'undefined'){
    const toolbar=$('.writing-toolbar');
    const importPanel=document.createElement('section');
    importPanel.className='markdown-import';
    importPanel.id='markdown-import';
    importPanel.innerHTML='<div><strong>从 Markdown 开始</strong><p class="hint">选择或拖入 .md 与图片；选择文件夹可保留相对图片路径。</p></div><button type="button" id="import-markdown" class="subtle">选择笔记和图片</button><button type="button" id="import-markdown-folder" class="subtle">选择文件夹</button><input id="markdown-file" type="file" multiple accept=".md,text/markdown,text/plain,image/png,image/jpeg,image/webp" hidden><input id="markdown-folder" type="file" webkitdirectory directory multiple accept=".md,text/markdown,text/plain,image/png,image/jpeg,image/webp" hidden>';
    toolbar.parentElement.insertBefore(importPanel,toolbar);
    const input=importPanel.querySelector('#markdown-file');
    const folderInput=importPanel.querySelector('#markdown-folder');
    const importFile=async files=>{
      const selected=Array.from(files || []), file=selected.find(item=>item.name.toLowerCase().endsWith('.md') || item.type === 'text/markdown' || item.type === 'text/plain');
      if(!file){toast('请选择 Markdown 文件（.md）。如需图片，请同时选中图片文件。');return;}
      if(body.value.trim() && !window.confirm('导入会替换当前笔记正文，是否继续？'))return;
      const parsed=parseMarkdownImport(await file.text(),file.webkitRelativePath || file.name);
      form.elements.title.value=parsed.title; body.value=parsed.body; form.elements.tags.value=parsed.tags;
      if(form.elements.category) form.elements.category.value=parsed.category;
      changed(); preview(false); status('已导入 Markdown，正在保存草稿…'); await flush();
      const imageFiles=selected.filter(item=>item!==file && /^image\/(?:png|jpe?g|webp)$/i.test(item.type));
      const references=markdownImageRefs(body.value), matchedFiles=new Map(references.map(ref=>[ref,markdownImageFile(ref,file.webkitRelativePath || file.name,imageFiles)]));
      const missing=[...new Set(references.filter(ref=>!matchedFiles.get(ref)).map(ref=>markdownImageName(ref.href)).filter(Boolean))];
      const replacements=new Map();
      if(references.length && imageFiles.length){
        await imageAction(async()=>{
          for(const ref of references){
            const name=markdownImagePath(ref.href), imageFile=matchedFiles.get(ref);
            if(!imageFile || replacements.has(name))continue;
            const image=await normalizedCover(imageFile); const result=await api('media','POST',{owner_type:'draft',owner_key:key,role:'inline',image}); replacements.set(name,result.url);
          }
        });
        if(replacements.size){ body.value=rewriteMarkdownImages(body.value,replacements); changed(); await flush(); }
      }
      if(missing.length) status(`文字已导入；未找到图片：${missing.slice(0,3).join('、')}${missing.length>3?'等':''}。请和图片一起选择。`);
      else if(replacements.size) status(`已导入 Markdown 和 ${replacements.size} 张图片。`);
      else if(references.length) status('文字已导入；请同时选择图片文件，图片才会保存到笔记。');
    };
    importPanel.querySelector('#import-markdown').onclick=()=>input.click();
    importPanel.querySelector('#import-markdown-folder').onclick=()=>folderInput.click();
    input.onchange=event=>{importFile(event.target.files).catch(error=>status('Markdown 未导入：'+error.message,true)).finally(()=>{input.value='';});};
    folderInput.onchange=event=>{importFile(event.target.files).catch(error=>status('Markdown 未导入：'+error.message,true)).finally(()=>{folderInput.value='';});};
    ['dragenter','dragover'].forEach(type=>importPanel.addEventListener(type,event=>{event.preventDefault();importPanel.classList.add('is-dragging');}));
    ['dragleave','drop'].forEach(type=>importPanel.addEventListener(type,event=>{event.preventDefault();importPanel.classList.remove('is-dragging');}));
    importPanel.addEventListener('drop',event=>importFile(event.dataTransfer.files).catch(error=>status('Markdown 未导入：'+error.message,true)));
  }
  dialogHasChanges=()=> !committed && JSON.stringify(snapshot())!==lastSaved;
  dialogBeforeLeave=async()=>{ if(busy){toast('图片正在处理，请稍候。');return false;} try{if(dialogHasChanges())await flush();return true;}catch{return false;} };
  const closed=()=>{active=false;clearTimeout(timer);headerStatus.remove();dialog.removeEventListener('close',closed);if(!committed&&persisted)refreshContent(kind).catch(()=>{});};
  dialog.addEventListener('close',closed);
  const update = () => {
    const count=Array.from(body.value).length;$('#body-count').textContent=`${count.toLocaleString('zh-CN')} / 50,000 字符`;
    body.setCustomValidity(count>50000?'正文最多 50,000 个字符，请缩短后再保存。':'');
    if(!$('#body-preview').hidden)$('#body-preview').innerHTML=markdown(body.value)||'<p class="hint">写下正文后，可以在这里预览。</p>';
    const published=!form.elements.is_private.checked;
    $('#save').textContent=published?(draft.record_id?'更新公开内容':'发布内容'):'保存为私密内容';
    $('#save-hint').textContent=published?'点击后访客才能看到这些修改':'点击后保存到私人内容列表';
  };
  const changed=()=>{update();clearTimeout(timer);status('有新修改，等待保存…');timer=setTimeout(()=>flush().catch(()=>{}),700);};
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  dialog.addEventListener('close',()=>{form.removeEventListener('input',changed);form.removeEventListener('change',changed);},{once:true});
  const preview=value=>{$('#body-label').hidden=value;$('#body-preview').hidden=!value;$('#write-mode').setAttribute('aria-pressed',String(!value));$('#preview-mode').setAttribute('aria-pressed',String(value));update();};
  $('#write-mode').onclick=()=>preview(false);$('#preview-mode').onclick=()=>preview(true);body.addEventListener('invalid',()=>preview(false));
  $('#draft-retry').onclick=()=>{if(!$('#save').disabled)flush().catch(()=>{});};
  $('#draft-close').onclick=async()=>{if(!$('#save').disabled && await dialogBeforeLeave())dialog.close();};
  const imageAction=async action=>{
    if(busy)return;busy=true;$('#save').disabled=true;$('#close').disabled=true;$('#fields').inert=true;
    try{await action();}catch(error){status('图片未保存：'+error.message,true);}finally{busy=false;$('#save').disabled=false;$('#close').disabled=false;$('#fields').inert=false;}
  };
  $('#insert-image').onclick=()=>$('#inline-file').click();
  $('#inline-file').onchange=event=>{
    const file=event.target.files[0];if(!file)return;const start=body.selectionStart,end=body.selectionEnd;
    imageAction(async()=>{const image=await normalizedCover(file);await flush();const result=await api('media','POST',{owner_type:'draft',owner_key:key,role:'inline',image});const alt=file.name.replace(/\.[^.]+$/,'').replace(/[\[\]\\\n]/g,' ');body.setRangeText(`\n![${alt}](${result.url})\n`,start,end,'end');changed();await flush();preview(false);body.focus();}).finally(()=>event.target.value='');
  };
  if(kind==='posts'||kind==='projects'){
    $('#draft-choose-cover').onclick=()=>$('#draft-cover-file').click();
    const pasteDraftCover = async (file) => {
      if (!file) return;
      await imageAction(async()=>{
        const image=await normalizedCover(file);
        await flush();
        const result=await api('media','POST',{owner_type:'draft',owner_key:key,role:'cover',image});
        $('#draft-cover-preview').innerHTML=`<img src="${esc(result.url)}" alt="草稿封面">`;
        $('#draft-cover-preview').hidden=false;
        $('#draft-remove-cover').hidden=false;
        status('封面已保存到草稿');
      });
    };
    const pasteButton = $('#draft-paste-cover');
    if (pasteButton) pasteButton.onclick = async () => {
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find(value => value.startsWith('image/'));
          if (type) { await pasteDraftCover(await item.getType(type)); return; }
        }
        status('剪贴板里没有图片，可先截屏再粘贴。');
      } catch { status('未能读取剪贴板，请在对话框内按 Ctrl/Cmd+V 粘贴截图。'); }
    };
    dialog.addEventListener('paste', async event => {
      if (!dialog.open) return;
      const item = Array.from(event.clipboardData?.items || []).find(entry => entry.kind === 'file' && entry.type.startsWith('image/'));
      if (!item) return;
      event.preventDefault();
      await pasteDraftCover(item.getAsFile());
    });
    $('#draft-cover-file').onchange=event=>{const file=event.target.files[0];if(!file)return;imageAction(async()=>{const image=await normalizedCover(file);await flush();const result=await api('media','POST',{owner_type:'draft',owner_key:key,role:'cover',image});$('#draft-cover-preview').innerHTML=`<img src="${esc(result.url)}" alt="草稿封面">`;$('#draft-cover-preview').hidden=false;$('#draft-remove-cover').hidden=false;status('封面已保存到草稿');}).finally(()=>event.target.value='');};
    $('#draft-remove-cover').onclick=()=>imageAction(async()=>{await flush();await api('drafts/'+key+'/cover','DELETE',{});$('#draft-cover-preview').hidden=true;$('#draft-cover-preview').innerHTML='';$('#draft-remove-cover').hidden=true;status('草稿已保存，发布时移除封面');});
  }
  update();
}
