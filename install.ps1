# One-line install: irm https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$Repo = "roywongx/worldcup2026-predictor"
$File = "index.html"
$Url = "https://raw.githubusercontent.com/$Repo/main/$File"

Write-Host "🏆 Installing World Cup 2026 Predictor..." -ForegroundColor Cyan

try {
    Invoke-WebRequest -Uri $Url -OutFile worldcup2026.html -UseBasicParsing
    Write-Host "✅ Downloaded to $(Get-Location)\worldcup2026.html" -ForegroundColor Green
    
    # Auto-open
    Start-Process worldcup2026.html
    
    Write-Host ""
    Write-Host "📋 Next steps:" -ForegroundColor Yellow
    Write-Host "   1. Click '⟳ Refresh' to fetch latest data"
    Write-Host "   2. Go to Data tab to set API keys (optional, free)"
    Write-Host ""
    Write-Host "🔗 API Keys (free):" -ForegroundColor Yellow
    Write-Host "   - football-data.org/client/register (match results)"
    Write-Host "   - the-odds-api.com (betting odds)"
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}
