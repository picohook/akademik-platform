param(
  [Parameter(Mandatory = $true)][string]$Dump,
  [string]$ComposeFile = "docker-compose.prod.yml",
  [string]$EnvFile = ".env.production",
  [string]$DbUser = "akademik",
  [string]$DbName = "akademik"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Test-Path "backups/$Dump")) { throw "backup not found: backups/$Dump" }

docker compose -f $ComposeFile --env-file $EnvFile stop caddy web
try {
  docker compose -f $ComposeFile --env-file $EnvFile exec -T db pg_restore -U $DbUser -d $DbName --clean --if-exists --no-owner "/backups/$Dump"
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }
} finally {
  docker compose -f $ComposeFile --env-file $EnvFile start web caddy
}

Write-Host "Database restored from backups/$Dump"
Write-Host "Restore files manually with:"
Write-Host "  docker compose -f $ComposeFile --env-file $EnvFile exec -T web tar xzf /backups/<files-...tgz> -C /app/public"
