import base64
import io
import json
import unittest
import zipfile

import test_server as baseline
import server

# A real 7x3 JPEG makes width/height swaps visible without an image dependency.
LANDSCAPE_JPEG = base64.b64decode(
    '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKAC'
    'AAQAAAABAAAAB6ADAAQAAAABAAAAAwAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZ'
    'jwCyBOmACZjs+EJ+/8AAEQgAAwAHAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIB'
    'AwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNE'
    'RUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfI'
    'ycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIB'
    'AgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpD'
    'REVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG'
    'x8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgK'
    'CgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ'
    'EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/n/ooooA/9k='
)


class ContentFeatures(unittest.TestCase):
    setUp = baseline.Integration.setUp
    tearDown = baseline.Integration.tearDown
    start = baseline.Integration.start
    stop = baseline.Integration.stop
    restart = baseline.Integration.restart
    req = baseline.Integration.req
    login = baseline.Integration.login
    public = baseline.Integration.public
    record = baseline.Integration.record

    def test_browser_assets_are_self_hosted_and_formula_styles_are_allowed(self):
        for path, mime in [('/katex/katex.min.js', 'text/javascript'), ('/marked-katex.umd.js', 'text/javascript'),
                           ('/katex/katex.min.css', 'text/css'), ('/katex/fonts/KaTeX_Main-Regular.woff2', 'font/woff2'),
                           ('/reading-navigation.js', 'text/javascript'), ('/reading-navigation.css', 'text/css')]:
            status, body, headers = self.req(path, client=self.anonymous)
            self.assertEqual(status, 200, path)
            self.assertTrue(headers['Content-Type'].startswith(mime))
            self.assertGreater(len(body), 100)
        _, body, headers = self.req('/', client=self.anonymous)
        self.assertIn(b'/katex/katex.min.js', body)
        self.assertIn("style-src-attr 'unsafe-inline'", headers['Content-Security-Policy'])
        self.assertIn("script-src 'self';", headers['Content-Security-Policy'])

    def draft(self, key, **data):
        status, response, _ = self.req('/api/drafts/' + key, 'PUT', data)
        self.assertEqual(status, 200, response)
        return json.loads(response)

    def upload(self, owner_type, owner_key, role='inline', raw=None):
        data = dict(baseline.cover_payload(raw or baseline.jpeg()), owner_type=owner_type, owner_key=str(owner_key), role=role)
        status, response, _ = self.req('/api/media', 'POST', data)
        self.assertEqual(status, 200, response)
        return json.loads(response)

    def commit(self, key):
        status, response, _ = self.req('/api/drafts/' + key + '/commit', 'POST', {})
        self.assertEqual(status, 200, response)
        return json.loads(response)

    def test_drafts_allow_empty_titles_restore_exact_text_and_commit_explicitly(self):
        for path in ('/api/drafts', '/api/drafts/test', '/api/export.zip', '/api/export/posts/1.zip'):
            self.assertEqual(self.req(path)[0], 401)
        self.assertEqual(self.req('/api/drafts/new', 'PUT', {'kind': 'posts'})[0], 401)
        self.login()
        draft = self.draft('new', kind='posts', title='', body='  unfinished\n\n')
        self.assertEqual(draft['body'], '  unfinished\n\n')
        self.assertEqual(draft['title'], '')
        self.assertIsNone(draft['record_id'])
        self.assertTrue(draft['published'])
        self.draft('new', kind='posts', title='', body='第二次内容\n')
        self.assertEqual(len(json.loads(self.req('/api/drafts')[1])), 1)
        self.assertEqual(self.public()['posts'], [])
        self.assertEqual(self.req('/api/drafts/new/commit', 'POST', {})[0], 400)
        self.restart()
        self.login()
        self.assertEqual(json.loads(self.req('/api/drafts/new')[1])['body'], '第二次内容\n')
        self.draft('new', title='正式标题', published=True, featured=True, pinned=True)
        result = self.commit('new')
        self.assertEqual(result['kind'], 'posts')
        self.assertEqual(self.req('/api/drafts/new')[0], 404)
        self.assertEqual(len(self.public()['posts']), 1)
        self.assertEqual(self.public()['posts'][0]['id'], result['id'])
        self.assertTrue(self.public()['posts'][0]['featured'])
        self.assertTrue(self.public()['posts'][0]['pinned'])
        self.assertEqual(self.req('/api/drafts/new/commit', 'POST', {})[0], 404)
        self.assertEqual(len(self.public()['posts']), 1)
        for flag in ('published', 'featured', 'pinned'):
            self.assertEqual(self.req('/api/drafts/bad', 'PUT', {'kind': 'notes', flag: 'true'})[0], 400)
        self.assertEqual(self.req('/api/drafts/missing', 'PUT', {'kind': 'posts', 'record_id': 9999})[0], 404)

    def test_new_note_draft_stays_hidden_until_commit_and_private_choice_persists(self):
        self.login()
        draft=self.draft('new-note',kind='notes',title='默认公开笔记',body='正文')
        self.assertTrue(draft['published'])
        self.assertEqual(self.public()['notes'],[])
        ident=self.commit('new-note')['id']
        self.assertEqual([r['id'] for r in self.public()['notes']],[ident])
        self.draft('private-note',kind='notes',title='私密笔记',published=False)
        updated=self.draft('private-note',body='自动保存')
        self.assertFalse(updated['published'])
        self.commit('private-note')
        self.assertEqual([r['id'] for r in self.public()['notes']],[ident])

    def test_public_note_image_sizes_include_only_committed_published_note_images(self):
        self.assertEqual(self.public()['note_image_sizes'], {})
        self.login()
        self.draft('public-note', kind='notes', title='公开图片笔记', published=True)
        first = self.upload('draft', 'public-note')
        second = self.upload('draft', 'public-note', raw=LANDSCAPE_JPEG)
        self.draft('public-note', body=f"![第一幅]({first['url']})\n\n![第二幅]({second['url']})")
        self.commit('public-note')
        excluded = []
        for key, kind, published, commit in [('private-note', 'notes', False, True),
                                              ('unfinished-note', 'notes', True, False),
                                              ('public-post', 'posts', True, True),
                                              ('public-project', 'projects', True, True)]:
            self.draft(key, kind=kind, title=key, published=published)
            image = self.upload('draft', key)
            self.draft(key, body=f"![图片]({image['url']})")
            if commit:
                self.commit(key)
            excluded.append(image['id'])
        sizes = self.public()['note_image_sizes']
        self.assertEqual(sizes, {first['id']: {'width': 2, 'height': 2}, second['id']: {'width': 7, 'height': 3}})
        self.assertTrue(all(ident not in sizes for ident in excluded))

    def test_public_note_image_sizes_batch_owned_references_and_skip_invalid_legacy_images(self):
        self.login()
        ident, data = self.record('notes', title='旧笔记', published=True)
        other, _ = self.record('notes', title='其他公开笔记', published=True)
        valid, invalid, orphan, foreign, wrong_role = [f'{index:032x}' for index in range(1, 6)]
        data['body'] = '\n\n'.join(f'![图片]({server.media_url(image)})' for image in (valid, invalid, foreign, wrong_role))
        with server.connect() as connection:
            connection.executemany('INSERT INTO media VALUES (?,?,?,?,?)', [
                (valid, 'record', str(ident), 'inline', baseline.jpeg()),
                (invalid, 'record', str(ident), 'inline', b'legacy invalid jpeg'),
                (orphan, 'record', str(ident), 'inline', baseline.jpeg()),
                (foreign, 'record', str(other), 'inline', baseline.jpeg()),
                (wrong_role, 'record', str(ident), 'cover', baseline.jpeg()),
            ])
            connection.execute('UPDATE records SET data=? WHERE id=?', (json.dumps(data), ident))
        self.assertEqual(self.public()['note_image_sizes'], {valid: {'width': 2, 'height': 2}})
        with server.connect() as connection:
            queries = []
            connection.set_trace_callback(queries.append)
            sizes = server.public_note_image_sizes(connection, [{'id': ident, **data}])
        self.assertEqual(sizes, {valid: {'width': 2, 'height': 2}})
        reads = [query for query in queries if query.lstrip().upper().startswith('SELECT')]
        self.assertEqual(len(reads), 1, 'body image references must be fetched together rather than once per image')

    def test_published_edit_keeps_original_content_and_cover_until_commit(self):
        self.login()
        ident, original = self.record('posts', published=True, title='公开版', body='公开正文')
        route = f'/api/posts/{ident}'
        cover_url = f'/covers/{ident}.jpg'
        self.assertEqual(self.req(route + '/cover', 'POST', baseline.cover_payload(baseline.jpeg()))[0], 200)
        draft = self.draft('edit', kind='posts', record_id=ident)
        self.assertEqual((draft['title'], draft['body'], draft['cover_url']), ('公开版', '公开正文', cover_url))
        self.draft('edit', title='未发布的改动', body='草稿正文')
        replacement = baseline.jpeg(b'new cover')
        media = self.upload('draft', 'edit', 'cover', replacement)
        self.assertEqual(self.req(media['url'], client=self.anonymous)[0], 404)
        self.assertEqual(json.loads(self.req('/api/drafts/edit')[1])['cover_url'], media['url'])
        self.assertEqual(self.public()['posts'][0]['title'], '公开版')
        self.assertEqual(self.req(cover_url, client=self.anonymous)[1], baseline.jpeg())
        self.assertEqual(self.req('/api/drafts/edit', 'DELETE', {})[0], 200)
        self.assertEqual(self.req(media['url'])[0], 404)
        self.assertEqual(self.req(cover_url, client=self.anonymous)[1], baseline.jpeg())
        self.draft('edit', kind='posts', record_id=ident, title='新版')
        self.upload('draft', 'edit', 'cover', replacement)
        self.commit('edit')
        self.assertEqual(self.public()['posts'][0]['title'], '新版')
        self.assertEqual(self.req(cover_url, client=self.anonymous)[1], replacement)
        self.draft('edit', kind='posts', record_id=ident)
        self.assertEqual(self.req('/api/drafts/edit/cover', 'DELETE', {})[0], 200)
        self.assertIsNone(json.loads(self.req('/api/drafts/edit')[1])['cover_url'])
        self.assertEqual(self.req(cover_url, client=self.anonymous)[1], replacement)
        self.commit('edit')
        self.assertEqual(self.req(cover_url)[0], 404)

    def test_inline_images_follow_draft_commit_visibility_and_content_changes(self):
        self.login()
        for kind in ('posts', 'notes'):
            with self.subTest(kind=kind):
                key = 'new-' + kind
                self.draft(key, kind=kind, title='正文图片', published=True)
                image = self.upload('draft', key)
                self.assertEqual(self.req(image['url'], client=self.anonymous)[0], 404)
                self.assertEqual(self.req(image['url'])[1], baseline.jpeg())
                body = f"![图片]({image['url']})"
                self.draft(key, body=body)
                self.assertEqual(self.req('/api/media/' + image['id'], 'DELETE', {})[0], 409)
                result = self.commit(key)
                ident = result['id']
                self.assertEqual(self.req(image['url'], client=self.anonymous)[0], 200)
                self.draft(key, kind=kind, record_id=ident, body='新草稿')
                next_image = self.upload('draft', key)
                self.draft(key, body=f"![新图片]({next_image['url']})")
                self.assertEqual(self.req(next_image['url'], client=self.anonymous)[0], 404)
                self.assertEqual(self.req(image['url'], client=self.anonymous)[0], 200)
                self.commit(key)
                self.assertEqual(self.req(image['url'])[0], 404)
                self.assertEqual(self.req(next_image['url'], client=self.anonymous)[0], 200)
                data = json.loads(self.req('/api/' + kind)[1])[0]
                data['published'] = False
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'PUT', data)[0], 200)
                self.assertEqual(self.req(next_image['url'], client=self.anonymous)[0], 404)
                self.assertEqual(self.req(next_image['url'])[0], 200)
                self.draft(key, kind=kind, record_id=ident)
                orphan = self.upload('draft', key)
                self.assertEqual(self.req(f'/api/{kind}/{ident}', 'DELETE', {})[0], 200)
                self.assertEqual(self.req('/api/drafts/' + key)[0], 404)
                self.assertEqual(self.req(next_image['url'])[0], 404)
                self.assertEqual(self.req(orphan['url'])[0], 404)

    def test_image_ownership_and_recovery_draft_references_are_preserved(self):
        self.login()
        self.draft('one', kind='posts', title='one', published=True)
        image = self.upload('draft', 'one')
        self.draft('two', kind='posts', title='two', body=f"![other]({image['url']})", published=True)
        self.assertEqual(self.req('/api/drafts/two/commit', 'POST', {})[0], 400)
        self.assertEqual(self.public()['posts'], [])
        self.draft('one', body=f"![mine]({image['url']})")
        ident = self.commit('one')['id']
        self.draft('saved-edit', kind='posts', record_id=ident)
        self.assertEqual(self.req(f'/api/posts/{ident}', 'PUT', {'title': 'without image', 'body': '', 'published': True})[0], 200)
        self.assertEqual(self.req(image['url'], client=self.anonymous)[0], 404)
        self.assertEqual(self.req(image['url'])[0], 200)
        self.commit('saved-edit')
        self.assertEqual(self.req(image['url'], client=self.anonymous)[0], 200)
        self.assertEqual(self.req('/api/drafts/two', 'DELETE', {})[0], 200)
        self.draft('discard', kind='notes', body='')
        orphan = self.upload('draft', 'discard')
        self.assertEqual(self.req('/api/drafts/discard', 'DELETE', {})[0], 200)
        self.assertEqual(self.req(orphan['url'])[0], 404)

    def test_feature_flags_friend_avatars_order_and_profile_background(self):
        self.login()
        first, first_data = self.record('posts', published=True, title='置顶', pinned=True, featured=True)
        self.record('posts', published=True, title='较新')
        self.assertEqual(self.public()['posts'][0]['id'], first)
        self.assertEqual(self.req(f'/api/posts/{first}', 'PUT', {'title': '保持设置', 'body': ''})[0], 200)
        self.assertTrue(self.public()['posts'][0]['pinned'])
        for invalid in (1, 'true', None):
            self.assertEqual(self.req(f'/api/posts/{first}', 'PUT', dict(first_data, featured=invalid))[0], 400)
        one, one_data = self.record('friends', published=True, title='first', order=20)
        two, _ = self.record('friends', published=True, title='second', order=-5)
        self.assertEqual([row['id'] for row in self.public()['friends']], [two, one])
        avatar = self.upload('friend', one, 'avatar')
        friend = next(row for row in self.public()['friends'] if row['id'] == one)
        self.assertEqual(friend['avatar_url'], avatar['url'])
        self.assertEqual(self.req(avatar['url'], client=self.anonymous)[0], 200)
        one_data['published'] = False
        self.assertEqual(self.req(f'/api/friends/{one}', 'PUT', one_data)[0], 200)
        self.assertEqual(self.req(avatar['url'], client=self.anonymous)[0], 404)
        self.assertEqual(self.req(f'/api/friends/{one}', 'DELETE', {})[0], 200)
        self.assertEqual(self.req(avatar['url'])[0], 404)
        for invalid in ('1', True, 1.5):
            self.assertEqual(self.req(f'/api/friends/{two}', 'PUT', {'title': 'x', 'url': self.origin, 'order': invalid})[0], 400)
        background = self.upload('profile', '1', 'background')
        self.assertEqual(self.public()['profile']['background_url'], background['url'])
        self.assertEqual(self.req(background['url'], client=self.anonymous)[0], 200)
        self.assertEqual(self.req('/api/profile', 'PUT', {'bio': '换简介'})[0], 200)
        self.assertEqual(self.public()['profile']['background_url'], background['url'])
        replacement = self.upload('profile', '1', 'background', baseline.jpeg(b'background'))
        self.assertEqual(self.req(background['url'])[0], 404)
        self.restart()
        self.login()
        self.assertEqual(self.public()['profile']['background_url'], replacement['url'])
        self.assertEqual(self.req('/api/media/' + replacement['id'], 'DELETE', {})[0], 200)
        self.assertIsNone(self.public()['profile']['background_url'])

    def test_export_contains_markdown_and_offline_images_for_single_and_all(self):
        self.login()
        self.draft('published', kind='posts', title='导出文章', published=True)
        image = self.upload('draft', 'published')
        cover = self.upload('draft', 'published', 'cover', baseline.jpeg(b'export cover'))
        self.draft('published', body=f"正文\n\n![正文图]({image['url']})")
        ident = self.commit('published')['id']
        self.draft('unfinished', kind='notes', body='未完成草稿')
        draft_image = self.upload('draft', 'unfinished')
        self.draft('unfinished', body=f"![草稿图]({draft_image['url']})")
        status, blob, headers = self.req(f'/api/export/posts/{ident}.zip')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'application/zip')
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            markdown = archive.read(f'posts/{ident}.md').decode()
            self.assertIn('导出文章', markdown)
            self.assertIn(f"../images/{image['id']}.jpg", markdown)
            self.assertIn(f'../images/cover-{ident}.jpg', markdown)
            self.assertNotIn('/media/', markdown)
            self.assertEqual(archive.read(f"images/{image['id']}.jpg"), baseline.jpeg())
            self.assertEqual(archive.read(f'images/cover-{ident}.jpg'), baseline.jpeg(b'export cover'))
            self.assertNotIn('drafts/unfinished.md', archive.namelist())
        status, blob, _ = self.req('/api/export.zip')
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            self.assertIn('drafts/unfinished.md', archive.namelist())
            self.assertEqual(archive.read(f"images/{draft_image['id']}.jpg"), baseline.jpeg())
            self.assertIn('profile.md', archive.namelist())
        self.assertEqual(self.req('/api/export/posts/9999.zip')[0], 404)
        self.assertEqual(self.req('/api/export.zip', client=self.anonymous)[0], 401)


