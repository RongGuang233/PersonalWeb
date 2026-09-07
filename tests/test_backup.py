from contextlib import closing
from datetime import datetime
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backup


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        # Exercise SQLite URI escaping, including spaces, question marks and #.
        self.db = self.root / "site ? # 中文.sqlite3"
        self.dest = self.root / "backups"
        self.text = "# 随手记\n保留中文、emoji 🌱、进度和评分。"
        self.image = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 32
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute("CREATE TABLE content (id INTEGER PRIMARY KEY, body TEXT, image BLOB)")
            connection.execute("INSERT INTO content VALUES (1, ?, ?)", (self.text, self.image))
            connection.commit()

    def run_backup(self, day=7, keep=7, db=None):
        with patch.object(backup, "datetime") as clock:
            clock.now.return_value = datetime(2026, 9, day, 4, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
            return backup.backup_database(db or self.db, self.dest, keep)

    def restore(self, source):
        # A real restore into a separate database: never replace the source DB.
        restored = self.root / "restored.sqlite3"
        restored.unlink(missing_ok=True)
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as saved:
            with closing(sqlite3.connect(restored)) as target:
                saved.backup(target)
        with closing(sqlite3.connect(restored)) as connection:
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            return connection.execute("SELECT id, body, image FROM content ORDER BY id").fetchall()

    def test_online_backup_restores_text_blobs_and_committed_wal(self):
        with closing(sqlite3.connect(self.db)) as writer:
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("PRAGMA wal_autocheckpoint=0")
            writer.execute("INSERT INTO content VALUES (2, ?, ?)", ("仍在 WAL 中", self.image[::-1]))
            writer.commit()
            self.assertGreater(Path(str(self.db) + "-wal").stat().st_size, 0)
            saved = self.run_backup()
            self.assertEqual(writer.execute("PRAGMA journal_mode").fetchone()[0], "wal")
            self.assertEqual(self.restore(saved), [
                (1, self.text, self.image), (2, "仍在 WAL 中", self.image[::-1])])
        self.assertEqual(saved.name, "site-2026-09-07.sqlite3")
        self.assertEqual(saved.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.dest.iterdir()), [saved])

    def test_same_day_repeat_replaces_with_current_contents(self):
        first = self.run_backup()
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute("UPDATE content SET body=? WHERE id=1", ("更新后的正文",))
            connection.commit()
        second = self.run_backup()
        self.assertEqual(first, second)
        self.assertEqual(self.restore(second), [(1, "更新后的正文", self.image)])
        self.assertEqual(list(self.dest.iterdir()), [second])

    def test_retention_keeps_newest_seven_days_and_unrelated_files(self):
        self.dest.mkdir()
        untouched = self.dest / "manual.sqlite3"
        untouched.write_bytes(b"not managed by backup.py")
        invalid_date = self.dest / "site-2026-99-99.sqlite3"
        invalid_date.write_bytes(b"also not a dated backup")
        for day in range(1, 10):
            self.run_backup(day=day)
        expected = {f"site-2026-09-{day:02d}.sqlite3" for day in range(3, 10)}
        self.assertEqual({path.name for path in self.dest.iterdir()},
                         expected | {untouched.name, invalid_date.name})
        for name in expected:
            self.assertEqual(self.restore(self.dest / name), [(1, self.text, self.image)])
        self.assertEqual(untouched.read_bytes(), b"not managed by backup.py")
        self.run_backup(day=10, keep=2)
        self.assertEqual({path.name for path in self.dest.iterdir()}, {
            "site-2026-09-09.sqlite3", "site-2026-09-10.sqlite3",
            untouched.name, invalid_date.name})

    def test_publication_failure_preserves_existing_backups_and_cleans_temp(self):
        previous = self.run_backup(day=6)
        today = self.run_backup(day=7)
        original = {path.name: path.read_bytes() for path in (previous, today)}
        with patch.object(backup.os, "replace", side_effect=OSError("publication denied")):
            with self.assertRaisesRegex(OSError, "publication denied"):
                self.run_backup(day=7, keep=1)
        self.assertEqual({path.name: path.read_bytes() for path in self.dest.iterdir()}, original)
        self.assertEqual(self.restore(today), [(1, self.text, self.image)])

    def test_invalid_source_preserves_all_previous_backups(self):
        self.run_backup(day=6)
        self.run_backup(day=7)
        original = {path.name: path.read_bytes() for path in self.dest.iterdir()}
        broken = self.root / "broken.sqlite3"
        broken.write_bytes(b"this is not a SQLite database")
        with self.assertRaises(sqlite3.DatabaseError):
            self.run_backup(day=7, keep=1, db=broken)
        self.assertEqual({path.name: path.read_bytes() for path in self.dest.iterdir()}, original)

    def test_missing_empty_or_directory_input_does_not_create_a_backup(self):
        missing = self.root / "missing.sqlite3"
        empty = self.root / "empty.sqlite3"
        empty.touch()
        for source in (missing, empty, self.root):
            with self.subTest(source=source), self.assertRaises(ValueError):
                self.run_backup(db=source)
            self.assertFalse(self.dest.exists())
        self.assertFalse(missing.exists())
        self.assertEqual(empty.stat().st_size, 0)

    def test_valid_database_with_no_content_can_be_backed_up(self):
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute("DELETE FROM content")
            connection.commit()
        self.dest.mkdir()
        self.assertEqual(self.restore(self.run_backup()), [])

    def test_source_is_never_overwritten_or_removed_by_retention(self):
        self.dest.mkdir()
        source = self.dest / "site-2026-09-07.sqlite3"
        source.write_bytes(self.db.read_bytes())
        original = source.read_bytes()
        with self.assertRaisesRegex(ValueError, "source database"):
            self.run_backup(day=7, db=source)
        self.assertEqual(source.read_bytes(), original)
        self.run_backup(day=8, db=source, keep=1)
        self.run_backup(day=9, db=source, keep=1)
        self.assertEqual(source.read_bytes(), original)

    def test_cli_accepts_explicit_paths_and_site_db(self):
        command = [sys.executable, str(Path(backup.__file__).resolve())]
        environment = dict(os.environ, SITE_DB=str(self.db))
        result = subprocess.run(command + ["--dest", str(self.dest), "--keep", "2"],
                                env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        saved, = self.dest.iterdir()
        self.assertEqual(self.restore(saved), [(1, self.text, self.image)])
        environment["SITE_DB"] = str(self.root / "missing-env.sqlite3")
        result = subprocess.run(command + ["--db", str(self.db), "--dest", str(self.dest)],
                                env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(list(self.dest.iterdir()), [saved])

    def test_cli_rejects_empty_paths_nonpositive_keep_and_missing_input(self):
        command = [sys.executable, str(Path(backup.__file__).resolve())]
        for arguments in (["--db", ""], ["--dest", ""], ["--keep", "0"], ["--keep", "-1"]):
            with self.subTest(arguments=arguments):
                result = subprocess.run(command + arguments, capture_output=True, text=True)
                self.assertEqual(result.returncode, 2, result.stderr)
        missing = self.root / "missing-cli.sqlite3"
        result = subprocess.run(command + ["--db", str(missing), "--dest", str(self.dest)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertFalse(missing.exists())
        self.assertFalse(self.dest.exists())


if __name__ == "__main__":
    unittest.main()
