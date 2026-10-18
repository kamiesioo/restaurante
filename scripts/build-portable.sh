#!/usr/bin/env bash
# Arma dist/restaurante-portable-win64.zip: app + Node incluido (no requiere instalar nada).
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_VERSION="${NODE_VERSION:-22.22.0}"
OUT="dist/restaurante-portable-win64"
CACHE=".cache"

rm -rf "$OUT" "$OUT.zip"
mkdir -p "$OUT/app" "$OUT/node" "$CACHE"

if [ ! -f "$CACHE/node-win.zip" ]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" -o "$CACHE/node-win.zip"
fi
unzip -q -j "$CACHE/node-win.zip" "node-v$NODE_VERSION-win-x64/node.exe" "node-v$NODE_VERSION-win-x64/LICENSE" -d "$OUT/node"

cp -r src scripts package.json "$OUT/app/"
rm -f "$OUT/app/scripts/build-portable.sh"
mkdir -p "$OUT/docs" && cp docs/DISENO.md "$OUT/docs/"

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

(cd dist && zip -qr "restaurante-portable-win64.zip" "restaurante-portable-win64")
ls -lh "$OUT.zip"
