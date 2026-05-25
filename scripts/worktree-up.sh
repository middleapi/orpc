#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Bootstrap the current Nuxt oRPC Playground worktree for local development.

This script will:
  1. Ensure the worktree has dependencies installed
  2. Create or update the worktree .env with a unique NUXT_PORT
  3. Point DATABASE_URL at a worktree-specific local PostgreSQL database
  4. Start the shared local PostgreSQL container if needed
  5. Create the worktree database, push the schema, and seed sample data
  6. Start the Nuxt dev server unless it is already running on that port

Usage:
  ./scripts/worktree-up.sh [options]

Options:
  --port <port>         Force a specific NUXT_PORT
  --db-name <name>      Force a specific PostgreSQL database name
  --skip-install        Skip pnpm install
  --skip-migrate        Skip pnpm db:push
  --skip-seed           Skip pnpm db:seed
  --foreground          Run the Nuxt dev server in the foreground
  --no-start            Do not start the Nuxt dev server
  --dry-run             Print the planned actions without changing anything
  -h, --help            Show this help message
EOF
}

say() {
  printf '[worktree-up] %s\n' "$*"
}

die() {
  printf '[worktree-up] Error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

hash_value() {
  if command -v sha1sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha1sum | awk '{ print substr($1, 1, 8) }'
  else
    printf '%s' "$1" | shasum | awk '{ print substr($1, 1, 8) }'
  fi
}

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null) || die 'Run this script inside the repository.'
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
STATE_DIR="$ROOT_DIR/logs/worktree-up"
mkdir -p "$STATE_DIR"

WORKTREE_PATH="$ROOT_DIR"
WORKTREE_HASH=$(hash_value "$WORKTREE_PATH")
APP_PID_FILE="$STATE_DIR/app-$WORKTREE_HASH.pid"
APP_LOG_FILE="$STATE_DIR/app-$WORKTREE_HASH.log"
ENV_BACKUP_FILE="$STATE_DIR/.env.backup-$WORKTREE_HASH"

POSTGRES_CONTAINER="${WORKTREE_POSTGRES_CONTAINER:-nuxt-orpc-playground-postgres}"
POSTGRES_USER="${WORKTREE_DB_USER:-postgres}"
POSTGRES_PASSWORD="${WORKTREE_DB_PASSWORD:-postgres}"
POSTGRES_HOST="${WORKTREE_DB_HOST:-localhost}"
POSTGRES_PORT="${WORKTREE_DB_PORT:-5433}"

PORT_OVERRIDE=''
DB_NAME_OVERRIDE=''
SKIP_INSTALL=0
SKIP_MIGRATE=0
SKIP_SEED=0
FOREGROUND=0
NO_START=0
DRY_RUN=0
ENV_CREATED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --)
      shift
      ;;
    --port)
      [ $# -ge 2 ] || die '--port requires a value'
      PORT_OVERRIDE="$2"
      shift 2
      ;;
    --db-name)
      [ $# -ge 2 ] || die '--db-name requires a value'
      DB_NAME_OVERRIDE="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --skip-migrate)
      SKIP_MIGRATE=1
      shift
      ;;
    --skip-seed)
      SKIP_SEED=1
      shift
      ;;
    --foreground)
      FOREGROUND=1
      shift
      ;;
    --no-start)
      NO_START=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

require_cmd git
require_cmd pnpm
require_cmd docker
require_cmd awk
require_cmd lsof
require_cmd mktemp

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die 'Missing docker compose support. Install docker compose or docker-compose.'
  fi
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] '
    printf '%q ' "$@"
    printf '\n'
    return 0
  fi

  "$@"
}

read_env_value() {
  local key="$1"

  [ -f "$ENV_FILE" ] || return 0

  awk -v key="$key" '
    index($0, key "=") == 1 {
      print substr($0, length(key) + 2)
      found = 1
      exit
    }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "$ENV_FILE" 2>/dev/null || true
}

upsert_env_value() {
  local key="$1"
  local value="$2"
  local tmp_file

  if [ "$DRY_RUN" -eq 1 ]; then
    say "Would set $key in .env"
    return 0
  fi

  tmp_file=$(mktemp "${TMPDIR:-/tmp}/nuxt-orpc-env.XXXXXX")

  if [ -f "$ENV_FILE" ]; then
    awk -v key="$key" -v value="$value" '
      BEGIN {
        updated = 0
      }
      index($0, key "=") == 1 {
        if (!updated) {
          print key "=" value
          updated = 1
        }
        next
      }
      {
        print
      }
      END {
        if (!updated) {
          print key "=" value
        }
      }
    ' "$ENV_FILE" > "$tmp_file"
  else
    printf '%s=%s\n' "$key" "$value" > "$tmp_file"
  fi

  mv "$tmp_file" "$ENV_FILE"
}

