const env = process.env;

export function loadConfig(overrides = {}) {
  return {
    machineId: env.MACHINE_ID || 'principal',
    // Caja que atiende esta PC: 'PB', 'P1' o vacío (sin caja, ej. mesa de entrada).
    registerId: env.REGISTER_ID || null,
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    // Dirección que se imprime en los QR (IP de esta PC dentro del Wi-Fi del local).
    publicBaseUrl: env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`,
    dbPath: env.DB_PATH || 'data/restaurante.db',
    // true: los pedidos del QR esperan la confirmación del mozo antes de ir a cocina.
    qrRequiresConfirmation: (env.QR_REQUIRES_CONFIRMATION ?? 'true') === 'true',
    sessionHours: 12,
    arca: {
      // 'deshabilitado' | 'mock' (solo desarrollo)
      // Pendiente: 'homologacion' y 'produccion' (WSAA + WSFEv1).
      mode: env.ARCA_MODE || 'deshabilitado',
      cuit: env.ARCA_CUIT || '',
      ptoVta: Number(env.ARCA_PTO_VTA || 1),
      // 'RI' (Responsable Inscripto) | 'MONOTRIBUTO'
      issuerCondition: env.ARCA_ISSUER || 'RI',
      // Importe desde el cual se exige identificar al consumidor final.
      // Lo fija ARCA y cambia: se configura, no se hardcodea.
      identifyAboveCents: Number(env.ARCA_IDENTIFY_ABOVE_CENTS || 0),
    },
    ...overrides,
  };
}
