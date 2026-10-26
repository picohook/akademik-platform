#!/usr/bin/env bash
# Run from repository root, in an interactive SSH terminal. Never paste keys into chat.
set -euo pipefail
umask 077
if [[ -e .env.r2 ]]; then
  echo '.env.r2 already exists; refusing to overwrite it.' >&2
  exit 1
fi
read -r -p 'R2 S3 endpoint (https://ACCOUNT.r2.cloudflarestorage.com): ' endpoint
read -r -p 'Private R2 bucket name: ' bucket
read -r -p 'R2 object prefix [libedge]: ' prefix
prefix=${prefix:-libedge}
read -r -s -p 'R2 Access Key ID (hidden): ' access_key
printf '\n'
read -r -s -p 'R2 Secret Access Key (hidden): ' secret_key
printf '\n'
[[ "$endpoint" =~ ^https://[a-zA-Z0-9.-]+\.r2\.cloudflarestorage\.com/?$ ]] || { echo 'Invalid R2 endpoint'; exit 1; }
[[ "$bucket" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || { echo 'Invalid bucket'; exit 1; }
[[ "$prefix" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Use a single alphanumeric prefix'; exit 1; }
[[ "$access_key" =~ ^[a-zA-Z0-9]+$ && "$secret_key" =~ ^[a-zA-Z0-9/+_=.-]+$ ]] || { echo 'Invalid key characters'; exit 1; }
# Noclobber avoids replacing a file created between the check and write.
(set -C; printf '%s\n' \
  'STORAGE_DRIVER=r2' "R2_ENDPOINT=$endpoint" "R2_BUCKET=$bucket" \
  "R2_PREFIX=$prefix" "R2_ACCESS_KEY_ID=$access_key" "R2_SECRET_ACCESS_KEY=$secret_key" > .env.r2)
unset access_key secret_key
chmod 600 .env.r2
echo 'R2 configuration saved privately. Credentials were not printed.'
