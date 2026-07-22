#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: this verification script only supports macOS." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_PATH="$REPO_ROOT/src-tauri/target/debug/bundle/macos/MergeBeacon.app"
APP_BINARY="$APP_PATH/Contents/MacOS/mergebeacon"
SOCKET_PATH="/tmp/com_mergebeacon_si.sock"
PROBE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mergebeacon-restart-timing.XXXXXX")"
RESTARTED_PID=""
INITIAL_PID=""

cleanup() {
  for pid in "$RESTARTED_PID" "$INITIAL_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait_for_exit "$pid" 20 || true
    fi
  done
  if [[ -e "$SOCKET_PATH" ]] && ! lsof "$SOCKET_PATH" >/dev/null 2>&1; then
    rm -f "$SOCKET_PATH"
  fi
  rm -rf "$PROBE_DIR"
}
trap cleanup EXIT

wait_for_file() {
  local path="$1"
  local attempts="${2:-100}"
  for ((i = 0; i < attempts; i++)); do
    [[ -s "$path" ]] && return 0
    sleep 0.1
  done
  return 1
}

wait_for_exit() {
  local pid="$1"
  local attempts="${2:-100}"
  for ((i = 0; i < attempts; i++)); do
    ! kill -0 "$pid" 2>/dev/null && return 0
    sleep 0.1
  done
  return 1
}

if [[ -e "$SOCKET_PATH" ]]; then
  echo "Error: $SOCKET_PATH already exists. Quit MergeBeacon before running this script." >&2
  exit 1
fi

echo "==> Building the feature-gated restart timing probe"
cd "$REPO_ROOT"
npm run tauri -- build \
  --debug \
  --features restart-timing-test \
  --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'

if [[ ! -x "$APP_BINARY" ]]; then
  echo "Error: bundled application binary was not created at $APP_BINARY" >&2
  exit 1
fi

echo "==> Launching the initial instance"
MERGEBEACON_RESTART_TIMING_TEST_DIR="$PROBE_DIR" "$APP_BINARY" &
INITIAL_PID=$!

if ! wait_for_file "$PROBE_DIR/restarted-ready" 200; then
  echo "Error: restarted process did not report ready." >&2
  [[ -f "$PROBE_DIR/events.log" ]] && cat "$PROBE_DIR/events.log" >&2
  exit 1
fi

RESTARTED_PID="$(tr -d '[:space:]' < "$PROBE_DIR/restarted-ready")"
if [[ -z "$RESTARTED_PID" || "$RESTARTED_PID" == "$INITIAL_PID" ]]; then
  echo "Error: restart did not replace the process (initial=$INITIAL_PID, restarted=$RESTARTED_PID)." >&2
  exit 1
fi
if ! wait_for_exit "$INITIAL_PID"; then
  echo "Error: initial process $INITIAL_PID did not exit after restart." >&2
  exit 1
fi
if ! kill -0 "$RESTARTED_PID" 2>/dev/null; then
  echo "Error: restarted process $RESTARTED_PID is not running." >&2
  exit 1
fi
if [[ ! -S "$SOCKET_PATH" ]]; then
  echo "Error: restarted process did not reacquire $SOCKET_PATH." >&2
  exit 1
fi

echo "==> Launching a third instance to verify single-instance ownership"
MERGEBEACON_RESTART_TIMING_TEST_DIR="$PROBE_DIR" "$APP_BINARY" &
THIRD_PID=$!
if ! wait_for_exit "$THIRD_PID"; then
  echo "Error: third instance $THIRD_PID remained running." >&2
  exit 1
fi

for ((i = 0; i < 100; i++)); do
  grep -q "duplicate-activation $RESTARTED_PID$" "$PROBE_DIR/events.log" && break
  sleep 0.1
done
if ! grep -q "duplicate-activation $RESTARTED_PID$" "$PROBE_DIR/events.log"; then
  echo "Error: restarted process did not receive the duplicate activation callback." >&2
  cat "$PROBE_DIR/events.log" >&2
  exit 1
fi
if ! kill -0 "$RESTARTED_PID" 2>/dev/null; then
  echo "Error: primary restarted process exited after the duplicate launch." >&2
  exit 1
fi

echo "==> Restart and single-instance timing verified"
cat "$PROBE_DIR/events.log"
