from email.utils import parsedate_to_datetime
import json
import os
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET

from test_publication import ApiFixture
import server


class RssApi(ApiFixture):
    def feed(self):
        status,body,headers=self.req('/feed.xml',client=self.anonymous)
        self.assertEqual(status,200)
        self.assertEqual(headers['Content-Type'],'application/rss+xml; charset=utf-8')
        root=ET.fromstring(body)
        self.assertEqual((root.tag,root.get('version')),('rss','2.0'))
        return root.find('channel'),body

    def test_empty_feed_and_profile(self):
        channel,_=self.feed()
        self.assertEqual(channel.findtext('title'),server.DEFAULT_NAME)
        self.assertEqual(channel.findtext('description'),server.DEFAULT_BIO)
        self.assertEqual(channel.findtext('link'),self.origin+'/')
        self.assertEqual(channel.findall('item'),[])

    def test_only_public_writing_and_no_draft_or_full_body(self):
        self.login()
        expected=[]
        for kind in ('posts','notes'):
            ident,_=self.record(kind,title='公开 '+kind,published=True,body='摘要文字 '*50+'全文末尾不应出现')
            expected.append(self.origin+f'/read/{kind}/{ident}')
            self.record(kind,title='私密标题',body='私密正文',published=False,published_at=2000000000)
            self.assertEqual(self.req('/api/drafts/'+kind,'PUT',{'kind':kind,'record_id':ident,'title':'未提交的草稿标题','body':'草稿正文','published':True})[0],200)
        for kind in ('works','friends','bookmarks'):
            self.record(kind,title='非写作条目',published=True)
        channel,raw=self.feed()
        self.assertCountEqual([item.findtext('link') for item in channel.findall('item')],expected)
        for marker in ('私密标题','私密正文','未提交的草稿标题','草稿正文','非写作条目','全文末尾不应出现'):
            self.assertNotIn(marker,raw.decode())
        self.assertTrue(all(len(item.findtext('description'))<=180 for item in channel.findall('item')))

    def test_xml_escaping_summary_origin_and_stable_guid(self):
        self.login()
        title='标题 <标签> & "引号" 😀'
        ident,data=self.record('posts',title=title,published=True,published_at=946684800,
                               summary='**摘要** &amp; 2 &lt; 3 [链接](https://example.test)\x01',body='不应输出正文')
        self.assertEqual(self.req('/api/profile','PUT',{'name':'站点 <名字> & 😀','bio':'简介 &amp; 介绍'})[0],200)
        channel,raw=self.feed()
        self.assertEqual(channel.findtext('title'),'站点 <名字> & 😀')
        self.assertEqual(channel.findtext('description'),'简介 & 介绍')
        item=channel.find('item')
        self.assertEqual(item.findtext('title'),title)
        self.assertEqual(item.findtext('description'),'摘要 & 2 < 3 链接')
        self.assertIn(b'&lt;',raw)
        self.assertEqual(parsedate_to_datetime(item.findtext('pubDate')).timestamp(),946684800)
        guid=item.findtext('guid')
        self.assertEqual(item.find('guid').get('isPermaLink'),'false')
        data.update(title='改后的标题',body='改后的正文')
        self.assertEqual(self.req(f'/api/posts/{ident}','PUT',data)[0],200)
        with patch.dict(os.environ,{'SITE_ORIGIN':'https://blog.example.test/'}):
            channel,_=self.feed()
            item=channel.find('item')
            self.assertEqual(channel.findtext('link'),'https://blog.example.test/')
            self.assertEqual(item.findtext('link'),f'https://blog.example.test/read/posts/{ident}')
            self.assertEqual(item.findtext('guid'),guid)
            self.assertEqual(parsedate_to_datetime(item.findtext('pubDate')).timestamp(),946684800)

    def test_latest_fifty_ordered_by_publication_date_then_id(self):
        # Fixture rows make ordering independent of request time and pinned state.
        with server.connect() as c:
            for ident in range(1,61):
                c.execute('INSERT INTO records(id,kind,data,updated,published_at) VALUES (?,?,?,?,?)',
                          (ident,'posts' if ident%2 else 'notes',json.dumps({'title':str(ident),'body':'正文','published':True,'pinned':ident==1}),1000-ident,ident//2))
            for value in (False,'true',1,None):
                c.execute('INSERT INTO records(kind,data,updated,published_at) VALUES (?,?,?,?)',
                          ('posts',json.dumps({'title':'不可见','published':value}),9999,9999))
        channel,_=self.feed()
        items=channel.findall('item')
        self.assertEqual([int(item.findtext('title')) for item in items],list(range(60,10,-1)))
        self.assertEqual(len({item.findtext('guid') for item in items}),50)
        self.assertEqual([parsedate_to_datetime(item.findtext('pubDate')).timestamp() for item in items],
                         [ident//2 for ident in range(60,10,-1)])


if __name__=='__main__': unittest.main()
