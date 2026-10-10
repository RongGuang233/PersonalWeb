"""Single-user private workspace. Python 3.10+, standard library only."""
from contextlib import contextmanager
import argparse, base64, binascii, gzip, getpass, hashlib, hmac, io, json, math, os, re, secrets, sqlite3, struct, time, unicodedata, zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from http.cookies import SimpleCookie
from cover_search import search_covers, fetch_cover_image, CoverSourceError
from public_page import render_public_page, render_rss

ROOT = Path(__file__).parent
DB = Path(os.environ.get('SITE_DB', ROOT / 'data/site.sqlite3'))
CATEGORIES = ['动画','漫画','游戏','小说','书籍','影视']
STATUS_LABELS = {'动画':('在看','看过','想看'),'影视':('在看','看过','想看'),'漫画':('在读','读过','想读'),'小说':('在读','读过','想读'),'书籍':('在读','读过','想读'),'游戏':('在玩','玩过','想玩')}
LEGACY_CATEGORY = {'动漫':'动画','电影':'影视','电视剧':'影视','出版书籍':'书籍'}
ANIME_CATEGORIES = ('动画', '动漫')
PROJECT_STATUSES = ['进行中','已完成','归档']
KINDS = ['posts','notes','projects','friends','works','bookmarks']
DEFAULT_NAME = 'RongGuang233'
DEFAULT_BIO = '写下想法，记录生活中的喜欢。'
DEFAULT_EXPERIENCE = '两年家教经历。'
DEFAULT_NOTE_CATEGORY_ORDER = ('高中数学讲义', '普通物理')
AVATAR_LIMIT = 1024 * 1024
COVER_LIMIT = 2 * 1024 * 1024
COVER_KINDS = ('posts','works','projects')
WRITING_KINDS = ('posts','notes','projects')
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
        c.executescript('''CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY, username TEXT UNIQUE, salt TEXT, password TEXT);
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires REAL);
        CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, kind TEXT, data TEXT, updated REAL);
        CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, bio TEXT NOT NULL, avatar BLOB, about TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS record_covers (record_id INTEGER PRIMARY KEY, image BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS drafts (key TEXT PRIMARY KEY, kind TEXT NOT NULL, record_id INTEGER, data TEXT NOT NULL, cover_action TEXT NOT NULL DEFAULT 'keep', updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_key TEXT NOT NULL, role TEXT NOT NULL, image BLOB NOT NULL);''')
        # Rebuild the original single-account table (CHECK(id=1)) to allow extra editors.
        schema=c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='account'").fetchone()
        if schema and 'CHECK(id=1)' in (schema['sql'] or ''):
            c.execute('ALTER TABLE account RENAME TO account_legacy')
            c.execute('CREATE TABLE account (id INTEGER PRIMARY KEY, username TEXT UNIQUE, salt TEXT, password TEXT)')
            c.execute('INSERT INTO account(id,username,salt,password) SELECT id,username,salt,password FROM account_legacy')
            c.execute('DROP TABLE account_legacy')
        profile_columns = {row['name'] for row in c.execute('PRAGMA table_info(profile)')}
        if 'about' not in profile_columns:
            c.execute("ALTER TABLE profile ADD COLUMN about TEXT NOT NULL DEFAULT ''")
        if 'experience' not in profile_columns:
            c.execute(f"ALTER TABLE profile ADD COLUMN experience TEXT NOT NULL DEFAULT '{DEFAULT_EXPERIENCE}'")
        if 'students' not in profile_columns:
            c.execute("ALTER TABLE profile ADD COLUMN students TEXT NOT NULL DEFAULT '[]'")
        if 'note_category_order' not in profile_columns:
            c.execute("ALTER TABLE profile ADD COLUMN note_category_order TEXT NOT NULL DEFAULT '[]'")
        if 'hidden_work_categories' not in profile_columns:
            c.execute("ALTER TABLE profile ADD COLUMN hidden_work_categories TEXT NOT NULL DEFAULT '[]'")
        if 'published_at' not in {row['name'] for row in c.execute('PRAGMA table_info(records)')}:
            c.execute('ALTER TABLE records ADD COLUMN published_at REAL')
        c.execute('INSERT OR IGNORE INTO profile(id,name,bio) VALUES (1,?,?)', (DEFAULT_NAME,DEFAULT_BIO))
    # Bounded, reentrant batches also resume if startup was interrupted after ALTER.
    # updated is the only available historical date; never rewrite source JSON.
    after=0
    while True:
        with connect() as c:
            rows=c.execute("SELECT id,data,updated FROM records WHERE id>? AND kind IN ('posts','notes','projects') AND published_at IS NULL ORDER BY id LIMIT 500",(after,)).fetchall()
            for row in rows:
                if json.loads(row['data']).get('published') is True:
                    c.execute('UPDATE records SET published_at=? WHERE id=? AND published_at IS NULL',(row['updated'],row['id']))
            if rows: after=rows[-1]['id']
        if len(rows)<500: break
    # Migrate legacy work categories and freeze display order via JSON update.
    with connect() as c:
        rows = [dict(id=row['id'], data=json.loads(row['data'])) for row in c.execute("SELECT id,data FROM records WHERE kind='works'").fetchall()]
        missing = [item for item in rows if not isinstance(item['data'].get('legacy_order'), (int, float))]
        missing.sort(key=lambda item: (-(item['data'].get('rating') if isinstance(item['data'].get('rating'), (int, float)) else -1), item['id']))
        for rank, item in enumerate(missing):
            item['data']['legacy_order'] = rank
            c.execute('UPDATE records SET data=? WHERE id=?', (json.dumps(item['data'], ensure_ascii=False), item['id']))
        for item in rows:
            d = item['data']
            changed = False
            cat = LEGACY_CATEGORY.get(d.get('category',''), d.get('category',''))
            if cat and cat != d.get('category') and cat in CATEGORIES:
                d['category'] = cat
                changed = True
            labels = STATUS_LABELS.get(d.get('category','') or cat)
            if labels:
                doing, done, want = labels
                p = str(d.get('progress') or '').strip()
                mapped = None
                if not p or p in ('想看','想读','想玩'):
                    mapped = want
                elif re.search(r'已看完|看完了|已通关|已读完|听完|已听过|已看过|读过|看过|玩过', p):
                    mapped = done if p not in (done, doing, want) else p
                    if p in (done,): mapped = p
                elif p in (doing, done, want):
                    mapped = p
                elif p:
                    mapped = doing if not re.search(r'已|过', p) else done
                else:
                    mapped = want
                if mapped and mapped != d.get('progress'):
                    d['progress'] = mapped
                    changed = True
            if changed:
                c.execute('UPDATE records SET data=? WHERE id=?', (json.dumps(d, ensure_ascii=False), item['id']))
    os.chmod(DB, 0o600)

