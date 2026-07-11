#!/usr/bin/env bash
# Kill whatever process is listening on a TCP port.
# Usage:
#   ./scripts/kill-port.sh        # defaults to 3001
#   ./scripts/kill-port.sh 3001
#   ./scripts/kill-port.sh 3000

set -euo pipefail

PORT="${1:-3001}"

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 [port]" >&2
  exit 1
fi

pids="$(
  ss -tlnp "sport = :$PORT" 2>/dev/null \
    | grep -oP 'pid=\K[0-9]+' \
    | sort -u \
    || true
)"

if [[ -z "$pids" ]]; then
  # Fallback for environments without ss pid info
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
fi

if [[ -z "$pids" ]]; then
  echo "Nothing listening on port $PORT"
  exit 0
fi

echo "Killing process(es) on port $PORT: $pids"
# shellcheck disable=SC2086
kill $pids 2>/dev/null || true
sleep 1

still="$(
  ss -tlnp "sport = :$PORT" 2>/dev/null \
    | grep -oP 'pid=\K[0-9]+' \
    | sort -u \
    || true
)"
if [[ -z "$still" ]]; then
  still="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
fi

if [[ -n "$still" ]]; then
  echo "Still in use; force killing: $still"
  # shellcheck disable=SC2086
  kill -9 $still 2>/dev/null || true
fi

if ss -tln "sport = :$PORT" 2>/dev/null | grep -q ":$PORT"; then
  echo "Port $PORT is still in use" >&2
  exit 1
fi

echo "Port $PORT is free"
