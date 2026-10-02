#!/usr/bin/env bash
# 真浏览器冒烟测试：起 vite（复用已在跑的）→ 编译 WKWebView 驱动 → 跑场景
set -euo pipefail
cd "$(dirname "$0")/.."

STARTED_VITE=0
if ! curl -s -o /dev/null --max-time 2 http://localhost:1420/; then
  echo "启动 vite（1420）…"
  npm run dev > /tmp/cige-smoke-vite.log 2>&1 &
  VITE_PID=$!
  STARTED_VITE=1
  for _ in $(seq 1 40); do
    curl -s -o /dev/null --max-time 1 http://localhost:1420/ && break
    sleep 0.25
  done
fi

swiftc -O tools/smoke/main.swift -o /tmp/cige-smoke
set +e
/tmp/cige-smoke tools/smoke/scenarios http://localhost:1420
CODE=$?
set -e

if [ "$STARTED_VITE" = "1" ]; then
  kill "$VITE_PID" 2>/dev/null || true
fi
exit $CODE
