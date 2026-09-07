"""Disposable local browser acceptance database, never used by deployment."""
import sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
with tempfile.TemporaryDirectory(prefix='personal-site-browser-') as temp:
 server.DB=Path(temp)/'site.sqlite3';server.init();server.set_account('test-owner','test-only-password')
 print('Disposable browser fixture listening on 3081; empty database.',flush=True)
 try:server.ThreadingHTTPServer(('127.0.0.1',3081),server.Handler).serve_forever()
 except KeyboardInterrupt:pass
