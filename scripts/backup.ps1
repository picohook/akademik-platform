param(
  [string]$ComposeFile = "docker-compose.prod.yml",
  [string]$EnvFile = ".env.production",
  [string]$DbUser = "akademik",
  [string]$DbName = "akademik"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
New-Item -ItemType Directory -Force backups | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dump = "akademik-$stamp.dump"
$files = "files-$stamp.tgz"

docker compose -f $ComposeFile --env-file $EnvFile exec -T db pg_dump -U $DbUser -d $DbName -Fc -f "/backups/$dump"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }

docker compose -f $ComposeFile --env-file $EnvFile exec -T web tar czf "/backups/$files" -C /app/public uploads ocr
if ($LASTEXITCODE -ne 0) { throw "file archive failed" }

Write-Host "Backup written:"
Write-Host "  backups/$dump"
Write-Host "  backups/$files"
