import json
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

import test_server
import server


class ApiFixture(unittest.TestCase):
    setUp=test_server.Integration.setUp
    tearDown=test_server.Integration.tearDown
    start=test_server.Integration.start
    stop=test_server.Integration.stop
    req=test_server.Integration.req
    login=test_server.Integration.login
    public=test_server.Integration.public
    record=test_server.Integration.record

    def saved(self,kind,ident):
        return next(row for row in json.loads(self.req('/api/'+kind)[1]) if row['id']==ident)


class PublicationApi(ApiFixture):
    def test_first_publication_corrections_and_edits(self):
        self.login()
        for kind in ('posts','notes'):
            ident,data=self.record(kind)
            self.assertIsNone(self.saved(kind,ident)['published_at'])
            data['published']=True
            now=time.time()+10
            with patch('server.time.time',return_value=now):
                self.assertEqual(self.req(f'/api/{kind}/{ident}','PUT',data)[0],200)
            self.assertEqual(self.saved(kind,ident)['published_at'],now)
            for published,date,expected in ((True,None,now),(False,None,now),(True,946684800,946684800),(True,None,946684800)):
                data.update(published=published,published_at=date,body='modified')
                self.assertEqual(self.req(f'/api/{kind}/{ident}','PUT',data)[0],200)
                self.assertEqual(self.saved(kind,ident)['published_at'],expected)
            self.assertNotEqual(self.saved(kind,ident)['updated'],946684800)
        work,_=self.record('works',published=True)
        self.assertNotIn('published_at',self.saved('works',work))

    def test_draft_date_applies_on_commit_and_old_draft_keeps_date(self):
        self.login()
        ident,data=self.record('posts',published=True,published_at=946684800)
        for date in (1234567890,None):
            payload=dict(data,kind='posts',record_id=ident,published_at=date)
            self.assertEqual(self.req('/api/drafts/edit','PUT',payload)[0],200)
            self.assertEqual(self.saved('posts',ident)['published_at'],946684800 if date else 1234567890)
            self.assertEqual(self.req('/api/drafts/edit/commit','POST',{})[0],200)
            self.assertEqual(self.saved('posts',ident)['published_at'],1234567890)
        old=dict(data); old.pop('published_at',None)
        with server.connect() as c:
            c.execute('INSERT INTO drafts(key,kind,record_id,data,updated) VALUES (?,?,?,?,?)',('old','posts',ident,json.dumps(old),100))
        self.assertEqual(self.req('/api/drafts/old/commit','POST',{})[0],200)
        self.assertEqual(self.saved('posts',ident)['published_at'],1234567890)
        self.assertEqual(self.req('/api/drafts/new','PUT',{'kind':'notes','title':'new','published':True,'published_at':None})[0],200)
        now=time.time()+10
        with patch('server.time.time',return_value=now):
            status,body,_=self.req('/api/drafts/new/commit','POST',{})
        self.assertEqual(status,200)
        self.assertEqual(self.saved('notes',json.loads(body)['id'])['published_at'],now)

    def test_validation_cover_and_public_order(self):
        self.login()
        for value in ('2020-01-01',True,-1,float('nan'),float('inf'),253402300800):
            data={'title':'bad','published_at':value}
            self.assertEqual(self.req('/api/posts','POST',data)[0],400)
            self.assertEqual(self.req('/api/drafts/bad','PUT',dict(data,kind='posts'))[0],400)
        older,_=self.record('posts',published=True,published_at=100)
        newer,_=self.record('posts',published=True,published_at=200)
        self.assertEqual(self.req(f'/api/posts/{older}/cover','POST',test_server.cover_payload(test_server.jpeg()))[0],200)
        self.assertEqual(self.saved('posts',older)['published_at'],100)
        self.assertEqual([x['id'] for x in self.public()['posts']],[newer,older])


class PublicationMigration(unittest.TestCase):
    def test_old_and_interrupted_schema_migration_preserves_original_data(self):
        for interrupted in (False,True):
            with self.subTest(interrupted=interrupted), tempfile.TemporaryDirectory() as folder, patch.object(server,'DB',Path(folder)/'legacy.sqlite3'):
                original='{ "title": "原文", "body": "  # 正文\\n\\n", "published": true }'
                private='{ "title": "私密", "published": false }'
                with sqlite3.connect(server.DB) as c:
                    c.execute('CREATE TABLE records (id INTEGER PRIMARY KEY,kind TEXT,data TEXT,updated REAL)')
                    c.executemany('INSERT INTO records VALUES (?,?,?,?)',[(i,'posts',original,100+i) for i in range(1,502)])
                    c.execute('INSERT INTO records VALUES (502,?,?,?)',('notes',private,900))
                    if interrupted:
                        c.execute('ALTER TABLE records ADD COLUMN published_at REAL')
                        c.execute('UPDATE records SET published_at=updated WHERE id<=500')
                c.close()
                server.init(); server.init()
                with server.connect() as c:
                    rows=c.execute('SELECT * FROM records ORDER BY id').fetchall()
                self.assertEqual(len(rows),502)
                for row in rows[:501]:
                    self.assertEqual(row['data'],original)
                    self.assertEqual(row['published_at'],row['updated'])
                self.assertEqual(rows[-1]['data'],private)
                self.assertIsNone(rows[-1]['published_at'])


if __name__=='__main__': unittest.main()