find_env_seed() {
  local worktree_path

  while IFS= read -r worktree_path; do
    [ "$worktree_path" = "$WORKTREE_PATH" ] && continue
    if [ -f "$worktree_path/.env" ]; then
      printf '%s\n' "$worktree_path/.env"
      return 0
    fi
  done < <(git worktree list --porcelain | awk '/^worktree / { print substr($0, 10) }')

  if [ -f "$ROOT_DIR/.env.example" ]; then
    printf '%s\n' "$ROOT_DIR/.env.example"
    return 0
  fi

  return 1
}

ensure_env_file() {
  local seed_file

  if [ -f "$ENV_FILE" ]; then
    if [ ! -f "$ENV_BACKUP_FILE" ] && [ "$DRY_RUN" -ne 1 ]; then
      cp "$ENV_FILE" "$ENV_BACKUP_FILE"
    fi
    return 0
  fi

  seed_file=$(find_env_seed) || die 'Could not find .env.example or another worktree .env to copy.'

  if [ "$DRY_RUN" -eq 1 ]; then
    say "Would create .env from $seed_file"
  else
    cp "$seed_file" "$ENV_FILE"
    cp "$ENV_FILE" "$ENV_BACKUP_FILE"
  fi

  ENV_CREATED=1
  say "Using $seed_file as the starting point for this worktree .env"
}

validate_port() {
  case "$1" in
    ''|*[!0-9]*)
      return 1
      ;;
  esac

  [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]
}

is_port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

is_port_reserved_by_other_worktree() {
  local requested_port="$1"
  local worktree_path
  local worktree_port

  while IFS= read -r worktree_path; do
    [ "$worktree_path" = "$WORKTREE_PATH" ] && continue
    [ -f "$worktree_path/.env" ] || continue

    worktree_port=$(
      awk '
        index($0, "NUXT_PORT=") == 1 {
          print substr($0, 11)
          exit
        }
      ' "$worktree_path/.env"
    )

    if [ "$worktree_port" = "$requested_port" ]; then
      return 0
    fi
  done < <(git worktree list --porcelain | awk '/^worktree / { print substr($0, 10) }')

  return 1
}

select_port() {
  local existing_port=''
  local start_port
  local hash_prefix
  local port

  if [ -n "$PORT_OVERRIDE" ]; then
    validate_port "$PORT_OVERRIDE" || die "Invalid port: $PORT_OVERRIDE"
    if is_port_reserved_by_other_worktree "$PORT_OVERRIDE"; then
      die "Port $PORT_OVERRIDE is already reserved by another worktree."
    fi
    printf '%s\n' "$PORT_OVERRIDE"
    return 0
  fi

  if [ "$ENV_CREATED" -ne 1 ]; then
    existing_port=$(read_env_value 'NUXT_PORT')
    if [ -n "$existing_port" ]; then
      validate_port "$existing_port" || die "Invalid NUXT_PORT in .env: $existing_port"
      if ! is_port_reserved_by_other_worktree "$existing_port"; then
        printf '%s\n' "$existing_port"
        return 0
      fi

      say "Port $existing_port is already reserved by another worktree, picking a new one"
    fi
  fi

  hash_prefix=$(printf '%s' "$WORKTREE_HASH" | cut -c1-4)
  start_port=$((3000 + 16#$hash_prefix % 200))
  port="$start_port"

  while [ "$port" -le 3999 ]; do
    if ! is_port_reserved_by_other_worktree "$port" && ! is_port_in_use "$port"; then
      printf '%s\n' "$port"
      return 0
    fi
    port=$((port + 1))
  done

  die 'Could not find an available port in the 3000-3999 range.'
}

validate_db_name() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$'
}

select_db_name() {
  if [ -n "$DB_NAME_OVERRIDE" ]; then
    validate_db_name "$DB_NAME_OVERRIDE" || die "Invalid database name: $DB_NAME_OVERRIDE"
    printf '%s\n' "$DB_NAME_OVERRIDE"
    return 0
  fi

  printf 'nuxt_orpc_wt_%s\n' "$WORKTREE_HASH"
}

ensure_dependencies() {
  if [ "$SKIP_INSTALL" -eq 1 ]; then
    say 'Skipping pnpm install'
    return 0
  fi

  if [ -d "$ROOT_DIR/node_modules" ] && [ -f "$ROOT_DIR/node_modules/.modules.yaml" ] && [ "$ROOT_DIR/pnpm-lock.yaml" -ot "$ROOT_DIR/node_modules/.modules.yaml" ]; then
    say 'Dependencies already look up to date'
    return 0
  fi

  say 'Installing dependencies with pnpm install'
  run_cmd pnpm install
}

wait_for_postgres() {
  local status=''
  local attempt=1

  while [ "$attempt" -le 30 ]; do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)
    if [ "$status" = 'healthy' ] || [ "$status" = 'unknown' ]; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  die "Postgres container $POSTGRES_CONTAINER did not become healthy in time."
}

