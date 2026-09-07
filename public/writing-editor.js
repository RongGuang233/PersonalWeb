'use strict';
function renderDrafts() {
  const target = $('#draft-list'); if (!target) return;
  const drafts = privateDrafts.filter(row => row.kind === privateKind && [row.title,row.body].some(value => String(value || '').toLowerCase().includes(search.toLowerCase())));
  target.innerHTML = drafts.length ? `<section class="drafts"><div class="heading"><h2>继续草稿 <span>${drafts.length}</span></h2><span class="hint">仅自己可见</span></div>${drafts.map(row => `<div class="draft-row"><button class="draft-open" data-draft="${esc(row.key)}"><strong>${esc(row.title || '未命名草稿')}</strong><span>${row.record_id ? '已有内容的修改' : '尚未发布'} · ${new Date(row.updated*1000).toLocaleString('zh-CN')}</span></button><button data-discard-draft="${esc(row.key)}" aria-label="丢弃草稿：${esc(row.title || '未命名草稿')}">丢弃</button></div>`).join('')}</section>` : '';
  target.querySelectorAll('[data-draft]').forEach(button => button.onclick = () => openWritingEditor(privateKind, {}, button.dataset.draft).catch(error => toast(error.message)));
  target.querySelectorAll('[data-discard-draft]').forEach(button => button.onclick = () => {
    const draft = drafts.find(row => row.key === button.dataset.discardDraft);
    showForm('丢弃草稿', `<p>确定丢弃「${esc(draft.title || '未命名草稿')}」？${draft.record_id ? '已保存的正式内容不受影响。' : '草稿中的文字和图片将被移除。'}</p>`, async () => { await api('drafts/'+draft.key,'DELETE',{}); await refreshContent(privateKind); toast('草稿已丢弃'); }, '丢弃草稿');
  });
}
async function openWritingEditor(kind, record = {}, requestedKey) {
  const key = requestedKey || (record.id ? `record-${kind}-${record.id}` : crypto.randomUUID());
  let draft, persisted = false;
  try { draft = await api('drafts/'+key); persisted = true; }
  catch(error) { if(error.status !== 404) throw error; draft = {kind,record_id:record.id || null,published:!record.id,...record}; }
  const titleField = field('title','标题',draft.title,'text',true,'maxlength="4000"');
  const settings = (kind === 'posts' ? `<section class="cover-editor"><span>文章封面</span><div class="cover-preview" id="draft-cover-preview" ${draft.cover_url ? '' : 'hidden'}>${draft.cover_url ? `<img src="${esc(draft.cover_url)}" alt="草稿封面">` : ''}</div><input id="draft-cover-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="cover-editor-actions"><button type="button" id="draft-choose-cover">选择封面</button><button type="button" id="draft-remove-cover" ${draft.cover_url ? '' : 'hidden'}>移除</button></div><p class="hint">更换只保存到草稿，发布时生效。</p></section>`+field('tags','标签（可留空）',draft.tags)+area('summary','摘要（可留空）',draft.summary,3,4000) : '') + `<label class="checkbox-label"><input type="checkbox" name="is_private" ${draft.published !== true ? 'checked' : ''}><span>仅自己可见<small>勾选后设为私密。自动保存的草稿始终仅自己可见。</small></span></label>` + (kind === 'posts' ? `<label class="checkbox-label"><input type="checkbox" name="featured" ${draft.featured ? 'checked' : ''}><span>首页精选<small>首页展示最多 3 篇精选文章。</small></span></label><label class="checkbox-label"><input type="checkbox" name="pinned" ${draft.pinned ? 'checked' : ''}><span>置顶文章<small>优先显示在博客列表和首页精选。</small></span></label>` : '');
  const fields = `<div class="draft-status-row"><span id="draft-status" role="status">${persisted ? '已恢复服务器草稿' : draft.record_id ? '已载入当前内容，修改后自动保存草稿' : '输入后自动保存草稿'}</span><button type="button" id="draft-retry" hidden>重试保存</button><button type="button" id="draft-close">保存草稿并关闭</button></div>`+titleField+`<div class="writing-layout"><section class="writing-main" aria-label="正文编辑"><div class="writing-toolbar"><div class="writing-switch"><button type="button" id="write-mode" aria-pressed="true">编辑</button><button type="button" id="preview-mode" aria-pressed="false">预览</button></div><button type="button" id="insert-image">插入图片</button><output id="body-count" for="record-body"></output></div><input id="inline-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><label id="body-label">正文<textarea id="record-body" name="body" rows="14" maxlength="100000" aria-describedby="body-count">${esc(draft.body)}</textarea></label><div id="body-preview" class="markdown writing-preview" hidden></div><p class="hint">支持 Markdown、表格、代码与数学公式。行内公式用 $…$，独立公式用单独成行的 $$ 包围。图片随文章发布，草稿图片仅自己可见。</p></section><details class="writing-settings" ${window.innerWidth > 650 ? 'open' : ''}><summary>发布设置${kind === 'posts' ? ' · 封面与摘要' : ''}</summary><div class="writing-settings-fields">${settings}</div></details></div>`;
  let timer, active=true, busy=false, queue=Promise.resolve(), committed=false;
  let lastSaved = '';
  const snapshot = () => {
    const data=Object.fromEntries(new FormData($('#form')));
    return {kind,record_id:draft.record_id || null,title:data.title || '',body:data.body || '',summary:data.summary || '',tags:data.tags || '',published:data.is_private!=='on',featured:data.featured==='on',pinned:data.pinned==='on'};
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
  lastSaved=JSON.stringify(snapshot());
  const body=$('#record-body'), form=$('#form');
  dialogHasChanges=()=> !committed && JSON.stringify(snapshot())!==lastSaved;
  dialogBeforeLeave=async()=>{ if(busy){toast('图片正在处理，请稍候。');return false;} try{if(dialogHasChanges())await flush();return true;}catch{return false;} };
  const closed=()=>{active=false;clearTimeout(timer);dialog.removeEventListener('close',closed);if(!committed&&persisted)refreshContent(kind).catch(()=>{});};
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
  $('#draft-retry').onclick=()=>flush().catch(()=>{});
  $('#draft-close').onclick=async()=>{if(await dialogBeforeLeave())dialog.close();};
  const imageAction=async action=>{
    if(busy)return;busy=true;$('#save').disabled=true;$('#close').disabled=true;$('#fields').inert=true;
    try{await action();}catch(error){status('图片未保存：'+error.message,true);}finally{busy=false;$('#save').disabled=false;$('#close').disabled=false;$('#fields').inert=false;}
  };
  $('#insert-image').onclick=()=>$('#inline-file').click();
  $('#inline-file').onchange=event=>{
    const file=event.target.files[0];if(!file)return;const start=body.selectionStart,end=body.selectionEnd;
    imageAction(async()=>{const image=await normalizedCover(file);await flush();const result=await api('media','POST',{owner_type:'draft',owner_key:key,role:'inline',image});const alt=file.name.replace(/\.[^.]+$/,'').replace(/[\[\]\\\n]/g,' ');body.setRangeText(`\n![${alt}](${result.url})\n`,start,end,'end');changed();await flush();preview(false);body.focus();}).finally(()=>event.target.value='');
  };
  if(kind==='posts'){
    $('#draft-choose-cover').onclick=()=>$('#draft-cover-file').click();
    $('#draft-cover-file').onchange=event=>{const file=event.target.files[0];if(!file)return;imageAction(async()=>{const image=await normalizedCover(file);await flush();const result=await api('media','POST',{owner_type:'draft',owner_key:key,role:'cover',image});$('#draft-cover-preview').innerHTML=`<img src="${esc(result.url)}" alt="草稿封面">`;$('#draft-cover-preview').hidden=false;$('#draft-remove-cover').hidden=false;status('封面已保存到草稿');}).finally(()=>event.target.value='');};
    $('#draft-remove-cover').onclick=()=>imageAction(async()=>{await flush();await api('drafts/'+key+'/cover','DELETE',{});$('#draft-cover-preview').hidden=true;$('#draft-cover-preview').innerHTML='';$('#draft-remove-cover').hidden=true;status('草稿已保存，发布时移除封面');});
  }
  update();
}
