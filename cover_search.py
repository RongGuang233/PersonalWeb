"""On-demand covers from Bangumi, Douban and Steam public search endpoints.

Search is intentionally limited to these catalogues. Images are only returned
for browser preview/normalization; this module never writes uploaded images.
"""

import http.client
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request


CATEGORIES = ('动画', '漫画', '游戏', '小说', '书籍', '影视')
MAX_IMAGE_BYTES = 8 * 1024 * 1024
TIMEOUT = 12
USER_AGENT = 'personal-website-cover-search/1.0'


class CoverSourceError(RuntimeError):
    """An upstream catalogue or image could not be read; suitable for HTTP 502."""


def _validate_image_url(url):
    if not isinstance(url, str) or len(url) > 2048 or any(ord(c) < 33 for c in url):
        raise ValueError('封面链接无效')
    try:
        parsed = urllib.parse.urlsplit(url)
        valid = (parsed.scheme == 'https' and not parsed.username and not parsed.password
                 and parsed.port in (None, 443) and not parsed.fragment)
    except ValueError:
        raise ValueError('封面链接无效') from None
    if re.fullmatch(r'img[0-9]\.doubanio\.com', parsed.hostname or ''):
        valid = valid and not parsed.query and re.fullmatch(
            r'/view/(?:photo/s_ratio_poster|subject/[sl])/public/[ps][0-9]+\.(?:jpg|webp|png)', parsed.path)
    elif parsed.hostname == 'shared.akamai.steamstatic.com':
        valid = valid and re.fullmatch(r'(?:t=[0-9]+)?', parsed.query) and re.fullmatch(
            r'/store_item_assets/steam/apps/[0-9]+/(?:[0-9a-f]{40}/)?(?:header|capsule_[0-9]+x[0-9]+)(?:_[a-z]+)?\.(?:jpg|png)', parsed.path)
    elif parsed.hostname == 'lain.bgm.tv':
        valid = valid and not parsed.query and re.fullmatch(
            r'/pic/cover/[scmlg]/[0-9a-f]{2}/[0-9a-f]{2}/[0-9]+_[A-Za-z0-9]+\.(?:jpg|jpeg|webp|png)', parsed.path)
    else:
        valid = False
    if not valid:
        raise ValueError('仅支持搜索来源的 HTTPS 封面图片链接')


class _ImageRedirects(urllib.request.HTTPRedirectHandler):
    max_redirections = 3
    max_repeats = 1

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            _validate_image_url(newurl)
        except ValueError as exc:
            raise CoverSourceError('封面来源返回了不支持的重定向') from exc
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CoverSourceError('搜索来源暂时不可用（地址已变更）')


def _read_response(response, limit):
    length = response.headers.get('Content-Length')
    if length:
        try:
            if int(length) > limit:
                raise CoverSourceError('来源内容超过大小限制')
        except ValueError:
            raise CoverSourceError('来源响应格式异常') from None
    deadline = time.monotonic() + TIMEOUT
    chunks, size = [], 0
    while True:
        if time.monotonic() > deadline:
            raise CoverSourceError('读取来源超时，请稍后重试')
        chunk = response.read(min(65536, limit + 1 - size))
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if size > limit:
            raise CoverSourceError('来源内容超过大小限制')
    return b''.join(chunks)


def _json_request(url):
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    host = urllib.parse.urlsplit(url).hostname
    if host in ('movie.douban.com', 'book.douban.com'):
        headers['Referer'] = f'https://{host}/'
    elif host in ('api.bgm.tv', 'lain.bgm.tv'):
        headers['Referer'] = 'https://bgm.tv/'
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.build_opener(_NoRedirects()).open(request, timeout=TIMEOUT) as response:
            data = json.loads(_read_response(response, 1024 * 1024))
        if not isinstance(data, (dict, list)):
            raise ValueError('Expected JSON object or list')
        return data
    except (OSError, ValueError, http.client.HTTPException) as exc:
        raise CoverSourceError('搜索来源暂时不可用，请稍后重试') from exc


def _narrow_titles(query, results):
    # Catalogues also return loosely related titles. Narrow only when an exact
    # title exists, since substring-only matches can be spinoffs of an alias
    # (e.g. 海贼王 第0卷 must not hide the main 航海王 entry).
    normalized = re.sub(r'[\W_]+', '', query).casefold()
    title_keys = [re.sub(r'[\W_]+', '', item['title']).casefold() for item in results]
    if normalized in title_keys:
        results = [item for item, key in zip(results, title_keys) if normalized in key]
    return results


