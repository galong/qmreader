#!/usr/bin/env python3
"""Package a clean merged GitHub revision, upload, then apply with a rollback backup."""
import argparse, json, re, subprocess
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--commit', required=True)
p.add_argument('--host', default='qiaomu-la', choices=['qiaomu-la'])
p.add_argument('--jump', choices=['qiaomu-hostinger'], help='Optional SSH transport relay; keys stay on this client')
a = p.parse_args()
def output(*cmd):
    return subprocess.check_output(cmd, text=True).strip()
commit = output('git', 'rev-parse', a.commit + '^{commit}')
if output('git', 'status', '--porcelain'):
    raise SystemExit('Use a clean release worktree')
remote = output('git', 'ls-remote', 'https://github.com/joeseesun/qmreader.git', 'refs/heads/main').split()[0]
if remote != commit:
    raise SystemExit('Commit must be the verified GitHub main revision')
subprocess.run(['npm', 'run', 'package', '--', '--commit', commit], check=True)
manifest_path = next(Path('artifacts/releases').glob('*-' + commit[:12] + '.tar.gz.json'))
m = json.loads(manifest_path.read_text())
archive = manifest_path.with_suffix('')
remote_archive = '/tmp/qmreader-' + commit + '.tar.gz'
remote_apply = '/tmp/qmreader-apply-' + commit + '.py'
transport = ['-o', 'BatchMode=yes'] + (['-o', 'ProxyJump=' + a.jump] if a.jump else [])
subprocess.run(['scp', '-q', *transport, str(archive), a.host + ':' + remote_archive], check=True)
subprocess.run(['scp', '-q', *transport, 'scripts/apply-release.py', a.host + ':' + remote_apply], check=True)
# These values are constrained to fixed paths and hex digests, never user shell input.
if not re.fullmatch('[a-f0-9]{64}', m['sha256']):
    raise SystemExit('Invalid digest')
subprocess.run(['ssh', *transport, a.host, 'python3', remote_apply, '--archive', remote_archive, '--sha256', m['sha256'], '--commit', commit], check=True)
