# Script khởi động nhanh hệ thống Universal Job Crawler (n8n-Inspired Pipeline)
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  CrawlJob Studio v2.0 - Universal n8n Job Scraper Engine " -ForegroundColor Emerald
Write-Host "==========================================================" -ForegroundColor Cyan

$BackendDir = Join-Path $PSScriptRoot "backend"
$FrontendDir = Join-Path $PSScriptRoot "frontend"

Write-Host "[1/2] Starting FastAPI Backend on http://127.0.0.1:8000 ..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$BackendDir'; python run.py"

Write-Host "[2/2] Starting React + Vite Dashboard on http://127.0.0.1:5173 ..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$FrontendDir'; npm run dev"

Write-Host "Done! Open http://127.0.0.1:5173 in your browser." -ForegroundColor Green
