#!/usr/bin/env python3
"""Apply a GitHub-backed code archive; preserve data/config and roll back on failure."""
import argparse, hashlib, json, os, shutil, subprocess, tarfile, tempfile, time, urllib.request
from pathlib import Path
APP = Path('/opt/qiaomu-apps/qmreader')
BACKUPS = Path('/opt/qiaomu-backups')
DR = Path('/opt/qiaomu-apps/qiaomu-rss-dr')
ROOT_FILES = {'server.js', 'package.json', 'package-lock.json'}
TREES = {'lib', 'public', 'scripts', '.rss-reliability'}

def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)

def restore(backup):
    record = json.loads((backup / 'receipt.json').read_text())
    run('systemctl', 'stop', 'qmreader')
    for name in record['files']:
        target = APP / name
        old = backup / 'files' / name
        if old.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(old, target)
        elif target.is_file():
            target.unlink()
    old_modules = backup / 'node_modules'
    if old_modules.exists():
        if (APP / 'node_modules').exists():
            os.rename(APP / 'node_modules', backup / ('rejected-node_modules-' + str(time.time_ns())))
        os.rename(old_modules, APP / 'node_modules')
    for name in record['external']:
        shutil.copy2(backup / 'external' / name, DR / name)
    run('systemctl', 'start', 'qmreader')

parser = argparse.ArgumentParser()
parser.add_argument('--archive')
parser.add_argument('--sha256')
parser.add_argument('--commit')
parser.add_argument('--rollback')
args = parser.parse_args()
if args.rollback:
    backup = Path(args.rollback).resolve()
    if backup.parent != BACKUPS or not backup.name.startswith('qmreader-web-'):
        raise SystemExit('Invalid rollback directory')
    restore(backup)
    print('Rolled back to ' + str(backup))
    raise SystemExit(0)
if not args.commit or len(args.commit) != 40 or any(c not in '0123456789abcdef' for c in args.commit):
    raise SystemExit('Expected an exact GitHub commit')
archive = Path(args.archive)
if hashlib.sha256(archive.read_bytes()).hexdigest() != args.sha256:
    raise SystemExit('Archive digest mismatch')
stage = Path(tempfile.mkdtemp(prefix='qmreader-release-' + args.commit[:12] + '-', dir='/opt/qiaomu-apps'))
with tarfile.open(archive) as bundle:
    members = bundle.getmembers()
    for member in members:
        name = Path(member.name)
        if name.is_absolute() or '..' in name.parts or member.issym() or member.islnk() or not (name.parts[0] in TREES or member.name in ROOT_FILES):
            raise SystemExit('Unexpected archive member')
    for member in members:
        target = stage / member.name
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
        elif member.isfile():
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(member) as source, target.open('wb') as destination:
                shutil.copyfileobj(source, destination)
            target.chmod(member.mode & 0o755)
        else:
            raise SystemExit('Unsupported archive member')
run('npm', 'ci', '--omit=dev', '--ignore-scripts', cwd=stage)
run('node', '--check', 'server.js', cwd=stage)
run('node', '--check', 'public/app.js', cwd=stage)
(stage / 'DEPLOYED_COMMIT').write_text(args.commit + '\n')
files = sorted(str(p.relative_to(stage)) for p in stage.rglob('*') if p.is_file() and 'node_modules' not in p.relative_to(stage).parts)
backup = BACKUPS / ('qmreader-web-' + time.strftime('%Y%m%d-%H%M%S') + '-' + args.commit[:12])
backup.mkdir(parents=True, exist_ok=False)
for name in files:
    old = APP / name
    if old.exists():
        dest = backup / 'files' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(old, dest)
external = []
for name in ['primary-gate.cjs', 'public-read-cache.cjs']:
    if (DR / name).exists():
        (backup / 'external').mkdir(exist_ok=True)
        shutil.copy2(DR / name, backup / 'external' / name)
        external.append(name)
(backup / 'receipt.json').write_text(json.dumps({'commit': args.commit, 'files': files, 'external': external}, indent=2))
try:
    run('systemctl', 'stop', 'qmreader')
    if (APP / 'node_modules').exists():
        os.rename(APP / 'node_modules', backup / 'node_modules')
    os.rename(stage / 'node_modules', APP / 'node_modules')
    for name in files:
        target = APP / name
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(target.name + '.release-tmp')
        shutil.copy2(stage / name, temp)
        os.replace(temp, target)
    for name in external:
        shutil.copy2(APP / 'lib/dr' / name, DR / name)
    run('systemctl', 'start', 'qmreader')
    # Loading the feed cache blocks the event loop for 13-20s on the contended
    # host; a 15s window rolled back a healthy release on 2026-10-28.
    for attempt in range(90):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3088/api/version', timeout=3) as response:
                result = json.load(response)
            if result['commit'] == args.commit:
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise RuntimeError('Deployed identity unavailable')
    with urllib.request.urlopen('http://127.0.0.1:3088/api/health', timeout=8) as response:
        health = json.load(response)
    if health.get('stalled') or health.get('updateStopped'):
        raise RuntimeError('Fetch health failed after deployment')
    for name in files:
        if hashlib.sha256((APP / name).read_bytes()).digest() != hashlib.sha256((stage / name).read_bytes()).digest():
            raise RuntimeError('Runtime source differs from GitHub archive: ' + name)
    print(json.dumps({'version': result, 'backup': str(backup), 'filesVerified': len(files), 'health': health['status']}))
except BaseException:
    restore(backup)
    raise
finally:
    shutil.rmtree(stage)