class JpegDimensions(unittest.TestCase):
    def test_real_jpeg_dimensions_and_cover_bytes_are_preserved(self):
        for raw, dimensions in ((baseline.jpeg(), (2, 2)), (baseline.jpeg(b'image comment'), (2, 2)), (LANDSCAPE_JPEG, (7, 3))):
            self.assertEqual(server.jpeg_dimensions(raw), dimensions)
            self.assertEqual(server.cover_data(baseline.cover_payload(raw)), raw)

    def test_invalid_jpeg_frames_and_segments_keep_cover_validation(self):
        original = baseline.jpeg()
        frame = original.index(b'\xff\xc0')
        zero_dimensions = original[:frame + 5] + b'\x00\x00\x00\x00' + original[frame + 9:]
        for raw in (b'not a jpeg', b'\xff\xd8\xff\xd9', original[:-2],
                    b'\xff\xd8\xff\xe0\xff\xff\x00\xff\xd9',
                    original[:original.index(b'\xff\xda')] + b'\xff\xd9', zero_dimensions):
            with self.subTest(raw=raw[:20]):
                with self.assertRaisesRegex(ValueError, '封面 JPEG 图片无效'):
                    server.jpeg_dimensions(raw)
                with self.assertRaisesRegex(ValueError, '封面 JPEG 图片无效'):
                    server.cover_data(baseline.cover_payload(raw))


if __name__ == '__main__':
    unittest.main(verbosity=2)
