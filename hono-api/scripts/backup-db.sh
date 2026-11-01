#!/usr/bin/env bash
# Encrypted Postgres backup for Smart Survey X.
#
#   pg_dump -Fc  →  AES-256 (PBKDF2, 200k iters)  →  sha256  →  R2
#
# Cadence is adaptive while the systemd timer still ticks hourly:
#   dump < BACKUP_LARGE_BYTES (default 3 MB)  → hourly
#   dump >= threshold                          → 6-hourly
#   election week (ELECTION_WEEK=1 or dates)   → hourly regardless of size
# The script skips a tick when the previous successful backup is newer than
# the current interval, so no privileged timer rewrite is needed.
#
# Local copies stay in BACKUP_DIR (newest 3) so a restore drill does not need
# a read token. R2 lifecycle owns offsite retention. Any failure exits non-zero
# and posts to BACKUP_ALERT_WEBHOOK when configured; systemd also records the
# failed unit in the journal.
#
# Required env (see scripts/BACKUP_SETUP.md):
#   BACKUP_PASSPHRASE, R2_BACKUP_BUCKET, R2_BACKUP_ACCESS_KEY_ID,
#   R2_BACKUP_SECRET_ACCESS_KEY, R2_BACKUP_ENDPOINT (or R2_BACKUP_ACCOUNT_ID)
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${BACKUP_DB:-smart_survey_x}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/smart-survey-x}"
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-3}"
ALLOW_LOCAL_ONLY="${BACKUP_ALLOW_LOCAL_ONLY:-0}"
LARGE_BYTES="${BACKUP_LARGE_BYTES:-3000000}"
ELECTION_WEEK="${ELECTION_WEEK:-0}"
ELECTION_WEEK_START="${ELECTION_WEEK_START:-}"
ELECTION_WEEK_END="${ELECTION_WEEK_END:-}"
FORCE="${BACKUP_FORCE:-0}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NAME="db-$TS"
TMPDIR=""

is_election_week() {
  [[ "$ELECTION_WEEK" == "1" ]] && return 0
  [[ -z "$ELECTION_WEEK_START" || -z "$ELECTION_WEEK_END" ]] && return 1
  local today
  today="$(TZ=Asia/Kolkata date +%F)"
  [[ ( "$today" > "$ELECTION_WEEK_START" || "$today" == "$ELECTION_WEEK_START" ) &&
     ( "$today" < "$ELECTION_WEEK_END" || "$today" == "$ELECTION_WEEK_END" ) ]]
}

alert() {
  local msg="$1"
  logger -t smart-survey-backup "$msg" 2>/dev/null || true
  echo "ALERT: $msg" >&2
  if [[ -n "${BACKUP_ALERT_WEBHOOK:-}" ]]; then
    local payload
    payload="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$msg")"
    curl -sS -m 10 -X POST "$BACKUP_ALERT_WEBHOOK" \
      -H 'Content-Type: application/json' --data "$payload" >/dev/null || true
  fi
}

cleanup() {
  # Must always return 0: on a skipped run TMPDIR is empty, and a failing
  # test here would trip the ERR trap and turn a normal skip into an alert.
  if [[ -n "$TMPDIR" && -d "$TMPDIR" ]]; then
    rm -rf "$TMPDIR"
  fi
  return 0
}
trap cleanup EXIT

on_error() {
  local code=$?
  alert "backup FAILED (exit $code) host=$(hostname) db=$DB"
  exit "$code"
}
trap on_error ERR

for tool in pg_dump pg_dumpall psql openssl sha256sum python3 curl flock; do
  command -v "$tool" >/dev/null || { alert "backup FAILED: missing $tool"; exit 2; }
done

if [[ -z "${BACKUP_PASSPHRASE:-}" || "${#BACKUP_PASSPHRASE}" -lt 16 ]]; then
  alert "backup FAILED: BACKUP_PASSPHRASE missing or shorter than 16 chars"
  exit 2
fi

# Adaptive cadence: hourly under 3 MB, 6-hourly above it outside election week.
# A skip is a normal exit 0 (systemd shows the tick as successful, no alert).
if [[ "$FORCE" != "1" ]]; then
  LAST_ROW="$(psql -d "$DB" -Atc "
    SELECT extract(epoch from finished_at)::bigint || '|' || COALESCE(bytes, 0)
    FROM backup_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1" 2>/dev/null || true)"
  if [[ -n "$LAST_ROW" ]]; then
    LAST_AT="${LAST_ROW%%|*}"
    LAST_BYTES="${LAST_ROW##*|}"
    INTERVAL=3600
    if (( LAST_BYTES >= LARGE_BYTES )) && ! is_election_week; then
      INTERVAL=21600
    fi
    NOW_EPOCH="$(date +%s)"
    # 5-minute grace: the hourly timer carries RandomizedDelaySec, so a run at
    # 14:01 is followed by a tick at 15:00 — without the grace that tick would
    # be skipped and small dumps would silently become 2-hourly.
    GRACE=300
    if (( NOW_EPOCH - LAST_AT < INTERVAL - GRACE )); then
      echo "backup: not due (last=${LAST_AT} size=${LAST_BYTES}B interval=${INTERVAL}s election_week=$(is_election_week && echo yes || echo no))"
      exit 0
    fi
  fi
fi

UPLOAD=1
if [[ "$ALLOW_LOCAL_ONLY" == "1" ]]; then
  UPLOAD=0
