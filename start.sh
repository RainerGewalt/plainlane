#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILES=(-f compose.yml)
if [[ -f compose.private.yml ]]; then
  COMPOSE_FILES+=(-f compose.private.yml)
fi

compose() {
  docker compose "${COMPOSE_FILES[@]}" "$@"
}

if [[ -t 1 ]]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  BLUE='\033[38;5;75m'
  GREEN='\033[38;5;78m'
  YELLOW='\033[38;5;220m'
  RED='\033[38;5;203m'
  RESET='\033[0m'
else
  BOLD='' DIM='' BLUE='' GREEN='' YELLOW='' RED='' RESET=''
fi

info() { printf "%b›%b %s\n" "$BLUE" "$RESET" "$1"; }
success() { printf "%b✓%b %s\n" "$GREEN" "$RESET" "$1"; }
warn() { printf "%b!%b %s\n" "$YELLOW" "$RESET" "$1"; }
fail() { printf "%b✕ %s%b\n" "$RED" "$1" "$RESET" >&2; exit 1; }

banner() {
  printf "\n%b  P L A I N L A N E%b\n" "$BOLD$BLUE" "$RESET"
  printf "%b  A quiet place to move work forward.%b\n\n" "$DIM" "$RESET"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Visit https://docs.docker.com/get-docker/"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
  docker info >/dev/null 2>&1 || fail "Docker is installed, but the daemon is not running."
}

ensure_env() {
  if [[ ! -f .env ]]; then
    cp .env.example .env
    success "Created .env from the safe example configuration."
    warn "AI research stays disabled until OPENAI_API_KEY is added to .env."
  fi
}

read_port() {
  local configured
  configured="$(sed -n 's/^PLAINLANE_PORT=//p' .env | tail -n 1)"
  printf "%s" "${configured:-8080}"
}

read_bind_address() {
  local configured
  configured="$(sed -n 's/^PLAINLANE_BIND_ADDRESS=//p' .env | tail -n 1)"
  printf "%s" "${configured:-127.0.0.1}"
}

show_urls() {
  local port bind_address lan_ip
  port="$(read_port)"
  bind_address="$(read_bind_address)"
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf "\n%bPlainlane is ready.%b\n" "$BOLD$GREEN" "$RESET"
  printf "  Local:   %bhttp://localhost:%s%b\n" "$BOLD" "$port" "$RESET"
  if [[ "$bind_address" == "0.0.0.0" && -n "$lan_ip" ]]; then
    printf "  Network: %bhttp://%s:%s%b\n" "$BOLD" "$lan_ip" "$port" "$RESET"
    printf "\n%bLAN access is enabled. Anyone on that network can use Plainlane.%b\n\n" "$YELLOW" "$RESET"
  else
    printf "\n%bLocalhost only. Set PLAINLANE_BIND_ADDRESS=0.0.0.0 for a trusted LAN.%b\n\n" "$DIM" "$RESET"
  fi
}

maintenance() {
  compose run --rm -T --no-deps --entrypoint node app server/database-maintenance.js "$@"
}

backup_database() {
  local label="${1:-manual}" limit="${2:-10}" result
  ensure_env
  info "Creating a consistent SQLite backup …"
  result="$(maintenance backup "$label" "$limit")"
  if [[ "$result" == "No database exists yet." ]]; then
    warn "$result"
  else
    success "Backup created: /data/backups/$result"
  fi
}

list_backups() {
  ensure_env
  info "Available backups in /data/backups:"
  maintenance list
}

confirm_restore() {
  local backup="$1" answer
  if [[ "${PLAINLANE_CONFIRM_RESTORE:-0}" == "1" ]]; then return 0; fi
  [[ -t 0 ]] || fail "Restore requires an interactive confirmation. Set PLAINLANE_CONFIRM_RESTORE=1 for unattended use."
  printf "%bRestore %s? Current data will be backed up first. [y/N] %b" "$YELLOW" "$backup" "$RESET"
  read -r answer
  [[ "$answer" =~ ^[Yy]$ ]] || fail "Restore cancelled."
}

restore_database() {
  local requested="${1:-}" backup restored
  ensure_env
  backup="$(maintenance resolve "$requested")"
  confirm_restore "$backup"
  backup_database pre-restore 11
  info "Stopping Plainlane for a consistent restore …"
  compose stop web app
  if ! restored="$(maintenance restore "$backup")"; then
    compose up --detach
    fail "Restore failed. The previous database was kept and Plainlane was restarted."
  fi
  compose up --detach
  success "Restored /data/backups/$restored and restarted Plainlane."
  show_urls
}

update_plainlane() {
  command -v git >/dev/null 2>&1 || fail "Git is required for ./start.sh update."
  [[ -d .git ]] || fail "This installation is not a Git clone. Update it using a new release snapshot."
  ensure_env
  backup_database pre-update
  info "Fetching the latest fast-forward release …"
  git pull --ff-only
  info "Building and starting the updated version …"
  compose up --build --detach
  success "Plainlane updated. The database was backed up before migrations."
  show_urls
}

start() {
  ensure_env
  if [[ -f compose.private.yml ]]; then
    info "Using private local storage from compose.private.yml."
  fi
  info "Building the app and starting NGINX, Node, and SQLite …"
  compose up --build --detach
  success "Containers started."
  show_urls
}

banner
require_docker

case "${1:-start}" in
  start) start ;;
  stop)
    info "Stopping Plainlane …"
    compose down
    success "Stopped. Your SQLite data was kept."
    ;;
  restart)
    compose down
    start
    ;;
  logs)
    compose logs --follow
    ;;
  status)
    compose ps
    ;;
  backup)
    backup_database manual
    ;;
  backups)
    list_backups
    ;;
  restore)
    restore_database "${2:-}"
    ;;
  update)
    update_plainlane
    ;;
  *)
    printf "Usage: %s [start|stop|restart|logs|status|backup|backups|restore [file]|update]\n" "$0"
    exit 2
    ;;
esac
