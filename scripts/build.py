"""Build a deterministic release archive without private or test data."""
from pathlib import Path
import gzip, hashlib, io, tarfile, py_compile, uuid
root=Path(__file__).resolve().parents[1]
py_compile.compile(str(root/'server.py'),doraise=True)
py_compile.compile(str(root/'cover_search.py'),doraise=True)
out=root/'dist';out.mkdir(exist_ok=True)
py_compile.compile(str(root/'backup.py'),doraise=True)
files=[root/'server.py',root/'cover_search.py',root/'backup.py',root/'README.md',root/'package.json',root/'package-lock.json']
for directory in ['public','deploy']:files.extend(p for p in (root/directory).rglob('*') if p.is_file())
buffer=io.BytesIO()
with tarfile.open(fileobj=buffer,mode='w',format=tarfile.USTAR_FORMAT) as archive:
 for path in sorted(files):
  content=path.read_bytes();info=tarfile.TarInfo(path.relative_to(root).as_posix());info.size=len(content);info.mode=0o644;info.mtime=0
  archive.addfile(info,io.BytesIO(content))
release=out/'personal-website.tar.gz'
with release.open('wb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as zipped:zipped.write(buffer.getvalue())
print(release)
print('output_digest=sha256:'+hashlib.sha256(release.read_bytes()).hexdigest())
print('build_run_id='+str(uuid.uuid4()))
