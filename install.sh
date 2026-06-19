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

# Download both files
download "${BASE_URL}/index.html" "index.html"
download "${BASE_URL}/server.py" "server.py"

echo "✅ Downloaded index.html + server.py"

echo ""
echo "📋 Usage:"
echo "   python3 server.py        # Start server on port 9090"
echo "   Open http://localhost:9090"
echo ""
echo "📊 Data sources (all free, no API key required):"
echo "   - Polymarket gamma/clob API (odds + results)"
echo "   - Dixon-Coles Poisson model (built-in)"
echo ""
echo "🔄 Click 'Sync Polymarket' in the app to fetch latest odds"
