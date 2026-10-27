#!/usr/bin/env bash
set -euo pipefail
# A real window manager supplies focus/activation semantics for native keyboard smoke tests.
if [[ "${JAB_CI_DESKTOP:-}" != 1 ]]; then
  exec xvfb-run -a dbus-run-session -- env JAB_CI_DESKTOP=1 bash "$0" "$@"
fi
openbox >/dev/null 2>&1 &
window_manager=$!
trap 'kill "$window_manager" 2>/dev/null || true' EXIT
"$@"
