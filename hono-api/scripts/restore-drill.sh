#!/usr/bin/env bash
# Restore drill: decrypt the newest local dump, restore it into a scratch DB,
# compare key table counts with the manifest written at backup time, then drop
# the scratch DB. Run as the postgres user (local peer auth).
#
#   sudo -u postgres BACKUP_DIR=/var/backups/smart-survey-x \
#     bash /opt/smart-survey-x/scripts/restore-drill.sh
set -euo pipefail
umask 077

DB="${BACKUP_DB:-smart_survey_x}"
DRILL_DB="${DRILL_DB:-smart_survey_x_restore_drill}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/smart-survey-x}"
TABLES="${DRILL_TABLES:-submissions record_facts survey_media app_users survey_form app_sessions}"

if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  echo "BACKUP_PASSPHRASE missing — source /etc/smart-survey-backup.env" >&2
  exit 2
fi

LATEST="$(ls -1t "$BACKUP_DIR"/db-*.dump.enc 2>/dev/null | head -n 1 || true)"
if [[ -z "$LATEST" ]]; then
  echo "no encrypted dump in $BACKUP_DIR" >&2
  exit 3
fi
MANIFEST="${LATEST%.dump.enc}.manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo "manifest missing for $LATEST" >&2
  exit 4
fi

TMP="$(mktemp)"
cleanup() {
  rm -f "$TMP"
  dropdb --if-exists "$DRILL_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "drill: $LATEST"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$LATEST" -out "$TMP" \
  -pass env:BACKUP_PASSPHRASE
# Structural check before creating anything.
pg_restore -l "$TMP" >/dev/null

dropdb --if-exists "$DRILL_DB"
createdb -T template0 "$DRILL_DB"
pg_restore --no-owner --no-privileges -d "$DRILL_DB" "$TMP"

fail=0
for table in $TABLES; do
  want="$(python3 - "$MANIFEST" "$table" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print((m.get("rowcounts") or {}).get(sys.argv[2], ""))
PY
)"
  got="$(psql -d "$DRILL_DB" -Atc "SELECT count(*) FROM ${table}" 2>/dev/null || echo "?")"
  echo "  ${table}: dumped=${want:-?} restored=${got}"
  if [[ -n "$want" && "$want" != "$got" ]]; then
    # A backup taken while rows were being inserted can differ by a few rows.
    if [[ "$table" == "submissions" || "$table" == "record_facts" ]]; then
      echo "  WARN: count drift on $table" >&2
      fail=1
    fi
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "DRILL FAILED — counts do not match the manifest" >&2
  exit 5
fi
echo "DRILL OK — encrypted dump restores cleanly"
