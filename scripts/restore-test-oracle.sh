#!/usr/bin/env bash
# Restore a backup made by scripts/backup-oracle.sh into a THROWAWAY postgres container
# and check it. It never connects to production: it starts its own container on its own
# docker network, publishes no port, mounts no production volume, and removes both when it
# finishes. Run it on any machine with docker and age (your PC is the better place: it also
# proves the private key and the off-server copy work).
#
#   scripts/restore-test-oracle.sh <archive.tar.gz.age> <age-identity-file>
#
# Expected values default to the production state recorded in
# docs/deployments/2026-11-01-libread-production.md; override them for a fixture:
#   EXPECT_MIGRATIONS=27 EXPECT_LAST_MIGRATION=027-reader-sso.sql EXPECT_GLOBAL_WORKS=12
#   RESTORE_SKIP_PROD_CHECKS=1   only the generic checks (restore ran, registry readable)
#   RESTORE_PG_IMAGE=...         default: the image recorded in the manifest
#   KEEP_WORKDIR=1               leave the decrypted files for inspection (they hold secrets)
set -euo pipefail
umask 077

archive="${1:?usage: restore-test-oracle.sh <archive.tar.gz.age> <age-identity-file>}"
identity="${2:?usage: restore-test-oracle.sh <archive.tar.gz.age> <age-identity-file>}"
EXPECT_MIGRATIONS="${EXPECT_MIGRATIONS:-27}"
EXPECT_LAST_MIGRATION="${EXPECT_LAST_MIGRATION:-027-reader-sso.sql}"
EXPECT_GLOBAL_WORKS="${EXPECT_GLOBAL_WORKS:-12}"
OA_COLLECTION="74149e93-39dd-50ba-b120-a75415d9b0ca"
INDIVIDUAL_GRANT="b2c00000-0000-4000-8000-000000000002"

log() { printf '%s restore-test: %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then log "PASS  $1 = $3"; else log "FAIL  $1: expected '$2', got '$3'"; fail=1; fi
}

[ -f "$archive" ] && [ -f "$identity" ] || { log "archive or identity file not found"; exit 2; }
command -v docker >/dev/null && command -v age >/dev/null || { log "docker and age are required"; exit 2; }

suffix="$(date -u +%Y%m%d%H%M%S)-$$"
cname="libread-restore-test-$suffix"
net="libread-restore-test-$suffix"
work="$(mktemp -d)"
cleanup() {
  docker rm -f "$cname" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  if [ "${KEEP_WORKDIR:-0}" = "1" ]; then log "workdir kept: $work (contains secrets)"; else rm -rf "$work"; fi
}
trap cleanup EXIT

if [ -f "$archive.sha256" ]; then
  want="$(cut -d' ' -f1 <"$archive.sha256")"
  got="$(sha256sum "$archive" | cut -d' ' -f1)"
  check "archive sha256" "$want" "$got"
else
  log "no .sha256 beside the archive; skipping checksum"
fi

log "decrypt + unpack"
age -d -i "$identity" <"$archive" | tar -xz -C "$work"
for f in db/akademik.dump db/roles.sql files/data.tar config/config.tar manifest.txt; do
  [ -s "$work/$f" ] || { log "FAIL  archive is missing $f"; exit 1; }
done
log "manifest:"; grep -E '^(created_utc|db_image|db_name|schema_migrations)=' "$work/manifest.txt" | sed 's/^/    /'

image="${RESTORE_PG_IMAGE:-$(sed -n 's/^db_image=//p' "$work/manifest.txt")}"
image="${image:-postgres:16}"
log "throwaway postgres: $image as $cname on private network $net"
docker network create "$net" >/dev/null
pw="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
docker run -d --name "$cname" --network "$net" \
  -e POSTGRES_USER=restore_check -e POSTGRES_PASSWORD="$pw" -e POSTGRES_DB=postgres \
  "$image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$cname" pg_isready -U restore_check -d postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$cname" pg_isready -U restore_check -d postgres >/dev/null || { log "FAIL  postgres did not start"; exit 1; }
psql_t() { docker exec -i "$cname" psql -U restore_check -d "$1" -v ON_ERROR_STOP=1 -Atq -c "$2"; }

log "roles"
docker exec -i "$cname" psql -U restore_check -d postgres -q <"$work/db/roles.sql" 2>"$work/roles.err" >/dev/null || true
# Re-creating a role the image already has is expected; any other error is not.
if grep -E 'ERROR' "$work/roles.err" | grep -v 'already exists' | grep -q .; then
  log "FAIL  roles.sql errors:"; grep -E 'ERROR' "$work/roles.err" | grep -v 'already exists' | sed 's/^/    /'; fail=1
fi

log "pg_restore (exit on first error)"
psql_t postgres "create database akademik_restore" >/dev/null
docker exec -i "$cname" pg_restore -U restore_check -d akademik_restore --exit-on-error <"$work/db/akademik.dump"
log "restore finished"

reg_count="$(psql_t akademik_restore "select count(*) from schema_migrations")"
reg_last="$(psql_t akademik_restore "select coalesce(max(filename),'-') from schema_migrations")"
if [ "${RESTORE_SKIP_PROD_CHECKS:-0}" != "1" ]; then
  check "schema_migrations count" "$EXPECT_MIGRATIONS" "$reg_count"
  check "last migration" "$EXPECT_LAST_MIGRATION" "$reg_last"
  check "global works" "$EXPECT_GLOBAL_WORKS" \
    "$(psql_t akademik_restore "select count(*) from works where tenant_id is null")"
  check "OA collection members" "12" \
    "$(psql_t akademik_restore "select count(*) from collection_items where collection_id='$OA_COLLECTION'")"
  check "individual grant scope" "collection" \
    "$(psql_t akademik_restore "select scope_type from grants where id='$INDIVIDUAL_GRANT'")"
  check "individual 'all' grants" "0" \
    "$(psql_t akademik_restore "select count(*) from grants where tenant_id='b2c00000-0000-4000-8000-000000000001' and scope_type='all'")"
  check "app roles without superuser/bypassrls" "0" \
    "$(psql_t postgres "select count(*) from pg_roles where rolname in ('akademik_app','akademik_catalog') and (rolsuper or rolbypassrls)")"
else
  log "generic checks only: registry rows=$reg_count last=$reg_last"
fi

log "files + config inside the archive"
# Listing only: nothing is extracted outside $work, so no existing file can be overwritten.
uploads="$(tar -tf "$work/files/data.tar" | grep -c '^uploads/.*[^/]$' || true)"
ocr="$(tar -tf "$work/files/data.tar" | grep -c '^ocr/.*[^/]$' || true)"
log "      uploads files: $uploads, ocr files: $ocr"
if [ "${RESTORE_SKIP_PROD_CHECKS:-0}" != "1" ] && [ "$uploads" -eq 0 ]; then
  log "FAIL  no files under uploads/ in the archive"; fail=1
fi
cfg_list="$(tar -tf "$work/config/config.tar")"
for env_name in web-runtime.env web-release.env reader-integration.env; do
  if echo "$cfg_list" | grep -q "/$env_name\$"; then log "PASS  config contains $env_name"
  elif [ "${RESTORE_SKIP_PROD_CHECKS:-0}" = "1" ] && [ "$env_name" != web-runtime.env ]; then :
  else log "FAIL  config.tar has no $env_name"; fail=1; fi
done

if [ "$fail" -eq 0 ]; then log "RESULT: PASS"; else log "RESULT: FAIL"; exit 1; fi
