import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import test_server as baseline
import server


class WorkVisibility(unittest.TestCase):
    setUp = baseline.Integration.setUp
    tearDown = baseline.Integration.tearDown
    start = baseline.Integration.start
    stop = baseline.Integration.stop
    restart = baseline.Integration.restart
    req = baseline.Integration.req
    login = baseline.Integration.login
    public = baseline.Integration.public
    record = baseline.Integration.record

    def test_category_hide_restore_preserves_records_and_individual_visibility(self):
        path = '/api/works/categories/visibility'
        self.assertEqual(self.req(path)[0], 401)
        self.assertEqual(self.req(path, 'PUT', {'hidden_categories': ['动画']})[0], 401)
        self.login()
        anime, _ = self.record('works', title='公开动画', category='动画', published=True)
        private, _ = self.record('works', title='私人动画', category='动画', published=False)
        game, _ = self.record('works', title='公开游戏', category='游戏', published=True)
        self.assertEqual(self.req(f'/api/works/{anime}/cover', 'POST', baseline.cover_payload(baseline.jpeg()))[0], 200)
        server.init()  # Complete existing work metadata migration before comparing untouched records.
        before = json.loads(self.req('/api/works')[1])
        self.assertEqual(self.public()['hidden_work_categories'], [])
        self.assertEqual(self.req(path, 'PUT', {'hidden_categories': ['动画']})[0], 200)
        self.assertEqual([row['id'] for row in self.public()['works']], [game])
        for url in (f'/read/works/{anime}', f'/covers/{anime}.jpg'):
            self.assertEqual(self.req(url, client=self.anonymous)[0], 404)
        self.assertEqual(self.req(f'/covers/{anime}.jpg')[0], 200)
        self.assertEqual(json.loads(self.req('/api/works')[1]), before)
        self.restart()
        self.login()
        self.assertEqual(json.loads(self.req(path)[1])['hidden_categories'], ['动画'])
        self.assertEqual([row['id'] for row in self.public()['works']], [game])
        for hidden in (['unknown'], '动画', [False], None):
            self.assertEqual(self.req(path, 'PUT', {'hidden_categories': hidden})[0], 400)
        self.assertEqual(self.req(path, 'PUT', {'hidden_categories': []})[0], 200)
        self.assertEqual({row['id'] for row in self.public()['works']}, {anime, game})
        self.assertNotIn(private, {row['id'] for row in self.public()['works']})
        self.assertEqual(self.req(f'/read/works/{anime}', client=self.anonymous)[0], 200)
        self.assertEqual(self.req(f'/covers/{anime}.jpg', client=self.anonymous)[0], 200)
        self.assertEqual(json.loads(self.req('/api/works')[1]), before)

    def test_all_categories_can_be_hidden_and_new_works_stay_hidden(self):
        self.login()
        path = '/api/works/categories/visibility'
        self.assertEqual(self.req(path, 'PUT', {'hidden_categories': server.CATEGORIES})[0], 200)
        for name in server.CATEGORIES:
            self.record('works', title=name, category=name, published=True)
        self.assertEqual(self.public()['works'], [])
        self.assertEqual(len(json.loads(self.req('/api/works')[1])), len(server.CATEGORIES))
        self.assertEqual(self.req(path, 'PUT', {'hidden_categories': []})[0], 200)
        self.assertEqual(len(self.public()['works']), len(server.CATEGORIES))


class WorkVisibilityMigration(unittest.TestCase):
    def test_existing_profile_defaults_visible_and_repeated_init_preserves_setting(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'DB', Path(directory) / 'site.sqlite3'):
            with sqlite3.connect(server.DB) as connection:
                connection.execute('CREATE TABLE profile (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, bio TEXT NOT NULL, avatar BLOB)')
                connection.execute("INSERT INTO profile VALUES (1,'原始名称','原始简介',NULL)")
            server.init()
            with server.connect() as connection:
                self.assertEqual(server.hidden_work_categories(connection), [])
                self.assertEqual(server.profile_data(connection)['name'], '原始名称')
                connection.execute('UPDATE profile SET hidden_work_categories=? WHERE id=1', (json.dumps(['游戏']),))
            server.init()
            with server.connect() as connection:
                self.assertEqual(server.hidden_work_categories(connection), ['游戏'])