ensure_postgres_container() {
  say 'Ensuring local Postgres is running'

  local running=''
  running=$(docker ps --filter "name=^/${POSTGRES_CONTAINER}$" --format '{{.Names}}' 2>/dev/null || true)

  if [ -n "$running" ]; then
    say "Reusing running container $POSTGRES_CONTAINER (started by another worktree)"
  else
    local existing=''
    existing=$(docker ps -a --filter "name=^/${POSTGRES_CONTAINER}$" --format '{{.Names}}' 2>/dev/null || true)
    if [ -n "$existing" ]; then
      say "Starting existing container $POSTGRES_CONTAINER"
      run_cmd docker start "$POSTGRES_CONTAINER" >/dev/null
    else
      run_cmd docker_compose up -d postgres
    fi
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi

  wait_for_postgres
}

ensure_database() {
  local db_name="$1"
  local exists=''

  say "Ensuring database $db_name exists"

  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi

  exists=$(
    docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
      psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$db_name';"
  )

  if [ "$exists" = '1' ]; then
    say "Database $db_name already exists"
    return 0
  fi

  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
    createdb -U "$POSTGRES_USER" "$db_name"
}

run_migrations() {
  if [ "$SKIP_MIGRATE" -eq 1 ]; then
    say 'Skipping pnpm db:push'
    return 0
  fi

  say 'Pushing database schema'
  run_cmd pnpm db:push
}

seed_database() {
  if [ "$SKIP_SEED" -eq 1 ]; then
    say 'Skipping pnpm db:seed'
    return 0
  fi

  say 'Seeding database'
  run_cmd pnpm db:seed
}

wait_for_app() {
  local port="$1"
  local attempt=1

  while [ "$attempt" -le 60 ]; do
    if is_port_in_use "$port"; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  return 1
}

start_app() {
  local port="$1"

  if [ "$NO_START" -eq 1 ]; then
    say 'Skipping app start'
    return 0
  fi

  if is_port_in_use "$port"; then
    say "A process is already listening on port $port; assuming this worktree is already running"
    return 0
  fi

  say "Starting Nuxt dev server on port $port"

  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$FOREGROUND" -eq 1 ]; then
      say 'Would run pnpm dev in the foreground'
    else
      say "Would write the app log to $APP_LOG_FILE"
    fi
    return 0
  fi

  if [ "$FOREGROUND" -eq 1 ]; then
    say 'Foreground mode enabled; attaching to pnpm dev (Ctrl+C stops the server)'
    say "URL: http://localhost:$port"
    exec pnpm dev --port "$port"
  fi

  nohup pnpm dev --port "$port" > "$APP_LOG_FILE" 2>&1 &
  printf '%s\n' "$!" > "$APP_PID_FILE"

  if wait_for_app "$port"; then
    say "Nuxt dev server is available on http://localhost:$port"
    return 0
  fi

  say "The dev server did not become ready in time. Check $APP_LOG_FILE for details."
}

ensure_env_file

APP_PORT=$(select_port)
DB_NAME=$(select_db_name)
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${DB_NAME}"
APP_ORIGIN="http://localhost:${APP_PORT}"
TRUSTED_ORIGINS="${APP_ORIGIN},http://127.0.0.1:${APP_PORT}"

say "Preparing worktree $WORKTREE_HASH"
say "Using app port $APP_PORT"
say "Using database $DB_NAME"

upsert_env_value 'NUXT_PORT' "$APP_PORT"
upsert_env_value 'DATABASE_URL' "$DATABASE_URL"
upsert_env_value 'BETTER_AUTH_URL' "$APP_ORIGIN"
upsert_env_value 'BETTER_AUTH_TRUSTED_ORIGINS' "$TRUSTED_ORIGINS"

ensure_dependencies
ensure_postgres_container
ensure_database "$DB_NAME"
run_migrations
seed_database
start_app "$APP_PORT"

if [ "$FOREGROUND" -eq 0 ]; then
  say 'Worktree bootstrap complete'
  say "URL: http://localhost:$APP_PORT"
  say "App log: $APP_LOG_FILE"
fi
