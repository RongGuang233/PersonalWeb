import base64
import http.client
import http.cookiejar
import json
import os
from pathlib import Path
import re
import sqlite3
import struct
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def png(width=1, height=1, color=b'\x00\x00\x00\xff'):
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))
    header = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    pixels = (b'\x00' + color * width) * height
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


def image_payload(raw):
    return {'image': 'data:image/png;base64,' + base64.b64encode(raw).decode()}


def jpeg(comment=b''):
    # A real 2x2 JPEG, embedded to keep the test runtime dependency-free.
    raw = base64.b64decode('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgACAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+L6KKK/lM/38P//Z')
    return raw[:2] + b'\xff\xfe' + struct.pack('>H', len(comment) + 2) + comment + raw[2:] if comment else raw


def cover_payload(raw):
    return {'image': 'data:image/jpeg;base64,' + base64.b64encode(raw).decode()}


class Integration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(server, 'DB', Path(self.temp.name) / 'site.sqlite3')
        self.db_patch.start()
        self.environment = patch.dict(os.environ)
        self.environment.start()
        os.environ.pop('SITE_ORIGIN', None)
        server.init()
        server.set_account('test-owner', 'test-only-password')
        self.start()
        self.jar = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.anonymous = urllib.request.build_opener()

    def start(self):
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.origin = 'http://127.0.0.1:' + str(self.http.server_port)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()

    def restart(self):
        self.stop()
        server.init()
        self.start()

    def tearDown(self):
        self.stop()
        self.environment.stop()
        self.db_patch.stop()
        self.temp.cleanup()

    def req(self, path, method='GET', data=None, client=None, origin=True, ensure_ascii=True):
        headers = {'Origin': self.origin} if origin else {}
        req = urllib.request.Request(self.origin + path, data=json.dumps(data, ensure_ascii=ensure_ascii).encode() if data is not None else None,
                                     method=method, headers=headers)
        try:
            with (client or self.client).open(req) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.read(), error.headers

    def login(self):
        self.assertEqual(self.req('/api/login', 'POST', {'username': 'test-owner', 'password': 'test-only-password'})[0], 200)

    def public(self):
        status, body, _ = self.req('/api/public', client=self.anonymous)
        self.assertEqual(status, 200)
        return json.loads(body)

    def record(self, kind, **values):
        data = {'title': 'private-marker', 'url': self.origin, 'body': '# 私人记录', 'category': '动漫', 'rating': '', 'published': False}
        data.update(values)
        status, body, _ = self.req('/api/' + kind, 'POST', data)
        self.assertEqual(status, 201)
        return json.loads(body)['id'], data

    def test_private_boundary_session(self):
        for path in ['/private', '/api/profile'] + ['/api/' + kind for kind in server.KINDS]:
            self.assertEqual(self.req(path)[0], 401)
        for method in ('POST', 'DELETE'):
            self.assertEqual(self.req('/api/avatar', method, {})[0], 401)
        self.assertEqual(self.req('/api/profile', 'PUT', {'name': 'no'})[0], 401)
        for path in ['/data/site.sqlite3', '/server.py', '/public/../data/site.sqlite3']:
            self.assertEqual(self.req(path)[0], 404)
        self.assertEqual(self.req('/api/login', 'POST', {'username': 'test-owner', 'password': 'bad'})[0], 401)
        self.login()
        self.assertEqual(self.req('/private')[0], 200)
        self.assertEqual(self.req('/api/notes', 'POST', {'title': 'x'}, origin=False)[0], 403)
        self.assertEqual(self.req('/api/avatar', 'POST', image_payload(png()), origin=False)[0], 403)
        self.assertEqual(self.req('/api/logout', 'POST', {})[0], 200)
        self.assertEqual(self.req('/api/session')[0], 401)
        self.login()
        with server.connect() as connection:
            connection.execute('UPDATE sessions SET expires=?', (time.time() - 1,))
        self.assertEqual(self.req('/api/session')[0], 401)

    def test_cover_search_requires_login_and_keeps_records_unchanged(self):
        paths=['/api/cover-search?q=test&category=game', '/api/cover-search/image?url=test']
        with patch('server.search_covers') as search, patch('server.fetch_cover_image') as image:
            for path in paths:
                self.assertEqual(self.req(path)[0],401)
            search.assert_not_called()
            image.assert_not_called()
            self.login()
            search.return_value={'results':[], 'message':'没有找到封面'}
            status,body,_=self.req('/api/cover-search?q=%E5%8E%9F%E7%A5%9E&category=%E6%B8%B8%E6%88%8F')
            self.assertEqual(status,200)
            search.assert_called_once_with('原神','游戏')
            self.assertEqual(json.loads(body)['message'],'没有找到封面')
            image.return_value=(jpeg(),'image/jpeg')
            status,body,headers=self.req(paths[1])
            self.assertEqual((status,body,headers['Content-Type']),(200,jpeg(),'image/jpeg'))
            image.side_effect=server.CoverSourceError('图片来源暂时不可用')
            self.assertEqual(self.req(paths[1])[0],502)
            search.side_effect=ValueError('请输入名称')
            self.assertEqual(self.req(paths[0])[0],400)
        with server.connect() as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM records').fetchone()[0],0)
            self.assertEqual(connection.execute('SELECT count(*) FROM record_covers').fetchone()[0],0)

    def test_crud_restart_categories(self):
        self.login()
        for kind in server.KINDS:
            with self.subTest(kind=kind):
                self.assertEqual(json.loads(self.req('/api/' + kind)[1]), [])
                ident, data = self.record(kind)
                data['title'] = 'edited'
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data)[0], 200)
                saved = json.loads(self.req('/api/' + kind)[1])[0]
                self.assertEqual(saved['title'], 'edited')
                self.assertFalse(saved['published'])
                self.assertNotIn(b'edited', self.req('/')[1])
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'DELETE', {})[0], 200)
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data)[0], 404)
        for category in server.CATEGORIES:
            self.assertEqual(self.req('/api/works', 'POST', {'title': category, 'category': category, 'rating': None})[0], 201)
        self.assertEqual(self.req('/api/works', 'POST', {'title': 'x', 'category': '电影', 'rating': 11})[0], 400)
        for kind in ('bookmarks', 'friends'):
            self.assertEqual(self.req('/api/' + kind, 'POST', {'title': 'x', 'url': 'javascript:alert(1)'})[0], 400)
        self.assertEqual(self.req('/api/services')[0], 404)
        self.assertEqual(self.req('/api/services/1/check', 'POST', {})[0], 404)
        self.restart()
        self.login()
        rows = json.loads(self.req('/api/works')[1])
        self.assertEqual(len(rows), 7)
        self.assertTrue(all(row['rating'] is None and row['published'] for row in rows))

    def test_new_records_default_public_and_explicit_private_stays_private(self):
        self.login()
        for kind in server.KINDS:
            with self.subTest(kind=kind):
                data={'title':'new default', 'url':self.origin, 'category':'游戏', 'rating':8}
                status,body,_=self.req('/api/'+kind,'POST',data)
                self.assertEqual(status,201)
                ident=json.loads(body)['id']
                self.assertEqual([r['id'] for r in self.public()[kind]],[ident])
                data['published']=False
                status,body,_=self.req('/api/'+kind,'POST',data)
                self.assertEqual(status,201)
                private_id=json.loads(body)['id']
                del data['published']
                self.assertEqual(self.req(f'/api/{kind}/{private_id}','PUT',data)[0],200)
                self.assertEqual([r['id'] for r in self.public()[kind]],[ident])

    def test_public_content_is_explicit_and_publish_state_survives_updates(self):
        public = self.public()
        self.assertEqual(set(public), {'profile', *server.KINDS})
        self.assertEqual(public['profile'], {'name': server.DEFAULT_NAME, 'bio': server.DEFAULT_BIO, 'avatar_url': None, 'background_url': None})
        self.assertTrue(all(public[kind] == [] for kind in server.KINDS))
        self.login()
        for kind in server.KINDS:
            with self.subTest(kind=kind):
                ident, data = self.record(kind)
                self.assertEqual(self.public()[kind], [])

                data['published'] = True
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data)[0], 200)
                visible = self.public()[kind]
                self.assertEqual([row['id'] for row in visible], [ident])
                self.assertTrue(visible[0]['published'])
                del data['published']
                data['title'] = 'still public'
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data)[0], 200)
                self.assertEqual(self.public()[kind][0]['title'], 'still public')
                data['published'] = False
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data)[0], 200)
                self.assertEqual(self.public()[kind], [])
                for invalid in ('true', 1, None):
                    data['published'] = invalid
                    self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data)[0], 400)
                    self.assertEqual(self.req('/api/' + kind, 'POST', data)[0], 400)
                self.assertEqual(self.public()[kind], [])

    def test_long_text_create_update_accepts_utf8_and_escaped_json(self):
        self.login()
        for kind in ('posts', 'notes'):
            for character in ('文', '😀'):
                for ensure_ascii in (False, True):
                    with self.subTest(kind=kind, character=character, ensure_ascii=ensure_ascii):
                        data = {'title': character * 4000, 'body': character * 50000}
                        if kind == 'posts':
                            data.update(summary=character * 4000, tags=character * 4000)
                        self.assertGreater(len(json.dumps(data, ensure_ascii=ensure_ascii).encode()), 65536)
                        status, response, _ = self.req('/api/' + kind, 'POST', data, ensure_ascii=ensure_ascii)
                        self.assertEqual(status, 201)
                        ident = json.loads(response)['id']
                        data['body'] = '新' + data['body'][1:]
                        self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data, ensure_ascii=ensure_ascii)[0], 200)
                        saved = next(row for row in json.loads(self.req('/api/' + kind)[1]) if row['id'] == ident)
                        self.assertEqual(saved['body'], data['body'])
                        self.assertEqual(saved['title'], data['title'])
                        if kind == 'posts':
                            self.assertEqual(saved['summary'], data['summary'])
                            self.assertEqual(saved['tags'], data['tags'])

    def test_long_text_character_and_request_limits(self):
        self.login()
        for kind in ('posts', 'notes'):
            ident, original = self.record(kind)
            for character in ('文', '😀'):
                invalid = dict(original, body=character * 50001)
                self.assertEqual(self.req('/api/' + kind, 'POST', invalid)[0], 400)
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', invalid)[0], 400)
                saved = json.loads(self.req('/api/' + kind)[1])
                self.assertEqual(len(saved), 1)
                self.assertEqual(saved[0]['body'], original['body'])
            for path, method, limit in (
                ('/api/' + kind, 'POST', 1024 * 1024),
                (f'/api/{kind}/{ident}', 'PUT', 1024 * 1024),
                ('/api/' + kind, 'PUT', 65536),
                (f'/api/{kind}/{ident}', 'POST', 65536),
                (f'/api/{kind}/{ident}', 'DELETE', 65536),
                ('/api/works', 'POST', 65536),
                ('/api/bookmarks', 'POST', 65536),
                ('/api/profile', 'PUT', 65536),
            ):
                with self.subTest(path=path, method=method):
                    connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
                    try:
                        connection.putrequest(method, path)
                        connection.putheader('Origin', self.origin)
                        connection.putheader('Content-Length', str(limit + 1))
                        connection.endheaders()
                        response = connection.getresponse()
                        self.assertEqual(response.status, 413)
                        response.read()
                    finally:
                        connection.close()

    def test_legacy_records_stay_private_without_being_rewritten(self):
        original = json.dumps({'title': 'old private note', 'body': 'keep this exact record'})
        old_service = json.dumps({'title': 'old service', 'url': self.origin, 'health_url': self.origin})
        with server.connect() as connection:
            connection.execute('INSERT INTO records(kind,data,updated) VALUES (?,?,?)', ('notes', original, 100))
            connection.execute('INSERT INTO records(kind,data,updated) VALUES (?,?,?)', ('services', old_service, 101))
            connection.execute('INSERT INTO records(kind,data,updated) VALUES (?,?,?)',
                               ('notes', json.dumps({'title': 'not boolean', 'published': 1}), 102))
        server.init()
        server.init()
        self.assertEqual(self.public()['notes'], [])
        self.login()
        rows = json.loads(self.req('/api/notes')[1])
        self.assertTrue(all(row['published'] is False for row in rows))
        with server.connect() as connection:
            actual = connection.execute('SELECT kind,data,updated FROM records ORDER BY updated').fetchall()
        self.assertEqual(tuple(actual[0]), ('notes', original, 100))
        self.assertEqual(tuple(actual[1]), ('services', old_service, 101))
        self.assertEqual(self.req('/api/services')[0], 404)

    def test_profile_avatar_replace_delete_and_restart(self):
        self.assertEqual(self.req('/avatar.png', client=self.anonymous)[0], 404)
        self.login()
        self.assertEqual(json.loads(self.req('/api/profile')[1]), self.public()['profile'])
        profile = {'name': 'My personal space', 'bio': '记录喜欢的作品'}
        self.assertEqual(self.req('/api/profile', 'PUT', profile)[0], 200)
        original = png()
        status, body, _ = self.req('/api/avatar', 'POST', image_payload(original))
        self.assertEqual(status, 200)
        expected = dict(profile, avatar_url='/avatar.png', background_url=None)
        self.assertEqual(json.loads(body), expected)
        status, body, headers = self.req('/avatar.png', client=self.anonymous)
        self.assertEqual((status, body, headers['Content-Type'], headers['Cache-Control']), (200, original, 'image/png', 'no-store'))
        self.assertEqual(self.public()['profile'], expected)
        changed = self.req('/api/profile', 'PUT', {'bio': '新的简介'})
        self.assertEqual(changed[0], 200)
        self.assertEqual(json.loads(changed[1]), dict(expected, bio='新的简介'))
        replacement = png(2, 2, b'\xff\x00\x00\xff')
        self.assertEqual(self.req('/api/avatar', 'POST', image_payload(replacement))[0], 200)
        self.restart()
        self.login()
        self.assertEqual(self.req('/avatar.png', client=self.anonymous)[1], replacement)
        self.assertEqual(json.loads(self.req('/api/profile')[1]), dict(expected, bio='新的简介'))
        with server.connect() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM profile').fetchone()[0], 1)
        self.assertEqual(self.req('/api/avatar', 'DELETE', {})[0], 200)
        self.assertEqual(self.req('/api/avatar', 'DELETE', {})[0], 200)
        self.restart()
        self.assertEqual(self.req('/avatar.png', client=self.anonymous)[0], 404)
        self.assertEqual(self.public()['profile'], dict(profile, bio='新的简介', avatar_url=None, background_url=None))

    def test_invalid_avatar_and_profile_leave_previous_values_intact(self):
        self.login()
        original = png()
        self.assertEqual(self.req('/api/avatar', 'POST', image_payload(original))[0], 200)
        invalid_images = [{}, {'image': 2}, {'image': 'data:image/jpeg;base64,AA=='},
                          {'image': 'data:image/png;base64,%%%'}, image_payload(b'not a png'),
                          image_payload(original[:20]), image_payload(png(0, 1)), image_payload(png(1025, 1)),
                          image_payload(original + b'x' * server.AVATAR_LIMIT)]
        for invalid in invalid_images:
            self.assertEqual(self.req('/api/avatar', 'POST', invalid)[0], 400)
            self.assertEqual(self.req('/avatar.png', client=self.anonymous)[1], original)
        # Oversized requests are rejected from their headers before the body is read.
        for path, limit in (('/api/avatar', 1536 * 1024), ('/api/bookmarks', 65536)):
            connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
            try:
                connection.putrequest('POST', path)
                connection.putheader('Origin', self.origin)
                connection.putheader('Content-Length', str(limit + 1))
                connection.endheaders()
                response = connection.getresponse()
                self.assertEqual(response.status, 413)
                self.assertIn('error', json.loads(response.read()))
            finally:
                connection.close()
        for invalid in ({'name': ''}, {'name': 'x' * 81}, {'bio': 'x' * 1001}, {'bio': []}):
            self.assertEqual(self.req('/api/profile', 'PUT', invalid)[0], 400)
        self.assertEqual(self.req('/api/profile', 'PUT', [1])[0], 400)
        self.assertEqual(self.public()['profile'], {'name': server.DEFAULT_NAME, 'bio': server.DEFAULT_BIO, 'avatar_url': '/avatar.png', 'background_url': None})

    def test_cover_visibility_follows_record_and_record_deletion_removes_image(self):
        self.login()
        for kind in ('posts', 'works'):
            with self.subTest(kind=kind):
                ident, data = self.record(kind, cover_url='https://not-used.invalid/picture.jpg')
                route = f'/api/{kind}/{ident}/cover'
                image_url = f'/covers/{ident}.jpg'
                self.assertIsNone(json.loads(self.req('/api/' + kind)[1])[0]['cover_url'])
                self.assertEqual(self.req(route, 'POST', cover_payload(jpeg()), client=self.anonymous)[0], 401)
                self.assertEqual(self.req(route, 'DELETE', {}, client=self.anonymous)[0], 401)
                wrong_kind = 'works' if kind == 'posts' else 'posts'
                self.assertEqual(self.req(f'/api/{wrong_kind}/{ident}/cover', 'POST', cover_payload(jpeg()))[0], 404)
                status, body, _ = self.req(route, 'POST', cover_payload(jpeg()))
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body), {'cover_url': image_url})
                self.assertEqual(json.loads(self.req('/api/' + kind)[1])[0]['cover_url'], image_url)
                self.assertEqual(self.req(image_url, client=self.anonymous)[0], 404)
                status, body, headers = self.req(image_url)
                self.assertEqual((status, body, headers['Content-Type'], headers['Cache-Control']), (200, jpeg(), 'image/jpeg', 'no-store'))
                self.assertEqual(self.public()[kind], [])
                data['published'] = True
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data)[0], 200)
                self.assertEqual(self.public()[kind][0]['cover_url'], image_url)
                self.assertEqual(self.req(image_url, client=self.anonymous)[1], jpeg())
                data['published'] = False
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data)[0], 200)
                self.assertEqual(self.req(image_url, client=self.anonymous)[0], 404)
                for _ in range(2):
                    status, body, _ = self.req(route, 'DELETE', {})
                    self.assertEqual((status, json.loads(body)), (200, {'cover_url': None}))
                self.assertEqual(self.req(image_url)[0], 404)
                self.assertIsNone(json.loads(self.req('/api/' + kind)[1])[0]['cover_url'])
                self.assertEqual(self.req(route, 'POST', cover_payload(jpeg()))[0], 200)
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'DELETE', {})[0], 200)
                self.assertEqual(self.req(image_url)[0], 404)
                self.assertEqual(self.req(route, 'DELETE', {})[0], 404)
                with server.connect() as connection:
                    self.assertEqual(connection.execute('SELECT COUNT(*) FROM record_covers').fetchone()[0], 0)
        note_id, _ = self.record('notes')
        self.assertEqual(self.req(f'/api/notes/{note_id}/cover', 'POST', cover_payload(jpeg()))[0], 404)
        self.assertEqual(self.req('/api/posts/9999/cover', 'POST', cover_payload(jpeg()))[0], 404)

    def test_cover_replacement_and_initialization_preserve_images_on_restart(self):
        self.login()
        stored = []
        for kind, published in (('posts', True), ('works', False)):
            ident, _ = self.record(kind, published=published)
            route = f'/api/{kind}/{ident}/cover'
            self.assertEqual(self.req(route, 'POST', cover_payload(jpeg()))[0], 200)
            replacement = jpeg(('replacement ' + kind).encode())
            self.assertEqual(self.req(route, 'POST', cover_payload(replacement))[0], 200)
            stored.append((kind, ident, replacement, published))
        self.assertEqual(self.req('/api/avatar', 'POST', image_payload(png()))[0], 200)
        server.init()
        server.init()
        self.restart()
        self.login()
        for kind, ident, replacement, published in stored:
            image_url = f'/covers/{ident}.jpg'
            self.assertEqual(self.req(image_url)[1], replacement)
            self.assertEqual(self.req(image_url, client=self.anonymous)[0], 200 if published else 404)
            self.assertEqual(json.loads(self.req('/api/' + kind)[1])[0]['cover_url'], image_url)
        with server.connect() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM record_covers').fetchone()[0], 2)
        self.assertEqual(self.req('/avatar.png', client=self.anonymous)[1], png())

    def test_invalid_cover_does_not_replace_saved_image_and_body_limit_is_scoped(self):
        self.login()
        ident, _ = self.record('posts')
        route = f'/api/posts/{ident}/cover'
        original = jpeg()
        self.assertEqual(self.req(route, 'POST', cover_payload(original))[0], 200)
        frame = original.index(b'\xff\xc0')
        zero_dimensions = original[:frame + 5] + b'\x00\x00\x00\x00' + original[frame + 9:]
        invalid_images = [{}, {'image': 7}, image_payload(png()), {'image': 'data:image/jpeg;base64,%%%'}]
        invalid_images += [cover_payload(raw) for raw in (
            b'not a jpeg', b'\xff\xd8\xff\xd9', original[:-2],
            b'\xff\xd8\xff\xe0\xff\xff\x00\xff\xd9',
            original[:original.index(b'\xff\xda')] + b'\xff\xd9', zero_dimensions,
            original[:-2] + b'x' * server.COVER_LIMIT + b'\xff\xd9')]
        for invalid in invalid_images:
            self.assertEqual(self.req(route, 'POST', invalid)[0], 400)
            self.assertEqual(self.req(f'/covers/{ident}.jpg')[1], original)
        for path, limit in ((route, 3 * 1024 * 1024), (f'/api/notes/{ident}/cover', 65536), ('/api/works', 65536)):
            connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
            try:
                connection.putrequest('POST', path)
                connection.putheader('Origin', self.origin)
                connection.putheader('Content-Length', str(limit + 1))
                connection.endheaders()
                response = connection.getresponse()
                self.assertEqual(response.status, 413)
                response.read()
            finally:
                connection.close()


