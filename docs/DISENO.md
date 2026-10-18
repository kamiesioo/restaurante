# Sistema de restaurante — Diseño base (pseudocódigo)

Estado: borrador para validar con el gerente. Todo lo marcado con `??` es una
suposición que hay que confirmar (ver sección 10).

---

## 1. Alcance

**Dentro:** carta y precios, mesas con QR, pedidos, cocina/barra, reparto del
mozo, caja (apertura, movimientos, arqueo, cierre), facturación ARCA, auditoría.

**Fuera (por ahora):** RRHH, sueldos, contabilidad, stock/recetas, proveedores,
reservas, delivery, integración con el sistema del casino.

---

## 2. Arquitectura

```
                       ┌──────────────────────────────┐
                       │  BASE DE DATOS EXTERNA       │
                       │  (Postgres administrado)     │
                       │  - solo acepta las 3 máquinas│
                       │  - sin DELETE, con backups   │
                       └───────▲──────▲──────▲────────┘
                  TLS + allow  │      │      │  (VPN / IP fija)
   ┌───────────────────────────┘      │      └──────────────────────────┐
┌──┴───────────────┐        ┌─────────┴────────┐         ┌──────────────┴──┐
│ M1 PRINCIPAL     │        │ M2 PLANTA BAJA   │         │ M3 PRIMER PISO  │
│ mesa de entrada  │        │ caja "PB"        │         │ caja "P1"       │
│ agente local     │        │ agente local     │         │ (lado casino)   │
│ sin caja ??      │        │ ?? función       │         │ agente local    │
└──────────────────┘        └──────────────────┘         └─────────────────┘
        ▲ Wi-Fi del local (solo red interna)
        │
   Celular del cliente  ── escanea QR de la mesa ──► http://<IP-local>/m/<token>
```

### Reglas de la arquitectura

1. **Agente local** en cada máquina: un servidor web que corre en esa PC. Es
   el *único* que conoce las credenciales de la base. Los demás dispositivos
   (celulares, otras pantallas) hablan con el agente, nunca con la base.
2. **La base de datos nunca se expone** a Internet abierto: se restringe por
   IP/VPN a las 3 máquinas, con un rol de base por máquina.
3. **Nada se borra:** los roles de base no tienen `DELETE`/`TRUNCATE`. Las
   bajas son lógicas (`active = false`) y hay un `audit_log` solo-inserción.
4. **Plata en centavos enteros** (nunca `float`).
5. **Precio congelado en el pedido:** cambiar un precio no altera pedidos ya
   tomados.
6. **Si se cae Internet** el agente sigue operando con su copia local y
   encola los cambios (outbox) para subirlos al reconectar.
7. El QR del cliente solo funciona **desde la red Wi-Fi del local** ya que
   apunta a la IP interna de la máquina; no hace falta exponer nada afuera.

### Roles

| Rol      | Puede                                                         |
|----------|---------------------------------------------------------------|
| admin    | todo, incluido precios, usuarios, anulaciones, reabrir caja   |
| cajero   | abrir/cerrar caja, cobrar, facturar, mover plata, anular ítems|
| mozo     | abrir pedidos, cargar ítems, confirmar QR, entregar, pedir cuenta |
| cocina   | ver cola de su estación, marcar en preparación / listo        |

---

## 3. Modelo de datos (resumen)

```
user(id, name, role, pin_hash, active)
category(id, name, position, active)
product(id, category_id, name, description, price_cents, iva_rate,
        station['cocina'|'barra'], available, active, updated_at)
price_history(id, product_id, old_cents, new_cents, changed_by, changed_at)

dining_table(id, sector, number, qr_token UNIQUE, active)

customer_order(id, table_id, status['abierto'|'cuenta_pedida'|'cerrado'|'anulado'],
               opened_by, opened_at, closed_at, closed_session_id)
order_item(id, order_id, product_id, name_snap, unit_price_cents, iva_rate,
           qty, notes, station, source['qr'|'mozo'],
           status['por_confirmar'|'enviado'|'en_preparacion'|'listo'|
                  'entregado'|'cancelado'],
           cancel_reason, created_at, status_changed_at)

cash_register(id['PB'|'P1'], name)
cash_session(id, register_id, opened_by, opened_at, opening_cents,
             closed_by, closed_at, counted_cents, expected_cents)
cash_movement(id, session_id, kind['ingreso'|'egreso'], amount_cents, reason,
              created_by, created_at)
payment(id, order_id, session_id, method, amount_cents, created_by, created_at)

invoice(id, order_id UNIQUE, status['pendiente'|'emitida'|'error'],
        tipo, pto_vta, numero, cae, cae_vto, receptor_doc_tipo,
        receptor_doc_nro, total_cents, error, created_at)

audit_log(id, at, user_id, machine_id, action, entity, entity_id, detail)  -- solo INSERT
```

