#!/bin/bash
# Compute content hash of all cached assets, update sw.js CACHE and SHA256SUMS.
# Run after modifying any file listed in ASSETS.
set -e
cd "$(dirname "$0")"

FILES="index.html server.py data/teams.js data/matches.js model/stats.js model/elo.js model/dixon-coles.js model/gbdt.js model/monte-carlo.js mc-worker.js"

# Update sw.js cache hash
HASH=$(cat $FILES | md5sum | cut -c1-8)
sed -i "s/const CACHE = 'wc26-[^']*'/const CACHE = 'wc26-${HASH}'/" sw.js
echo "✅ sw.js CACHE → 'wc26-${HASH}'"

# Regenerate SHA256SUMS
sha256sum $FILES > SHA256SUMS
echo "✅ SHA256SUMS regenerated"
