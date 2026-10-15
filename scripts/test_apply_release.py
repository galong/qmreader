import contextlib, hashlib, io, json, os, subprocess, sys, tarfile, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).with_name('apply-release.py').read_text()
COMMIT = 'a' * 40

class ReleaseTests(unittest.TestCase):
    def scenario(self, unhealthy=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        app, backups, dr = root/'app', root/'backups', root/'dr'
        for directory in [app/'node_modules', app/'data', backups, dr]: directory.mkdir(parents=True)
        (app/'server.js').write_text('old server')
        (app/'node_modules/installed').write_text('old dependencies')
        (app/'data/private.sqlite').write_text('must remain untouched')
        (app/'.env').write_text('private configuration')
        (dr/'primary-gate.cjs').write_text('old gate')
        archive = root/'release.tar.gz'
        payload = {'server.js':'new server', 'lib/dr/primary-gate.cjs':'new gate', 'public/app.js':'new app', 'package.json':'{}'}
        with tarfile.open(archive, 'w:gz') as bundle:
            for name, value in payload.items():
                info = tarfile.TarInfo(name); raw = value.encode(); info.size=len(raw)
                bundle.addfile(info, io.BytesIO(raw))
        commands = []
        def command(args, cwd=None, check=None):
            commands.append(tuple(args))
            if args[:2] == ('npm','ci'):
                (Path(cwd)/'node_modules').mkdir()
                (Path(cwd)/'node_modules/installed').write_text('new dependencies')
        class Response(io.BytesIO): pass
        def fetch(url, timeout=None):
            if url.endswith('/api/health'):
                if unhealthy: raise RuntimeError('health failed')
                return Response(b'{"status":"ok","stalled":false,"updateStopped":false}')
            return Response(json.dumps({'version':'1.0.2','commit':COMMIT}).encode())
        code=SOURCE.replace("Path('/opt/qiaomu-apps/qmreader')",f'Path({str(app)!r})').replace("Path('/opt/qiaomu-backups')",f'Path({str(backups)!r})').replace("Path('/opt/qiaomu-apps/qiaomu-rss-dr')",f'Path({str(dr)!r})').replace("dir='/opt/qiaomu-apps'",f'dir={str(root)!r}')
        argv=['apply-release.py','--archive',str(archive),'--sha256',hashlib.sha256(archive.read_bytes()).hexdigest(),'--commit',COMMIT]
        with patch.object(sys,'argv',argv), patch('subprocess.run',command), patch('urllib.request.urlopen',fetch), patch('time.sleep',lambda _:None), contextlib.redirect_stdout(io.StringIO()):
            if unhealthy:
                with self.assertRaisesRegex(RuntimeError,'health failed'):exec(compile(code,'apply-release.py','exec'),{})
            else:exec(compile(code,'apply-release.py','exec'),{})
        self.assertEqual((app/'data/private.sqlite').read_text(),'must remain untouched')
        self.assertEqual((app/'.env').read_text(),'private configuration')
        self.assertIn(('systemctl','start','qmreader'),commands)
        if unhealthy:
            self.assertEqual((app/'server.js').read_text(),'old server')
            self.assertEqual((app/'node_modules/installed').read_text(),'old dependencies')
            self.assertEqual((dr/'primary-gate.cjs').read_text(),'old gate')
            self.assertFalse((app/'public/app.js').exists())
            self.assertFalse((app/'DEPLOYED_COMMIT').exists())
        else:
            self.assertEqual((app/'server.js').read_text(),'new server')
            self.assertEqual((app/'node_modules/installed').read_text(),'new dependencies')
            self.assertEqual((dr/'primary-gate.cjs').read_text(),'new gate')
            self.assertEqual((app/'DEPLOYED_COMMIT').read_text().strip(),COMMIT)
            backup=next(backups.iterdir())
            self.assertEqual((backup/'files/server.js').read_text(),'old server')
    def test_success_keeps_private_state_and_records_backup(self): self.scenario()
    def test_failed_health_restores_old_code_and_dependencies(self): self.scenario(unhealthy=True)

if __name__ == '__main__': unittest.main()
