#!/usr/bin/env bash
# Arma dist/restaurante-portable-<win64|linux64>.zip: app + Node incluido (no requiere instalar nada).
# Uso: scripts/build-portable.sh [win|linux]   (por defecto: win)
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-win}"
NODE_VERSION="${NODE_VERSION:-22.22.0}"
CACHE=".cache"
case "$TARGET" in
  win)   NAME="restaurante-portable-win64" ;;
  linux) NAME="restaurante-portable-linux64" ;;
  *) echo "Uso: $0 [win|linux]" >&2; exit 1 ;;
esac
OUT="dist/$NAME"

rm -rf "$OUT" "$OUT.zip"
mkdir -p "$OUT/app" "$OUT/node" "$CACHE"

fetch_node() {
  if [ "$TARGET" = win ]; then
    [ -f "$CACHE/node-win.zip" ] || curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" -o "$CACHE/node-win.zip"
    unzip -q -j "$CACHE/node-win.zip" "node-v$NODE_VERSION-win-x64/node.exe" "node-v$NODE_VERSION-win-x64/LICENSE" -d "$OUT/node"
  else
    [ -f "$CACHE/node-linux.tar.xz" ] || curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" -o "$CACHE/node-linux.tar.xz"
    tar -xJf "$CACHE/node-linux.tar.xz" -C "$OUT/node" --strip-components=1 \
      "node-v$NODE_VERSION-linux-x64/bin/node" "node-v$NODE_VERSION-linux-x64/LICENSE"
  fi
}
fetch_node

cp -r src scripts package.json "$OUT/app/"
rm -f "$OUT/app/scripts/build-portable.sh"
mkdir -p "$OUT/docs" && cp docs/DISENO.md "$OUT/docs/"

if [ "$TARGET" = win ]; then
# Los .bat llevan CRLF y se escriben en UTF-8 (chcp 65001) para que Windows los lea bien.
cat > "$OUT/INICIAR.bat" <<'BAT'
@echo off
chcp 65001 >nul
title Restaurante - modo prueba
cd /d "%~dp0app"
set REGISTER_ID=PB
set MACHINE_ID=demo-pc
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000/"
"%~dp0node\node.exe" --disable-warning=ExperimentalWarning scripts\portable.js
echo.
echo El servidor se detuvo.
pause
BAT
cat > "$OUT/INICIAR_CAJA_P1.bat" <<'BAT'
@echo off
chcp 65001 >nul
title Restaurante - modo prueba (caja P1, puerto 3001)
cd /d "%~dp0app"
set REGISTER_ID=P1
set MACHINE_ID=demo-pc-p1
set PORT=3001
set DB_PATH=datos/demo-p1.db
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3001/"
"%~dp0node\node.exe" --disable-warning=ExperimentalWarning scripts\portable.js
pause
BAT
cat > "$OUT/BORRAR_DATOS_DE_PRUEBA.bat" <<'BAT'
@echo off
chcp 65001 >nul
echo Esto borra TODOS los datos de prueba (pedidos, caja, precios cambiados).
choice /m "Continuar"
if errorlevel 2 exit /b
rmdir /s /q "%~dp0app\datos" 2>nul
echo Listo. Al iniciar de nuevo se cargan los datos de demostración.
pause
BAT
cat > "$OUT/LEEME.txt" <<'TXT'
RESTAURANTE - VERSIÓN PORTABLE DE PRUEBA
========================================

1) Descomprimí esta carpeta completa (no ejecutes desde dentro del .zip).
2) Doble clic en INICIAR.bat. Se abre el navegador en http://localhost:3000/
   - Si Windows pregunta por el Firewall, "Permitir acceso" en redes privadas
     (necesario solo si querés probar el QR desde un celular en la misma Wi-Fi).
3) Usuarios de prueba (PIN):  Admin 1111 | Cajero 2222 | Mozo 3333 | Cocina 4444