def _douban(query, category):
    books = category in ('漫画', '小说', '书籍')
    host = 'book.douban.com' if books else 'movie.douban.com'
    data = _json_request(f'https://{host}/j/subject_suggest?' + urllib.parse.urlencode({'q': query}))
    if not isinstance(data, list):
        raise CoverSourceError('豆瓣返回了无法识别的搜索结果')
    results = []
    for item in data:
        if not isinstance(item, dict) or item.get('type') != ('b' if books else 'movie'):
            continue
        ident, title = item.get('id'), item.get('title')
        if not isinstance(ident, str) or not ident.isascii() or not ident.isdigit() or not isinstance(title, str) or not title.strip():
            continue
        episode = item.get('episode')
        # This public suggestion endpoint exposes episodes, not a movie/tv enum.
        # An absent field remains unknown instead of being labelled a film.
        has_episodes = isinstance(episode, str) and episode.isdigit() and int(episode) > 0
        image_url = item.get('pic' if books else 'img')
        try:
            _validate_image_url(image_url)
        except ValueError:
            continue
        if books:
            image_url = image_url.replace('/view/subject/s/', '/view/subject/l/')
        kind = '图书' if books else (f'剧集 · {episode} 集' if has_episodes else '影视')
        parts = [kind] + [item[k] for k in ('year', 'author_name') if isinstance(item.get(k), str) and item[k]]
        results.append({'title': title, 'subtitle': ' · '.join(parts), 'image_url': image_url,
                        'source': '豆瓣读书' if books else '豆瓣电影',
                        'source_url': f'https://{host}/subject/{ident}/'})
    return _narrow_titles(query, results)


def _bangumi(query):
    """Anime covers from Bangumi subject search; Chinese titles work well."""
    data = _json_request('https://api.bgm.tv/search/subject/' + urllib.parse.quote(query) + '?type=2&responseGroup=small')
    if not isinstance(data, dict) or not isinstance(data.get('list'), list):
        raise CoverSourceError('Bangumi 返回了无法识别的搜索结果')
    results = []
    for item in data['list']:
        if not isinstance(item, dict) or item.get('type') != 2:
            continue
        ident, title = item.get('id'), item.get('name_cn') or item.get('name')
        if not isinstance(ident, int) or ident <= 0 or not isinstance(title, str) or not title.strip():
            continue
        images = item.get('images') if isinstance(item.get('images'), dict) else {}
        image_url = images.get('large') or images.get('common') or images.get('medium') or images.get('small')
        if isinstance(image_url, str) and image_url.startswith('http://'):
            image_url = 'https://' + image_url[len('http://'):]
        try:
            _validate_image_url(image_url)
        except ValueError:
            continue
        air_date = item.get('air_date') if isinstance(item.get('air_date'), str) else ''
        name = item.get('name') if isinstance(item.get('name'), str) else ''
        parts = ['动画']
        if air_date:
            parts.append(air_date[:4] if len(air_date) >= 4 else air_date)
        if name and name.strip() and name.strip() != title.strip():
            parts.append(name.strip())
        results.append({'title': title, 'subtitle': ' · '.join(parts),
                        'image_url': image_url, 'source': 'Bangumi',
                        'source_url': f'https://bgm.tv/subject/{ident}/'})
    return _narrow_titles(query, results)


def _steam(query):
    params = urllib.parse.urlencode({'term': query, 'l': 'schinese', 'cc': 'cn'})
    data = _json_request('https://store.steampowered.com/api/storesearch/?' + params)
    if not isinstance(data, dict) or not isinstance(data.get('items'), list):
        raise CoverSourceError('Steam 返回了无法识别的搜索结果')
    results = []
    for item in data['items']:
        if not isinstance(item, dict) or item.get('type') != 'app':
            continue
        ident, title, image_url = item.get('id'), item.get('name'), item.get('tiny_image')
        if not isinstance(ident, int) or ident <= 0 or not isinstance(title, str) or not title.strip():
            continue
        try:
            _validate_image_url(image_url)
        except ValueError:
            continue
        results.append({'title': title, 'subtitle': 'Steam 商店条目 · 横版图片',
                        'image_url': image_url, 'source': 'Steam',
                        'source_url': f'https://store.steampowered.com/app/{ident}/'})
    results = _narrow_titles(query, results)[:8]
    # Improve the most likely match with the official larger header. Avoid an
    # extra request for every suggestion; other candidates retain real thumbnails.
    if results:
        ident = results[0]['source_url'].rstrip('/').rsplit('/', 1)[-1]
        params = urllib.parse.urlencode({'appids': ident, 'l': 'schinese', 'cc': 'cn'})
        try:
            details = _json_request('https://store.steampowered.com/api/appdetails?' + params)
            entry = details.get(ident) if isinstance(details, dict) else None
            info = entry.get('data') if isinstance(entry, dict) and entry.get('success') else None
            if isinstance(info, dict):
                _validate_image_url(info.get('header_image'))
                results[0]['image_url'] = info['header_image']
                release = info.get('release_date')
                if isinstance(release, dict) and isinstance(release.get('date'), str):
                    results[0]['subtitle'] = release['date'] + ' · Steam 横版图片'
        except (CoverSourceError, ValueError):
            pass  # The already returned official thumbnail remains usable.
    return results


