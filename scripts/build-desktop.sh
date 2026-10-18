#!/usr/bin/env bash
# Empaqueta la app de escritorio (Electron). Genera en dist/:
#   restaurante-desktop-linux-x64.tar.gz   y   restaurante-desktop-win32-x64.zip
# Uso: scripts/build-desktop.sh [linux|win|all]   (por defecto: all)
set -euo pipefail
cd "$(dirname "$0")/.."
WHAT="${1:-all}"
ELECTRON_VERSION="${ELECTRON_VERSION:-44.9.0}"
TOOLS=".cache/desktop-tools"
STAGE=".cache/desktop-stage"

# Herramientas de build aparte, para que el proyecto siga sin dependencias.
if [ ! -d "$TOOLS/node_modules/@electron/packager" ]; then
  mkdir -p "$TOOLS"
  (cd "$TOOLS" && npm init -y >/dev/null && npm i --no-audit --no-fund @electron/packager >/dev/null)
fi

# Carpeta a empaquetar: desktop/ + src/ con la misma disposición relativa que en el repo.
rm -rf "$STAGE" && mkdir -p "$STAGE/desktop"
cp desktop/main.mjs "$STAGE/desktop/"
cp desktop/package.json "$STAGE/package.json"
cp -r src "$STAGE/src"

pack() { # $1 = plataforma de Electron (linux | win32)
  node -e "
    import('$PWD/$TOOLS/node_modules/@electron/packager/dist/index.js').then(async (m) => {
      const packager = m.packager ?? m.default;
      await packager({ dir: '$STAGE', out: 'dist/build', overwrite: true, asar: true, prune: false,
        platform: '$1', arch: 'x64', electronVersion: '$ELECTRON_VERSION',
        name: 'restaurante', appVersion: '0.1.0', quiet: true });
    });"
}

mkdir -p dist
if [ "$WHAT" = linux ] || [ "$WHAT" = all ]; then
  pack linux
  tar -C dist/build -czf dist/restaurante-desktop-linux-x64.tar.gz restaurante-linux-x64
  ls -lh dist/restaurante-desktop-linux-x64.tar.gz
fi
if [ "$WHAT" = win ] || [ "$WHAT" = all ]; then
  pack win32
  (cd dist/build && rm -f ../restaurante-desktop-win32-x64.zip && zip -qr ../restaurante-desktop-win32-x64.zip restaurante-win32-x64)
  ls -lh dist/restaurante-desktop-win32-x64.zip
fi
