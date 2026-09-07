"""Run against an installed release using only a disposable database and loopback port."""
import base64, io, os, sys, tempfile, secrets, socket, subprocess, time, json, urllib.request, urllib.error, http.cookiejar, sqlite3, zipfile
from pathlib import Path
sys.dont_write_bytecode = True
release=Path(sys.argv[1]);sys.path.insert(0,str(release))
import server

def ensure(condition,label):
    if not condition: raise AssertionError(label)

with tempfile.TemporaryDirectory(prefix='personal-site-acceptance-') as temp:
    server.DB=Path(temp)/'test.sqlite3';server.init()
    username='acceptance';password=secrets.token_urlsafe(24)
    server.set_account(username,password)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    origin=f'http://127.0.0.1:{port}'
    env=dict(os.environ,SITE_DB=str(server.DB),SITE_ORIGIN=origin,PYTHONDONTWRITEBYTECODE='1')
    jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    anonymous=urllib.request.build_opener()
    process=None
    def request(path,method='GET',data=None,auth=True):
        req=urllib.request.Request(origin+path,method=method,headers={'Origin':origin,'Content-Type':'application/json'},data=json.dumps(data).encode() if data is not None else None)
        try:
            with (client if auth else anonymous).open(req,timeout=6) as response:
                body=response.read();return response.status,json.loads(body) if response.headers.get_content_type()=='application/json' else body
        except urllib.error.HTTPError as error:
            with error:return error.code,None
    def start():
        global process
        process=subprocess.Popen([sys.executable,str(release/'server.py'),'--port',str(port)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for attempt in range(40):
            try:
                if request('/')[0]==200:return
            except urllib.error.URLError:pass
            time.sleep(.1)
        raise AssertionError('test process startup')
    def stop():
        if process is not None:
            process.terminate();process.wait(timeout=5)
    def login():ensure(request('/api/login','POST',{'username':username,'password':password})[0]==200,'login')
    def get_record(kind,ident,public=False):
        status,body=request('/api/public' if public else '/api/'+kind,auth=not public)
        ensure(status==200,'read '+kind)
        rows=body[kind] if public else body
        matches=[row for row in rows if row['id']==ident]
        ensure(len(matches)==1,'record present '+kind)
        return matches[0]
    def upload_media(owner_type,owner_key,role,image):
        status,result=request('/api/media','POST',dict(image,owner_type=owner_type,owner_key=str(owner_key),role=role))
        ensure(status==200 and isinstance(result,dict) and isinstance(result.get('url'),str),'upload '+role)
        ensure(result['url'].startswith('/media/') and result['url'].endswith('.jpg'),'media URL '+role)
        return result['url']
    def inspect_export(path,expected_markdown,expected_images):
        ensure(request(path,auth=False)[0]==401,'anonymous export boundary '+path)
        status,raw=request(path)
        ensure(status==200 and isinstance(raw,bytes),'owner export '+path)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            ensure(archive.testzip() is None,'readable ZIP entries '+path)
            for name in archive.namelist():
                if name.endswith('.md'):archive.read(name).decode('utf-8')
            for name,snippets in expected_markdown.items():
                text=archive.read(name).decode('utf-8')
                ensure(all(snippet in text for snippet in snippets),'Chinese Markdown export '+name)
            for name,image in expected_images.items():
                ensure(archive.read(name)==image,'image bytes export '+name)
    try:
        start()
        for path in ['/private','/api/session','/api/profile','/api/drafts','/api/export.zip']+['/api/'+kind for kind in server.KINDS]:
            ensure(request(path,auth=False)[0]==401,'anonymous boundary')
        ensure(request('/api/avatar','POST',{},auth=False)[0]==401,'avatar upload boundary')
        ensure(request('/api/avatar','DELETE',{},auth=False)[0]==401,'avatar delete boundary')
        ensure(request('/api/drafts/anonymous','PUT',{'kind':'notes'},auth=False)[0]==401,'draft write boundary')
        ensure(request('/api/media','POST',{},auth=False)[0]==401,'media write boundary')
        status,public=request('/api/public',auth=False)
        ensure(status==200 and set(public)=={'profile',*server.KINDS},'public response')
        ensure(all(public[kind]==[] for kind in server.KINDS),'empty public content')
        ensure(public['profile']=={'name':server.DEFAULT_NAME,'bio':server.DEFAULT_BIO,'avatar_url':None,'background_url':None},'default profile')
        ensure(request('/cover.jpg',auth=False)[0]==200,'cover image')
        ensure(request('/avatar.png',auth=False)[0]==404,'no initial avatar')
        ensure(request('/data/site.sqlite3',auth=False)[0]==404,'database static boundary')
        ensure(request('/api/login','POST',{'username':username,'password':secrets.token_urlsafe(24)})[0]==401,'bad password')
        login();ensure(request('/private')[0]==200,'private page')
        cover_bytes=(release/'public/cover.jpg').read_bytes()
        cover_payload={'image':'data:image/jpeg;base64,'+base64.b64encode(cover_bytes).decode()}
        for kind in server.KINDS:
            ensure(request('/api/'+kind)[1]==[],'initial empty kind')
            record={'title':'acceptance-only','url':origin,'category':'动漫','rating':None,'body':'# temporary note'}
            status,created=request('/api/'+kind,'POST',record);ensure(status==201,'create '+kind)
            ident=created['id'];record['title']='edited-only'
            if kind in ('posts','notes'):record['body']='中😀'*25000
            ensure(request(f'/api/{kind}/{ident}','PUT',record)[0]==200,'edit '+kind)
            saved=request('/api/'+kind)[1][0]
            ensure(saved['title']=='edited-only' and saved['published'] is False,'read private '+kind)
            if kind in ('posts','notes'):ensure(saved['body']==record['body'],'50000 character text preserved '+kind)
            ensure(request('/api/public',auth=False)[1][kind]==[],'private content excluded '+kind)
            if kind in ('posts','works'):
                ensure(request(f'/api/{kind}/{ident}/cover','POST',cover_payload)[0]==200,'upload private cover '+kind)
                ensure(request(f'/covers/{ident}.jpg',auth=False)[0]==404,'private cover boundary '+kind)
                ensure(request(f'/covers/{ident}.jpg')[1]==cover_bytes,'private owner cover '+kind)
            record['published']=True
            ensure(request(f'/api/{kind}/{ident}','PUT',record)[0]==200,'publish '+kind)
            ensure([row['id'] for row in request('/api/public',auth=False)[1][kind]]==[ident],'public content '+kind)
            if kind in ('posts','works'):
                ensure(request(f'/covers/{ident}.jpg',auth=False)[1]==cover_bytes,'public cover '+kind)
            del record['published']
            ensure(request(f'/api/{kind}/{ident}','PUT',record)[0]==200,'edit published '+kind)
            ensure(request('/api/public',auth=False)[1][kind][0]['published'] is True,'retain publish state '+kind)
            record['published']=False
            ensure(request(f'/api/{kind}/{ident}','PUT',record)[0]==200,'unpublish '+kind)
            ensure(request('/api/public',auth=False)[1][kind]==[],'unpublished content excluded '+kind)
            if kind in ('posts','works'):
                ensure(request(f'/covers/{ident}.jpg',auth=False)[0]==404,'unpublished cover boundary '+kind)
            ensure(request(f'/api/{kind}/{ident}','DELETE',{})[0]==200,'delete '+kind)
            if kind in ('posts','works'):
                ensure(request(f'/covers/{ident}.jpg')[0]==404,'cover removed with record '+kind)
            ensure(request('/api/'+kind)[1]==[],'empty after delete')
        for category in server.CATEGORIES:
            ensure(request('/api/works','POST',{'title':'temporary '+category,'category':category,'rating':None})[0]==201,'seven categories')
        ensure(request('/api/works','POST',{'title':'bad','category':'电影','rating':11})[0]==400,'rating bounds')
        ensure(request('/api/services')[0]==404,'removed services API')
        profile={'name':'Acceptance only','bio':'Temporary profile'}
        ensure(request('/api/profile','PUT',profile)[0]==200,'edit profile')
        avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
        ensure(request('/api/avatar','POST',{'image':avatar})[0]==200,'upload avatar')
        ensure(request('/avatar.png',auth=False)[1]==base64.b64decode(avatar.split(',',1)[1]),'public avatar')
        cover_id=request('/api/works')[1][0]['id']
        ensure(request(f'/api/works/{cover_id}/cover','POST',cover_payload)[0]==200,'cover before restart')

        note_key='acceptance-empty-title'
        note_body='\n# 尚未命名的笔记\n中文和 emoji 🌱，保持草稿空白。\n  '
        status,note_draft=request('/api/drafts/'+note_key,'PUT',{'kind':'notes','title':'','body':note_body})
        ensure(status==200 and note_draft['title']=='' and note_draft['body']==note_body,'empty title draft saved')
        ensure(request('/api/drafts/'+note_key)[1]['body']==note_body,'restore draft over HTTP')
        ensure(any(row['key']==note_key for row in request('/api/drafts')[1]),'draft list includes saved note')
        ensure(request('/api/notes')[1]==[],'draft is separate from saved notes')

        original_post={'title':'已公开的验收文章','body':'# 原有正文\n访客只能看到这段。','published':True,'featured':True,'pinned':True}
        status,created=request('/api/posts','POST',original_post)
        ensure(status==201,'create published article for draft isolation')
        post_id=created['id']
        ensure(request(f'/api/posts/{post_id}/cover','POST',cover_payload)[0]==200,'original public article cover')
        status,plain_post=request('/api/posts','POST',{'title':'普通的验收文章','body':'非置顶正文','published':True})
        ensure(status==201,'create unpinned comparison article')
        post_key='acceptance-public-edit'
        status,post_draft=request('/api/drafts/'+post_key,'PUT',{'kind':'posts','record_id':post_id})
        ensure(status==200 and post_draft['body']==original_post['body'],'draft starts from saved article')
        inline_url=upload_media('draft',post_key,'inline',cover_payload)
        ensure(request(inline_url,auth=False)[0]==404,'draft inline image private')
        ensure(request(inline_url)[1]==cover_bytes,'owner reads draft inline image')
        new_body='# 更新后的中文正文\n这是尚未提交的改动。\n\n![验收图片]('+inline_url+')'
        status,post_draft=request('/api/drafts/'+post_key,'PUT',{'title':'更新后的验收文章','body':new_body})
        ensure(status==200 and post_draft['body']==new_body,'save article draft with inline image')
        comment=b'acceptance-only distinct cover'
        changed_cover=cover_bytes[:2]+b'\xff\xfe'+(len(comment)+2).to_bytes(2,'big')+comment+cover_bytes[2:]
        changed_payload={'image':'data:image/jpeg;base64,'+base64.b64encode(changed_cover).decode()}
        draft_cover_url=upload_media('draft',post_key,'cover',changed_payload)
        ensure(request(draft_cover_url,auth=False)[0]==404,'draft cover private')
        ensure(request(draft_cover_url)[1]==changed_cover,'owner reads replacement draft cover')
        ensure(get_record('posts',post_id,public=True)['body']==original_post['body'],'draft does not replace public body')
        ensure(request(f'/covers/{post_id}.jpg',auth=False)[1]==cover_bytes,'draft does not replace public cover')

        friend_ids=[]
        for title,order in [('后显示的友链',20),('先显示的友链',-5)]:
            status,friend=request('/api/friends','POST',{'title':title,'url':origin,'notes':'仅用于临时验收','order':order})
            ensure(status==201,'create ordered friend')
            friend_ids.append(friend['id'])
        friend_avatar_url=upload_media('friend',friend_ids[1],'avatar',cover_payload)
        ensure(request(friend_avatar_url,auth=False)[0]==404,'private friend avatar boundary')
        for friend_id in friend_ids:
            friend=get_record('friends',friend_id);friend['published']=True
            ensure(request(f'/api/friends/{friend_id}','PUT',friend)[0]==200,'publish friend')
        ensure([row['id'] for row in request('/api/friends')[1]]==friend_ids[::-1],'owner friend order')
        ensure([row['id'] for row in request('/api/public',auth=False)[1]['friends']]==friend_ids[::-1],'public friend order')
        ensure(request(friend_avatar_url,auth=False)[1]==cover_bytes,'public friend avatar')
        background_url=upload_media('profile','1','background',changed_payload)
        ensure(request('/api/profile')[1]['background_url']==background_url,'profile returns background URL')
        ensure(request(background_url,auth=False)[1]==changed_cover,'public profile background')

        stop();start()
        ensure(request(f'/covers/{cover_id}.jpg')[1]==cover_bytes,'cover survives restart')
        ensure(request('/api/session')[0]==200,'session survives process restart')
        works=request('/api/works')[1];ensure(len(works)==7 and all(r['rating'] is None and r['published'] is False for r in works),'records survive process restart')
        ensure(request('/api/public',auth=False)[1]['works']==[],'private content after restart')
        ensure(request('/api/profile')[1]==dict(profile,avatar_url='/avatar.png',background_url=background_url),'profile survives restart')
        ensure(request('/avatar.png',auth=False)[1]==base64.b64decode(avatar.split(',',1)[1]),'avatar survives restart')
        ensure(request(background_url,auth=False)[1]==changed_cover,'profile background survives restart')
        ensure(request('/api/drafts/'+note_key)[1]['body']==note_body,'empty-title draft survives restart')
        ensure(request('/api/drafts/'+note_key)[1]['title']=='','empty draft title survives restart')
        restored_draft=request('/api/drafts/'+post_key)[1]
        ensure(restored_draft['body']==new_body and restored_draft['cover_url']==draft_cover_url,'article draft state survives restart')
        ensure({row['key'] for row in request('/api/drafts')[1]}=={note_key,post_key},'draft list survives restart')
        ensure(request(inline_url)[1]==cover_bytes and request(inline_url,auth=False)[0]==404,'draft inline media survives restart privately')
        ensure(request(draft_cover_url)[1]==changed_cover and request(draft_cover_url,auth=False)[0]==404,'draft cover survives restart privately')
        saved_post=get_record('posts',post_id,public=True)
        ensure(saved_post['body']==original_post['body'] and saved_post['featured'] is True and saved_post['pinned'] is True,'public body and featured/pinned survive restart')
        ensure([row['id'] for row in request('/api/public',auth=False)[1]['posts']]==[post_id,plain_post['id']],'pinned article sorts before newer unpinned article')
        ensure(request(f'/covers/{post_id}.jpg',auth=False)[1]==cover_bytes,'draft cover remains separate after restart')
        saved_friend=get_record('friends',friend_ids[1],public=True)
        ensure(saved_friend['order']==-5 and saved_friend['avatar_url']==friend_avatar_url,'friend order and avatar URL survive restart')
        ensure([row['id'] for row in request('/api/public',auth=False)[1]['friends']]==friend_ids[::-1],'friend ordering survives restart')
        ensure(request(friend_avatar_url,auth=False)[1]==cover_bytes,'friend avatar bytes survive restart')

        status,committed=request('/api/drafts/'+post_key+'/commit','POST',{})
        ensure(status==200 and committed=={'id':post_id,'kind':'posts'},'commit article draft')
        ensure(request('/api/drafts/'+post_key)[0]==404,'committed draft removed')
        ensure(get_record('posts',post_id,public=True)['body']==new_body,'commit updates public body')
        ensure(request(inline_url,auth=False)[1]==cover_bytes,'committed inline media becomes public')
        ensure(request(f'/covers/{post_id}.jpg',auth=False)[1]==changed_cover,'commit publishes replacement cover')
        inline_name=Path(inline_url).name
        markdown_name=f'posts/{post_id}.md'
        exported_images={'images/'+inline_name:cover_bytes,f'images/cover-{post_id}.jpg':changed_cover}
        inspect_export(f'/api/export/posts/{post_id}.zip',
                       {markdown_name:['更新后的验收文章','更新后的中文正文','../images/'+inline_name]},exported_images)
        saved_post=get_record('posts',post_id);saved_post['published']=False
        ensure(request(f'/api/posts/{post_id}','PUT',saved_post)[0]==200,'unpublish article with inline media')
        ensure(request(inline_url,auth=False)[0]==404 and request(f'/covers/{post_id}.jpg',auth=False)[0]==404,'unpublishing hides inline media and cover')
        ensure(request(inline_url)[1]==cover_bytes,'owner retains unpublished inline media')
        exported_images.update({'images/'+Path(friend_avatar_url).name:cover_bytes,
                                'images/profile-background.jpg':changed_cover,
                                'images/profile-avatar.png':base64.b64decode(avatar.split(',',1)[1])})
        inspect_export('/api/export.zip',
                       {markdown_name:['更新后的中文正文','published: false','../images/'+inline_name],
                        'drafts/'+note_key+'.md':['未命名草稿',note_body],
                        f'friends/{friend_ids[1]}.md':['先显示的友链','order: -5']},exported_images)
        ensure(request('/api/avatar','DELETE',{})[0]==200,'delete avatar')
        ensure(request('/avatar.png',auth=False)[0]==404,'avatar removed')
        ensure(request('/api/logout','POST',{})[0]==200,'logout')
        ensure(request('/api/session')[0]==401,'logout invalidation');login()
        with server.connect() as connection:connection.execute('UPDATE sessions SET expires=?',(time.time()-1,))
        ensure(request('/api/session')[0]==401,'expired session')
        print('PASS actual Python '+sys.version.split()[0]+': login/logout/expiry, five CRUD, 50000 character text, public/private content, seven categories/unrated, drafts/inline media/cover isolation and commit, readable Chinese Markdown+image ZIP exports, featured/pinned, friend order/avatar, profile background, process restart persistence')
    finally:
        stop()
print('PASS disposable database and account removed; formal database untouched')
