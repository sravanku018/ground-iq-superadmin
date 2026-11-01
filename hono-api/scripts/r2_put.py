#!/usr/bin/env python3
"""Upload one object to the R2 backups bucket.

The backup token is deliberately write-only (PutObject, no List/Get/Delete):
a compromised VPS cannot read or erase older backups, and R2 lifecycle rules
handle expiry. Credentials come from the systemd EnvironmentFile, never argv.

Usage: r2_put.py <local-file> <object-key>
"""
import json
import os
import sys

import boto3
from botocore.config import Config


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: r2_put.py <file> <key>", file=sys.stderr)
        return 2
    path, key = sys.argv[1], sys.argv[2]
    bucket = os.environ.get("R2_BACKUP_BUCKET", "").strip()
    endpoint = os.environ.get("R2_BACKUP_ENDPOINT", "").strip()
    if not endpoint:
        account = os.environ.get("R2_BACKUP_ACCOUNT_ID", "").strip()
        endpoint = f"https://{account}.r2.cloudflarestorage.com" if account else ""
    access = os.environ.get("R2_BACKUP_ACCESS_KEY_ID", "").strip()
    secret = os.environ.get("R2_BACKUP_SECRET_ACCESS_KEY", "").strip()
    missing = [
        name
        for name, value in (
            ("R2_BACKUP_BUCKET", bucket),
            ("R2_BACKUP_ENDPOINT/ACCOUNT_ID", endpoint),
            ("R2_BACKUP_ACCESS_KEY_ID", access),
            ("R2_BACKUP_SECRET_ACCESS_KEY", secret),
        )
        if not value
    ]
    if missing:
        print("missing env: " + ", ".join(missing), file=sys.stderr)
        return 3

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )
    with open(path, "rb") as handle:
        result = s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=handle,
            ContentType="application/octet-stream",
        )
    print(json.dumps({"ok": True, "key": key, "etag": result.get("ETag", "")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