---

## 4. Carta y precios

```
función cambiarPrecio(producto, nuevoPrecio, usuario):
    exigir usuario.rol == admin
    exigir nuevoPrecio >= 0 y entero (centavos)
    transacción:
        viejo = producto.price_cents
        producto.price_cents = nuevoPrecio
        producto.updated_at  = ahora
        insertar price_history(producto, viejo, nuevoPrecio, usuario, ahora)
        auditar("precio.cambiar", producto, {viejo, nuevoPrecio})
    avisar a todas las pantallas ("carta cambió")

función obtenerCarta():            // la usa el QR, el mozo y el admin
    devolver categorías activas, con sus productos activos
             (los no disponibles se muestran tachados / "agotado")
    // La carta SIEMPRE se lee de `product`, así que el cambio de precio
    // se refleja solo, sin republicar nada.
```

---

## 5. Mesas y QR

```
función crearMesa(sector, numero):
    token = aleatorio_seguro(128 bits)        // no adivinable
    guardar dining_table(sector, numero, token)

función urlQR(mesa):  return "http://" + IP_LOCAL + "/m/" + mesa.qr_token

función rotarQR(mesa, usuario):               // si alguien filtró/robó el QR
    exigir rol admin|cajero
    mesa.qr_token = aleatorio_seguro()
    auditar("mesa.rotar_qr")
```

Cada mesa tiene un QR impreso con su URL. El token identifica la mesa; el
cliente **no elige** el número de mesa.

---

## 6. Pedidos (corazón del sistema)

```
// ---- el cliente, desde el QR -------------------------------------
función pedidoPorQR(token, items):
    mesa = buscarMesaPorToken(token)  o  error 404
    limitarFrecuencia(token)          // anti-abuso/bromas
    exigir cada item: producto activo y disponible, 1 <= qty <= 20
    pedido = pedidoAbiertoDe(mesa)  o  abrirPedido(mesa, abierto_por=nulo)
    estado = config.qrRequiereConfirmacion ? 'por_confirmar' : 'enviado'
    para cada item:
        crear order_item(estado, source='qr',
                         precio=producto.precio_actual,      // congelado
                         estación=producto.estación)
    notificar("pedido.nuevo", mesa)

// ---- el mozo ------------------------------------------------------
función confirmarItems(ids, mozo):        // solo si hay confirmación
    para cada item en 'por_confirmar': pasar a 'enviado'; auditar
    notificar("cocina")

función cargarItemsComoMozo(pedido, items, mozo):
    igual que pedidoPorQR pero source='mozo', estado='enviado'

// ---- cocina / barra ----------------------------------------------
función colaDeEstacion(estacion):
    items en ('enviado','en_preparacion') de esa estación
    ordenados por created_at ASC, mostrando "Mesa 7 · Sector PB"

transiciones permitidas:
    enviado → en_preparacion → listo → entregado
    cualquiera (menos entregado) → cancelado   // exige motivo + queda auditado
    // cancelar algo ya en preparación exige rol cajero|admin

// ---- reparto ------------------------------------------------------
función pendientesDeReparto():
    items en 'listo' agrupados por mesa  → el mozo los lleva y marca 'entregado'

// ---- cuenta -------------------------------------------------------
función pedirCuenta(pedido):       // desde QR o mozo
    pedido.status = 'cuenta_pedida'   // avisa al cajero

función totalDe(pedido): suma(unit_price_cents * qty) de ítems != 'cancelado'
```

---

## 7. Caja (una por piso)

```
// PB y P1 son cajas INDEPENDIENTES; cada una tiene sus propias sesiones.

función abrirCaja(registro, cajero, efectivoInicial):
    exigir que no haya sesión abierta en ese registro
    crear cash_session(registro, cajero, efectivoInicial, ahora)

función cobrar(pedido, pagos[], cajero, registro):
    sesion = sesionAbierta(registro)  o  error "abrí la caja primero"
    exigir todos los ítems en 'entregado' o 'cancelado'
    exigir suma(pagos) == totalDe(pedido)
    transacción:
        guardar payment(...) por cada pago (método: efectivo|débito|crédito|
                                              transferencia|qr_mp ...)
        pedido.status = 'cerrado'
        crear invoice(estado='pendiente')      // ver sección 8
    auditar("pedido.cobrar")

función movimiento(sesion, tipo, monto, motivo, usuario):   // retiros, gastos
    exigir motivo no vacío
    guardar cash_movement

función cerrarCaja(sesion, efectivoContado, cajero):
    esperado = inicial + pagos_efectivo + ingresos - egresos
    diferencia = efectivoContado - esperado
    guardar contado, esperado, closed_at
    devolver resumen { por_método, ingresos, egresos, esperado, contado,
                       diferencia, cantidad_pedidos, facturado, sin_facturar }
```

