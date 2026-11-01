# Postgres backups — Smart Survey X

Hourly encrypted `pg_dump` to a **separate** Cloudflare R2 bucket, plus a
restore drill. Source of truth: VPS `/opt/smart-survey-x/scripts/`.

```
pg_dump -Fc ──► AES-256 (PBKDF2 200k) ──► sha256 ──► R2 (write-only token)
     │                                                     │
     └── newest 3 local copies ──► restore-drill.sh ────────┘
```

## 1. One-time Cloudflare setup (dashboard — API token cannot do this)

1. **R2 → Create bucket**: `smartsurveyx-backups` (location: automatic).
2. **R2 → Manage R2 API Tokens → Create API token**
   - Permissions: **Object Read & Write**, bucket scope `smartsurveyx-backups`
     only. R2 does not offer an object-write-only scope — bucket scoping is
     the narrowest object permission available. Do not reuse the media token.
   - Save the Access Key ID / Secret Access Key (shown once).
3. **Bucket → Settings → Object lifecycle rules**
   - Delete objects under prefix `postgres/` after **60 days** (45–60 is the
     agreed window; the tighter 45-day rule is fine too).
   - If Object Lock is available, use a **45-day retention** (anything above
     30 days is enough). This bucket was created without Object Lock, so
     **enable object versioning** as the practical delete protection; an
     Object Read & Write token can still delete current objects.
4. Keep the encryption passphrase **outside the VPS** (password manager).
   Losing it means every offsite dump is unreadable.

## Cadence

The systemd timer ticks hourly. `backup-db.sh` decides whether to dump:

| Last successful dump | Schedule |
|---|---|
| `< BACKUP_LARGE_BYTES` (default 3,000,000 B) | hourly |
| `>=` threshold, normal week | 6-hourly |
| any size during election week | hourly |

Election week is set in the env file (IST dates):

```bash
ELECTION_WEEK=0                     # 1 = force hourly now
ELECTION_WEEK_START=2026-11-03     # inclusive
ELECTION_WEEK_END=2026-11-09       # inclusive
```

Set `BACKUP_FORCE=1` for a manual run that ignores the cadence.

## 2. VPS env (`/etc/smart-survey-backup.env`, root:postgres 0640)

```bash
BACKUP_DB=smart_survey_x
BACKUP_DIR=/var/backups/smart-survey-x
BACKUP_KEEP_LOCAL=3
BACKUP_PASSPHRASE=<32+ random chars — store a copy offsite>
R2_BACKUP_BUCKET=smartsurveyx-backups
R2_BACKUP_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BACKUP_ACCESS_KEY_ID=<write-only token>
R2_BACKUP_SECRET_ACCESS_KEY=<write-only token secret>
# Optional failure alert (Telegram sendMessage URL or any JSON webhook):
BACKUP_ALERT_WEBHOOK=
```

Generate the passphrase without printing it:

```bash
openssl rand -base64 32 > /tmp/backup-pass
# copy /tmp/backup-pass into the env file, then save it in your password manager
shred -u /tmp/backup-pass
```

## 3. Install timer

```bash
install -m 0644 /opt/smart-survey-x/scripts/systemd/smart-survey-backup.service /etc/systemd/system/
install -m 0644 /opt/smart-survey-x/scripts/systemd/smart-survey-backup.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now smart-survey-backup.timer
```

Run once by hand:

```bash
sudo -u postgres env $(grep -v '^#' /etc/smart-survey-backup.env | xargs) \
  bash /opt/smart-survey-x/scripts/backup-db.sh
```

Bootstrap without R2 credentials (local dump only):

```bash
sudo -u postgres BACKUP_ALLOW_LOCAL_ONLY=1 ... bash scripts/backup-db.sh
```

## 4. Restore drill (run weekly/monthly, and after any schema change)

```bash
sudo -u postgres env $(grep -v '^#' /etc/smart-survey-backup.env | xargs) \
  bash /opt/smart-survey-x/scripts/restore-drill.sh
```

It decrypts the newest local dump, `pg_restore`s into
`smart_survey_x_restore_drill`, compares the manifest row counts, and drops
the scratch DB. Exit 0 = `DRILL OK`.

Full offsite restore test (needs a read-capable token): download the newest
`.../db-*.dump.enc` + `.manifest.json` from the bucket, then run the same
decrypt/`pg_restore` steps against the downloaded file.

## 5. Verify

```bash
systemctl status smart-survey-backup.timer
journalctl -u smart-survey-backup.service -n 50 --no-pager
ls -lh /var/backups/smart-survey-x
curl -sk -H "Authorization: Bearer <super-admin-token>" \
  https://162.35.96.65.sslip.io/api/backup/status
```

`/api/backup/status` returns the newest `backup_runs` heartbeat (the UI can
surface a red badge when `finished_at` is older than ~2 hours).
