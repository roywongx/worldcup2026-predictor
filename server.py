#!/usr/bin/env python3
"""Local server with API proxy for World Cup Predictor.
Serves static files and proxies football-data.org / the-odds-api.com requests
to bypass browser CORS restrictions."""

import http.server
import json
import sys
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9090
DIR = Path(__file__).parent

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def do_GET(self):
        if self.path.startswith('/api/results'):
            self._proxy_football_data()
        elif self.path.startswith('/api/odds'):
            self._proxy_odds_api()
        elif self.path.startswith('/api/test-odds'):
            self._test_odds_key()
        elif self.path.startswith('/api/test'):
            self._test_key()
        else:
            super().do_GET()

    def _log(self, msg):
        ts = datetime.now().strftime('%H:%M:%S')
        print(f'  [{ts}] {msg}')

    def _test_key(self):
        """Test if a football-data.org API key is valid."""
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        api_key = params.get('key', [''])[0]
        if not api_key:
            self._json_response({'error': 'Pass ?key=YOUR_KEY'}, 400)
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
        """Test if a the-odds-api.com key is valid."""
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        api_key = params.get('key', [''])[0]
        if not api_key:
            self._json_response({'error': 'Pass ?key=YOUR_KEY'}, 400)
            return

        url = f'https://api.the-odds-api.com/v4/sports?apiKey={api_key}'
        req = urllib.request.Request(url)
        self._log(f'test-odds → key={api_key[:8]}...')
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                remaining = resp.headers.get('x-requests-remaining', '?')
                used = resp.headers.get('x-requests-used', '?')
                self._log(f'test-odds ✓ remaining={remaining}')
                self._json_response({'ok': True, 'remaining': remaining, 'used': used})
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:300]
            self._log(f'test-odds ✗ HTTP {e.code}')
            self._json_response({'ok': False, 'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._log(f'test-odds ✗ {e}')
            self._json_response({'ok': False, 'error': str(e)}, 502)

    def _proxy_football_data(self):
        """Proxy to football-data.org with API key from query param."""
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        api_key = params.get('key', [''])[0]

        if not api_key:
            self._json_response({'error': 'Missing API key'}, 400)
            return

        url = 'https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED'
        req = urllib.request.Request(url, headers={
            'X-Auth-Token': api_key,
            'Accept': 'application/json',
        })
        self._log(f'football-data.org → key={api_key[:8]}...')
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                count = len(data.get('matches', []))
                self._log(f'football-data.org ✓ {count} matches')
                self._json_response(data)
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:300]
            self._log(f'football-data.org ✗ HTTP {e.code}: {body[:80]}')
            self._json_response({'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._log(f'football-data.org ✗ {e}')
            self._json_response({'error': str(e)}, 502)

    def _proxy_odds_api(self):
        """Proxy to the-odds-api.com with API key from query param."""
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        api_key = params.get('key', [''])[0]
        if not api_key:
            self._json_response({'error': 'Missing API key'}, 400)
            return

        url = f'https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup_winner/odds/?apiKey={api_key}&regions=us&markets=outrights&oddsFormat=american'
        req = urllib.request.Request(url)
        self._log(f'the-odds-api.com → key={api_key[:8]}...')
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                remaining = resp.headers.get('x-requests-remaining', '')
                self._log(f'the-odds-api.com ✓ remaining={remaining}')
                self._json_response({'data': data, 'remaining': remaining})
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:300]
            self._log(f'the-odds-api.com ✗ HTTP {e.code}')
            self._json_response({'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._log(f'the-odds-api.com ✗ {e}')
            self._json_response({'error': str(e)}, 502)

    def _json_response(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

print(f'🏆 World Cup Predictor server')
print(f'   http://localhost:{PORT}')
print(f'   http://0.0.0.0:{PORT}')
print(f'   Test key: http://localhost:{PORT}/api/test?key=YOUR_KEY')
print()

http.server.HTTPServer(('0.0.0.0', PORT), ProxyHandler).serve_forever()
