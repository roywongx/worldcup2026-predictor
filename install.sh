#!/bin/bash
# One-line install: curl -fsSL https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.sh | bash

set -e

REPO="roywongx/worldcup2026-predictor"
BASE_URL="https://raw.githubusercontent.com/${REPO}/main"

echo "🏆 Installing World Cup 2026 Predictor..."

# Detect platform for browser open
if [[ "$OSTYPE" == "darwin"* ]]; then
    OPEN_CMD="open"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OPEN_CMD="xdg-open"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    OPEN_CMD="start"
else
    OPEN_CMD=""
fi

# Download function
download() {
    local url="$1" output="$2"
    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$output"
    elif command -v wget &> /dev/null; then
        wget -q "$url" -O "$output"
    else
        echo "❌ curl or wget required"
        exit 1
    fi
}

# Download checksum file first
echo "📋 Downloading checksums..."
download "${BASE_URL}/SHA256SUMS" "SHA256SUMS"

# Download all files
FILES="index.html server.py model/stats.js model/elo.js model/dixon-coles.js model/gbdt.js model/monte-carlo.js data/teams.js data/matches.js mc-worker.js"

mkdir -p model data
for f in $FILES; do
    download "${BASE_URL}/${f}" "${f}"
done

echo "🔍 Verifying file integrity..."
FAILED=0
while IFS='  ' read -r expected_hash filename; do
    [[ -z "$filename" ]] && continue
    if [[ ! -f "$filename" ]]; then
        echo "  ❌ MISSING: $filename"
        FAILED=1
        continue
    fi
    actual_hash=$(sha256sum "$filename" | cut -d' ' -f1)
    if [[ "$actual_hash" != "$expected_hash" ]]; then
        echo "  ❌ MISMATCH: $filename"
        echo "     expected: $expected_hash"
        echo "     actual:   $actual_hash"
        FAILED=1
    else
        echo "  ✅ $filename"
    fi
done < SHA256SUMS

if [[ $FAILED -ne 0 ]]; then
    echo ""
    echo "❌ Integrity check failed! Files may be corrupted or tampered."
    echo "   Re-run install or download from: https://github.com/${REPO}"
    exit 1
fi

echo ""
echo "✅ All files verified. Installed to $(pwd)"
echo ""
echo "📋 Usage:"
echo "   python3 server.py        # Start server on port 9090"
echo "   Open http://localhost:9090"
