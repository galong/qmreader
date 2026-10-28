#!/usr/bin/env python3
"""Add a proxied read-only hostname on the existing Nginx. Dry-run by default."""
import argparse, json, os, subprocess, tempfile, urllib.request, urllib.error
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--apply', action='store_true')
args = p.parse_args()
token = os.environ.get('CLOUDFLARE_API_TOKEN') or os.environ.get('CF_API_TOKEN')
if not token: raise SystemExit('Cloudflare token unavailable')
def api(path, method='GET', body=None):
    request = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
        data=json.dumps(body).encode() if body else None, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response: result = json.load(response)
    except urllib.error.HTTPError as error: result = json.loads(error.read())
    if not result.get('success'): raise SystemExit(json.dumps(result.get('errors', [])))
    return result['result']
def ssh(command):
    subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'qiaomu-hostinger', command], check=True)

zone = api('/zones?name=qiaomu.ai')[0]['id']
hostname, address = 'rss-edge.qiaomu.ai', '76.13.103.27'
records = api(f'/zones/{zone}/dns_records?name={hostname}')
if len(records) > 1 or any(r['type'] != 'A' or r['content'] != address for r in records): raise SystemExit('Unexpected existing DNS target')
print(json.dumps({'apply': args.apply, 'hostname': hostname, 'origin': address, 'proxied': True, 'existing': bool(records)}), flush=True)
if not args.apply: raise SystemExit(0)
record = records[0] if records else api(f'/zones/{zone}/dns_records', 'POST', {'type': 'A', 'name': hostname, 'content': address, 'proxied': False, 'ttl': 300})
config = '/www/server/panel/vhost/nginx/rss-edge.qiaomu.ai.conf'
ssh('mkdir -p /www/wwwroot/rss-edge.qiaomu.ai /opt/qiaomu-backups/rss-network-20261028')
bootstrap = 'server { listen 80; server_name rss-edge.qiaomu.ai; location ^~ /.well-known/acme-challenge/ { root /www/wwwroot/rss-edge.qiaomu.ai; } location / { return 404; } }\n'
with tempfile.TemporaryDirectory(prefix='rss-edge-deploy-') as directory:
    local = Path(directory) / 'bootstrap.conf'; local.write_text(bootstrap)
    subprocess.run(['scp', '-q', str(local), 'qiaomu-hostinger:/tmp/rss-edge-bootstrap.conf'], check=True)
ssh(f'if [ ! -f {config} ]; then cp /tmp/rss-edge-bootstrap.conf {config}; nginx -t && nginx -s reload; else cp {config} /opt/qiaomu-backups/rss-network-20261028/rss-edge.conf.before; fi')
# Wait for the reloaded HTTP virtual host before ACME validation.
ssh("mkdir -p /www/wwwroot/rss-edge.qiaomu.ai/.well-known/acme-challenge && printf ready > /www/wwwroot/rss-edge.qiaomu.ai/.well-known/acme-challenge/qrs-ready; for i in 1 2 3 4 5; do test \"$(curl -fsS --max-time 3 -H 'Host: rss-edge.qiaomu.ai' http://127.0.0.1/.well-known/acme-challenge/qrs-ready)\" = ready && exit 0; sleep 1; done; exit 1")
ssh("certbot certonly --webroot -w /www/wwwroot/rss-edge.qiaomu.ai -d rss-edge.qiaomu.ai --non-interactive --agree-tos --keep-until-expiring --deploy-hook 'nginx -t && nginx -s reload'")
subprocess.run(['scp', '-q', str(Path(__file__).with_name('rss-edge.nginx.conf')), 'qiaomu-hostinger:/tmp/rss-edge-https.conf'], check=True)
ssh(f'cp {config} /opt/qiaomu-backups/rss-network-20261028/rss-edge.conf.pre-https && cp /tmp/rss-edge-https.conf {config} && (nginx -t && nginx -s reload || (cp /opt/qiaomu-backups/rss-network-20261028/rss-edge.conf.pre-https {config}; nginx -t && nginx -s reload; exit 1))')
record = api(f'/zones/{zone}/dns_records/{record["id"]}', 'PATCH', {'proxied': True})
print(json.dumps({'hostname': record['name'], 'proxied': record['proxied'], 'record_id': record['id']}))