QUÉ PROBAR
 - Admin > QR por mesa: abrí el link de una mesa (o escaneá desde el celular).
   Pedí algo como cliente -> aparece "por confirmar" en el Panel (Mozo).
 - Mozo: confirmar -> Cocina: preparar/listo -> Mozo: entregado -> Cajero: abrir caja y cobrar.
 - Admin > cambiar un precio: se actualiza en la carta del QR al instante.
 - Caja: movimientos, cierre con diferencia. Facturas: emitir ahora o después.
 - Auditoría: registro de todo lo que pasó.
 - Para simular las dos cajas: INICIAR.bat (PB, puerto 3000) y INICIAR_CAJA_P1.bat
   (P1, puerto 3001). OJO: cada una tiene su propia base de datos en esta versión de prueba.

IMPORTANTE
 - La facturación ARCA está SIMULADA: los CAE son falsos y no tienen validez fiscal.
 - Los PIN de prueba son públicos: no usar esta versión en el local real.
 - Los datos quedan en app\datos. BORRAR_DATOS_DE_PRUEBA.bat los reinicia.
TXT
for f in "$OUT"/*.bat "$OUT"/LEEME.txt; do sed -i 's/$/\r/' "$f"; done

else
cat > "$OUT/iniciar.sh" <<'SH'
#!/usr/bin/env bash
# Uso: ./iniciar.sh [PB|P1]   (por defecto PB; P1 usa el puerto 3001 y su propia base)
cd "$(dirname "$0")/app" || exit 1
export REGISTER_ID="${1:-PB}"
if [ "$REGISTER_ID" = P1 ]; then
  export MACHINE_ID=demo-pc-p1 PORT=3001 DB_PATH=datos/demo-p1.db
else
  export MACHINE_ID=demo-pc PORT=3000
fi
( sleep 2; command -v xdg-open >/dev/null && xdg-open "http://localhost:${PORT}/" >/dev/null 2>&1 ) &
exec ../node/bin/node --disable-warning=ExperimentalWarning scripts/portable.js
SH
cat > "$OUT/borrar-datos-de-prueba.sh" <<'SH'
#!/usr/bin/env bash
read -r -p "Esto borra TODOS los datos de prueba. ¿Continuar? [s/N] " r
[ "$r" = s ] && rm -rf "$(dirname "$0")/app/datos" && echo "Listo. Al iniciar de nuevo se carga la demo."
SH
cat > "$OUT/LEEME.txt" <<'TXT'
RESTAURANTE - VERSIÓN PORTABLE DE PRUEBA (Linux x86_64)
=======================================================

1) unzip restaurante-portable-linux64.zip && cd restaurante-portable-linux64
2) ./iniciar.sh            (caja PB, http://localhost:3000)
   ./iniciar.sh P1         (caja P1, puerto 3001, base propia)
   Si no tiene permiso de ejecución:  chmod +x iniciar.sh borrar-datos-de-prueba.sh node/bin/node
3) Usuarios de prueba (PIN):  Admin 1111 | Cajero 2222 | Mozo 3333 | Cocina 4444

QUÉ PROBAR
 - Admin > QR por mesa: abrí el link de una mesa (o escaneá desde el celular en la misma Wi-Fi;
   si tenés firewall abierto el puerto 3000/tcp).
   Pedí algo como cliente -> aparece "por confirmar" en el Panel (Mozo).
 - Mozo: confirmar -> Cocina: preparar/listo -> Mozo: entregado -> Cajero: abrir caja y cobrar.
 - Admin > cambiar un precio: se actualiza en la carta del QR al instante.
 - Caja: movimientos y cierre con diferencia. Facturas: emitir ahora o después. Auditoría: todo el registro.

IMPORTANTE
 - La facturación ARCA está SIMULADA: los CAE son falsos y no tienen validez fiscal.
 - Los PIN de prueba son públicos: no usar esta versión en el local real.
 - Los datos quedan en app/datos. borrar-datos-de-prueba.sh los reinicia.
TXT
chmod +x "$OUT/iniciar.sh" "$OUT/borrar-datos-de-prueba.sh" "$OUT/node/bin/node"
fi

(cd dist && zip -qr "$NAME.zip" "$NAME")
ls -lh "$OUT.zip"
