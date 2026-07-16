#!/bin/bash
cd "$(dirname "$0")"
source .venv/bin/activate
python servidor.py &
SERVER_PID=$!
sleep 2
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open http://localhost:8787
elif command -v open >/dev/null 2>&1; then
  open http://localhost:8787
fi
wait "$SERVER_PID"