class DeploymentTemplate(unittest.TestCase):
    def test_text_locations_match_collection_and_updates_without_capturing_other_routes(self):
        config = (Path(__file__).resolve().parents[1] / 'deploy/openresty.conf').read_text()
        regex_locations = re.findall(r'location\s+~\s+(\S+)\s*\{([^}]+)\}', config)
        for path, expected_limit in (
            ('/api/posts', '1m'), ('/api/notes', '1m'),
            ('/api/posts/12', '1m'), ('/api/notes/12', '1m'),
            ('/api/posts/', '1m'), ('/api/notes/12/', '1m'),
            ('/api/posts/12/cover', '3m'), ('/api/works/12/cover', '3m'),
            ('/api/posts-extra', None), ('/api/posts/name', None),
            ('/api/notes/12/cover', None), ('/api/posts/12/extra', None),
            ('/api/works', None), ('/api/bookmarks', None),
            ('/api/profile', None), ('/api/avatar', None),
        ):
            with self.subTest(path=path):
                matches = [body for pattern, body in regex_locations if re.search(pattern, path)]
                if expected_limit is None:
                    self.assertEqual(matches, [])
                else:
                    self.assertEqual(len(matches), 1)
                    self.assertRegex(matches[0], r'client_max_body_size\s+' + expected_limit + ';')
        self.assertRegex(config, r'location\s+=\s+/api/avatar\s*\{[^}]*client_max_body_size\s+1536k;')
        self.assertRegex(config, r'location\s+/\s*\{[^}]*client_max_body_size\s+64k;')


