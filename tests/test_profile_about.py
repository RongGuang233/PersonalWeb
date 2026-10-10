import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import test_server as baseline
import server


class ProfileMigration(unittest.TestCase):
    def test_old_profile_migrates_repeatedly_without_changing_existing_values(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'DB', Path(folder) / 'site.sqlite3'):
            with sqlite3.connect(server.DB) as connection:
                connection.execute('CREATE TABLE profile (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, bio TEXT NOT NULL, avatar BLOB)')
                connection.execute('INSERT INTO profile VALUES (1,?,?,?)', ('原名称', '原简介', b'original-avatar'))
            server.init()
            with server.connect() as connection:
                row = connection.execute('SELECT * FROM profile').fetchone()
                self.assertEqual((row['name'], row['bio'], row['avatar'], row['about']), ('原名称', '原简介', b'original-avatar', ''))
                self.assertEqual(row['experience'], '两年家教经历。')
                self.assertEqual(json.loads(row['students']), [])
                students = [{'surname': '欧阳', 'subjects': '数学', 'university': '某大学'}]
                connection.execute('UPDATE profile SET about=?,experience=?,students=? WHERE id=1', ('## 兴趣\n\n阅读与游戏', '已保存的经历', json.dumps(students, ensure_ascii=False)))
            server.init()
            with server.connect() as connection:
                row = connection.execute('SELECT * FROM profile').fetchone()
                self.assertEqual((row['name'], row['bio'], row['avatar'], row['about']), ('原名称', '原简介', b'original-avatar', '## 兴趣\n\n阅读与游戏'))
                self.assertEqual(row['experience'], '已保存的经历')
                self.assertEqual(json.loads(row['students']), students)

    def test_new_database_has_empty_about(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'DB', Path(folder) / 'nested' / 'site.sqlite3'):
            server.init()
            with server.connect() as connection:
                profile = server.profile_data(connection)
                self.assertEqual(profile['about'], '')
                self.assertEqual(profile['name'], server.DEFAULT_NAME)
                self.assertEqual(profile['bio'], server.DEFAULT_BIO)
                self.assertIsNone(profile['avatar_url'])
                self.assertEqual(profile['experience'], '两年家教经历。')
                self.assertEqual(profile['students'], [])

    def test_explicit_empty_new_fields_survive_reinitialization(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'DB', Path(folder) / 'site.sqlite3'):
            server.init()
            with server.connect() as connection:
                connection.execute("UPDATE profile SET experience='',students='[]' WHERE id=1")
            server.init()
            with server.connect() as connection:
                profile = server.profile_data(connection)
                self.assertEqual(profile['experience'], '')
                self.assertEqual(profile['students'], [])


