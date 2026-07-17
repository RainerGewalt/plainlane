#!/usr/bin/env bash
set -Eeuo pipefail

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

show_urls() {
  local port lan_ip
  port="$(read_port)"
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf "\n%bPlainlane is ready.%b\n" "$BOLD$GREEN" "$RESET"
  printf "  Local:   %bhttp://localhost:%s%b\n" "$BOLD" "$port" "$RESET"
  if [[ -n "$lan_ip" ]]; then
    printf "  Network: %bhttp://%s:%s%b\n" "$BOLD" "$lan_ip" "$port" "$RESET"
  fi
  printf "\n%bAnyone who can reach this address can use the app. Keep it on a trusted network.%b\n\n" "$YELLOW" "$RESET"
}

start() {
  ensure_env
  info "Building the app and starting NGINX, Node, and SQLite …"
  docker compose up --build --detach
  success "Containers started."
  show_urls
}

banner
require_docker

case "${1:-start}" in
  start) start ;;
  stop)
    info "Stopping Plainlane …"
    docker compose down
    success "Stopped. Your Docker volume was kept."
    ;;
  restart)
    docker compose down
    start
    ;;
  logs)
    docker compose logs --follow
    ;;
  status)
    docker compose ps
    ;;
  *)
    printf "Usage: %s [start|stop|restart|logs|status]\n" "$0"
    exit 2
    ;;
esac
