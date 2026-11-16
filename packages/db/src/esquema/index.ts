/**
 * Esquema `comercial` (ESPECIFICACION.md §8). Drizzle gestiona solo este esquema.
 *
 * Nota: `mensajes` está particionada por mes en `fecha`. Drizzle no modela particiones, así que la
 * migración que la crea se editó a mano (PARTITION BY RANGE). Por la misma razón su clave primaria
 * es (message_id, fecha): PostgreSQL exige que la clave de partición forme parte de la PK.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const comercial = pgSchema('comercial');

const ts = (nombre: string) => timestamp(nombre, { withTimezone: true, mode: 'date' });
const auditoriaFilas = {
  creadoEn: ts('creado_en').notNull().defaultNow(),
  actualizadoEn: ts('actualizado_en')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const rolEnum = comercial.enum('rol', ['admin', 'dueno', 'supervisor', 'asesor']);
export const nivelEnum = comercial.enum('nivel', ['ninguno', 'ver', 'editar']);

// ---------------------------------------------------------------- Subcuentas y credenciales

export const subcuentas = comercial.table(
  'subcuentas',
  {
    locationId: text('location_id').primaryKey(),
    nombre: text('nombre').notNull(),
    zonaHoraria: text('zona_horaria').notNull().default('America/Lima'),
    activa: boolean('activa').notNull().default(true),
    horarioGeneral: jsonb('horario_general'),
    metas: jsonb('metas'),
    umbrales: jsonb('umbrales'),
    /** Exactamente 3 stage_id del pipeline de la subcuenta (§6.1). Nulo mientras no se eligen. */
    etapasCalidad: text('etapas_calidad').array(),
    ...auditoriaFilas,
  },
  (t) => [
    check(
      'etapas_calidad_tres',
      sql`${t.etapasCalidad} IS NULL OR cardinality(${t.etapasCalidad}) = 3`,
    ),
  ],
);