def search_covers(query, category):
    """Return up to eight candidates; distinguish catalogue failure from no match.

    Invalid input raises ValueError. Source failures appear in message and are
    distinct from a successful search with no usable cover.
    """
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 120:
        raise ValueError('作品名需为 1–120 个字符')
    if category not in CATEGORIES:
        raise ValueError('请选择有效的作品分类')
    query = query.strip()
    try:
        if category == '游戏':
            candidates = _steam(query)
        elif category == '动画':
            candidates = _bangumi(query)
        else:
            candidates = _douban(query, category)
    except CoverSourceError:
        if category == '动画':
            try:
                candidates = _douban(query, category)
            except CoverSourceError:
                return {'results': [], 'message': 'Bangumi 与豆瓣暂时无法访问，请稍后重试或手动上传封面。'}
        else:
            name = 'Steam' if category == '游戏' else '豆瓣'
            return {'results': [], 'message': name + ' 暂时无法访问，请稍后重试或手动上传封面。'}
    results, seen = [], set()
    for item in candidates:
        if item['source_url'] not in seen:
            seen.add(item['source_url'])
            results.append(item)
    if not results:
        message = ('Steam 未收录该游戏或未找到带图片的匹配条目。' if category == '游戏'
                   else '当前来源未找到带封面的匹配作品。')
        return {'results': [], 'message': message + '可尝试原名、别名，或手动上传封面。'}
    message = '请核对名称、年份和版本后点选。'
    if results and results[0]['source'] == '豆瓣读书':
        message = '图书候选：请核对作者和版本。'
    elif results and category == '动画' and results[0]['source'] == 'Bangumi':
        message = '动画候选：请核对季度与版本。'
    elif results and category == '动画' and results[0]['source'] == '豆瓣电影':
        message = '影视候选：请确认选择动画版。'
    return {'results': results[:8], 'message': message}


def fetch_cover_image(url):
    """Read a supported HTTPS catalogue image, at most 8 MiB; never arbitrary URLs."""
    _validate_image_url(url)
    headers = {'User-Agent': USER_AGENT, 'Accept': 'image/*'}
    parsed = urllib.parse.urlsplit(url)
    if re.fullmatch(r'img[0-9]\.doubanio\.com', parsed.hostname or ''):
        headers['Referer'] = 'https://book.douban.com/' if parsed.path.startswith('/view/subject/') else 'https://movie.douban.com/'
    elif parsed.hostname == 'lain.bgm.tv':
        headers['Referer'] = 'https://bgm.tv/'
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.build_opener(_ImageRedirects()).open(request, timeout=TIMEOUT) as response:
            _validate_image_url(response.geturl())
            raw = _read_response(response, MAX_IMAGE_BYTES)
        # Return only raster data; the browser decodes and normalizes before upload.
        if raw.startswith(b'\xff\xd8\xff'):
            content_type = 'image/jpeg'
        elif raw.startswith(b'\x89PNG\r\n\x1a\n'):
            content_type = 'image/png'
        elif raw.startswith((b'GIF87a', b'GIF89a')):
            content_type = 'image/gif'
        elif len(raw) >= 12 and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
            content_type = 'image/webp'
        else:
            raise CoverSourceError('来源未返回可用的封面图片')
        return raw, content_type
    except (OSError, ValueError, http.client.HTTPException) as exc:
        raise CoverSourceError('封面读取失败，请稍后重试或选择其他图片') from exc
