#!/usr/bin/env python3
"""Локальная имитация нужной части GitHub API для проверки синхронизации без настоящего токена.
Хранит файлы в памяти. Токен: test-token. Порт 8766."""
import json, base64, hashlib, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

FILES = {}   # path -> {content(str), sha}
LOG = []

def sha_of(content: str) -> str:
    raw = content.encode('utf-8')
    return hashlib.sha1(b'blob %d\0' % len(raw) + raw).hexdigest()

class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-GitHub-Api-Version')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
    def _json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code); self._cors()
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def _auth(self):
        if self.headers.get('Authorization') != 'Bearer test-token':
            self._json(401, {'message': 'Bad credentials'}); return False
        return True
    def log_message(self, *a): pass
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_GET(self):
        u = urlparse(self.path); parts = u.path.strip('/').split('/')
        if u.path == '/_admin/files':
            return self._json(200, {p: {'sha': f['sha'], 'content': f['content']} for p, f in FILES.items()})
        if not self._auth(): return
        LOG.append('GET ' + self.path)
        if len(parts) == 3 and parts[0] == 'repos':
            return self._json(200, {'full_name': parts[1] + '/' + parts[2], 'private': True})
        if len(parts) >= 6 and parts[3] == 'git' and parts[4] == 'trees':
            tree = [{'path': p, 'type': 'blob', 'sha': f['sha']} for p, f in FILES.items()]
            return self._json(200, {'sha': 'tree', 'tree': tree})
        if len(parts) >= 6 and parts[3] == 'git' and parts[4] == 'blobs':
            for p, f in FILES.items():
                if f['sha'] == parts[5]:
                    return self._json(200, {'sha': f['sha'], 'encoding': 'base64', 'content': base64.b64encode(f['content'].encode()).decode()})
            return self._json(404, {'message': 'Not Found'})
        if len(parts) >= 5 and parts[3] == 'contents':
            path = '/'.join(parts[4:])
            f = FILES.get(path)
            if not f: return self._json(404, {'message': 'Not Found'})
            return self._json(200, {'sha': f['sha'], 'encoding': 'base64', 'content': base64.b64encode(f['content'].encode()).decode()})
        self._json(404, {'message': 'Not Found'})
    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get('Content-Length', 0)); body = json.loads(self.rfile.read(n) or b'{}')
        if u.path == '/_admin/set':   # имитация записи с другого устройства
            FILES[body['path']] = {'content': body['content'], 'sha': sha_of(body['content'])}
            return self._json(200, {'sha': FILES[body['path']]['sha']})
        if u.path == '/_admin/reset':
            FILES.clear(); LOG.clear(); return self._json(200, {})
        self._json(404, {})
    def do_PUT(self):
        if not self._auth(): return
        u = urlparse(self.path); parts = u.path.strip('/').split('/')
        n = int(self.headers.get('Content-Length', 0)); body = json.loads(self.rfile.read(n) or b'{}')
        LOG.append('PUT ' + self.path)
        if len(parts) >= 5 and parts[3] == 'contents':
            path = '/'.join(parts[4:])
            content = base64.b64decode(body['content']).decode('utf-8')
            cur = FILES.get(path)
            if cur and body.get('sha') != cur['sha']:
                return self._json(409, {'message': 'sha mismatch'})
            if not cur and body.get('sha'):
                return self._json(422, {'message': 'no such file'})
            FILES[path] = {'content': content, 'sha': sha_of(content)}
            return self._json(200 if cur else 201, {'content': {'sha': FILES[path]['sha'], 'path': path}, 'commit': {'message': body.get('message')}})
        self._json(404, {})

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print('mock github on', port, flush=True)
    HTTPServer(('127.0.0.1', port), H).serve_forever()
