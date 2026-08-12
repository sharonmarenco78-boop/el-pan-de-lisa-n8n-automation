#!/usr/bin/env bash
set -euo pipefail

backup_dir=/opt/n8n/backups
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

cd /opt/n8n
docker compose exec -T postgres pg_dump -U n8n -d n8n -Fc > "$backup_dir/postgres-$timestamp.dump"
docker run --rm \
  -v n8n_n8n_data:/data:ro \
  -v "$backup_dir":/backup \
  alpine:3.22 tar -czf "/backup/n8n-data-$timestamp.tar.gz" -C /data .

cp -f .env "$backup_dir/config-$timestamp.env"
chmod 600 "$backup_dir"/*
find "$backup_dir" -type f -mtime +13 -delete
