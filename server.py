"""Single-user private workspace. Python 3.10+, standard library only."""
from contextlib import contextmanager
import argparse, base64, binascii, getpass, hashlib, hmac, io, json, os, re, secrets, sqlite3, struct, time, zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from http.cookies import SimpleCookie
from cover_search import search_covers, fetch_cover_image, CoverSourceError

ROOT = Path(__file__).parent
DB = Path(os.environ.get('SITE_DB', ROOT / 'data/site.sqlite3'))
CATEGORIES = ['动漫','漫画','游戏','小说','电影','电视剧','出版书籍']
KINDS = ['posts','notes','friends','works','bookmarks']
DEFAULT_NAME = 'RongGuang233'
DEFAULT_BIO = '写下想法，记录生活中的喜欢。'
AVATAR_LIMIT = 1024 * 1024
COVER_LIMIT = 2 * 1024 * 1024
COVER_KINDS = ('posts','works')
TEXT_REQUEST_LIMIT = 1024 * 1024
RECORD_SELECT = """SELECT records.*,record_covers.record_id IS NOT NULL AS has_cover,friend_avatar.id AS friend_avatar_id
    FROM records LEFT JOIN record_covers ON record_covers.record_id=records.id
    LEFT JOIN media AS friend_avatar ON friend_avatar.owner_type='friend' AND friend_avatar.owner_key=CAST(records.id AS TEXT) AND friend_avatar.role='avatar'"""

@contextmanager
def connect():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    try:
        with c:
            yield c
    finally:
        c.close()

