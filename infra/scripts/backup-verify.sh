#!/usr/bin/env bash
# Staged backup + restore drill (PRD 16.7): dump the database, restore into a scratch
# database, compare row counts and sealed payload digests, and re-hash every stored
# evidence object against its recorded SHA-256. Exits non-zero on any mismatch.
set -euo pipefail

CONTAINER="${DB_CONTAINER:-compose-db-1}"
DB="${DB_NAME:-blindcount}"
USER="${DB_USER:-blindcount}"
SCRATCH="${DB}_restore_check"
OUT_DIR="${BACKUP_DIR:-storage/backups}"
STORAGE_DIR="${STORAGE_ROOT:-storage}"
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="$OUT_DIR/$DB-$STAMP.dump"

docker exec "$CONTAINER" pg_dump -U "$USER" -Fc "$DB" > "$DUMP"
echo "backup written: $DUMP ($(wc -c < "$DUMP") bytes)"

docker exec "$CONTAINER" psql -U "$USER" -q -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
docker exec -i "$CONTAINER" pg_restore -U "$USER" -d "$SCRATCH" --no-owner < "$DUMP"

q() { docker exec "$CONTAINER" psql -U "$USER" -d "$1" -At -c "$2"; }
FAIL=0
for t in organizations memberships cohorts assignments submission_versions evidence_files reports audit_events; do
  a=$(q "$DB" "select count(*) from $t"); b=$(q "$SCRATCH" "select count(*) from $t")
  if [ "$a" != "$b" ]; then echo "MISMATCH $t: live=$a restored=$b"; FAIL=1; else echo "ok $t rows=$a"; fi
done
DIGEST_SQL="select coalesce(md5(string_agg(id::text || payload_sha256 || commitment, ',' order by id)), '') from submission_versions"
if [ "$(q "$DB" "$DIGEST_SQL")" != "$(q "$SCRATCH" "$DIGEST_SQL")" ]; then echo "MISMATCH sealed submission digests"; FAIL=1; else echo "ok sealed submission digests"; fi

while IFS='|' read -r key sha; do
  [ -z "$key" ] && continue
  f="$STORAGE_DIR/objects/$key"
  if [ ! -f "$f" ]; then echo "MISSING object $key"; FAIL=1; continue; fi
  actual=$(shasum -a 256 "$f" | cut -d' ' -f1)
  [ "$actual" = "$sha" ] || { echo "HASH MISMATCH $key"; FAIL=1; }
done < <(q "$DB" "select storage_key || '|' || sha256 from evidence_files")
echo "evidence objects checked: $(q "$DB" "select count(*) from evidence_files")"

docker exec "$CONTAINER" psql -U "$USER" -q -c "DROP DATABASE $SCRATCH"
[ "$FAIL" = 0 ] && echo "BACKUP VERIFY: PASS" || { echo "BACKUP VERIFY: FAIL"; exit 1; }