class Migration(unittest.TestCase):
    def test_old_schema_initializes_repeatedly_and_preserves_existing_data(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(server, 'DB', Path(temp) / 'old.sqlite3'):
            with sqlite3.connect(server.DB) as connection:
                connection.executescript('''
                    CREATE TABLE account (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT, salt TEXT, password TEXT);
                    CREATE TABLE sessions (token TEXT PRIMARY KEY, expires REAL);
                    CREATE TABLE records (id INTEGER PRIMARY KEY, kind TEXT, data TEXT, updated REAL);
                    INSERT INTO account VALUES (1,'unchanged','salt','password');
                    INSERT INTO records VALUES (4,'services','{"title":"existing service"}',123);
                    INSERT INTO records VALUES (5,'notes','{"title":"existing note"}',124);
                ''')
            server.init()
            with server.connect() as connection:
                self.assertEqual(server.profile_data(connection), {'name': server.DEFAULT_NAME, 'bio': server.DEFAULT_BIO, 'avatar_url': None, 'background_url': None})
                connection.execute('UPDATE profile SET name=?,bio=?,avatar=? WHERE id=1', ('edited', 'retained', png()))
            server.init()
            server.init()
            with server.connect() as connection:
                self.assertEqual(tuple(connection.execute('SELECT * FROM account').fetchone()), (1, 'unchanged', 'salt', 'password'))
                rows = [tuple(row) for row in connection.execute('SELECT * FROM records ORDER BY id')]
                self.assertEqual(rows, [(4, 'services', '{"title":"existing service"}', 123), (5, 'notes', '{"title":"existing note"}', 124)])
                self.assertEqual(server.profile_data(connection), {'name': 'edited', 'bio': 'retained', 'avatar_url': '/avatar.png', 'background_url': None})
                self.assertEqual(connection.execute('SELECT avatar FROM profile').fetchone()['avatar'], png())


if __name__ == '__main__':
    unittest.main(verbosity=2)