class ProfileAbout(unittest.TestCase):
    setUp = baseline.Integration.setUp
    tearDown = baseline.Integration.tearDown
    start = baseline.Integration.start
    stop = baseline.Integration.stop
    req = baseline.Integration.req
    login = baseline.Integration.login
    public = baseline.Integration.public

    def test_update_omit_clear_public_profile_and_export(self):
        self.assertEqual(self.public()['profile']['about'], '')
        self.assertEqual(self.req('/api/profile')[0], 401)
        self.login()
        about = '## 正在做什么\n\n  保留 Markdown 空格与换行。\n'
        status, body, _ = self.req('/api/profile', 'PUT', {'about': about})
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)['about'], about)
        self.assertEqual(self.public()['profile']['about'], about)
        self.assertEqual(json.loads(self.req('/api/profile')[1])['about'], about)
        status, body, _ = self.req('/api/profile', 'PUT', {'name': '新名称', 'bio': '短简介'})
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)['about'], about)
        status, archive, _ = self.req('/api/export.zip')
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(archive)) as exported:
            self.assertEqual(exported.read('profile.md').decode(), '# 新名称\n\n短简介\n\n' + about + '\n\n## 经历\n\n两年家教经历。\n')
        status, body, _ = self.req('/api/profile', 'PUT', {'about': ''})
        self.assertEqual(status, 200, body)
        self.assertEqual(self.public()['profile']['about'], '')

    def test_unicode_length_and_invalid_updates_preserve_previous_profile(self):
        self.login()
        # JSON escapes use two surrogate escapes per emoji; limits count Unicode characters.
        about = '🌟' * 20000
        status, body, _ = self.req('/api/profile', 'PUT', {'about': about})
        self.assertEqual(status, 200, body[:200])
        self.assertEqual(json.loads(body)['about'], about)
        for invalid in (about + '星', None, 42, True, [], {}):
            with self.subTest(value_type=type(invalid).__name__):
                status, body, _ = self.req('/api/profile', 'PUT', {'name': '不应保存', 'about': invalid})
                self.assertEqual(status, 400, body)
                profile = self.public()['profile']
                self.assertEqual(profile['about'], about)
                self.assertEqual(profile['name'], server.DEFAULT_NAME)

    def test_experience_students_normalize_omit_clear_public_profile_and_export(self):
        profile = self.public()['profile']
        self.assertEqual(profile['experience'], '两年家教经历。')
        self.assertEqual(profile['students'], [])
        self.login()
        about = '座右铭：原有内容。\n\n联系邮箱：example@qq.com'
        experience = '## 家教\n\n  两年家教经历。\n'
        students = [
            {'surname': ' 张 ', 'subjects': ' 数学、物理 ', 'university': ' 某大学 '},
            {'surname': ' 欧阳 ', 'subjects': ' 英语 ', 'university': ' 另一所大学 '},
            {'surname': '𠮷', 'subjects': '化学', 'university': '第三所大学'},
        ]
        expected_students = [
            {'surname': '张', 'subjects': '数学、物理', 'university': '某大学'},
            {'surname': '欧阳', 'subjects': '英语', 'university': '另一所大学'},
            {'surname': '𠮷', 'subjects': '化学', 'university': '第三所大学'},
        ]
        status, body, _ = self.req('/api/profile', 'PUT', {'about': about, 'experience': experience, 'students': students})
        self.assertEqual(status, 200, body)
        saved = json.loads(body)
        self.assertEqual(saved['experience'], experience)
        self.assertEqual(saved['students'], expected_students)
        self.assertEqual(self.public()['profile'], saved)
        self.assertEqual(json.loads(self.req('/api/profile')[1]), saved)
        status, body, _ = self.req('/api/profile', 'PUT', {'bio': '更新后的短简介'})
        self.assertEqual(status, 200, body)
        saved = json.loads(body)
        self.assertEqual(saved['about'], about)
        self.assertEqual(saved['experience'], experience)
        self.assertEqual(saved['students'], expected_students)
        prefix = '# ' + server.DEFAULT_NAME + '\n\n更新后的短简介\n\n' + about + '\n'
        status, archive, _ = self.req('/api/export.zip')
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(archive)) as exported:
            markdown = exported.read('profile.md').decode()
        self.assertTrue(markdown.startswith(prefix))
        self.assertIn('\n## 经历\n\n' + experience + '\n', markdown)
        self.assertIn('\n## 部分学生风采\n\n', markdown)
        self.assertIn('- 张\\*\\*；辅导科目：数学、物理；就读大学：某大学\n', markdown)
        self.assertIn('- 欧阳\\*\\*；辅导科目：英语；就读大学：另一所大学\n', markdown)
        status, body, _ = self.req('/api/profile', 'PUT', {'experience': '', 'students': []})
        self.assertEqual(status, 200, body)
        self.assertEqual(self.public()['profile']['experience'], '')
        self.assertEqual(self.public()['profile']['students'], [])
        status, archive, _ = self.req('/api/export.zip')
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(archive)) as exported:
            self.assertEqual(exported.read('profile.md').decode(), prefix)

    def test_students_without_subjects_keep_duplicates_and_export_only_known_fields(self):
        self.login()
        student = {'surname': '张', 'university': '中国矿业大学'}
        status, body, _ = self.req('/api/profile', 'PUT', {'students': [student, student]})
        self.assertEqual(status, 200, body)
        expected = [dict(student, subjects=''), dict(student, subjects='')]
        self.assertEqual(self.public()['profile']['students'], expected)
        status, archive, _ = self.req('/api/export.zip')
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(archive)) as exported:
            markdown = exported.read('profile.md').decode()
        self.assertEqual(markdown.count('就读大学：中国矿业大学'), 2)
        self.assertNotIn('辅导科目：', markdown)
        expected[0]['subjects'] = '数学'
        self.assertEqual(self.req('/api/profile', 'PUT', {'students': expected})[0], 200)
        self.assertEqual(self.public()['profile']['students'], expected)
        self.assertEqual(self.req('/api/profile', 'PUT', {'students': expected[1:]})[0], 200)
        self.assertEqual(self.public()['profile']['students'], expected[1:])

    def test_experience_students_limits_and_invalid_updates_are_atomic(self):
        self.login()
        experience = '🌟' * 5000
        student = {'surname': '欧阳', 'subjects': '科' * 80, 'university': '校' * 120}
        students = [student.copy() for _ in range(60)]
        status, body, _ = self.req('/api/profile', 'PUT', {'experience': experience, 'students': students})
        self.assertEqual(status, 200, body[:200])
        previous = json.loads(body)
        self.assertEqual(previous['experience'], experience)
        self.assertEqual(previous['students'], students)
        invalid_payloads = [
            {'experience': value} for value in (experience + '星', None, 42, True, [], {})
        ] + [
            {'students': value} for value in (None, 42, True, {}, '', students + [student], [None], ['张'])
        ]
        for field, values in (
            ('surname', ('', '  ', '张三丰', 'A', '1', '🌟', '张*', '张 三', None, 42, True)),
            ('subjects', ('科' * 81, None, 42, True)),
            ('university', ('', '  ', '校' * 121, None, 42, True)),
        ):
            invalid_payloads.extend({'students': [student, dict(student, **{field: value})]} for value in values)
            if field != 'subjects':
                invalid_payloads.append({'students': [{key: value for key, value in student.items() if key != field}]})
        for index, invalid in enumerate(invalid_payloads):
            with self.subTest(index=index):
                status, body, _ = self.req('/api/profile', 'PUT', {'name': '不应保存', 'bio': '不应保存', 'about': '不应保存', **invalid})
                self.assertEqual(status, 400, body[:200])
                self.assertEqual(self.public()['profile'], previous)


if __name__ == '__main__':
    unittest.main()
