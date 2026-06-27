#!/usr/bin/env python3
"""Local server with API proxy for World Cup Predictor.
Serves static files, proxies external APIs, and forwards computation
requests to compute-server.js (Node.js, port 9091)."""

import http.server
import socketserver
import json
import sys
import threading
import urllib.request
import urllib.parse
import subprocess
import time
from pathlib import Path
from datetime import datetime

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9090
COMPUTE_PORT = 9091
DIR = Path(__file__).parent
BIND = '0.0.0.0'

_sport_cache_lock = threading.Lock()
_compute_proc = None


def ensure_compute_server():
    """Start compute-server.js if not already running."""
    global _compute_proc
    try:
        req = urllib.request.Request(f'http://127.0.0.1:{COMPUTE_PORT}/health')
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read())
            if data.get('status') == 'ok':
                return True
    except Exception:
        pass
    script = DIR / 'compute-server.js'
    if not script.exists():
        print('[Server] compute-server.js not found, /api/compute will not work')
        return False
    print(f'[Server] Starting compute-server.js on port {COMPUTE_PORT}...')
    try:
        _compute_proc = subprocess.Popen(
            ['node', str(script)], cwd=str(DIR),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )
        for _ in range(30):
            time.sleep(0.2)
            try:
                req = urllib.request.Request(f'http://127.0.0.1:{COMPUTE_PORT}/health')
                with urllib.request.urlopen(req, timeout=2) as resp:
                    data = json.loads(resp.read())
                    if data.get('status') == 'ok':
                        print(f'[Server] compute-server.js ready (pid={_compute_proc.pid})')
                        return True
            except Exception:
                pass
        print('[Server] compute-server.js started but health check failed')
        return False
    except Exception as e:
        print(f'[Server] Failed to start compute-server.js: {e}')
        return False