def init():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT, salt TEXT, password TEXT);
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires REAL);
        CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, kind TEXT, data TEXT, updated REAL);
        CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, bio TEXT NOT NULL, avatar BLOB);
        CREATE TABLE IF NOT EXISTS record_covers (record_id INTEGER PRIMARY KEY, image BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS drafts (key TEXT PRIMARY KEY, kind TEXT NOT NULL, record_id INTEGER, data TEXT NOT NULL, cover_action TEXT NOT NULL DEFAULT 'keep', updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_key TEXT NOT NULL, role TEXT NOT NULL, image BLOB NOT NULL);''')
        c.execute('INSERT OR IGNORE INTO profile(id,name,bio) VALUES (1,?,?)', (DEFAULT_NAME,DEFAULT_BIO))
    os.chmod(DB, 0o600)

def digest(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def set_account(username, password):
    if not username.strip() or len(password) < 12: raise ValueError('用户名不能为空，密码至少 12 位')
    salt = secrets.token_hex(16)
    with connect() as c:
        c.execute('INSERT OR REPLACE INTO account VALUES (1,?,?,?)', (username.strip(),salt,digest(password,salt)))
        c.execute('DELETE FROM sessions')

def validate(kind, data, previous=None, draft=False):
    fields = {'posts':['title','body','summary','tags'], 'friends':['title','url','notes'], 'bookmarks':['title','url','tags','notes'], 'notes':['title','body'], 'works':['title','category','progress','rating','notes']}[kind]
    d = {k: data.get(k,'') for k in fields}
    for k,v in d.items():
        if k == 'rating': continue
        if not isinstance(v,str) or len(v)> (50000 if k=='body' else 4000): raise ValueError('字段过长或格式错误')
        d[k] = v if draft and k=='body' else v.strip()
    if not d['title'] and not draft: raise ValueError('请填写名称或标题')
    for k in ['url']:
        if k in d and d[k]:
            u=urlsplit(d[k])
            if u.scheme not in ('http','https') or not u.hostname or u.username or u.password: raise ValueError('请输入不包含账号密码的 HTTP(S) 地址')
    if kind in ('friends','bookmarks') and not d['url']: raise ValueError('请填写链接')
    if kind=='works':
        if d['category'] not in CATEGORIES: raise ValueError('请选择作品分类')
        if d['rating'] in ('',None): d['rating']=None
        else:
            d['rating']=float(d['rating'])
            if not 0<=d['rating']<=10: raise ValueError('评分范围为 0–10')
    # A partial update must not silently publish or unpublish existing content.
    d['published'] = data.get('published',(previous or {}).get('published') is True)
    if not isinstance(d['published'],bool): raise ValueError('公开状态必须为 true 或 false')
    if kind=='posts':
        for field in ('featured','pinned'):
            d[field]=data.get(field,(previous or {}).get(field,False))
            if not isinstance(d[field],bool): raise ValueError('精选和置顶状态必须为 true 或 false')
    if kind=='friends':
        d['order']=data.get('order',(previous or {}).get('order',0))
        if type(d['order']) is not int or not -1000000<=d['order']<=1000000: raise ValueError('友链排序须为 -1000000 到 1000000 的整数')
    return d

def profile_data(c):
    row=c.execute('SELECT name,bio,avatar IS NOT NULL AS has_avatar FROM profile WHERE id=1').fetchone()
    background=c.execute("SELECT id FROM media WHERE owner_type='profile' AND owner_key='1' AND role='background'").fetchone()
    return {'name':row['name'],'bio':row['bio'],'avatar_url':'/avatar.png' if row['has_avatar'] else None,'background_url':media_url(background['id']) if background else None}

def record_data(row):
    d=json.loads(row['data'])
    d.pop('cover_url',None)
    if row['kind'] in COVER_KINDS:
        d['cover_url']=f"/covers/{row['id']}.jpg" if row['has_cover'] else None
    if row['kind']=='posts':
        d.update(featured=d.get('featured') is True,pinned=d.get('pinned') is True)
    if row['kind']=='friends':
        d.update(order=d.get('order',0),avatar_url=media_url(row['friend_avatar_id']) if row['friend_avatar_id'] else None)
    return dict(d,id=row['id'],updated=row['updated'],published=d.get('published') is True)

def avatar_data(data):
    image=data.get('image')
    prefix='data:image/png;base64,'
    if not isinstance(image,str) or not image.startswith(prefix): raise ValueError('请上传 PNG 格式的头像')
    try: raw=base64.b64decode(image[len(prefix):],validate=True)
    except (ValueError,binascii.Error): raise ValueError('头像图片编码无效') from None
    if len(raw)>AVATAR_LIMIT: raise ValueError('头像不能超过 1 MiB')
    if len(raw)<33 or raw[:8]!=b'\x89PNG\r\n\x1a\n' or raw[8:16]!=b'\x00\x00\x00\rIHDR': raise ValueError('头像 PNG 图片无效')
    width,height=struct.unpack('>II',raw[16:24])
    if not (1<=width<=1024 and 1<=height<=1024): raise ValueError('头像宽高须在 1–1024 像素内')
    return raw

def cover_data(data):
    image=data.get('image')
    prefix='data:image/jpeg;base64,'
    if not isinstance(image,str) or not image.startswith(prefix): raise ValueError('请上传 JPEG 格式的封面')
    try: raw=base64.b64decode(image[len(prefix):],validate=True)
    except (ValueError,binascii.Error): raise ValueError('封面图片编码无效') from None
    if len(raw)>COVER_LIMIT: raise ValueError('封面不能超过 2 MiB')
    invalid='封面 JPEG 图片无效'
    if not raw.startswith(b'\xff\xd8\xff') or not raw.endswith(b'\xff\xd9'): raise ValueError(invalid)
    # Check the frame and segment boundaries of the browser-generated JPEG.
    offset=2; has_frame=False
    while offset<len(raw)-2:
        if raw[offset]!=0xff: raise ValueError(invalid)
        while offset<len(raw) and raw[offset]==0xff: offset+=1
        if offset>=len(raw)-2: raise ValueError(invalid)
        marker=raw[offset]; offset+=1
        if marker in (0x00,0xd8,0xd9) or 0xd0<=marker<=0xd7: raise ValueError(invalid)
        length=int.from_bytes(raw[offset:offset+2],'big')
        if length<2 or offset+length>len(raw)-2: raise ValueError(invalid)
        segment=raw[offset+2:offset+length]; offset+=length
        if marker in (0xc0,0xc1,0xc2):
            if len(segment)<6: raise ValueError(invalid)
            height,width=struct.unpack('>HH',segment[1:5]); components=segment[5]
            if not height or not width or not components or len(segment)!=6+3*components: raise ValueError(invalid)
            has_frame=True
        elif marker==0xda:
            if not has_frame or not segment or not segment[0] or len(segment)!=4+2*segment[0] or offset>=len(raw)-2: raise ValueError(invalid)
            return raw
    raise ValueError(invalid)


def media_url(ident):
    return f'/media/{ident}.jpg'

def body_media(data):
    return set(re.findall(r'/media/([a-f0-9]{32})\.jpg',data.get('body','')))

def draft_data(c,row):
    result=dict(json.loads(row['data']),key=row['key'],kind=row['kind'],record_id=row['record_id'],updated=row['updated'],cover_url=None)
    if row['kind']=='posts':
        if row['cover_action']=='replace':
            cover=c.execute("SELECT id FROM media WHERE owner_type='draft' AND owner_key=? AND role='cover'",(row['key'],)).fetchone()
            if cover: result['cover_url']=media_url(cover['id'])
        elif row['cover_action']=='keep' and row['record_id'] is not None:
            if c.execute('SELECT 1 FROM record_covers WHERE record_id=?',(row['record_id'],)).fetchone(): result['cover_url']=f"/covers/{row['record_id']}.jpg"
    return result

def save_draft(c,key,data):
    old=c.execute('SELECT * FROM drafts WHERE key=?',(key,)).fetchone()
    kind=data.get('kind',old['kind'] if old else None)
    record_id=data.get('record_id',old['record_id'] if old else None)
    if kind not in ('posts','notes'): raise ValueError('草稿仅支持博客和笔记')
    if record_id is not None and (type(record_id) is not int or record_id<1): raise ValueError('关联记录无效')
    if old and (kind!=old['kind'] or record_id!=old['record_id']): raise ValueError('草稿不能更换所属内容')
    record=c.execute('SELECT * FROM records WHERE id=? AND kind=?',(record_id,kind)).fetchone() if record_id is not None else None
    if record_id is not None and record is None: return None
    previous=json.loads(old['data']) if old else json.loads(record['data']) if record else {}
    merged=dict(previous,**data)
    d=validate(kind,merged,previous,draft=True)
    # Boolean editor flags are validated even if they do not apply to notes.
    for flag in ('featured','pinned'):
        if flag in data and not isinstance(data[flag],bool): raise ValueError('精选和置顶状态必须为 true 或 false')
    c.execute("INSERT INTO drafts(key,kind,record_id,data,updated) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated=excluded.updated",(key,kind,record_id,json.dumps(d),time.time()))
    return draft_data(c,c.execute('SELECT * FROM drafts WHERE key=?',(key,)).fetchone())

def cleanup_record_media(c,record_id):
    record=c.execute('SELECT data FROM records WHERE id=?',(record_id,)).fetchone()
    keep=body_media(json.loads(record['data'])) if record else set()
    for row in c.execute('SELECT data FROM drafts WHERE record_id=?',(record_id,)):
        keep.update(body_media(json.loads(row['data'])))
    for row in c.execute("SELECT id FROM media WHERE owner_type='record' AND owner_key=?",(str(record_id),)).fetchall():
        if row['id'] not in keep: c.execute('DELETE FROM media WHERE id=?',(row['id'],))

def discard_draft(c,row):
    c.execute("DELETE FROM media WHERE owner_type='draft' AND owner_key=?",(row['key'],))
    c.execute('DELETE FROM drafts WHERE key=?',(row['key'],))
    if row['record_id'] is not None: cleanup_record_media(c,row['record_id'])

def check_content_media(c,data,record_id=None,draft_key=None):
    for ident in body_media(data):
        media=c.execute('SELECT * FROM media WHERE id=?',(ident,)).fetchone()
        if not media or media['role']!='inline': raise ValueError('正文包含不可用图片，请重新插入')
        owned_record=record_id is not None and media['owner_type']=='record' and media['owner_key']==str(record_id)
        owned_draft=draft_key is not None and media['owner_type']=='draft' and media['owner_key']==draft_key
        if not (owned_record or owned_draft): raise ValueError('正文图片不属于这条内容')

def commit_draft(c,row):
    d=validate(row['kind'],json.loads(row['data']))
    ident=row['record_id']
    check_content_media(c,d,ident,row['key'])
    if ident is None:
        ident=c.execute('INSERT INTO records(kind,data,updated) VALUES (?,?,?)',(row['kind'],json.dumps(d),time.time())).lastrowid
    else:
        c.execute('UPDATE records SET data=?,updated=? WHERE id=?',(json.dumps(d),time.time(),ident))
    if row['kind']=='posts' and row['cover_action']=='replace':
        cover=c.execute("SELECT image FROM media WHERE owner_type='draft' AND owner_key=? AND role='cover'",(row['key'],)).fetchone()
        if not cover: raise ValueError('草稿封面不可用，请重新选择')
        c.execute('INSERT INTO record_covers(record_id,image) VALUES (?,?) ON CONFLICT(record_id) DO UPDATE SET image=excluded.image',(ident,cover['image']))
    elif row['cover_action']=='remove': c.execute('DELETE FROM record_covers WHERE record_id=?',(ident,))
    for media_id in body_media(d):
        c.execute("UPDATE media SET owner_type='record',owner_key=? WHERE id=? AND owner_type='draft' AND owner_key=?",(str(ident),media_id,row['key']))
    discard_draft(c,row)
    cleanup_record_media(c,ident)
    return {'id':ident,'kind':row['kind']}

def delete_record(c,record_id):
    for draft in c.execute('SELECT * FROM drafts WHERE record_id=?',(record_id,)).fetchall(): discard_draft(c,draft)
    c.execute("DELETE FROM media WHERE owner_type IN ('record','friend') AND owner_key=?",(str(record_id),))
    c.execute('DELETE FROM record_covers WHERE record_id=?',(record_id,))
    c.execute('DELETE FROM records WHERE id=?',(record_id,))

def media_is_public(c,row):
    if row['owner_type']=='profile': return row['role']=='background'
    if row['owner_type'] not in ('record','friend'): return False
    record=c.execute('SELECT kind,data FROM records WHERE id=?',(row['owner_key'],)).fetchone()
    if not record: return False
    data=json.loads(record['data'])
    if data.get('published') is not True: return False
    if row['owner_type']=='friend': return record['kind']=='friends' and row['role']=='avatar'
    return row['id'] in body_media(data)

def media_is_referenced(c,ident):
    for table in ('records','drafts'):
        for row in c.execute(f'SELECT data FROM {table}'):
            if ident in body_media(json.loads(row['data'])): return True
    return False

def upload_media(c,data):
    owner_type=data.get('owner_type'); owner_key=data.get('owner_key'); role=data.get('role')
    if not isinstance(owner_key,str): raise ValueError('图片所属对象无效')
    if owner_type=='draft':
        owner=c.execute('SELECT * FROM drafts WHERE key=?',(owner_key,)).fetchone()
        if not owner: return None
        if role not in ('inline','cover') or (role=='cover' and owner['kind']!='posts'): raise ValueError('这类草稿不支持该图片用途')
    elif owner_type=='friend':
        if not owner_key.isdigit() or not c.execute("SELECT 1 FROM records WHERE id=? AND kind='friends'",(owner_key,)).fetchone(): return None
        if role!='avatar': raise ValueError('友链图片仅支持头像')
    elif owner_type=='profile':
        if owner_key!='1' or role!='background': raise ValueError('个人资料图片仅支持侧栏背景')
    else: raise ValueError('图片所属对象无效')
    raw=cover_data(data)
    if role!='inline': c.execute('DELETE FROM media WHERE owner_type=? AND owner_key=? AND role=?',(owner_type,owner_key,role))
    ident=secrets.token_hex(16)
    c.execute('INSERT INTO media VALUES (?,?,?,?,?)',(ident,owner_type,owner_key,role,raw))
    if owner_type=='draft' and role=='cover': c.execute("UPDATE drafts SET cover_action='replace',updated=? WHERE key=?",(time.time(),owner_key))
    return {'id':ident,'url':media_url(ident),'role':role}

def export_zip(c,kind=None,ident=None):
    if kind is not None:
        rows=c.execute(RECORD_SELECT+' WHERE records.kind=? AND records.id=?',(kind,ident)).fetchall()
        if not rows: return None
    else: rows=c.execute(RECORD_SELECT+' ORDER BY records.kind,records.id').fetchall()
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        written=set()
        def image_file(name,raw):
            if name not in written:
                archive.writestr('images/'+name,raw); written.add(name)
            return '../images/'+name
        def write_content(folder,name,data,cover=None):
            body=data.get('body',data.get('notes',''))
            for media_id in body_media(data):
                media=c.execute('SELECT image FROM media WHERE id=?',(media_id,)).fetchone()
                if media: body=body.replace(media_url(media_id),image_file(media_id+'.jpg',media['image']))
            header=['---']
            for key in ('title','kind','published','featured','pinned','order','tags','summary','category','progress','rating','url'):
                if key in data: header.append(key+': '+json.dumps(data[key],ensure_ascii=False))
            header.extend(['---','', '# '+data.get('title','').replace('\n',' ').strip() if data.get('title','').strip() else '# 未命名草稿',''])
            if cover: header.extend(['![封面]('+image_file(cover[0],cover[1])+')',''])
            archive.writestr(folder+'/'+name+'.md','\n'.join(header)+body+'\n')
        for row in rows:
            data=dict(record_data(row),kind=row['kind'])
            cover=c.execute('SELECT image FROM record_covers WHERE record_id=?',(row['id'],)).fetchone()
            cover=(f"cover-{row['id']}.jpg",cover['image']) if cover else None
            if row['kind']=='friends' and row['friend_avatar_id']:
                avatar=c.execute('SELECT image FROM media WHERE id=?',(row['friend_avatar_id'],)).fetchone()
                if avatar: cover=(row['friend_avatar_id']+'.jpg',avatar['image'])
            write_content(row['kind'],str(row['id']),data,cover)
        if kind is None:
            for row in c.execute('SELECT * FROM drafts ORDER BY key').fetchall():
                data=draft_data(c,row); cover=None
                if row['cover_action']=='replace':
                    m=c.execute("SELECT id,image FROM media WHERE owner_type='draft' AND owner_key=? AND role='cover'",(row['key'],)).fetchone()
                    if m: cover=(m['id']+'.jpg',m['image'])
                elif row['cover_action']=='keep' and row['record_id'] is not None:
                    m=c.execute('SELECT image FROM record_covers WHERE record_id=?',(row['record_id'],)).fetchone()
                    if m: cover=(f"cover-{row['record_id']}.jpg",m['image'])
                write_content('drafts',row['key'],data,cover)
            profile=profile_data(c)
            archive.writestr('profile.md','# '+profile['name']+'\n\n'+profile['bio']+'\n')
            avatar=c.execute('SELECT avatar FROM profile WHERE id=1').fetchone()['avatar']
            if avatar: archive.writestr('images/profile-avatar.png',avatar)
            background=c.execute("SELECT image FROM media WHERE owner_type='profile' AND owner_key='1' AND role='background'").fetchone()
            if background: archive.writestr('images/profile-background.jpg',background['image'])
    return output.getvalue()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass  # log sanitized route/status in send() instead
    def send(self, status, data, content_type='application/json; charset=utf-8', headers=None):
        body=json.dumps(data,ensure_ascii=False).encode() if content_type.startswith('application/json') else data
        route=urlsplit(self.path).path.split('/')[:3]
        route='/'.join(part if part in ['', 'api', *KINDS, 'public', 'profile', 'avatar', 'avatar.png', 'covers', 'cover-search', 'image', 'login', 'logout', 'session', 'private', 'app.js', 'style.css', 'robots.txt'] else '?' for part in route)
        print(f'{self.command} {route} {status}',flush=True)
        self.send_response(status)
        # KaTeX's generated formula spans use style attributes for glyph placement.
        for k,v in {'Content-Type':content_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", **(headers or {})}.items(): self.send_header(k,v)
        self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def auth(self):
        try:
            cookie=SimpleCookie(self.headers.get('Cookie','')); token=cookie['session'].value
        except (KeyError,ValueError): return False
        with connect() as c:
            c.execute('DELETE FROM sessions WHERE expires<=?',(time.time(),))
            return c.execute('SELECT 1 FROM sessions WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),)).fetchone() is not None
    def do_GET(self): self.handle_request()
    def do_POST(self): self.handle_request()
    def do_PUT(self): self.handle_request()
    def do_DELETE(self): self.handle_request()
    def handle_request(self):
        try: self.route()
        except CoverSourceError as e: self.send(502,{'error':str(e)})
        except (ValueError,TypeError,json.JSONDecodeError) as e: self.send(400,{'error':str(e)})
        except Exception: self.send(500,{'error':'操作失败，请稍后重试'})
    def route(self):
        path=urlsplit(self.path).path
        parts=path.strip('/').split('/')
        is_cover=len(parts)==4 and parts[0]=='api' and parts[1] in COVER_KINDS and parts[2].isdigit() and parts[3]=='cover'
        if self.command!='GET':
            expected=os.environ.get('SITE_ORIGIN', 'http://'+self.headers.get('Host',''))
            if self.headers.get('Origin')!=expected: return self.send(403,{'error':'请求来源无效'})
            size=int(self.headers.get('Content-Length',0))
            limit=1536*1024 if path=='/api/avatar' and self.command=='POST' else 65536
            # Allow all valid text fields, including JSON-escaped Unicode, within one request.
            if len(parts)>=2 and parts[0]=='api' and parts[1] in ('posts','notes'):
                if (len(parts)==2 and self.command=='POST') or (len(parts)==3 and parts[2].isdigit() and self.command=='PUT'):
                    limit=TEXT_REQUEST_LIMIT
            if is_cover and self.command=='POST': limit=3*1024*1024
            if len(parts)==3 and parts[:2]==['api','drafts'] and self.command=='PUT': limit=TEXT_REQUEST_LIMIT
            if path=='/api/media' and self.command=='POST': limit=3*1024*1024
            if size<0: raise ValueError('内容长度无效')
            if size>limit: return self.send(413,{'error':'内容过长'})
            data=json.loads(self.rfile.read(size) or b'{}')
            if not isinstance(data,dict): raise ValueError('请求内容须为 JSON 对象')
        if path=='/api/public' and self.command=='GET':
            with connect() as c:
                result={'profile':profile_data(c),**{kind:[] for kind in KINDS}}
                rows=c.execute(RECORD_SELECT+' ORDER BY records.updated DESC').fetchall()
                for row in rows:
                    if row['kind'] in KINDS:
                        d=record_data(row)
                        if d['published']: result[row['kind']].append(d)
                result['posts'].sort(key=lambda row:(not row['pinned'],-row['updated']))
                result['friends'].sort(key=lambda row:(row['order'],-row['updated']))
            return self.send(200,result)
        if len(parts)==2 and parts[0]=='media' and re.fullmatch(r'[a-f0-9]{32}\.jpg',parts[1]) and self.command=='GET':
            with connect() as c:
                row=c.execute('SELECT * FROM media WHERE id=?',(parts[1][:-4],)).fetchone()
                public=row is not None and media_is_public(c,row)
            if row is None or (not public and not self.auth()): return self.send(404,{'error':'未找到'})
            return self.send(200,row['image'],'image/jpeg')
        if len(parts)==2 and parts[0]=='covers' and parts[1].endswith('.jpg') and parts[1][:-4].isdigit() and self.command=='GET':
            ident=int(parts[1][:-4])
            with connect() as c:
                row=c.execute("SELECT records.data,record_covers.image FROM records JOIN record_covers ON record_covers.record_id=records.id WHERE records.id=? AND records.kind IN ('posts','works')",(ident,)).fetchone()
            if row is None or (json.loads(row['data']).get('published') is not True and not self.auth()): return self.send(404,{'error':'未找到'})
            return self.send(200,row['image'],'image/jpeg')
        if path=='/avatar.png' and self.command=='GET':
            with connect() as c: avatar=c.execute('SELECT avatar FROM profile WHERE id=1').fetchone()['avatar']
            if avatar is None: return self.send(404,{'error':'尚未设置头像'})
            return self.send(200,avatar,'image/png')
        if path=='/api/login' and self.command=='POST':
            with connect() as c:
                a=c.execute('SELECT * FROM account').fetchone()
                valid=a and hmac.compare_digest(a['username'],str(data.get('username',''))) and hmac.compare_digest(a['password'],digest(str(data.get('password','')),a['salt']))
                if not valid: return self.send(401,{'error':'用户名或密码错误'})
                token=secrets.token_urlsafe(32); ttl=int(os.environ.get('SESSION_TTL','43200'))
                c.execute('DELETE FROM sessions WHERE expires<=?',(time.time(),))
                c.execute('INSERT INTO sessions VALUES (?,?)',(hashlib.sha256(token.encode()).hexdigest(),time.time()+ttl))
            secure='; Secure' if os.environ.get('SITE_ORIGIN','').startswith('https:') else ''
            return self.send(200,{'ok':True},headers={'Set-Cookie':f'session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={ttl}{secure}'})
        if path.startswith('/api/') or path=='/private':
            if not self.auth(): return self.send(401,{'error':'请先登录'})
        if path=='/api/session': return self.send(200,{'ok':True})
        if path=='/api/cover-search' and self.command=='GET':
            query=parse_qs(urlsplit(self.path).query)
            return self.send(200,search_covers(query.get('q',[''])[0],query.get('category',[''])[0]))
        if path=='/api/cover-search/image' and self.command=='GET':
            query=parse_qs(urlsplit(self.path).query)
            image,mime=fetch_cover_image(query.get('url',[''])[0])
            return self.send(200,image,mime)

        if path=='/api/drafts' and self.command=='GET':
            with connect() as c:
                result=[draft_data(c,row) for row in c.execute('SELECT * FROM drafts ORDER BY updated DESC').fetchall()]
            return self.send(200,result)
        if len(parts) in (3,4) and parts[:2]==['api','drafts']:
            key=parts[2]
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',key): raise ValueError('草稿标识无效')
            response=None
            with connect() as c:
                row=c.execute('SELECT * FROM drafts WHERE key=?',(key,)).fetchone()
                if len(parts)==3 and self.command=='PUT':
                    result=save_draft(c,key,data)
                    response=(200,result) if result is not None else (404,{'error':'关联记录不存在'})
                elif row is None: response=(404,{'error':'草稿不存在'})
                elif len(parts)==3 and self.command=='GET': response=(200,draft_data(c,row))
                elif len(parts)==3 and self.command=='DELETE':
                    discard_draft(c,row); response=(200,{'ok':True})
                elif len(parts)==4 and parts[3]=='commit' and self.command=='POST': response=(200,commit_draft(c,row))
                elif len(parts)==4 and parts[3]=='cover' and self.command=='DELETE' and row['kind']=='posts':
                    c.execute("DELETE FROM media WHERE owner_type='draft' AND owner_key=? AND role='cover'",(key,))
                    c.execute("UPDATE drafts SET cover_action='remove',updated=? WHERE key=?",(time.time(),key))
                    response=(200,draft_data(c,c.execute('SELECT * FROM drafts WHERE key=?',(key,)).fetchone()))
            if response is not None: return self.send(*response)
        if path=='/api/media' and self.command=='POST':
            with connect() as c: result=upload_media(c,data)
            return self.send(200,result) if result is not None else self.send(404,{'error':'图片所属内容不存在'})
        if len(parts)==3 and parts[:2]==['api','media'] and self.command=='DELETE':
            with connect() as c:
                row=c.execute('SELECT * FROM media WHERE id=?',(parts[2],)).fetchone()
                if row is None: return self.send(404,{'error':'图片不存在'})
                if media_is_referenced(c,row['id']): return self.send(409,{'error':'请先从正文移除图片并保存内容'})
                if row['owner_type']=='draft' and row['role']=='cover': c.execute("UPDATE drafts SET cover_action='remove',updated=? WHERE key=?",(time.time(),row['owner_key']))
                c.execute('DELETE FROM media WHERE id=?',(row['id'],))
            return self.send(200,{'ok':True})
        if self.command=='GET' and (path=='/api/export.zip' or (len(parts)==4 and parts[:2]==['api','export'] and parts[2] in ('posts','notes') and re.fullmatch(r'[0-9]+\.zip',parts[3]))):
            kind=parts[2] if len(parts)==4 else None; ident=int(parts[3][:-4]) if kind else None
            with connect() as c: archive=export_zip(c,kind,ident)
            if archive is None: return self.send(404,{'error':'记录不存在'})
            filename=f'{kind}-{ident}.zip' if kind else 'site-export.zip'
            return self.send(200,archive,'application/zip',{'Content-Disposition':f'attachment; filename="{filename}"'})
        if path=='/api/profile' and self.command in ('GET','PUT'):
            with connect() as c:
                if self.command=='PUT':
                    current=profile_data(c)
                    name=data.get('name',current['name']); bio=data.get('bio',current['bio'])
                    if not isinstance(name,str) or not name.strip() or len(name)>80: raise ValueError('名称须为 1–80 个字符')
                    if not isinstance(bio,str) or len(bio)>1000: raise ValueError('简介最多 1000 个字符')
                    c.execute('UPDATE profile SET name=?,bio=? WHERE id=1',(name.strip(),bio.strip()))
                result=profile_data(c)
            return self.send(200,result)
        if path=='/api/avatar' and self.command in ('POST','DELETE'):
            avatar=avatar_data(data) if self.command=='POST' else None
            with connect() as c:
                c.execute('UPDATE profile SET avatar=? WHERE id=1',(avatar,))
                result=profile_data(c)
            return self.send(200,result)
        if path=='/api/logout' and self.command=='POST':
            token=SimpleCookie(self.headers.get('Cookie',''))['session'].value
            with connect() as c: c.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),))
            return self.send(200,{'ok':True},headers={'Set-Cookie':'session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/'})
        if len(parts)>=2 and parts[0]=='api' and parts[1] in KINDS:
            kind=parts[1]
            response=None
            with connect() as c:
                if len(parts)==2 and self.command=='GET':
                    rows=c.execute(RECORD_SELECT+' WHERE records.kind=? ORDER BY records.updated DESC',(kind,)).fetchall()
                    result=[record_data(r) for r in rows]
                    if kind=='friends': result.sort(key=lambda row:(row['order'],-row['updated']))
                    return self.send(200,result)
                if len(parts)==2 and self.command=='POST':
                    d=validate(kind,data)
                    if kind in ('posts','notes'): check_content_media(c,d)
                    cur=c.execute('INSERT INTO records(kind,data,updated) VALUES (?,?,?)',(kind,json.dumps(d),time.time()))
                    response=(201,{'id':cur.lastrowid})
                if len(parts)>=3 and parts[2].isdigit():
                    ident=int(parts[2]); row=c.execute('SELECT * FROM records WHERE kind=? AND id=?',(kind,ident)).fetchone()
                    if not row: return self.send(404,{'error':'记录不存在'})
                    if is_cover and self.command in ('POST','DELETE'):
                        if self.command=='POST':
                            image=cover_data(data)
                            c.execute('INSERT INTO record_covers(record_id,image) VALUES (?,?) ON CONFLICT(record_id) DO UPDATE SET image=excluded.image',(ident,image))
                            response=(200,{'cover_url':f'/covers/{ident}.jpg'})
                        else:
                            c.execute('DELETE FROM record_covers WHERE record_id=?',(ident,))
                            response=(200,{'cover_url':None})
                    if len(parts)==3 and self.command=='PUT':
                        d=validate(kind,data,json.loads(row['data']))
                        if kind in ('posts','notes'): check_content_media(c,d,ident)
                        c.execute('UPDATE records SET data=?,updated=? WHERE id=?',(json.dumps(d),time.time(),ident))
                        if kind in ('posts','notes'): cleanup_record_media(c,ident)
                        response=(200,{'ok':True})
                    if len(parts)==3 and self.command=='DELETE':
                        delete_record(c,ident); response=(200,{'ok':True})
            if response is not None: return self.send(*response)
        if self.command=='GET':
            files={'/':'index.html','/private':'index.html','/app.js':'app.js','/style.css':'style.css','/robots.txt':'robots.txt','/cover.jpg':'cover.jpg'}
            files.update({f'/{name}':name for name in ('image-editor.js','image-editor.css','writing-editor.js','markdown.js','marked.umd.js','marked-katex.umd.js')})
            files.update({'/'+f.relative_to(ROOT/'public').as_posix():f.relative_to(ROOT/'public').as_posix() for f in (ROOT/'public/katex').rglob('*') if f.is_file() and f.suffix in ('.js','.css','.woff2','.woff','.ttf')})
            if path in files:
                f=ROOT/'public'/files[path]; mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.txt':'text/plain','.jpg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'}[f.suffix]
                return self.send(200,f.read_bytes(),mime)
        self.send(404,{'error':'未找到'})

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('action',choices=['serve','account'],nargs='?',default='serve'); parser.add_argument('--port',type=int,default=3080); args=parser.parse_args(); init()
    if args.action=='account':
        username=input('用户名: '); password=getpass.getpass('密码（至少12位，不显示）: ')
        if password!=getpass.getpass('再次输入密码: '): raise SystemExit('密码不一致')
        set_account(username,password); print('唯一账号已设置，旧会话已退出。')
    else:
        print(f'Local preview: http://127.0.0.1:{args.port}',flush=True)
        ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