El cierre de PB y P1 son independientes; el admin puede ver el consolidado.

---

## 8. Facturación (ARCA, ex AFIP)

```
Todo pedido cobrado queda registrado en el sistema y en el cierre de caja.
La factura es un paso aparte con estados:  pendiente → emitida | error

función facturar(pedido, receptor, cajero):
    inv = invoice del pedido
    si inv.status == 'emitida': devolver inv       // idempotente
    tipo = tipoComprobante(config.condicionEmisor, receptor)
              // Resp. Inscripto → B (consumidor final) / A (con CUIT RI)
              // Monotributo     → C
    si total supera el tope configurado y receptor es Consumidor Final anónimo:
        exigir identificar al receptor (DNI/CUIT)  // el tope lo fija ARCA
    resultado = proveedorARCA.emitir({tipo, pto_vta, receptor, total, IVA})
    si ok:  guardar numero, CAE, vencimiento CAE; status='emitida'
    si error: guardar mensaje; status='error'   // se puede reintentar

proveedorARCA (interfaz):
    - "deshabilitado": no emite (default)
    - "homologacion":  WSAA + WSFEv1 contra el ambiente de pruebas de ARCA
    - "produccion":    idem con certificado real
    // Autenticación: certificado X.509 + clave privada → WSAA devuelve
    // token/sign (dura ~12 hs) → WSFEv1: FECompUltimoAutorizado para el
    // próximo número, luego FECAESolicitar.

reporte pendientesDeFacturar():  todos los pedidos cobrados sin factura emitida
```

> **Importante:** el sistema **no** tiene una opción para ocultar ventas del
> registro interno. "Facturar o no" se modela como *emitir ahora / emitir
> después*; el pedido igual figura siempre en caja y en los reportes. Ver nota
> en el README.

---

## 9. Auditoría y seguridad

```
auditar(accion, entidad, id, detalle):
    INSERT audit_log(ahora, usuario, maquina, accion, entidad, id, detalle)
    // tabla con triggers que prohíben UPDATE y DELETE

login(usuario, pin):  scrypt + límite de intentos; token de sesión con vencimiento
acciones auditadas: precios, anulaciones, cancelaciones, aperturas/cierres de
caja, movimientos de plata, emisión de facturas, rotación de QR.
```

### Base externa — recomendaciones

- Postgres administrado con **backups automáticos y recuperación a un punto en el tiempo**.
- Acceso solo desde las 3 IPs fijas (o una VPN tipo Tailscale/WireGuard);
  desactivar cualquier API REST pública que ofrezca el proveedor.
- Un rol de base por máquina con `SELECT/INSERT/UPDATE`, **sin `DELETE`**.
- Credenciales en variables de entorno de cada PC, no en el repo.

### Sincronización / sin conexión

```
cada escritura local → fila en `outbox` (id, tabla, payload, enviado=false)
hilo en segundo plano: mientras hay conexión, enviar outbox en orden y marcar enviado
pedidos/pagos/auditoría son "solo agregar" → no hay conflictos
precios/carta: gana la versión más nueva (campo updated_at/version)
las pantallas se refrescan por eventos (SSE) y, entre máquinas, por polling
de un cursor de cambios
```

---

## 10. Preguntas para la reunión con el gerente

1. ¿Qué hace la máquina de **planta baja**? (¿otra caja con salón propio? ¿solo cocina? ¿barra?)
2. ¿La **mesa de entrada** cobra algo (cubiertos, reservas) o solo ubica gente?
3. ¿Dónde está físicamente la **cocina**? ¿Una sola o una por piso? ¿Hay barra aparte?
4. ¿Los pedidos por QR se aceptan solos o los **confirma el mozo**? ¿Se puede pagar desde el celular?
5. ¿Condición frente a IVA del emisor (RI / Monotributo)? ¿Cuántos **puntos de venta** ARCA y cuál para cada caja?
6. ¿Se cobra **propina / servicio**? ¿Se **divide la cuenta** entre comensales?
7. ¿Hay **impresora** de comandas/tickets? ¿Modelo? ¿Impresora fiscal o solo electrónica?
8. ¿Qué pasa con las mesas del lado **casino** (consumos a cuenta, comps, tarjetas del casino)?
9. ¿Qué reportes necesita ver el gerente al cierre?
10. ¿Hay **internet estable** en las 3 ubicaciones? ¿IP fija?

---

## 11. Hoja de ruta

1. **Núcleo local** (este repo): datos, carta/precios, mesas+QR, pedidos, cocina, caja, facturación (interfaz), auditoría, API + pantallas básicas.
2. Adaptador **Postgres externo** + outbox/sync.
3. Proveedor **ARCA homologación** → producción.
4. Pantallas pulidas (admin, caja, mozo), impresión de comandas/tickets, generación de imágenes QR.
5. Ajustes según lo que diga el gerente.