elif [[ -z "${R2_BACKUP_BUCKET:-}" || -z "${R2_BACKUP_ACCESS_KEY_ID:-}" ||
        -z "${R2_BACKUP_SECRET_ACCESS_KEY:-}" ||
        ( -z "${R2_BACKUP_ENDPOINT:-}" && -z "${R2_BACKUP_ACCOUNT_ID:-}" ) ]]; then
  alert "backup FAILED: R2 backup env incomplete (bucket/token/endpoint)"
  exit 2
fi

mkdir -p "$BACKUP_DIR"
# One writer at a time; a slow dump must not overlap the next hourly run.
exec 9>"$BACKUP_DIR/.lock"
if ! flock -n 9; then
  echo "backup already running — skipping $TS"
  exit 0
fi

TMPDIR="$(mktemp -d "$BACKUP_DIR/.tmp.XXXXXX")"
RAW_DB="$TMPDIR/$NAME.dump"
RAW_GLOBALS="$TMPDIR/$NAME.globals.sql"
ENC_DB="$TMPDIR/$NAME.dump.enc"
ENC_GLOBALS="$TMPDIR/$NAME.globals.enc"

echo "backup: dumping $DB at $STARTED"
pg_dump -Fc --no-owner --no-privileges -d "$DB" -f "$RAW_DB"
pg_dumpall --globals-only -f "$RAW_GLOBALS"

openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$RAW_DB" -out "$ENC_DB" -pass env:BACKUP_PASSPHRASE
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$RAW_GLOBALS" -out "$ENC_GLOBALS" -pass env:BACKUP_PASSPHRASE

DUMP_SHA="$(sha256sum "$ENC_DB" | awk '{print $1}')"
DUMP_BYTES="$(stat -c %s "$ENC_DB")"
printf '%s  %s\n' "$DUMP_SHA" "$(basename "$ENC_DB")" > "$TMPDIR/$NAME.dump.enc.sha256"

# Counts captured at dump time; the daily/weekly restore drill compares these
# with the restored scratch DB instead of the (by then newer) live DB.
ROWCOUNTS="$(psql -d "$DB" -Atc "
  SELECT COALESCE(jsonb_object_agg(t, n), '{}'::jsonb)::text FROM (
    SELECT 'submissions' AS t, COUNT(*) AS n FROM submissions
    UNION ALL SELECT 'record_facts', COUNT(*) FROM record_facts
    UNION ALL SELECT 'survey_media', COUNT(*) FROM survey_media
    UNION ALL SELECT 'app_users', COUNT(*) FROM app_users
    UNION ALL SELECT 'survey_form', COUNT(*) FROM survey_form
    UNION ALL SELECT 'app_sessions', COUNT(*) FROM app_sessions
  ) x" 2>/dev/null || echo '{}')"

MANIFEST="$TMPDIR/$NAME.manifest.json"
python3 - "$MANIFEST" "$DB" "$STARTED" "$DUMP_BYTES" "$DUMP_SHA" "$ROWCOUNTS" <<'PY'
import json, sys
path, db, started, size, sha, counts = sys.argv[1:7]
try:
    rowcounts = json.loads(counts or "{}")
except Exception:
    rowcounts = {}
json.dump(
    {
        "db": db,
        "started_at": started,
        "bytes": int(size),
        "sha256": sha,
        "rowcounts": rowcounts,
        "encryption": "aes-256-cbc/pbkdf2-200000",
    },
    open(path, "w"),
    indent=2,
)
PY

if [[ "$UPLOAD" == "1" ]]; then
  KEY_PREFIX="postgres/${TS:0:4}/${TS:4:2}/${TS:6:2}"
  echo "backup: uploading $NAME to R2"
  python3 "$SCRIPT_DIR/r2_put.py" "$ENC_DB" "$KEY_PREFIX/$NAME.dump.enc"
  python3 "$SCRIPT_DIR/r2_put.py" "$ENC_GLOBALS" "$KEY_PREFIX/$NAME.globals.enc"
  python3 "$SCRIPT_DIR/r2_put.py" "$TMPDIR/$NAME.dump.enc.sha256" "$KEY_PREFIX/$NAME.dump.enc.sha256"
  python3 "$SCRIPT_DIR/r2_put.py" "$MANIFEST" "$KEY_PREFIX/$NAME.manifest.json"
  OBJECT_KEY="$KEY_PREFIX/$NAME.dump.enc"
else
  echo "backup: local-only run (BACKUP_ALLOW_LOCAL_ONLY=1)"
  OBJECT_KEY="local:$NAME.dump.enc"
fi

mv "$ENC_DB" "$ENC_GLOBALS" "$TMPDIR/$NAME.dump.enc.sha256" "$MANIFEST" "$BACKUP_DIR/"

# Heartbeat for /api/backup/status; never fail the backup if schema is behind.
psql -d "$DB" -Atc "
  INSERT INTO backup_runs (status, db_name, object_key, bytes, sha256, started_at, finished_at)
  VALUES ('ok', '$DB', '$OBJECT_KEY', $DUMP_BYTES, '$DUMP_SHA', '$STARTED'::timestamptz, NOW())" \
  >/dev/null 2>&1 || true

# Keep the newest N local sets (dump + sidecars + manifest).
if [[ "$KEEP_LOCAL" =~ ^[0-9]+$ ]] && [[ "$KEEP_LOCAL" -gt 0 ]]; then
  ls -1t "$BACKUP_DIR"/db-*.dump.enc 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" |
    while IFS= read -r old; do
      base="${old%.dump.enc}"
      rm -f "$old" "$base.globals.enc" "$old.sha256" "$base.manifest.json"
    done
fi

echo "backup: OK $NAME bytes=$DUMP_BYTES sha256=$DUMP_SHA key=$OBJECT_KEY"
