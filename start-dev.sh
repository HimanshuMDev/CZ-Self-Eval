#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  ChargeZone Self-Eval — start both servers with one command
#
#  Usage:
#    chmod +x start-dev.sh
#    ./start-dev.sh
#
#  Requirements:
#    1. MongoDB running locally  OR  set MONGODB_URI in server/.env
#    2. node & npm installed
# ─────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 1. MongoDB API server ─────────────────────────────────────────
echo "🔧  Starting MongoDB API server (port 4001)…"
cd "$SCRIPT_DIR/server"
if [ ! -d node_modules ]; then
  echo "   Installing server dependencies…"
  npm install
fi
node index.js &
SERVER_PID=$!
echo "   Server PID: $SERVER_PID"

# ── 2. Vite dev server ────────────────────────────────────────────
echo ""
echo "🎨  Starting Vite dashboard (port 5173)…"
cd "$SCRIPT_DIR/dashboard"
if [ ! -d node_modules ]; then
  echo "   Installing dashboard dependencies…"
  npm install
fi
npm run dev &
VITE_PID=$!
echo "   Vite PID: $VITE_PID"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅  Both servers running"
echo "  📊  Dashboard → http://localhost:5173"
echo "  🗄️   API       → http://localhost:4001/api/sessions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Press Ctrl+C to stop both servers"
echo ""

# Trap Ctrl+C and kill both processes
trap "echo ''; echo 'Stopping…'; kill $SERVER_PID $VITE_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait
