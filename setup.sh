#!/usr/bin/env bash
# One command setup for Mac and Linux: ./setup.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Install Node.js (LTS) from https://nodejs.org, then run ./setup.sh again."; exit 1; }
exec node backend/scripts/setup.mjs "$@"
