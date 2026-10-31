#!/bin/sh
# Lance tous les tests : un petit serveur local pour l'appli, puis chaque scénario dans Chromium.
# Besoins : Node.js, Python 3 et Playwright (avec Chromium) déjà installés.
set -e
cd "$(dirname "$0")"
[ -d node_modules/graphql ] || npm install --no-audit --no-fund --ignore-scripts >/dev/null
PORT=${PORT:-8765}
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory .. >/dev/null 2>&1 &
SERVEUR=$!
trap 'kill $SERVEUR 2>/dev/null' EXIT
sleep 1
export WIKI_URL="http://127.0.0.1:$PORT/"
for t in demo github securite hors-ligne; do
  echo "=== $t"
  node "$t.test.cjs"
done
echo "=== tous les tests sont passés"
