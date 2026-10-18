# Restaurante — sistema local

Sistema de pedidos, cocina y caja para un restaurante con 3 PCs. Diseño completo
y pseudocódigo en [`docs/DISENO.md`](docs/DISENO.md).

## Estado

| Módulo | Estado |
|---|---|
| Carta y cambio de precios (con historial) | ✅ |
| Mesas con QR (token secreto por mesa, rotable) | ✅ |
| Pedido del cliente por QR (con confirmación opcional del mozo) | ✅ |
| Cola de cocina/barra, reparto del mozo, cuenta | ✅ |
| Caja por piso (apertura, movimientos, arqueo, cierre) | ✅ |
| Cobro con pagos mixtos | ✅ |
| Facturación ARCA | 🟡 interfaz + estados listos; falta WSAA/WSFEv1 (necesita CUIT, certificado, punto de venta) |
| Auditoría solo-inserción | ✅ |
| Base de datos externa + sincronización | ⏳ hoy usa SQLite local (ver abajo) |
| Panel de admin (pantalla) | ⏳ la API ya está; falta la UI |
| Pantallas: QR del cliente, cocina/salón | ✅ básicas |

## Uso

Requiere Node ≥ 22.13 (sin dependencias externas).

```sh
ADMIN_PIN=1234 npm run seed     # crea admin, 2 cajas, carta y mesas de ejemplo
npm start                       # arranca en el puerto 3000
npm test
```

Configuración por máquina (variables de entorno, ver `src/config.js`):

| Variable | Ejemplo | Para qué |
|---|---|---|
| `MACHINE_ID` | `planta-baja` | se registra en la auditoría |
| `REGISTER_ID` | `PB` / `P1` / vacío | caja que atiende esta PC (vacío = sin caja) |
| `PUBLIC_BASE_URL` | `http://192.168.0.10:3000` | IP de la PC en el Wi-Fi; es lo que codifica el QR |
| `QR_REQUIRES_CONFIRMATION` | `true` | el mozo confirma antes de que llegue a cocina |
| `ARCA_MODE` | `deshabilitado` / `mock` | `mock` emite CAE **falsos**, solo para desarrollo |

URLs: `/cocina` (staff: login, cocina/barra y salón) y `/m/<token>` (cliente).
`GET /api/tables/qr-links` (cajero/admin) lista la URL a imprimir en cada mesa.

## Sobre facturar o no facturar

El sistema **no** incluye una opción para dejar ventas fuera del registro. Todo
cobro queda en la caja y en los reportes; la factura es un paso aparte
(`pendiente → emitida | error`): se puede emitir en el momento (`emitirFactura`)
o después desde "pendientes de facturar". Una factura emitida no se puede
modificar ni borrar. Si el gerente necesita otro flujo (por ejemplo ticket
interno + factura global), conviene definirlo con su contador.

## Seguridad

- PIN con scrypt, sesiones con vencimiento, límite de intentos.
- `audit_log`, `payment` y facturas emitidas protegidos con triggers (no se editan ni borran).
- Los endpoints públicos (`/api/public/*`) solo exponen carta y el estado de *esa* mesa, con límite de frecuencia.
- Precios en centavos enteros; el pedido congela el precio al momento de pedir.

## Próximos pasos

1. Adaptador Postgres externo (misma interfaz `run/get/all/tx` de `src/db.js`) + cola de sincronización.
2. Proveedor ARCA homologación/producción.
3. Panel de admin, pantalla de caja/mozo, impresión de comandas y QR.
4. Ajustar según la reunión con el gerente (preguntas en `docs/DISENO.md` §10).
