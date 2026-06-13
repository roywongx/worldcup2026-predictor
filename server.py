#!/usr/bin/env python3
"""Local server with API proxy for World Cup Predictor.
Serves static files and proxies football-data.org / the-odds-api.com requests
to bypass browser CORS restrictions."""

import http.server
import json
import os
import sys
import urllib.request
import urllib.parse
from pathlib import Path

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
        else:
            super().do_GET()

    def _proxy_football_data(self):
        """Proxy to football-data.org with API key from query param or header."""
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        api_key = params.get('key', [''])[0]
        if not api_key:
            api_key = self.headers.get('X-Api-Key', '')

        if not api_key:
            self._json_response({'error': 'Missing API key. Pass ?key=YOUR_KEY'}, 400)
            return

        url = 'https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED'
        req = urllib.request.Request(url, headers={'X-Auth-Token': api_key})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                self._json_response(data)
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:200]
            self._json_response({'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._json_response({'error': str(e)}, 502)

    def _proxy_odds_api(self):
        """Proxy to the-odds-api.com with API key from query param."""
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        api_key = params.get('key', [''])[0]
        if not api_key:
            self._json_response({'error': 'Missing API key. Pass ?key=YOUR_KEY'}, 400)
            return

        url = f'https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup_winner/odds/?apiKey={api_key}&regions=us&markets=outrights&oddsFormat=american'
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                remaining = resp.headers.get('x-requests-remaining', '')
                self._json_response({'data': data, 'remaining': remaining})
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:200]
            self._json_response({'error': f'HTTP {e.code}: {body}'}, e.code)
        except Exception as e:
            self._json_response({'error': str(e)}, 502)

    def _json_response(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress noisy request logs, only log errors
        if args and '404' in str(args[1]) if len(args) > 1 else False:
            super().log_message(format, *args)

print(f'🏆 World Cup Predictor server running at:')
print(f'   Local:   http://localhost:{PORT}')
print(f'   Network: http://0.0.0.0:{PORT}')
print(f'   Proxy:   /api/results?key=... and /api/odds?key=...')

http.server.HTTPServer(('0.0.0.0', PORT), ProxyHandler).serve_forever()
