#!/usr/bin/env bash
# Build the web client: plain into dist/, or straight into the neighbouring
# owpengram-server checkout (see scripts/owpengram-web.mjs for the options).
#
#   ./build-web.sh                 # ask
#   ./build-web.sh build           # production build into dist/
#   ./build-web.sh embed           # build into ../owpengram-server
#   ./build-web.sh build --fast --server 1.2.3.4:2398
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$ROOT/scripts/owpengram-web.mjs"

if [[ ! -f "$SCRIPT" ]]; then
  echo "[ERROR] Missing script: $SCRIPT" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed or not on PATH." >&2
  exit 1
fi

case "${1:-}" in
  build|embed)
    exec node "$SCRIPT" "$@"
    ;;
esac

echo
echo "  Build the web client:"
echo "    [1] build - production build into dist/"
echo "    [2] embed - build into ../owpengram-server, served by it"
echo
choice=""
while [[ "$choice" != "1" && "$choice" != "2" ]]; do
  read -r -p "  Choice [1/2]: " choice
done

if [[ "$choice" == "1" ]]; then
  exec node "$SCRIPT" build "$@"
else
  exec node "$SCRIPT" embed "$@"
fi
