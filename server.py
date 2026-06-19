#!/usr/bin/env python3
"""Local server with API proxy for World Cup Predictor.
Serves static files and proxies football-data.org / the-odds-api.com requests
to bypass browser CORS restrictions."""

import http.server
import socketserver
import json
import sys
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9090
DIR = Path(__file__).parent
BIND = '0.0.0.0'  # accessible on local network

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def do_GET(self):
        if self.path.startswith('/api/results'):
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

    def end_headers(self):
        # Prevent browser caching of HTML/JS files
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def _log(self, msg):
        ts = datetime.now().strftime('%H:%M:%S')
        print(f'  [{ts}] {msg}')

    def _get_api_key(self):
        """Extract API key from X-API-Key header only."""
        key = self.headers.get('X-API-Key', '')
        if not key:
            self._log(f'⚠ No X-API-Key in header (path={self.path})')
        return key

    def _odds_request(self, path, params=None):
        """Build the-odds-api request using header auth so keys stay out of URLs."""
        api_key = self._get_api_key()
        if not api_key or len(api_key) < 10:
            self._log(f'⚠ _odds_request: invalid API key (len={len(api_key)}) — will get 401')
        query = urllib.parse.urlencode(params or {})
        url = f'https://api.the-odds-api.com/v4/{path}'
        if query:
            url += '?' + query
        return urllib.request.Request(url, headers={'x-api-key': api_key})

    def _test_key(self):
        """Test if a football-data.org API key is valid."""
        api_key = self._get_api_key()
        if not api_key:
            self._json_response({'error': 'Pass X-API-Key header or ?key=YOUR_KEY'}, 400)
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
        api_key = self._get_api_key()
        if not api_key:
            self._json_response({'error': 'Pass X-API-Key header or ?key=YOUR_KEY'}, 400)
            return

        req = self._odds_request('sports')
        # SEC-1: don't log key
        self._log('test-odds →')
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
        """Proxy to football-data.org with API key from header."""
        api_key = self._get_api_key()
        if not api_key:
            self._json_response({'error': 'Missing API key (X-API-Key header)'}, 400)
            return

        url = 'https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED'
        req = urllib.request.Request(url, headers={
            'X-Auth-Token': api_key,
            'Accept': 'application/json',
        })
        # SEC-1: don't log key
        self._log('football-data.org →')
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
        """Proxy to the-odds-api.com with API key from header."""
        api_key = self._get_api_key()
        if not api_key:
            self._log('✗ /api/odds: No API key in request header')
            self._json_response({'error': 'Missing API key. Set it in Data tab → API Keys → Odds API, then save.'}, 400)
            return

        req = self._odds_request('sports/soccer_fifa_world_cup_winner/odds/', {
            'regions': 'us',
            'markets': 'outrights',
            'oddsFormat': 'american',
        })
        # SEC-1: don't log key
        self._log('the-odds-api.com →')
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

    def _proxy_match_odds(self):
        """Proxy to the-odds-api.com for match-level h2h odds."""
        api_key = self._get_api_key()
        if not api_key:
            self._log('✗ /api/match-odds: No API key in request header')
            self._json_response({'error': 'Missing API key. Set it in Data tab → API Keys → Odds API, then save.'}, 400)
            return

        # Cache: remember which sport key worked to avoid wasting quota on 404s
        if not hasattr(self, '_match_odds_sport_cache'):
            self.__class__._match_odds_sport_cache = None

        sports_to_try = (
            [self._match_odds_sport_cache, 'soccer_fifa_world_cup', 'soccer_fifa_world_cup_winner']
            if self._match_odds_sport_cache
            else ['soccer_fifa_world_cup', 'soccer_fifa_world_cup_winner']
        )
        seen = set()
        for sport in sports_to_try:
            if sport in seen or not sport:
                continue
            seen.add(sport)
            req = self._odds_request(f'sports/{sport}/odds/', {
                'regions': 'us,eu',
                'markets': 'h2h',
                'oddsFormat': 'decimal',
            })
            self._log(f'the-odds-api.com match-odds → {sport}')
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read())
                    remaining = resp.headers.get('x-requests-remaining', '')
                    self._log(f'the-odds-api.com match-odds ✓ {len(data)} events, remaining={remaining}')
                    self.__class__._match_odds_sport_cache = sport
                    self._json_response({'data': data, 'remaining': remaining, 'sport': sport})
                    return
            except urllib.error.HTTPError as e:
                body = e.read().decode('utf-8', errors='replace')[:200]
                self._log(f'the-odds-api.com match-odds ✗ {sport} HTTP {e.code}')
                if e.code == 404:
                    continue  # try next sport key
            except Exception as e:
                self._log(f'the-odds-api.com match-odds ✗ {e}')
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
        return (
            host in {'localhost', '127.0.0.1', '::1'} or
            host.startswith('192.168.') or
            host.startswith('10.') or
            (host.startswith('172.') and host.split('.')[1].isdigit() and 16 <= int(host.split('.')[1]) <= 31)
        )

# SEC-3: use ThreadingHTTPServer for concurrent requests
class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

print(f'World Cup Predictor server')
print(f'   http://localhost:{PORT}')
print(f'   Bind: {BIND}:{PORT} (LAN accessible)')
print()

ThreadedHTTPServer((BIND, PORT), ProxyHandler).serve_forever()
