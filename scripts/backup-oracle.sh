#!/usr/bin/env bash
# Daily encrypted backup of the Oracle production reader (LibRead).
#
# Contents of one archive:
#   db/akademik.dump   pg_dump -Fc of the live database (a consistent MVCC snapshot,
#                      taken while the web container keeps running - nothing is stopped)
#   db/roles.sql       pg_dumpall --roles-only (contains password hashes)
#   files/             uploads and OCR output from the host (R2 stays the source for books)
#   config/            the three env files' directories (secrets!)
#   manifest.txt       what was backed up, sizes, migration registry state
#
# CONSISTENCY LIMIT: the database dump is a consistent snapshot, but the files are tarred
# while the web container runs. An upload or delete that happens during the run can leave the
# files and the DB out of step (a file with no row, a row whose file was just removed, or a
# half-written file). That is not full crash-consistency; R2 stays the content source of
# truth. A test against a fixture does not prove production consistency.
#
# The archive is encrypted with an age PUBLIC key before it leaves this script's staging
# directory. The matching private key is never kept on this server or next to the backups.
#
# Run it through systemd (infra/systemd/libread-backup.service). systemd reads the
# EnvironmentFile as plain KEY=value; do not `source` that file in a shell.
# Restore: docs/runbooks/oracle-backup-restore.md and scripts/restore-test-oracle.sh.
#
# Exit code is non-zero on ANY failure, and nothing is pruned after a failure.
set -euo pipefail
umask 077

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT (age1... public key) is required}"

LIVE_ROOT="${LIVE_ROOT:-/home/ubuntu/libedge-oracle-v136}"
V137_ROOT="${V137_ROOT:-/home/ubuntu/libedge-oracle-v137}"
DB_CONTAINER="${DB_CONTAINER:-libedge-oracle-v136-db}"
DB_NAME="${DB_NAME:-akademik}"
DB_SUPERUSER="${DB_SUPERUSER:-akademik}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/libedge-backups}"
KEEP_LOCAL="${KEEP_LOCAL:-7}"
MIN_FREE_MB="${MIN_FREE_MB:-2048}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"      # e.g. r2backup:libedge-backups/oracle
BACKUP_ALLOW_LOCAL_ONLY="${BACKUP_ALLOW_LOCAL_ONLY:-0}"
ROLES_FLAGS="${BACKUP_ROLES_FLAGS:-}"                  # e.g. --no-role-passwords
# Same privilege model as today: `sudo -n docker`. No docker-group change just for backups.
read -r -a DOCKER <<<"${DOCKER_CMD:-sudo -n docker}"

