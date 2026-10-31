#!/bin/sh
# Reconstruit vendor/bibliotheques.js et vendor/LICENCES.txt à partir des versions figées de package.json.
# À lancer seulement pour changer de version d'une bibliothèque (Node.js et npm nécessaires).
set -e
cd "$(dirname "$0")"
npm install --no-audit --no-fund --ignore-scripts >/dev/null
npx esbuild entree.js --bundle --format=esm --minify --target=es2020 \
  --legal-comments=none --outfile=../../vendor/bibliotheques.js \
  --banner:js="/* marked, marked-footnote, DOMPurify, MiniSearch, js-yaml : versions et licences dans vendor/LICENCES.txt */"
{
  echo "Bibliothèques regroupées dans vendor/bibliotheques.js, avec leurs licences."
  for p in marked marked-footnote dompurify minisearch js-yaml; do
    v=$(node -p "require('./node_modules/$p/package.json').version")
    l=$(node -p "require('./node_modules/$p/package.json').license")
    echo; echo "================================================================"
    echo "$p $v ($l)"
    echo "================================================================"
    f=$(ls node_modules/$p/LICENSE node_modules/$p/LICENSE.txt node_modules/$p/LICENSE.md 2>/dev/null | head -1 || true)
    if [ -n "$f" ]; then cat "$f"; else
      a=$(node -p "const a=require('./node_modules/$p/package.json').author; typeof a==='string'?a:(a&&a.name)||''")
      printf 'MIT License\n\nCopyright (c) %s\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n' "$a"
    fi
  done
} > ../../vendor/LICENCES.txt
echo "vendor/bibliotheques.js : $(wc -c < ../../vendor/bibliotheques.js) octets"
