#!/bin/bash
# One-line install: curl -fsSL https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.sh | bash

set -e

REPO="roywongx/worldcup2026-predictor"
FILE="index.html"
URL="https://raw.githubusercontent.com/${REPO}/main/${FILE}"

echo "🏆 Installing World Cup 2026 Predictor..."

# Detect platform
if [[ "$OSTYPE" == "darwin"* ]]; then
    OPEN_CMD="open"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OPEN_CMD="xdg-open"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    OPEN_CMD="start"
else
    OPEN_CMD=""
fi

# Download
if command -v curl &> /dev/null; then
    curl -fsSL "$URL" -o worldcup2026.html
elif command -v wget &> /dev/null; then
    wget -q "$URL" -O worldcup2026.html
else
    echo "❌ curl or wget required"
    exit 1
fi

echo "✅ Downloaded to $(pwd)/worldcup2026.html"

# Auto-open if possible
if [ -n "$OPEN_CMD" ]; then
    echo "🌐 Opening in browser..."
    $OPEN_CMD worldcup2026.html 2>/dev/null || true
fi

echo ""
echo "📋 Next steps:"
echo "   1. Open worldcup2026.html in Chrome/Edge/Firefox"
echo "   2. Click '⟳ Refresh' to fetch latest data"
echo "   3. Go to Data tab to set API keys (optional, free)"
echo ""
echo "🔗 API Keys (free):"
echo "   - football-data.org/client/register (match results)"
echo "   - the-odds-api.com (betting odds)"