def cleanup_compute_server():
    global _compute_proc
    if _compute_proc:
        try:
            _compute_proc.terminate()
            _compute_proc.wait(timeout=5)
        except Exception:
            try:
                _compute_proc.kill()
            except Exception:
                pass


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def do_GET(self):
        if self.path.startswith('/api/results-alt'):
            self._proxy_worldcupjson()
        elif self.path.startswith('/api/results'):
            self._proxy_football_data()
        elif self.path.startswith('/api/match-odds'):
            self._proxy_match_odds()
        elif self.path.startswith('/api/odds'):
            self._proxy_odds_api()
        elif self.path.startswith('/api/test-odds'):
            self._test_odds_key()
        elif self.path.startswith('/api/test'):
            self._test_key()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/compute'):
            self._proxy_compute()
        elif self.path.startswith('/api/montecarlo'):
            self._run_montecarlo()
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        origin = self.headers.get('Origin')
        if self._is_allowed_origin(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')
        self.end_headers()

    def _proxy_compute(self):
        """Proxy computation requests to compute-server.js on port 9091."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            url = f'http://127.0.0.1:{COMPUTE_PORT}/compute'
            req = urllib.request.Request(url, data=body.encode('utf-8'),
                                         headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                origin = self.headers.get('Origin')
                if self._is_allowed_origin(origin):
                    self.send_header('Access-Control-Allow-Origin', origin)
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:500]
            self._json_response({'error': f'Compute error: {body}'}, e.code)
        except Exception as e:
            self._json_response({'error': f'Compute unavailable: {e}'}, 502)

    def _run_montecarlo(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            input_data = json.loads(body) if body else {}
            # Try compute server first
            try:
                payload = {'action': 'montecarlo', 'params': input_data}
                url = f'http://127.0.0.1:{COMPUTE_PORT}/compute'
                req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
                                             headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.loads(resp.read())
                    self._json_response(data)
                    return
            except Exception:
                pass
            # Fallback: spawn mc-server.js
            mc_script = DIR / 'mc-server.js'
            if not mc_script.exists():
                self._json_response({'error': 'mc-server.js not found'}, 404)
                return
            result = subprocess.run(['node', str(mc_script)], input=json.dumps(input_data),
                                    capture_output=True, text=True, timeout=120, cwd=str(DIR))
            if result.returncode != 0:
                self._json_response({'error': result.stderr}, 500)
                return
            self._json_response(json.loads(result.stdout))
        except subprocess.TimeoutExpired:
            self._json_response({'error': 'Simulation timed out'}, 504)
        except Exception as e:
            self._json_response({'error': str(e)}, 500)

    def end_headers(self):
        if self.path.startswith('/api/'):
            if '/results' in self.path:
                self.send_header('Cache-Control', 'public, max-age=300')
            elif '/odds' in self.path:
                self.send_header('Cache-Control', 'public, max-age=1800')
            elif '/test' in self.path:
                self.send_header('Cache-Control', 'public, max-age=60')
            elif '/compute' in self.path:
                self.send_header('Cache-Control', 'no-cache')
        else:
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def _log(self, msg):
        ts = datetime.now().strftime('%H:%M:%S')
        print(f'  [{ts}] {msg}')

    def _get_api_key(self):
        return self.headers.get('X-API-Key', '')

    def _odds_request(self, path, params=None):
        api_key = self._get_api_key()
        all_params = dict(params or {})
        all_params['apiKey'] = api_key
        query = urllib.parse.urlencode(all_params)
        return urllib.request.Request(f'https://api.the-odds-api.com/v4/{path}?{query}')

    def _test_key(self):
        api_key = self._get_api_key()
        if not api_key:
            self._json_response({'error': 'Pass X-API-Key header'}, 400)
            return
        url = 'https://api.football-data.org/v4/competitions'
        req = urllib.request.Request(url, headers={'X-Auth-Token': api_key})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                comps = [c['code'] + ' (' + c['name'] + ')' for c in data.get('competitions', [])]
                self._json_response({'ok': True, 'plan': data.get('plan', '?'), 'competitions': comps})
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:300]
            self._json_response({'ok': False, 'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._json_response({'ok': False, 'error': str(e)}, 502)

    def _test_odds_key(self):
        api_key = self._get_api_key()
        if not api_key:
            self._json_response({'error': 'Pass X-API-Key header'}, 400)
            return
        req = self._odds_request('sports')
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                remaining = resp.headers.get('x-requests-remaining', '?')
                used = resp.headers.get('x-requests-used', '?')
                self._json_response({'ok': True, 'remaining': remaining, 'used': used})
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:300]
            self._json_response({'ok': False, 'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._json_response({'ok': False, 'error': str(e)}, 502)

    def _proxy_football_data(self):
        api_key = self._get_api_key()
        if not api_key:
            self._json_response({'error': 'Missing API key'}, 400)
            return
        url = 'https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED'
        req = urllib.request.Request(url, headers={'X-Auth-Token': api_key, 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                self._json_response(json.loads(resp.read()))
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:300]
            self._json_response({'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._json_response({'error': str(e)}, 502)

    def _proxy_worldcupjson(self):
        url = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json'
        req = urllib.request.Request(url, headers={'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                matches = data.get('matches', []) if isinstance(data, dict) else []
                self._json_response(matches)
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:300]
            self._json_response({'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._json_response({'error': str(e)}, 502)

    def _proxy_odds_api(self):
        api_key = self._get_api_key()
        if not api_key:
            self._json_response({'error': 'Missing API key'}, 400)
            return
        req = self._odds_request('sports/soccer_fifa_world_cup_winner/odds/', {
            'regions': 'us', 'markets': 'outrights', 'oddsFormat': 'american'})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                remaining = resp.headers.get('x-requests-remaining', '')
                self._json_response({'data': data, 'remaining': remaining})
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:300]
            self._json_response({'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._json_response({'error': str(e)}, 502)

    def _proxy_match_odds(self):
        api_key = self._get_api_key()
        if not api_key:
            self._json_response({'error': 'Missing API key'}, 400)
            return
        with _sport_cache_lock:
            if not hasattr(self.__class__, '_match_odds_sport_cache'):
                self.__class__._match_odds_sport_cache = None
            cached_sport = self.__class__._match_odds_sport_cache
        sports = ([cached_sport, 'soccer_fifa_world_cup', 'soccer_fifa_world_cup_winner']
                  if cached_sport else ['soccer_fifa_world_cup', 'soccer_fifa_world_cup_winner'])
        seen = set()
        for sport in sports:
            if sport in seen or not sport:
                continue
            seen.add(sport)
            req = self._odds_request(f'sports/{sport}/odds/', {
                'regions': 'us,eu', 'markets': 'h2h', 'oddsFormat': 'decimal'})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read())
                    remaining = resp.headers.get('x-requests-remaining', '')
                    with _sport_cache_lock:
                        self.__class__._match_odds_sport_cache = sport
                    self._json_response({'data': data, 'remaining': remaining, 'sport': sport})
                    return
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    continue
            except Exception:
                pass
        self._json_response({'error': 'No WC match odds available'}, 404)

    def _json_response(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        origin = self.headers.get('Origin')
        if self._is_allowed_origin(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(body)

    def _is_allowed_origin(self, origin):
        if not origin:
            return False
        try:
            parsed = urllib.parse.urlparse(origin)
        except Exception:
            return False
        host = parsed.hostname or ''
        return (host in {'localhost', '127.0.0.1', '::1'} or
                host.startswith('192.168.') or host.startswith('10.') or
                (host.startswith('172.') and host.split('.')[1].isdigit() and
                 16 <= int(host.split('.')[1]) <= 31))


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


print(f'World Cup Predictor server')
print(f'   http://localhost:{PORT}')
print(f'   Bind: {BIND}:{PORT} (LAN accessible)')
print()

ensure_compute_server()
import atexit
atexit.register(cleanup_compute_server)
ThreadedHTTPServer((BIND, PORT), ProxyHandler).serve_forever()
