#!/bin/bash
# Compute content hash of all cached assets and update sw.js CACHE version.
# Run after modifying any file listed in ASSETS.
set -e
cd "$(dirname "$0")"

HASH=$(cat index.html data/teams.js data/matches.js model/stats.js model/elo.js \
  model/dixon-coles.js model/gbdt.js model/monte-carlo.js mc-worker.js \
  | md5sum | cut -c1-8)

sed -i "s/const CACHE = 'wc26-[^']*'/const CACHE = 'wc26-${HASH}'/" sw.js
echo "✅ sw.js CACHE → 'wc26-${HASH}'"
