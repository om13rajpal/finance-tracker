#!/usr/bin/env bash
set -e

(cd "$(dirname "$0")/../.." && E2E_TEST_MODE=true pnpm dev:api) &
API_PID=$!
(cd "$(dirname "$0")/.." && pnpm dev) &
WEB_PID=$!

trap "kill $API_PID $WEB_PID" EXIT

until curl -sf http://localhost:4000/health > /dev/null; do sleep 1; done
until curl -sf http://localhost:3000 > /dev/null; do sleep 1; done

wait