export const credenciales = comercial.table(
  'credenciales',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Nulo para el token de agencia. */
    locationId: text('location_id').references(() => subcuentas.locationId, {
      onDelete: 'cascade',
    }),
    tipo: text('tipo', { enum: ['agencia', 'subcuenta'] }).notNull(),
    tokenCifrado: text('token_cifrado').notNull(),
    permisosVerificados: jsonb('permisos_verificados'),
    verificadoEn: ts('verificado_en'),
    ...auditoriaFilas,
  },
  (t) => [
    unique('credenciales_tipo_location').on(t.tipo, t.locationId).nullsNotDistinct(),
    check(
      'credenciales_tipo_coherente',
      sql`(${t.tipo} = 'agencia' AND ${t.locationId} IS NULL) OR (${t.tipo} = 'subcuenta' AND ${t.locationId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------- Asesores, horarios y ausencias

export const asesores = comercial.table('asesores', {
  userId: text('user_id').primaryKey(),
  nombre: text('nombre').notNull(),
  correo: text('correo'),
  ...auditoriaFilas,
});

export const asesorSubcuenta = comercial.table(
  'asesor_subcuenta',
  {
    userId: text('user_id')
      .notNull()
      .references(() => asesores.userId, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => subcuentas.locationId, { onDelete: 'cascade' }),
    activo: boolean('activo').notNull().default(true),
    ...auditoriaFilas,
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId] })],
);

export const horarios = comercial.table(
  'horarios',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Nulo = horario general de la subcuenta. */
    userId: text('user_id').references(() => asesores.userId, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => subcuentas.locationId, { onDelete: 'cascade' }),
    /** 1 = lunes … 7 = domingo (ISO 8601). */
    diaSemana: smallint('dia_semana').notNull(),
    horaInicio: time('hora_inicio').notNull(),
    horaFin: time('hora_fin').notNull(),
    vigenteDesde: date('vigente_desde', { mode: 'string' }).notNull(),
    vigenteHasta: date('vigente_hasta', { mode: 'string' }),
    ...auditoriaFilas,
  },
  (t) => [
    check('horarios_dia_valido', sql`${t.diaSemana} BETWEEN 1 AND 7`),
    check('horarios_tramo_valido', sql`${t.horaFin} > ${t.horaInicio}`),
    index('horarios_location_user').on(t.locationId, t.userId),
  ],
);

export const ausencias = comercial.table(
  'ausencias',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Nulo = toda la subcuenta (feriado). */
    userId: text('user_id').references(() => asesores.userId, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => subcuentas.locationId, { onDelete: 'cascade' }),
    inicio: ts('inicio').notNull(),
    fin: ts('fin').notNull(),
    tipo: text('tipo', { enum: ['feriado', 'vacaciones', 'permiso'] }).notNull(),
    motivo: text('motivo'),
    ...auditoriaFilas,
  },
  (t) => [
    check('ausencias_rango_valido', sql`${t.fin} > ${t.inicio}`),
    index('ausencias_location_user').on(t.locationId, t.userId),
  ],
);

export const mapaEtapas = comercial.table(
  'mapa_etapas',
  {
    locationId: text('location_id')
      .notNull()
      .references(() => subcuentas.locationId, { onDelete: 'cascade' }),
    pipelineId: text('pipeline_id').notNull(),
    stageId: text('stage_id').notNull(),
    nombreOriginal: text('nombre_original').notNull(),
    etapaEstandar: text('etapa_estandar', {
      enum: ['nuevo', 'contactado', 'interesado', 'por_cerrar', 'ganado', 'perdido'],
    }),
    ...auditoriaFilas,
  },
  (t) => [primaryKey({ columns: [t.locationId, t.pipelineId, t.stageId] })],
);

// ---------------------------------------------------------------- Datos cargados desde GHL

export const leads = comercial.table(
  'leads',
  {
    conversationId: text('conversation_id').primaryKey(),
    locationId: text('location_id').notNull(),
    contactId: text('contact_id').notNull(),
    opportunityId: text('opportunity_id'),
    canal: text('canal'),
    asesorId: text('asesor_id'),
    ingresoEn: ts('ingreso_en'),
    primeraRespAutoEn: ts('primera_resp_auto_en'),
    primeraRespHumanaEn: ts('primera_resp_humana_en'),
    minutosLaboralesRespuesta: numeric('minutos_laborales_respuesta', { mode: 'number' }),
    ultimoInboundEn: ts('ultimo_inbound_en'),
    ultimoOutboundEn: ts('ultimo_outbound_en'),
    intentos: integer('intentos').notNull().default(0),
    respuestaEfectiva: boolean('respuesta_efectiva'),
    abandono: boolean('abandono').notNull().default(false),
    estado: text('estado'),
    etapaEstandar: text('etapa_estandar'),
    ...auditoriaFilas,
  },
  (t) => [
    index('leads_location_ingreso').on(t.locationId, t.ingresoEn),
    index('leads_asesor_ingreso').on(t.asesorId, t.ingresoEn),
  ],
);

export const mensajes = comercial.table(
  'mensajes',
  {
    messageId: text('message_id').notNull(),
    locationId: text('location_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    direccion: text('direccion', { enum: ['inbound', 'outbound'] }).notNull(),
    tipo: text('tipo'),
    origen: text('origen', { enum: ['manual', 'workflow', 'agente_ia', 'campana', 'sin_origen'] }),
    userId: text('user_id'),
    /** Se purga a los 90 días (job purga:textos); las clasificaciones se conservan. */
    texto: text('texto'),
    fecha: ts('fecha').notNull(),
    ...auditoriaFilas,
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.fecha] }),
    index('mensajes_conversacion_fecha').on(t.conversationId, t.fecha),
  ],
);

export const oportunidades = comercial.table(
  'oportunidades',
  {
    opportunityId: text('opportunity_id').primaryKey(),
    locationId: text('location_id').notNull(),
    contactId: text('contact_id'),
    pipelineId: text('pipeline_id'),
    stageId: text('stage_id'),
    status: text('status', { enum: ['open', 'won', 'lost', 'abandoned'] }).notNull(),
    monto: numeric('monto', { precision: 14, scale: 2, mode: 'number' }),
    creadaEn: ts('creada_en'),
    cambioEstadoEn: ts('cambio_estado_en'),
    /** `lastStageChangeAt` de GHL: se usa para construir `historial_etapas`. */
    cambioEtapaEn: ts('cambio_etapa_en'),
    motivoPerdida: text('motivo_perdida'),
    asesorId: text('asesor_id'),
    ...auditoriaFilas,
  },
  (t) => [
    index('oportunidades_location_status_cambio').on(t.locationId, t.status, t.cambioEstadoEn),
  ],
);

export const historialEtapas = comercial.table(
  'historial_etapas',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    opportunityId: text('opportunity_id').notNull(),
    locationId: text('location_id').notNull(),
    contactId: text('contact_id'),
    stageId: text('stage_id').notNull(),
    etapaEstandar: text('etapa_estandar'),
    desde: ts('desde').notNull(),
    /** Nulo = etapa actual. */
    hasta: ts('hasta'),
    fuente: text('fuente', { enum: ['carga', 'webhook', 'actividad'] }).notNull(),
    ...auditoriaFilas,
  },
  (t) => [
    index('historial_etapas_oportunidad').on(t.opportunityId, t.desde),
    index('historial_etapas_contacto').on(t.locationId, t.contactId, t.desde),
  ],
);

export const tareas = comercial.table(
  'tareas',
  {
    taskId: text('task_id').primaryKey(),
    locationId: text('location_id').notNull(),
    contactId: text('contact_id'),
    venceEn: ts('vence_en'),
    completada: boolean('completada').notNull().default(false),
    ...auditoriaFilas,
  },
  (t) => [index('tareas_location_vence').on(t.locationId, t.venceEn)],
);

// ---------------------------------------------------------------- Análisis de calidad (§6)

export const analisisCalidad = comercial.table(
  'analisis_calidad',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    locationId: text('location_id').notNull(),
    tipo: text('tipo', { enum: ['automatico', 'manual'] }).notNull(),
    lanzadoPor: uuid('lanzado_por'),
    periodoDesde: date('periodo_desde', { mode: 'string' }).notNull(),
    periodoHasta: date('periodo_hasta', { mode: 'string' }).notNull(),
    semilla: text('semilla').notNull(),
    estado: text('estado', {
      enum: ['preparando', 'enviado', 'revisando', 'terminado', 'fallido', 'detenido_por_tope'],
    }).notNull(),
    batchIds: text('batch_ids').array(),
    conversacionesElegibles: integer('conversaciones_elegibles'),
    conversacionesMuestra: integer('conversaciones_muestra'),
    descartes: jsonb('descartes'),
    mensajesCalificados: integer('mensajes_calificados'),
    fallidos: integer('fallidos'),
    costoEstimado: numeric('costo_estimado', { precision: 10, scale: 4, mode: 'number' }),
    tokensEntrada: integer('tokens_entrada'),
    tokensSalida: integer('tokens_salida'),
    costoReal: numeric('costo_real', { precision: 10, scale: 4, mode: 'number' }),
    creadoEn: ts('creado_en').notNull().defaultNow(),
    cerradoEn: ts('cerrado_en'),
    actualizadoEn: auditoriaFilas.actualizadoEn,
  },
  (t) => [index('analisis_calidad_location').on(t.locationId, t.creadoEn)],
);

export const analisisCalidadMuestra = comercial.table(
  'analisis_calidad_muestra',
  {
    analisisId: bigint('analisis_id', { mode: 'number' })
      .notNull()
      .references(() => analisisCalidad.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').notNull(),
    asesorId: text('asesor_id'),
    estado: text('estado').notNull(),
    intentos: integer('intentos').notNull().default(0),
    ...auditoriaFilas,
  },
  (t) => [primaryKey({ columns: [t.analisisId, t.conversationId] })],
);

export const clasificaciones = comercial.table(
  'clasificaciones',
  {
    analisisId: bigint('analisis_id', { mode: 'number' })
      .notNull()
      .references(() => analisisCalidad.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    asesorId: text('asesor_id'),
    categoria: text('categoria').notNull(),
    puntaje: smallint('puntaje'),
    criterios: jsonb('criterios'),
    motivo: text('motivo'),
    modelo: text('modelo').notNull(),
    versionRubrica: text('version_rubrica').notNull(),
    ...auditoriaFilas,
  },
  (t) => [
    primaryKey({ columns: [t.analisisId, t.messageId] }),
    check('clasificaciones_puntaje', sql`${t.puntaje} IS NULL OR ${t.puntaje} BETWEEN 1 AND 5`),
  ],
);

export const ejemplosCalidad = comercial.table(
  'ejemplos_calidad',
  {
    analisisId: bigint('analisis_id', { mode: 'number' })
      .notNull()
      .references(() => analisisCalidad.id, { onDelete: 'cascade' }),
    asesorId: text('asesor_id').notNull(),
    locationId: text('location_id').notNull(),
    mejorMessageId: text('mejor_message_id'),
    peorMessageId: text('peor_message_id'),
    ...auditoriaFilas,
  },
  (t) => [primaryKey({ columns: [t.analisisId, t.asesorId] })],
);

// ---------------------------------------------------------------- Resumen diario

export const resumenDiario = comercial.table(
  'resumen_diario',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fecha: date('fecha', { mode: 'string' }).notNull(),
    locationId: text('location_id').notNull(),
    /** Nulo = toda la subcuenta. */
    asesorId: text('asesor_id'),
    indicadores: jsonb('indicadores').notNull(),
    estadosEtapa: jsonb('estados_etapa'),
    cuelloBotella: text('cuello_botella'),
    alertas: jsonb('alertas'),
    ...auditoriaFilas,
  },
  (t) => [
    unique('resumen_diario_fecha_location_asesor')
      .on(t.fecha, t.locationId, t.asesorId)
      .nullsNotDistinct(),
    index('resumen_diario_fecha_location').on(t.fecha, t.locationId),
  ],
);

// ---------------------------------------------------------------- Usuarios y accesos (§10.1)

export const usuarios = comercial.table(
  'usuarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    correo: text('correo').notNull(),
    nombre: text('nombre').notNull(),
    /** Hash Argon2id. */
    hash: text('hash').notNull(),
    rol: rolEnum('rol').notNull(),
    activo: boolean('activo').notNull().default(true),
    totpSecretoCifrado: text('totp_secreto_cifrado'),
    debeCambiarClave: boolean('debe_cambiar_clave').notNull().default(true),
    ultimoIngreso: ts('ultimo_ingreso'),
    ...auditoriaFilas,
  },
  (t) => [
    unique('usuarios_correo').on(t.correo),
    check('usuarios_correo_minusculas', sql`${t.correo} = lower(${t.correo})`),
  ],
);

export const usuarioSubcuenta = comercial.table(
  'usuario_subcuenta',
  {
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => subcuentas.locationId, { onDelete: 'cascade' }),
    creadoEn: auditoriaFilas.creadoEn,
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.locationId] })],
);

export const permisosRol = comercial.table(
  'permisos_rol',
  {
    rol: rolEnum('rol').notNull(),
    modulo: text('modulo').notNull(),
    nivel: nivelEnum('nivel').notNull(),
  },
  (t) => [primaryKey({ columns: [t.rol, t.modulo] })],
);

export const permisosUsuario = comercial.table(
  'permisos_usuario',
  {
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    modulo: text('modulo').notNull(),
    nivel: nivelEnum('nivel').notNull(),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.modulo] })],
);

export const usuarioAsesor = comercial.table('usuario_asesor', {
  usuarioId: uuid('usuario_id')
    .primaryKey()
    .references(() => usuarios.id, { onDelete: 'cascade' }),
  /** userId de GHL. Es el mismo en todas las subcuentas (§3). */
  userId: text('user_id').notNull(),
});

/**
 * Sesiones de inicio de sesión. No figura en la §8: es infraestructura de autenticación.
 * Se guarda el SHA-256 del token, nunca el token.
 */
export const sesiones = comercial.table(
  'sesiones',
  {
    id: text('id').primaryKey(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    verificada2fa: boolean('verificada_2fa').notNull().default(false),
    creadaEn: ts('creada_en').notNull().defaultNow(),
    expiraEn: ts('expira_en').notNull(),
    ultimoUso: ts('ultimo_uso').notNull().defaultNow(),
    ip: text('ip'),
    agente: text('agente'),
  },
  (t) => [index('sesiones_usuario').on(t.usuarioId)],
);

export const auditoria = comercial.table(
  'auditoria',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Usuario que hizo la acción (nulo = sistema o anónimo, p. ej. intento de ingreso fallido). */
    quien: uuid('quien'),
    que: text('que').notNull(),
    cuando: ts('cuando').notNull().defaultNow(),
    detalle: jsonb('detalle'),
  },
  (t) => [
    index('auditoria_cuando').on(t.cuando),
    index('auditoria_que_cuando').on(t.que, t.cuando),
  ],
);

export const syncEstado = comercial.table(
  'sync_estado',
  {
    locationId: text('location_id').notNull(),
    recurso: text('recurso').notNull(),
    marcaAgua: ts('marca_agua'),
    ultimoOk: ts('ultimo_ok'),
    ultimoError: text('ultimo_error'),
    ...auditoriaFilas,
  },
  (t) => [primaryKey({ columns: [t.locationId, t.recurso] })],
);
