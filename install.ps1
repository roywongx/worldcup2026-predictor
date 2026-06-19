# One-line install: irm https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$Repo = "roywongx/worldcup2026-predictor"
$BaseUrl = "https://raw.githubusercontent.com/$Repo/main"

Write-Host "🏆 Installing World Cup 2026 Predictor..." -ForegroundColor Cyan

try {
    Invoke-WebRequest -Uri "$BaseUrl/index.html" -OutFile index.html -UseBasicParsing
    Invoke-WebRequest -Uri "$BaseUrl/server.py" -OutFile server.py -UseBasicParsing
    # Download module files
    New-Item -ItemType Directory -Force -Path model, data | Out-Null
    $moduleFiles = @(
        "model/stats.js", "model/elo.js", "model/dixon-coles.js",
        "model/gbdt.js", "model/monte-carlo.js",
        "data/teams.js", "data/matches.js", "mc-worker.js"
    )
    foreach ($f in $moduleFiles) {
        Invoke-WebRequest -Uri "$BaseUrl/$f" -OutFile $f -UseBasicParsing
    }
    Write-Host "✅ Downloaded index.html + server.py + 8 module files" -ForegroundColor Green

    # Auto-open
    Start-Process "http://localhost:9090"

    Write-Host ""
    Write-Host "📋 Usage:" -ForegroundColor Yellow
    Write-Host "   python3 server.py        # Start server on port 9090"
    Write-Host "   Open http://localhost:9090"
    Write-Host ""
    Write-Host "📊 Data sources (all free, no API key required):" -ForegroundColor Yellow
    Write-Host "   - Polymarket gamma/clob API (odds + results)"
    Write-Host "   - Dixon-Coles Poisson model (built-in)"
    Write-Host ""
    Write-Host "🔄 Click 'Sync Polymarket' in the app to fetch latest odds" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}
