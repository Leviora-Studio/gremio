#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env.local ]; then
  umask 077
  python3 - <<'PY'
from secrets import token_hex, token_urlsafe
from pathlib import Path
values = {key: token_hex(32) for key in ['GREMIO_AUTH_SECRET','GREMIO_ENCRYPTION_KEY','LIMEN_AUTH_SECRET','LIMEN_ENCRYPTION_KEY','GREMIO_DB_PASSWORD','LIMEN_DB_PASSWORD','OIDC_CLIENT_SECRET']}
values['DEMO_PASSWORD'] = token_urlsafe(18)
Path('.env.local').write_text(''.join(f'{key}={value}\n' for key,value in values.items()))
PY
fi
if ! docker info >/dev/null 2>&1; then
  echo 'Docker ist nicht erreichbar. Docker Desktop starten und Zugriff auf den Docker-Socket erlauben.' >&2
  exit 1
fi
docker compose --env-file .env.local -f compose.yml up -d --build
seed_id=$(docker compose --env-file .env.local -f compose.yml ps -aq gremio-seed)
seed_exit=$(docker wait "$seed_id")
if [ "$seed_exit" != 0 ]; then
  docker compose --env-file .env.local -f compose.yml logs gremio-seed
  exit 1
fi
echo 'Gremio: http://localhost:3010'
echo 'Limen:  http://localhost:3000'
echo 'Benutzer: demo-admin'
sed -n 's/^DEMO_PASSWORD=/Passwort: /p' .env.local
