import io
from pathlib import Path
import sys
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cover_search as covers

IMAGE_URL = 'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2545472803.jpg'
BOOK_IMAGE = 'https://img3.doubanio.com/view/subject/s/public/s27060187.jpg'
STEAM_IMAGE = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2358720/801e841a7975fc29967e30cf799084f4b2987b77/capsule_231x87_schinese.jpg?t=1760601605'
STEAM_HEADER = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2358720/header_schinese.jpg?t=1760601605'


def movie(ident='1', title='流浪地球', episode=''):
    return {'id': ident, 'title': title, 'type': 'movie', 'episode': episode,
            'img': IMAGE_URL, 'year': '2019'}


def game(ident=2358720, name='黑神话：悟空'):
    return {'id': ident, 'name': name, 'type': 'app', 'tiny_image': STEAM_IMAGE}


class Response(io.BytesIO):
    def __init__(self, body, headers=None, url=IMAGE_URL):
        super().__init__(body)
        self.headers = headers or {}
        self.url = url

    def geturl(self):
        return self.url


class SearchTests(unittest.TestCase):
    def test_query_validation_does_not_contact_source(self):
        with patch.object(covers, '_json_request') as request:
            for query, category in [('', '电影'), ('  ', '电影'), ('x' * 121, '电影'),
                                    (None, '电影'), ('x', 'movie'), ('x', None)]:
                with self.subTest(query=query, category=category), self.assertRaises(ValueError):
                    covers.search_covers(query, category)
            request.assert_not_called()

    def test_movie_tv_episode_filter_keeps_episode_format(self):
        data = [movie('1', '流浪地球'), movie('2', '庆余年 第一季', '46')]
        for category, expected in [('电影', ['1']), ('电视剧', ['2'])]:
            with self.subTest(category=category), patch.object(covers, '_json_request', return_value=data) as request:
                result = covers.search_covers('作品', category)
                self.assertEqual([r['source_url'].split('/')[-2] for r in result['results']], expected)
                self.assertIn('movie.douban.com/j/subject_suggest?', request.call_args.args[0])
        with patch.object(covers, '_json_request', return_value=[movie('2', '庆余年', '46')]):
            self.assertIn('46 集', covers.search_covers('庆余年', '电视剧')['results'][0]['subtitle'])

    def test_anime_uses_bangumi_and_upgrades_image_scheme(self):
        BANGUMI_IMAGE = 'https://lain.bgm.tv/pic/cover/l/13/c5/400602_ZI8Y9.jpg'
        data = {'results': 1, 'list': [{
            'id': 400602, 'type': 2, 'name': '葬送のフリーレン', 'name_cn': '葬送的芙莉莲',
            'air_date': '2023-09-29',
            'images': {'large': BANGUMI_IMAGE.replace('https://', 'http://')},
        }]}
        with patch.object(covers, '_json_request', return_value=data) as request:
            result = covers.search_covers('葬送的芙莉莲', '动画')
        item = result['results'][0]
        self.assertEqual(item['source'], 'Bangumi')
        self.assertEqual(item['title'], '葬送的芙莉莲')
        self.assertEqual(item['image_url'], BANGUMI_IMAGE)
        self.assertEqual(item['source_url'], 'https://bgm.tv/subject/400602/')
        self.assertIn('葬送のフリーレン', item['subtitle'])
        self.assertIn('api.bgm.tv/search/subject/', request.call_args.args[0])
        self.assertIn('动画候选', result['message'])

    def test_book_categories_use_large_cover_and_disclose_subtype_limits(self):
        data = [{'title': '遮天1·九龙拉棺', 'id': '11502594', 'pic': BOOK_IMAGE,
                 'author_name': '辰东', 'year': '2012', 'type': 'b'}]
        for category in ('漫画', '小说', '出版书籍'):
            with self.subTest(category=category), patch.object(covers, '_json_request', return_value=data) as request:
                result = covers.search_covers(' 遮天 ', category)
                item = result['results'][0]
                self.assertEqual(item['source'], '豆瓣读书')
                self.assertEqual(item['image_url'], BOOK_IMAGE.replace('/s/', '/l/'))
                self.assertIn('辰东', item['subtitle'])
                self.assertEqual('图书候选：请核对作者和版本。', result['message'])
                self.assertIn('book.douban.com/j/subject_suggest?', request.call_args.args[0])

    def test_steam_uses_real_header_for_first_match_only(self):
        data = {'items': [game(), game(2, '黑神话：悟空 豪华升级包'), game(3, '无关游戏')]}
        details = {'2358720': {'success': True, 'data': {'header_image': STEAM_HEADER,
                                                       'release_date': {'date': '2024 年 8 月 19 日'}}}}
        with patch.object(covers, '_json_request', side_effect=[data, details]) as request:
            result = covers.search_covers('黑神话 悟空', '游戏')
        self.assertEqual(len(result['results']), 2)
        self.assertEqual(result['results'][0]['image_url'], STEAM_HEADER)
        self.assertEqual(result['results'][1]['image_url'], STEAM_IMAGE)
        self.assertIn('2024', result['results'][0]['subtitle'])
        self.assertEqual(request.call_count, 2)

    def test_steam_detail_failure_preserves_usable_thumbnail(self):
        for details in [covers.CoverSourceError('timeout'), [], {'2358720': {'success': False}}]:
            with self.subTest(details=details), patch.object(covers, '_json_request', side_effect=[{'items': [game()]}, details]):
                self.assertEqual(covers.search_covers('黑神话', '游戏')['results'][0]['image_url'], STEAM_IMAGE)

    def test_source_failure_empty_and_wrong_schema_are_distinct_without_fallbacks(self):
        with patch.object(covers, '_json_request', return_value={'items': []}) as request:
            empty = covers.search_covers('原神', '游戏')
            self.assertEqual(request.call_count, 1)
        with patch.object(covers, '_json_request', side_effect=covers.CoverSourceError('timeout')) as request:
            failure = covers.search_covers('原神', '游戏')
            self.assertEqual(request.call_count, 1)
        with patch.object(covers, '_json_request', return_value={'error': 'schema changed'}):
            malformed = covers.search_covers('电影', '电影')
        self.assertIn('未收录', empty['message'])
        self.assertIn('暂时无法访问', failure['message'])
        self.assertIn('暂时无法访问', malformed['message'])

    def test_eight_result_limit_duplicate_sources_and_bad_entries(self):
        invalid = movie('20')
        invalid['img'] = 'https://example.org/cover.jpg'
        data = [movie('1'), movie('1'), invalid, None, {'id': []}] + [movie(str(i)) for i in range(2, 15)]
        with patch.object(covers, '_json_request', return_value=data):
            result = covers.search_covers('流浪地球', '电影')
        self.assertEqual(len(result['results']), 8)
        self.assertEqual(len({x['source_url'] for x in result['results']}), 8)

    def test_exact_title_excludes_noise_but_alias_match_remains(self):
        with patch.object(covers, '_json_request', return_value=[movie('1'), movie('2', '无关电影')]):
            self.assertEqual(len(covers.search_covers('流浪地球', '电影')['results']), 1)
        data = [{'id': '1', 'type': 'b', 'title': '海贼王 第0卷', 'pic': BOOK_IMAGE},
                {'id': '2', 'type': 'b', 'title': '航海王', 'pic': BOOK_IMAGE}]
        with patch.object(covers, '_json_request', return_value=data):
            self.assertEqual(len(covers.search_covers('海贼王', '漫画')['results']), 2)

    def test_json_transport_errors_wrapped_and_lists_accepted(self):
        with patch.object(urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = urllib.error.URLError('unavailable')
            with self.assertRaises(covers.CoverSourceError):
                covers._json_request('https://movie.douban.com/j/subject_suggest?q=x')
        for body in [b'<html>error</html>', b'42']:
            with patch.object(urllib.request, 'build_opener') as build:
                build.return_value.open.return_value = Response(body)
                with self.assertRaises(covers.CoverSourceError):
                    covers._json_request('https://movie.douban.com/j/subject_suggest?q=x')
        with patch.object(urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = Response(b'[]')
            self.assertEqual(covers._json_request('https://movie.douban.com/j/subject_suggest?q=x'), [])
            self.assertEqual(build.return_value.open.call_args.args[0].get_header('Referer'), 'https://movie.douban.com/')


class ImageTests(unittest.TestCase):
    def test_only_supported_cover_paths_are_accepted_before_network(self):
        urls = ['http://img3.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg',
                'https://localhost/cover.jpg', 'https://127.0.0.1/cover.jpg',
                IMAGE_URL.replace('doubanio.com', 'doubanio.com.evil.example'),
                IMAGE_URL.replace('https://', 'https://user@'), IMAGE_URL + '#x',
                IMAGE_URL + '?url=http://localhost', IMAGE_URL.replace('.com/', '.com:8443/'),
                'https://img3.doubanio.com/../private', STEAM_IMAGE + '&redirect=http://localhost',
                'https://shared.akamai.steamstatic.com/private/header.jpg',
                'https://lain.bgm.tv/pic/cover/l/25/7a/test.jpg',
                'https://lain.bgm.tv/private/cover.jpg',
                'https://lain.bgm.tv/pic/cover/l/25/7a/400602_ZI8Y9.jpg?x=1',
                '\n' + IMAGE_URL, None]
        with patch.object(urllib.request, 'build_opener') as build:
            for url in urls:
                with self.subTest(url=url), self.assertRaises(ValueError):
                    covers.fetch_cover_image(url)
            build.assert_not_called()

    def test_referer_matches_douban_image_source_and_keeps_custom_user_agent(self):
        for url, referer in [(IMAGE_URL, 'https://movie.douban.com/'),
                             (BOOK_IMAGE, 'https://book.douban.com/'),
                             (STEAM_HEADER, None),
                             ('https://lain.bgm.tv/pic/cover/l/13/c5/400602_ZI8Y9.jpg', 'https://bgm.tv/')]:
            with self.subTest(url=url), patch.object(urllib.request, 'build_opener') as build:
                build.return_value.open.return_value = Response(b'\xff\xd8\xffdata', url=url)
                covers.fetch_cover_image(url)
                req = build.return_value.open.call_args.args[0]
                self.assertEqual(req.get_header('Referer'), referer)
                self.assertEqual(req.get_header('User-agent'), covers.USER_AGENT)

    def test_raster_types_sniffed_and_html_rejected(self):
        for raw, expected in [(b'\xff\xd8\xffdata', 'image/jpeg'),
                              (b'\x89PNG\r\n\x1a\ndata', 'image/png'),
                              (b'GIF89adata', 'image/gif'), (b'RIFF0000WEBPdata', 'image/webp')]:
            with self.subTest(expected=expected), patch.object(urllib.request, 'build_opener') as build:
                build.return_value.open.return_value = Response(raw)
                self.assertEqual(covers.fetch_cover_image(IMAGE_URL), (raw, expected))
                self.assertEqual(build.return_value.open.call_args.kwargs['timeout'], covers.TIMEOUT)
        with patch.object(urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = Response(b'<svg onload="bad()"></svg>')
            with self.assertRaises(covers.CoverSourceError):
                covers.fetch_cover_image(IMAGE_URL)

    def test_redirect_target_checked_before_opening(self):
        handler = covers._ImageRedirects()
        request = urllib.request.Request(IMAGE_URL)
        for target in ['http://localhost/secret', 'https://evil.example/payload',
                       'https://img3.doubanio.com/private', 'https://archive.org/download/file']:
            with self.subTest(target=target), self.assertRaises(covers.CoverSourceError):
                handler.redirect_request(request, None, 302, 'Found', {}, target)
        self.assertEqual(handler.redirect_request(request, None, 302, 'Found', {}, BOOK_IMAGE).full_url, BOOK_IMAGE)

    def test_size_limit_with_or_without_content_length(self):
        for headers, body in [({'Content-Length': '17'}, b'\xff\xd8\xff'), ({}, b'\xff\xd8\xff' + b'x' * 14)]:
            with self.subTest(headers=headers), patch.object(covers, 'MAX_IMAGE_BYTES', 16), \
                 patch.object(urllib.request, 'build_opener') as build:
                build.return_value.open.return_value = Response(body, headers)
                with self.assertRaisesRegex(covers.CoverSourceError, '大小限制'):
                    covers.fetch_cover_image(IMAGE_URL)

    def test_timeout_and_final_url_errors_wrapped(self):
        with patch.object(urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = TimeoutError()
            with self.assertRaises(covers.CoverSourceError):
                covers.fetch_cover_image(IMAGE_URL)
        with patch.object(urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = Response(b'\xff\xd8\xff', url='http://localhost/')
            with self.assertRaises(covers.CoverSourceError):
                covers.fetch_cover_image(IMAGE_URL)
        with patch.object(covers.time, 'monotonic', side_effect=[0, covers.TIMEOUT + 1]):
            with self.assertRaisesRegex(covers.CoverSourceError, '超时'):
                covers._read_response(Response(b'data'), 16)


if __name__ == '__main__':
    unittest.main()