log() { printf '%s backup-oracle: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "FAILED: $*"; exit 1; }

command -v "${DOCKER[0]}" >/dev/null || die "${DOCKER[0]} not found"
command -v age >/dev/null    || die "age not found (sudo apt install age)"
if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  command -v rclone >/dev/null || die "rclone not found (sudo apt install rclone)"
elif [ "$BACKUP_ALLOW_LOCAL_ONLY" != "1" ]; then
  die "BACKUP_RCLONE_REMOTE is empty: an off-server copy is the point. Set BACKUP_ALLOW_LOCAL_ONLY=1 to run local-only."
fi

[ "$("${DOCKER[@]}" inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" = "true" ] \
  || die "DB container $DB_CONTAINER is not running"

mkdir -p "$BACKUP_DIR"
free_mb=$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')
[ "$free_mb" -ge "$MIN_FREE_MB" ] || die "only ${free_mb} MB free in $BACKUP_DIR (need $MIN_FREE_MB)"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="libread-oracle-${stamp}.tar.gz.age"
stage="$(mktemp -d "$BACKUP_DIR/.stage-${stamp}-XXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/db" "$stage/files" "$stage/config"

# Files are taken before the database. This order gives NO consistency guarantee (see the
# CONSISTENCY LIMIT above); concurrent uploads/deletes can still leave them out of step.
log "files: uploads + ocr + seed"
[ -d "$LIVE_ROOT/data/uploads" ] || die "$LIVE_ROOT/data/uploads missing"
[ -d "$LIVE_ROOT/data/ocr" ]     || die "$LIVE_ROOT/data/ocr missing"
tar -C "$LIVE_ROOT/data" -cf "$stage/files/data.tar" uploads ocr
# The live reader uses seed/sample.pdf, so it is mandatory in the archive.
[ -f "$LIVE_ROOT/seed/sample.pdf" ] || die "$LIVE_ROOT/seed/sample.pdf missing"
tar -C "$LIVE_ROOT" -cf "$stage/files/seed.tar" seed

log "config: env directories (secrets - stays inside the encrypted archive)"
cfg_dirs=("$LIVE_ROOT/config" "$V137_ROOT/config")
for d in "$V137_ROOT"/releases/*/config; do [ -d "$d" ] && cfg_dirs+=("$d"); done
for d in "${cfg_dirs[@]}"; do [ -r "$d" ] || die "cannot read $d"; done
# Some release files (web-release.env, admin.env) are root-owned 0600, so read with
# `sudo -n` (same model as docker). The redirect runs as this user, so the archive stays ours.
read -r -a SUDO <<<"${SUDO_CMD:-sudo -n}"
"${SUDO[@]}" tar -C / -cf - "${cfg_dirs[@]#/}" >"$stage/config/config.tar"
[ -s "$stage/config/config.tar" ] || die "config.tar is empty"

log "database: pg_dump -Fc $DB_NAME"
"${DOCKER[@]}" exec "$DB_CONTAINER" pg_dump -U "$DB_SUPERUSER" -d "$DB_NAME" -Fc >"$stage/db/akademik.dump"
"${DOCKER[@]}" exec -i "$DB_CONTAINER" pg_restore -l <"$stage/db/akademik.dump" >/dev/null \
  || die "pg_restore cannot read the dump it just wrote"
log "database: roles"
# shellcheck disable=SC2086
"${DOCKER[@]}" exec "$DB_CONTAINER" pg_dumpall -U "$DB_SUPERUSER" --roles-only $ROLES_FLAGS >"$stage/db/roles.sql"
[ -s "$stage/db/roles.sql" ] || die "roles.sql is empty"

registry="$("${DOCKER[@]}" exec "$DB_CONTAINER" psql -U "$DB_SUPERUSER" -d "$DB_NAME" -Atc \
  "select count(*) || ' ' || coalesce(max(filename),'-') from schema_migrations")" \
  || die "cannot read schema_migrations"

{
  echo "created_utc=$stamp"
  echo "host=$(hostname)"
  echo "db_container=$DB_CONTAINER"
  echo "db_image=$("${DOCKER[@]}" inspect -f '{{.Config.Image}}' "$DB_CONTAINER")"
  echo "db_name=$DB_NAME"
  echo "schema_migrations=$registry"
  (cd "$stage" && find db files config -type f -exec sha256sum {} +)
  (cd "$stage" && find db files config -type f -exec stat -c '%s %n' {} +)
} >"$stage/manifest.txt"

log "encrypt: age -> $name"
tar -C "$stage" -czf - . | age -r "$BACKUP_AGE_RECIPIENT" >"$BACKUP_DIR/$name.partial"
[ -s "$BACKUP_DIR/$name.partial" ] || die "encrypted archive is empty"
mv "$BACKUP_DIR/$name.partial" "$BACKUP_DIR/$name"
(cd "$BACKUP_DIR" && sha256sum "$name" >"$name.sha256")
size=$(stat -c %s "$BACKUP_DIR/$name")
log "archive $name ($size bytes), registry: $registry"

if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  log "upload: $BACKUP_RCLONE_REMOTE"
  rclone copyto "$BACKUP_DIR/$name" "$BACKUP_RCLONE_REMOTE/$name"
  rclone copyto "$BACKUP_DIR/$name.sha256" "$BACKUP_RCLONE_REMOTE/$name.sha256"
  remote_size=$(rclone lsf --format s "$BACKUP_RCLONE_REMOTE/$name" | head -n1)
  [ "$remote_size" = "$size" ] || die "remote size $remote_size != local $size"
  # Size alone is not proof: download the object again and compare SHA-256.
  rclone copyto "$BACKUP_RCLONE_REMOTE/$name" "$stage/roundtrip.age"
  want_sha="$(cut -d' ' -f1 <"$BACKUP_DIR/$name.sha256")"
  got_sha="$(sha256sum "$stage/roundtrip.age" | cut -d' ' -f1)"
  [ "$want_sha" = "$got_sha" ] || die "remote SHA-256 $got_sha != local $want_sha"
  rm -f "$stage/roundtrip.age"
  log "upload verified (size + SHA-256 after re-download)"
fi

# Retention. Local: keep the newest $KEEP_LOCAL archives. Remote retention is a bucket
# lifecycle rule (7 days) on the backup bucket/prefix only.
mapfile -t old < <(cd "$BACKUP_DIR" && ls -1t libread-oracle-*.tar.gz.age 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))")
for f in "${old[@]}"; do
  [ -n "$f" ] || continue
  rm -f -- "$BACKUP_DIR/$f" "$BACKUP_DIR/$f.sha256"
  log "pruned local $f"
done

date -u +%FT%TZ >"$BACKUP_DIR/last-success"
log "OK"
