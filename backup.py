"""Back up the site's SQLite database without stopping the application."""

import argparse
from contextlib import closing
from datetime import date, datetime
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from zoneinfo import ZoneInfo


def backup_database(db, dest, keep=7):
    """Publish today's complete database, then retain the newest dated backups."""
    if keep < 1:
        raise ValueError("--keep must be at least 1")
    db = Path(db).resolve()
    dest = Path(dest).resolve()
    if not db.is_file():
        raise ValueError(f"source database does not exist or is not a file: {db}")
    day = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
    published = dest / f"site-{day}.sqlite3"
    if published.resolve() == db:
        raise ValueError("backup destination must not replace the source database")

    # mode=ro prevents a missing source from silently becoming an empty database.
    with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as source:
        if source.execute("PRAGMA page_count").fetchone()[0] == 0:
            raise ValueError("source database is empty")
        dest.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(prefix=f".site-{day}.", suffix=".tmp", dir=dest)
        os.close(descriptor)
        temporary = Path(name)
        try:
            with closing(sqlite3.connect(temporary)) as target:
                source.backup(target)
                # The copied WAL setting must not require sidecar files on restore.
                target.execute("PRAGMA journal_mode=DELETE")
                if target.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise sqlite3.DatabaseError("backup failed SQLite integrity_check")
            with temporary.open("rb") as completed:
                os.fsync(completed.fileno())
            os.replace(temporary, published)
        finally:
            temporary.unlink(missing_ok=True)

    # Only files named by this script are managed; temporary and other files stay.
    backups = []
    for candidate in dest.glob("site-????-??-??.sqlite3"):
        if not candidate.is_file() or candidate.resolve() == db:
            continue
        try:
            date.fromisoformat(candidate.stem[5:])
        except ValueError:
            continue
        backups.append(candidate)
    for obsolete in sorted(backups, reverse=True)[keep:]:
        try:
            obsolete.unlink()
        except OSError as error:
            raise OSError(f"backup saved to {published}; could not remove {obsolete}: {error}") from error
    return published


def path_argument(value):
    if not value.strip():
        raise argparse.ArgumentTypeError("path must not be empty")
    return Path(value)


def positive_integer(value):
    try:
        result = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be a positive integer") from None
    if result < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=path_argument,
                        default=os.environ.get("SITE_DB", str(Path(__file__).parent / "data/site.sqlite3")),
                        help="source SQLite database (default: SITE_DB or data/site.sqlite3)")
    parser.add_argument("--dest", type=path_argument, default="/var/backups/personal-website",
                        help="backup directory (default: /var/backups/personal-website)")
    parser.add_argument("--keep", type=positive_integer, default=7,
                        help="number of daily backups to keep (default: 7)")
    args = parser.parse_args(argv)
    try:
        published = backup_database(args.db, args.dest, args.keep)
    except (OSError, ValueError, sqlite3.Error) as error:
        print(f"backup: {error}", file=sys.stderr)
        return 1
    print(f"Backup saved: {published}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
