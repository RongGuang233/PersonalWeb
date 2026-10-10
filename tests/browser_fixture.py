"""Disposable local browser acceptance database, never used by deployment."""
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def seed():
    """Fictional content for search, long reading, list return and draft scenarios."""
    now = time.time()
    paragraphs = '\n\n'.join(['把想法写下来，再慢慢整理成可以回看的记录。阅读与记录让普通的一天有了新的细节。' * 8] * 2)
    body = '\n\n'.join(f'## {title}\n\n{paragraphs}' for title in ['开始记录', '整理想法', '回看与补充'])
    with server.connect() as c:
        c.execute('UPDATE profile SET bio=? WHERE id=1', ('记录生活，收藏喜欢。这里是独立的本地试用数据。',))
        for kind, values in [
            ('posts', {'title':'记录一段普通的时光','body':body,'summary':'一篇用于试读的长文章：从开始记录，到整理与回看。','tags':'生活随笔','published':True}),
            ('notes', {'title':'阅读时记下的小想法','body':'先留住想法，再决定它是否值得写成完整文章。','published':True}),
            ('posts', {'title':'重看时，发现了另一个故事','body':'第一次看故事，第二次留意细节。','published':True}),
            ('posts', {'title':'私密验收记录','body':'这篇不应出现在公开首页或搜索中。','published':False}),
            ('friends', {'title':'Mortal','url':'https://mortal.icu','notes':'朋友的个人网站','published':True}),
            ('bookmarks', {'title':'MDN Web Docs','url':'https://developer.mozilla.org/zh-CN/','notes':'网页开发参考','published':True}),
        ]:
            ident = c.execute('INSERT INTO records(kind,data,updated) VALUES (?,?,?)', (kind,json.dumps(server.validate(kind,values)),now)).lastrowid
            if kind in ('posts', 'notes') and values['published']:
                published_at = 1735689600 if ident == 1 else now
                c.execute('UPDATE records SET published_at=? WHERE id=?', (published_at, ident))
            if kind == 'posts' and values['title'] == '记录一段普通的时光':
                c.execute('INSERT INTO record_covers VALUES (?,?)',(ident,(server.ROOT/'public/cover.jpg').read_bytes()))
            now -= 60
        for i in range(28):
            category = server.CATEGORIES[i % len(server.CATEGORIES)]
            values = {'title':f'{category}试用记录 {i+1:02d}','category':category,'rating':round(6+(i%11)*.3,1),'progress':'进行中' if i%2 else '已完成','notes':'用于测试分类、评分排序与返回列表的位置。','published':True}
            work_id = c.execute('INSERT INTO records(kind,data,updated) VALUES (?,?,?)',( 'works',json.dumps(server.validate('works',values)),now-i*60)).lastrowid
            if i == 0:
                c.execute('INSERT INTO record_covers VALUES (?,?)',(work_id,(server.ROOT/'public/cover.jpg').read_bytes()))
        for kind in ['posts','notes']:
            values = {'kind':kind,'title':f'待续的{kind == "posts" and "文章" or "笔记"}','body':'这是尚未发布的试用草稿。','published':True}
            c.execute('INSERT INTO drafts(key,kind,record_id,data,updated) VALUES (?,?,NULL,?,?)',(f'browser-{kind}',kind,json.dumps(values),now))

        revision = {'kind':'posts','record_id':1,'title':'记录一段普通的时光（修改草稿）','body':'尚未发布的补充内容。','published':True}
        c.execute('INSERT INTO drafts(key,kind,record_id,data,updated) VALUES (?,?,?,?,?)',('record-posts-1','posts',1,json.dumps(revision),now-60))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=3081)
    parser.add_argument('--seed',action='store_true',help='Seed fictional content for browser scenarios')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='personal-site-browser-') as temp:
        server.DB = Path(temp)/'site.sqlite3'
        server.init()
        server.set_account('test-owner','test-only-password')
        if args.seed:
            seed()
        print(f'Disposable browser fixture: http://127.0.0.1:{args.port}; fictional data={args.seed}',flush=True)
        try:
            server.ThreadingHTTPServer(('127.0.0.1',args.port),server.Handler).serve_forever()
        except KeyboardInterrupt:
            pass
