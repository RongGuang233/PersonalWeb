from html.parser import HTMLParser
import os
import unittest
from urllib.parse import urlsplit
from unittest.mock import patch

from test_publication import ApiFixture
import test_server


class Head(HTMLParser):
    def __init__(self,text):
        super().__init__(); self.meta={}; self.links={}; self.scripts=[]; self.title=''; self.in_title=False
        self.feed(text)
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='meta': self.meta[attrs.get('property',attrs.get('name'))]=attrs.get('content')
        if tag=='link': self.links.setdefault(attrs.get('rel'),[]).append(attrs.get('href'))
        if tag=='script': self.scripts.append(attrs.get('src'))
        if tag=='title': self.in_title=True
    def handle_endtag(self,tag):
        if tag=='title': self.in_title=False
    def handle_data(self,data):
        if self.in_title: self.title+=data


class PublicPages(ApiFixture):
    def test_missing_note_is_an_html_page_with_a_return_link(self):
        status,body,headers=self.req('/read/notes/999999',client=self.anonymous)
        self.assertEqual(status,404)
        self.assertIn('text/html',headers['Content-Type'])
        text=body.decode()
        self.assertIn('内容不存在或尚未公开',text)
        self.assertIn('href="/#notes"',text)
        self.assertNotIn('og:type',Head(text).meta)

    def test_article_metadata_escaping_and_root_assets(self):
        self.login()
        title='作品 <script>alert("x")</script> & 标题'
        for kind in ('posts','notes','works','projects'):
            ident,_=self.record(kind,title=title,body='# 正文\n\n**摘要** 与 [链接](https://example.test)',notes='作品记录',published=True)
            route=f'/read/{kind}/{ident}'
            status,body,headers=self.req(route,client=self.anonymous)
            self.assertEqual(status,200)
            self.assertIn('text/html',headers['Content-Type'])
            text=body.decode(); head=Head(text)
            self.assertIn(title,head.title)
            self.assertNotIn('<script>alert',text)
            self.assertEqual(head.meta['og:title'],title)
            self.assertEqual(head.meta['og:type'],'article')
            self.assertEqual(head.meta['og:url'],self.origin+route)
            self.assertEqual(head.links['canonical'],[self.origin+route])
            self.assertEqual(head.meta['description'],head.meta['og:description'])
            self.assertNotIn('og:image',head.meta)
            self.assertEqual(head.meta['robots'],'noindex,nofollow')
            self.assertTrue(all(src.startswith('/') for src in head.scripts))
            self.assertTrue(all(src.startswith('/') for src in head.links['stylesheet']))

    def test_private_missing_and_existing_hash_routes(self):
        self.login()
        ident,_=self.record('posts',title='secret marker')
        private=self.req(f'/read/posts/{ident}',client=self.anonymous)
        missing=self.req('/read/posts/999999',client=self.anonymous)
        self.assertEqual(private[:2],missing[:2])
        self.assertEqual(private[0],404)
        self.assertNotIn(b'secret marker',private[1])
        self.assertEqual(self.req(f'/read/posts/{ident}')[0],404)
        for route in ('/','/#posts','/#read/posts/1'):
            # Browser fragments are client-only and do not reach the HTTP server.
            self.assertEqual(self.req(urlsplit(route).path,client=self.anonymous)[0],200)
        self.assertEqual(self.req('/private',client=self.anonymous)[0],401)

    def test_configured_origin_cover_and_avatar_fallback(self):
        self.login()
        ident,_=self.record('posts',published=True)
        self.assertEqual(self.req('/api/avatar','POST',test_server.image_payload(test_server.png()))[0],200)
        route=f'/read/posts/{ident}'
        with patch.dict(os.environ,{'SITE_ORIGIN':'https://blog.example.test'}):
            head=Head(self.req(route,client=self.anonymous)[1].decode())
            self.assertEqual(head.meta['og:url'],'https://blog.example.test'+route)
            self.assertEqual(head.meta['og:image'],'https://blog.example.test/avatar.png')
        self.assertEqual(self.req(f'/api/posts/{ident}/cover','POST',test_server.cover_payload(test_server.jpeg()))[0],200)
        head=Head(self.req(route,client=self.anonymous)[1].decode())
        self.assertEqual(head.meta['og:image'],self.origin+f'/covers/{ident}.jpg')


if __name__=='__main__': unittest.main()