def publication_input(data):
    value=data.get('published_at')
    if value is not None and (type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=253402300799):
        raise ValueError('公开日期须为有效的 Unix 秒数或 null')
    return value

def publication_date(kind,data,previous=None):
    if kind not in WRITING_KINDS: return None
    value=publication_input(data)
    if value is not None: return value
    if previous is not None and previous['published_at'] is not None: return previous['published_at']
    return time.time() if data.get('published') is True else None

def digest(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def set_account(username, password):
    if not username.strip() or len(password) < 12: raise ValueError('用户名不能为空，密码至少 12 位')
    username=username.strip(); salt = secrets.token_hex(16)
    with connect() as c:
        if c.execute('SELECT 1 FROM account WHERE id!=1 AND username=?',(username,)).fetchone():
            raise ValueError('用户名已被其他账号使用')
        c.execute('INSERT INTO account(id,username,salt,password) VALUES (1,?,?,?) '
                  'ON CONFLICT(id) DO UPDATE SET username=excluded.username,salt=excluded.salt,password=excluded.password',
                  (username,salt,digest(password,salt)))
        c.execute('DELETE FROM sessions')

def add_account(username, password):
    if not username.strip() or len(password) < 12: raise ValueError('用户名不能为空，密码至少 12 位')
    username=username.strip(); salt = secrets.token_hex(16)
    with connect() as c:
        # id=1 belongs to the primary account; never let an added account claim it.
        if c.execute('SELECT 1 FROM account WHERE id=1').fetchone() is None:
            raise ValueError('请先运行 account 创建主账号')
        if c.execute('SELECT 1 FROM account WHERE username=?',(username,)).fetchone():
            raise ValueError('用户名已存在')
        c.execute('INSERT INTO account(username,salt,password) VALUES (?,?,?)', (username,salt,digest(password,salt)))

def validate(kind, data, previous=None, draft=False):
    # Notes accept optional tags as a backward-compatible JSON field. Existing
    # rows without tags continue to validate and render exactly as before.
    fields = {'posts':['title','body','summary','tags'], 'friends':['title','url','notes'], 'bookmarks':['title','url','tags','notes'], 'notes':['title','body','tags','category'], 'works':['title','category','progress','rating','notes'], 'projects':['title','body','summary','tags','status','repo_url','demo_url']}[kind]
    d = {k: data.get(k,'') for k in fields}
    for k,v in d.items():
        if k == 'rating': continue
        if not isinstance(v,str) or len(v)> (50000 if k=='body' else 4000): raise ValueError('字段过长或格式错误')
        d[k] = v if draft and k=='body' else v.strip()
    if not d['title'] and not draft: raise ValueError('请填写名称或标题')
    for k in ['url','repo_url','demo_url']:
        if k in d and d[k]:
            u=urlsplit(d[k])
            if u.scheme not in ('http','https') or not u.hostname or u.username or u.password: raise ValueError('请输入不包含账号密码的 HTTP(S) 地址')
    if kind in ('friends','bookmarks') and not d['url']: raise ValueError('请填写链接')
    if kind=='projects':
        if not d['status']: d['status']='进行中'
        elif d['status'] not in PROJECT_STATUSES: raise ValueError('请选择项目状态')
    if kind=='works':
        d['category'] = LEGACY_CATEGORY.get(d['category'], d['category'])
        if d['category'] not in CATEGORIES: raise ValueError('请选择作品分类')
        if d['rating'] in ('',None): d['rating']=None
        else:
            d['rating']=float(d['rating'])
            if not 0<=d['rating']<=10: raise ValueError('评分范围为 0–10')
    # A partial update must not silently publish or unpublish existing content.
    d['published'] = data.get('published',True if previous is None else previous.get('published') is True)
    if not isinstance(d['published'],bool): raise ValueError('公开状态必须为 true 或 false')
    if kind in ('posts','projects'):
        for field in ('featured',) + (('pinned',) if kind=='posts' else ()):
            d[field]=data.get(field,(previous or {}).get(field,False))
            if not isinstance(d[field],bool): raise ValueError('精选和置顶状态必须为 true 或 false')
    if kind=='friends':
        d['order']=data.get('order',(previous or {}).get('order',0))
        if type(d['order']) is not int or not -1000000<=d['order']<=1000000: raise ValueError('友链排序须为 -1000000 到 1000000 的整数')
    if kind=='notes':
        d['order']=(previous or {}).get('order',0) if d['category']==(previous or {}).get('category','') else 0
    return d

def profile_data(c):
    row=c.execute('SELECT name,bio,about,experience,students,avatar IS NOT NULL AS has_avatar FROM profile WHERE id=1').fetchone()
    background=c.execute("SELECT id FROM media WHERE owner_type='profile' AND owner_key='1' AND role='background'").fetchone()
    return {'name':row['name'],'bio':row['bio'],'about':row['about'],'experience':row['experience'],'students':json.loads(row['students']),'avatar_url':'/avatar.png' if row['has_avatar'] else None,'background_url':media_url(background['id']) if background else None}

def profile_students(students):
    if not isinstance(students,list) or len(students)>60:
        raise ValueError('学生风采须为列表，最多 60 条')
    cleaned=[]
    for student in students:
        if not isinstance(student,dict): raise ValueError('每条学生风采须为对象')
        surname=student.get('surname'); subjects=student.get('subjects',''); university=student.get('university')
        if not isinstance(surname,str): raise ValueError('学生姓氏须为 1–2 个中文汉字，请勿填写全名')
        surname=surname.strip()
        if not 1<=len(surname)<=2 or any(not unicodedata.name(char,'').startswith('CJK UNIFIED IDEOGRAPH-') for char in surname):
            raise ValueError('学生姓氏须为 1–2 个中文汉字，请勿填写全名')
        if not isinstance(subjects,str) or len(subjects.strip())>80:
            raise ValueError('辅导科目最多 80 个字符，可留空')
        if not isinstance(university,str) or not 1<=len(university.strip())<=120:
            raise ValueError('就读大学须为 1–120 个字符')
        cleaned.append({'surname':surname,'subjects':subjects.strip(),'university':university.strip()})
    return cleaned

def note_categories(c):
    categories=set()
    for row in c.execute("SELECT data FROM records WHERE kind='notes'").fetchall():
        value=json.loads(row['data']).get('category','')
        if isinstance(value,str) and value.strip():
            categories.add(value.strip())
    return categories

def note_category_order(c, available=None):
    """Return the saved order followed by any categories added since the save."""
    available=note_categories(c) if available is None else {
        value.strip() for value in available if isinstance(value,str) and value.strip()
    }
    row=c.execute('SELECT note_category_order FROM profile WHERE id=1').fetchone()
    try:
        saved=json.loads(row['note_category_order'] or '[]') if row else []
    except (TypeError, json.JSONDecodeError):
        saved=[]
    if not isinstance(saved,list): saved=[]
    ordered=[]
    for value in saved:
        if isinstance(value,str) and value.strip() in available and value.strip() not in ordered:
            ordered.append(value.strip())
    remaining=available-set(ordered)
    ordered.extend(value for value in DEFAULT_NOTE_CATEGORY_ORDER if value in remaining)
    ordered.extend(sorted(remaining-set(ordered), key=lambda value:value.casefold()))
    return ordered

def save_note_category_order(c, categories):
    available=note_categories(c)
    if not isinstance(categories,list) or len(categories)>500:
        raise ValueError('分类顺序列表无效')
    cleaned=[]
    for value in categories:
        if not isinstance(value,str) or not value.strip() or len(value.strip())>4000:
            raise ValueError('分类顺序列表无效')
        value=value.strip()
        if value in cleaned:
            raise ValueError('分类顺序列表包含重复分类')
        cleaned.append(value)
    if set(cleaned)!=available:
        raise ValueError('分类内容已变化，请关闭面板并刷新后重试')
    c.execute('UPDATE profile SET note_category_order=? WHERE id=1',
              (json.dumps(cleaned,ensure_ascii=False,separators=(',',':')),))
    return cleaned

def record_data(row):
    d=json.loads(row['data'])
    d.pop('cover_url',None)
    if row['kind'] in COVER_KINDS:
        d['cover_url']=f"/covers/{row['id']}.jpg" if row['has_cover'] else None
    if row['kind']=='posts':
        d.update(featured=d.get('featured') is True,pinned=d.get('pinned') is True)
    if row['kind']=='projects':
        d.update(featured=d.get('featured') is True,status=d.get('status') or '进行中',repo_url=d.get('repo_url') or '',demo_url=d.get('demo_url') or '')
    if row['kind']=='friends':
        d.update(order=d.get('order',0),avatar_url=media_url(row['friend_avatar_id']) if row['friend_avatar_id'] else None)
    if row['kind'] in WRITING_KINDS: d['published_at']=row['published_at']
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

def jpeg_dimensions(raw):
    invalid='封面 JPEG 图片无效'
    if not isinstance(raw,bytes) or not raw.startswith(b'\xff\xd8\xff') or not raw.endswith(b'\xff\xd9'): raise ValueError(invalid)
    # Check the frame and segment boundaries of the browser-generated JPEG.
    offset=2; dimensions=None
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
            dimensions=(width,height)
        elif marker==0xda:
            if dimensions is None or not segment or not segment[0] or len(segment)!=4+2*segment[0] or offset>=len(raw)-2: raise ValueError(invalid)
            return dimensions
    raise ValueError(invalid)

def cover_data(data):
    image=data.get('image')
    prefix='data:image/jpeg;base64,'
    if not isinstance(image,str) or not image.startswith(prefix): raise ValueError('请上传 JPEG 格式的封面')
    try: raw=base64.b64decode(image[len(prefix):],validate=True)
    except (ValueError,binascii.Error): raise ValueError('封面图片编码无效') from None
    if len(raw)>COVER_LIMIT: raise ValueError('封面不能超过 2 MiB')
    jpeg_dimensions(raw)
    return raw


def media_url(ident):
    return f'/media/{ident}.jpg'

def body_media(data):
    return set(re.findall(r'/media/([a-f0-9]{32})\.jpg',data.get('body','')))

def public_note_image_sizes(c,notes):
    references=sorted({(ident,str(note['id'])) for note in notes for ident in body_media(note)})
    result={}
    # Pair each referenced image with its public record owner; unrelated blobs
    # are not read. Keep each batch below SQLite's older 999-parameter limit.
    for offset in range(0,len(references),400):
        batch=references[offset:offset+400]
        placeholders=','.join(' (?,?)' for _ in batch)
        values=[value for pair in batch for value in pair]
        rows=c.execute("SELECT id,image FROM media WHERE owner_type='record' AND role='inline' AND (id,owner_key) IN (VALUES"+placeholders+")",values).fetchall()
        for row in rows:
            try: width,height=jpeg_dimensions(row['image'])
            except ValueError: continue
            result[row['id']]={'width':width,'height':height}
    return result

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
    if kind not in WRITING_KINDS: raise ValueError('草稿仅支持博客、笔记和项目')
    if record_id is not None and (type(record_id) is not int or record_id<1): raise ValueError('关联记录无效')
    if old and (kind!=old['kind'] or record_id!=old['record_id']): raise ValueError('草稿不能更换所属内容')
    record=c.execute('SELECT * FROM records WHERE id=? AND kind=?',(record_id,kind)).fetchone() if record_id is not None else None
    if record_id is not None and record is None: return None
    previous=json.loads(old['data']) if old else json.loads(record['data']) if record else None
    if not old and record is not None: previous['published_at']=record['published_at']
    merged=dict(previous or {},**data)
    d=validate(kind,merged,previous,draft=True)
    if 'published_at' in merged: d['published_at']=publication_input(merged)
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
    stored=json.loads(row['data'])
    d=validate(row['kind'],stored,previous=stored)
    ident=row['record_id']
    previous=c.execute('SELECT * FROM records WHERE id=?',(ident,)).fetchone() if ident is not None else None
    if row['kind']=='notes':
        current=json.loads(previous['data']) if previous else {}
        d['order']=current.get('order',0) if d['category']==current.get('category','') else 0
    published_at=publication_date(row['kind'],dict(d,**({'published_at':stored['published_at']} if 'published_at' in stored else {})),previous)
    check_content_media(c,d,ident,row['key'])
    if ident is None:
        ident=c.execute('INSERT INTO records(kind,data,updated,published_at) VALUES (?,?,?,?)',(row['kind'],json.dumps(d),time.time(),published_at)).lastrowid
    else:
        c.execute('UPDATE records SET data=?,updated=?,published_at=? WHERE id=?',(json.dumps(d),time.time(),published_at,ident))
    if row['kind'] in ('posts','projects') and row['cover_action']=='replace':
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

def hidden_work_categories(c):
    row=c.execute('SELECT hidden_work_categories FROM profile WHERE id=1').fetchone()
    return json.loads(row['hidden_work_categories']) if row else []

def record_is_public(c,kind,data,hidden=None):
    if data.get('published') is not True: return False
    return kind!='works' or LEGACY_CATEGORY.get(data.get('category'),data.get('category')) not in (hidden_work_categories(c) if hidden is None else hidden)

def media_is_public(c,row):
    if row['owner_type']=='profile': return row['role']=='background'
    if row['owner_type'] not in ('record','friend'): return False
    record=c.execute('SELECT kind,data FROM records WHERE id=?',(row['owner_key'],)).fetchone()
    if not record: return False
    data=json.loads(record['data'])
    if not record_is_public(c,record['kind'],data): return False
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
        if role not in ('inline','cover') or (role=='cover' and owner['kind'] not in ('posts','projects')): raise ValueError('这类草稿不支持该图片用途')
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
            for key in ('title','kind','published','published_at','featured','pinned','order','tags','summary','category','progress','rating','url'):
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
            profile_text='# '+profile['name']+'\n\n'+profile['bio']+'\n'+('\n'+profile['about']+'\n' if profile['about'] else '')
            if profile['experience']:
                profile_text+='\n## 经历\n\n'+profile['experience']+'\n'
            if profile['students']:
                profile_text+='\n## 部分学生风采\n\n'
                for student in profile['students']:
                    subjects=f"；辅导科目：{student['subjects']}" if student['subjects'] else ''
                    profile_text+=f"- {student['surname']}\\*\\*{subjects}；就读大学：{student['university']}\n"
            archive.writestr('profile.md',profile_text)
            avatar=c.execute('SELECT avatar FROM profile WHERE id=1').fetchone()['avatar']
            if avatar: archive.writestr('images/profile-avatar.png',avatar)
            background=c.execute("SELECT image FROM media WHERE owner_type='profile' AND owner_key='1' AND role='background'").fetchone()
            if background: archive.writestr('images/profile-background.jpg',background['image'])
    return output.getvalue()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass  # log sanitized route/status in send() instead
    def send(self, status, data, content_type='application/json; charset=utf-8', headers=None):
        body=json.dumps(data,ensure_ascii=False).encode() if content_type.startswith('application/json') else data
        response_headers = dict(headers or {})
        accepts_gzip = 'gzip' in self.headers.get('Accept-Encoding', '').lower()
        compressible = content_type.startswith(('application/json', 'text/'))
        if accepts_gzip and compressible and len(body) >= 512:
            compressed = gzip.compress(body, compresslevel=6, mtime=0)
            if len(compressed) < len(body):
                body = compressed
                response_headers['Content-Encoding'] = 'gzip'
                response_headers['Vary'] = 'Accept-Encoding'
        route=urlsplit(self.path).path.split('/')[:3]
        route='/'.join(part if part in ['', 'api', *KINDS, 'public', 'profile', 'avatar', 'avatar.png', 'covers', 'cover-search', 'image', 'login', 'logout', 'session', 'private', 'app.js', 'theme-init.js', 'style.css', 'robots.txt'] else '?' for part in route)
        print(f'{self.command} {route} {status}',flush=True)
        self.send_response(status)
        # KaTeX's generated formula spans use style attributes for glyph placement.
        for k,v in {'Content-Type':content_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", **response_headers}.items(): self.send_header(k,v)
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
        if path=='/feed.xml' and self.command=='GET':
            with connect() as c:
                profile=profile_data(c)
                records=[]
                rows=c.execute("SELECT id,kind,data,published_at FROM records WHERE kind IN ('posts','notes','projects') ORDER BY published_at DESC,id DESC")
                for row in rows:
                    data=json.loads(row['data'])
                    if data.get('published') is not True: continue
                    records.append(dict(data,id=row['id'],kind=row['kind'],published_at=row['published_at']))
                    if len(records)==50: break
            origin=os.environ.get('SITE_ORIGIN') or 'http://'+self.headers.get('Host','')
            return self.send(200,render_rss(records,profile,origin),'application/rss+xml; charset=utf-8')
        if len(parts)==3 and parts[0]=='read' and parts[1] in ('posts','notes','works','projects') and parts[2].isdigit() and self.command=='GET':
            with connect() as c:
                row=c.execute(RECORD_SELECT+' WHERE records.kind=? AND records.id=?',(parts[1],int(parts[2]))).fetchone()
                readable=row is not None and record_is_public(c,row['kind'],json.loads(row['data']))
                if readable: record=record_data(row); profile=profile_data(c)
            if not readable:
                shell=(ROOT/'public/index.html').read_text()
                content=f'<div class="layout public-layout"><section class="content"><div class="empty"><h2>内容不存在或尚未公开</h2><p><a href="/#{parts[1]}">返回列表</a></p></div></section></div>'
                page=re.sub(r'(<main\b[^>]*>).*?(</main>)',lambda match:match[1]+content+match[2],shell,count=1,flags=re.S)
                return self.send(404,page.encode(),'text/html; charset=utf-8')
            origin=os.environ.get('SITE_ORIGIN') or 'http://'+self.headers.get('Host','')
            page=render_public_page((ROOT/'public/index.html').read_text(),record,profile,origin,f'/read/{parts[1]}/{row["id"]}')
            return self.send(200,page.encode(),'text/html; charset=utf-8')
        is_cover=len(parts)==4 and parts[0]=='api' and parts[1] in COVER_KINDS and parts[2].isdigit() and parts[3]=='cover'
        if self.command!='GET':
            expected=os.environ.get('SITE_ORIGIN', 'http://'+self.headers.get('Host',''))
            if self.headers.get('Origin')!=expected: return self.send(403,{'error':'请求来源无效'})
            size=int(self.headers.get('Content-Length',0))
            limit=1536*1024 if path=='/api/avatar' and self.command=='POST' else 65536
            # Allow all valid text fields, including JSON-escaped Unicode, within one request.
            if len(parts)>=2 and parts[0]=='api' and parts[1] in WRITING_KINDS:
                if (len(parts)==2 and self.command=='POST') or (len(parts)==3 and parts[2].isdigit() and self.command=='PUT'):
                    limit=TEXT_REQUEST_LIMIT
            if is_cover and self.command=='POST': limit=3*1024*1024
            if len(parts)==3 and parts[:2]==['api','drafts'] and self.command=='PUT': limit=TEXT_REQUEST_LIMIT
            if path=='/api/notes/categories/order' and self.command=='POST': limit=TEXT_REQUEST_LIMIT
            if path=='/api/profile' and self.command=='PUT': limit=TEXT_REQUEST_LIMIT
            if path=='/api/media' and self.command=='POST': limit=3*1024*1024
            if size<0: raise ValueError('内容长度无效')
            if size>limit: return self.send(413,{'error':'内容过长'})
            data=json.loads(self.rfile.read(size) or b'{}')
            if not isinstance(data,dict): raise ValueError('请求内容须为 JSON 对象')
        if path=='/api/public' and self.command=='GET':
            with connect() as c:
                result={'profile':profile_data(c),**{kind:[] for kind in KINDS}}
                hidden=hidden_work_categories(c)
                result['hidden_work_categories']=hidden
                public_note_categories=set()
                rows=c.execute(RECORD_SELECT+' ORDER BY records.updated DESC').fetchall()
                for row in rows:
                    if row['kind'] in KINDS:
                        d=record_data(row)
                        if record_is_public(c,row['kind'],d,hidden):
                            result[row['kind']].append(d)
                            if row['kind']=='notes' and d.get('category','').strip():
                                public_note_categories.add(d['category'].strip())
                result['note_category_order']=note_category_order(c, public_note_categories)
                result['note_image_sizes']=public_note_image_sizes(c,result['notes'])
                result['posts'].sort(key=lambda row:(not row['pinned'],-(row['published_at'] or 0)))
                result['notes'].sort(key=lambda row:-(row['published_at'] or 0))
                result['projects'].sort(key=lambda row:(not row.get('featured'),-(row['published_at'] or 0)))
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
                row=c.execute("SELECT records.kind,records.data,record_covers.image FROM records JOIN record_covers ON record_covers.record_id=records.id WHERE records.id=? AND records.kind IN ('posts','works','projects')",(ident,)).fetchone()
                public=row is not None and record_is_public(c,row['kind'],json.loads(row['data']))
            if row is None or (not public and not self.auth()): return self.send(404,{'error':'未找到'})
            return self.send(200,row['image'],'image/jpeg')
        if path=='/avatar.png' and self.command=='GET':
            with connect() as c: avatar=c.execute('SELECT avatar FROM profile WHERE id=1').fetchone()['avatar']
            if avatar is None: return self.send(404,{'error':'尚未设置头像'})
            return self.send(200,avatar,'image/png')
        if path=='/api/login' and self.command=='POST':
            with connect() as c:
                uname=str(data.get('username','')); pw=str(data.get('password',''))
                accounts=c.execute('SELECT * FROM account').fetchall()
                valid=any(hmac.compare_digest(str(a['username'] or ''),uname) and hmac.compare_digest(a['password'],digest(pw,a['salt'])) for a in accounts)
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
        if self.command=='GET' and (path=='/api/export.zip' or (len(parts)==4 and parts[:2]==['api','export'] and parts[2] in WRITING_KINDS and re.fullmatch(r'[0-9]+\.zip',parts[3]))):
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
                    about=data.get('about',current['about'])
                    experience=data.get('experience',current['experience'])
                    if not isinstance(name,str) or not name.strip() or len(name)>80: raise ValueError('名称须为 1–80 个字符')
                    if not isinstance(bio,str) or len(bio)>1000: raise ValueError('简介最多 1000 个字符')
                    if not isinstance(about,str) or len(about)>20000: raise ValueError('详细介绍须为文本，最多 20000 个字符')
                    if not isinstance(experience,str) or len(experience)>5000: raise ValueError('经历须为文本，最多 5000 个字符')
                    students=profile_students(data.get('students',current['students']))
                    c.execute('UPDATE profile SET name=?,bio=?,about=?,experience=?,students=? WHERE id=1',(name.strip(),bio.strip(),about,experience,json.dumps(students,ensure_ascii=False,separators=(',',':'))))
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
        if path=='/api/works/categories/visibility' and self.command in ('GET','PUT'):
            with connect() as c:
                if self.command=='PUT':
                    hidden=data.get('hidden_categories')
                    if not isinstance(hidden,list) or any(not isinstance(name,str) or name not in CATEGORIES for name in hidden):
                        raise ValueError('请选择有效的作品分类')
                    c.execute('UPDATE profile SET hidden_work_categories=? WHERE id=1',(json.dumps([name for name in CATEGORIES if name in hidden],ensure_ascii=False),))
                result=hidden_work_categories(c)
            return self.send(200,{'hidden_categories':result})
        if path=='/api/notes/categories/order' and self.command in ('GET','POST'):
            with connect() as c:
                if self.command=='GET':
                    ordered=note_category_order(c)
                else:
                    ordered=save_note_category_order(c,data.get('categories'))
            return self.send(200,{'categories':ordered})
        if path=='/api/notes/reorder' and self.command=='POST':
            category=data.get('category')
            ids=data.get('ids')
            if not isinstance(category,str) or len(category.strip())>120: raise ValueError('分类无效')
            category=category.strip()
            if not category: raise ValueError('请先选择一个分类')
            if not isinstance(ids,list) or not ids or len(ids)>500 or any(type(ident) is not int or ident<1 for ident in ids):
                raise ValueError('笔记顺序列表无效')
            if len(set(ids)) != len(ids): raise ValueError('笔记顺序列表包含重复内容')
            with connect() as c:
                placeholders=','.join('?' for _ in ids)
                rows=c.execute(f"SELECT id,data FROM records WHERE kind='notes' AND id IN ({placeholders})",ids).fetchall()
                if len(rows)!=len(ids): raise ValueError('部分笔记不存在或已被删除')
                category_ids={row['id'] for row in c.execute("SELECT id,data FROM records WHERE kind='notes'") if json.loads(row['data']).get('category','').strip()==category}
                if set(ids)!=category_ids: raise ValueError('分类内容已变化，请关闭面板并刷新后重试')
                by_id={row['id']:row for row in rows}
                for ident in ids:
                    record=json.loads(by_id[ident]['data'])
                    if str(record.get('category','')).strip()!=category: raise ValueError('只能调整同一分类内的笔记')
                for position,ident in enumerate(ids,1):
                    record=json.loads(by_id[ident]['data']); record['order']=position
                    c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(record),ident))
            return self.send(200,{'ok':True,'category':category,'count':len(ids)})
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
                    if kind in WRITING_KINDS: check_content_media(c,d)
                    published_at=publication_date(kind,dict(d,**({'published_at':data['published_at']} if 'published_at' in data else {})))
                    cur=c.execute('INSERT INTO records(kind,data,updated,published_at) VALUES (?,?,?,?)',(kind,json.dumps(d),time.time(),published_at))
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
                        if kind in WRITING_KINDS: check_content_media(c,d,ident)
                        published_at=publication_date(kind,dict(d,**({'published_at':data['published_at']} if 'published_at' in data else {})),row)
                        c.execute('UPDATE records SET data=?,updated=?,published_at=? WHERE id=?',(json.dumps(d),time.time(),published_at,ident))
                        if kind in WRITING_KINDS: cleanup_record_media(c,ident)
                        response=(200,{'ok':True})
                    if len(parts)==3 and self.command=='DELETE':
                        delete_record(c,ident); response=(200,{'ok':True})
            if response is not None: return self.send(*response)
        if self.command=='GET':
            files={'/':'index.html','/private':'index.html','/app.js':'app.js','/style.css':'style.css','/robots.txt':'robots.txt','/cover.jpg':'cover.jpg','/favicon.svg':'favicon.svg'}
            files.update({f'/{name}':name for name in ('portal.css','theme-init.js','work-browser.js','reading-navigation.js','reading-navigation.css','image-editor.js','image-editor.css','writing-editor.js','markdown.js','marked.umd.js','marked-katex.umd.js')})
            files.update({'/'+f.relative_to(ROOT/'public').as_posix():f.relative_to(ROOT/'public').as_posix() for f in (ROOT/'public/katex').rglob('*') if f.is_file() and f.suffix in ('.js','.css','.woff2','.woff','.ttf')})
            files.update({'/university-seals/'+f.name:'university-seals/'+f.name for f in (ROOT/'public/university-seals').glob('*') if f.is_file() and f.suffix in ('.png','.jpg','.svg')})
            if path in files:
                f=ROOT/'public'/files[path]; mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.txt':'text/plain','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'}[f.suffix]
                return self.send(200,f.read_bytes(),mime)
        self.send(404,{'error':'未找到'})

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('action',choices=['serve','account','add-account'],nargs='?',default='serve'); parser.add_argument('--port',type=int,default=3080); args=parser.parse_args(); init()
    if args.action in ('account','add-account'):
        username=input('用户名: '); password=getpass.getpass('密码（至少12位，不显示）: ')
        if password!=getpass.getpass('再次输入密码: '): raise SystemExit('密码不一致')
        if args.action=='account':
            set_account(username,password); print('主账号已设置，旧会话已退出。')
        else:
            add_account(username,password); print('账号已添加，已有会话保持有效。')
    else:
        print(f'Local preview: http://127.0.0.1:{args.port}',flush=True)
        ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
