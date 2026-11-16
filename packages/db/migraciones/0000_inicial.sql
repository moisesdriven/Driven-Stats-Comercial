-- El esquema "comercial" lo crea scripts/sql/esquema_y_roles.sql (dueño: comercial_migrador).
-- El rol migrador no tiene permiso para crear esquemas en la base compartida, a propósito.
SELECT 1;
--> statement-breakpoint
CREATE TYPE "comercial"."nivel" AS ENUM('ninguno', 'ver', 'editar');--> statement-breakpoint
CREATE TYPE "comercial"."rol" AS ENUM('admin', 'dueno', 'supervisor', 'asesor');--> statement-breakpoint
CREATE TABLE "comercial"."analisis_calidad" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"tipo" text NOT NULL,
	"lanzado_por" uuid,
	"periodo_desde" date NOT NULL,
	"periodo_hasta" date NOT NULL,
	"semilla" text NOT NULL,
	"estado" text NOT NULL,
	"modelo" text,
	"version_rubrica" text,
	"mensajes_estimados" integer,
	"error" text,
	"batch_ids" text[],
	"conversaciones_elegibles" integer,
	"conversaciones_muestra" integer,
	"descartes" jsonb,
	"mensajes_calificados" integer,
	"fallidos" integer,
	"costo_estimado" numeric(10, 4),
	"tokens_entrada" integer,
	"tokens_salida" integer,
	"costo_real" numeric(10, 4),
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrado_en" timestamp with time zone,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comercial"."analisis_calidad_muestra" (
	"analisis_id" bigint NOT NULL,
	"conversation_id" text NOT NULL,
	"asesor_id" text,
	"estado" text NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"mensajes" integer DEFAULT 0 NOT NULL,
	"numeracion" jsonb,
	"batch_id" text,
	"error" text,
	"huella" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analisis_calidad_muestra_analisis_id_conversation_id_pk" PRIMARY KEY("analisis_id","conversation_id")
);
--> statement-breakpoint
CREATE TABLE "comercial"."asesor_subcuenta" (
	"user_id" text NOT NULL,
	"location_id" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asesor_subcuenta_user_id_location_id_pk" PRIMARY KEY("user_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "comercial"."asesores" (
	"user_id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"correo" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comercial"."auditoria" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quien" uuid,
	"que" text NOT NULL,
	"cuando" timestamp with time zone DEFAULT now() NOT NULL,
	"detalle" jsonb
);
--> statement-breakpoint
CREATE TABLE "comercial"."ausencias" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"location_id" text NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fin" timestamp with time zone NOT NULL,
	"tipo" text NOT NULL,
	"motivo" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ausencias_rango_valido" CHECK ("comercial"."ausencias"."fin" > "comercial"."ausencias"."inicio")
);
--> statement-breakpoint
CREATE TABLE "comercial"."clasificaciones" (
	"analisis_id" bigint NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"asesor_id" text,
	"categoria" text NOT NULL,
	"puntaje" smallint,
	"criterios" jsonb,
	"motivo" text,
	"modelo" text NOT NULL,
	"version_rubrica" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clasificaciones_analisis_id_message_id_pk" PRIMARY KEY("analisis_id","message_id"),
	CONSTRAINT "clasificaciones_puntaje" CHECK ("comercial"."clasificaciones"."puntaje" IS NULL OR "comercial"."clasificaciones"."puntaje" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "comercial"."credenciales" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"location_id" text,
	"tipo" text NOT NULL,
	"token_cifrado" text NOT NULL,
	"permisos_verificados" jsonb,
	"verificado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credenciales_tipo_location" UNIQUE NULLS NOT DISTINCT("tipo","location_id"),
	CONSTRAINT "credenciales_tipo_coherente" CHECK (("comercial"."credenciales"."tipo" = 'agencia' AND "comercial"."credenciales"."location_id" IS NULL) OR ("comercial"."credenciales"."tipo" = 'subcuenta' AND "comercial"."credenciales"."location_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "comercial"."ejemplos_calidad" (
	"analisis_id" bigint NOT NULL,
	"asesor_id" text NOT NULL,
	"location_id" text NOT NULL,
	"mejor_message_id" text,
	"peor_message_id" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ejemplos_calidad_analisis_id_asesor_id_pk" PRIMARY KEY("analisis_id","asesor_id")
);
--> statement-breakpoint
CREATE TABLE "comercial"."eventos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"location_id" text NOT NULL,
	"contact_id" text,
	"opportunity_id" text,
	"conversation_id" text,
	"tipo" text NOT NULL,
	"ocurrido_en" timestamp with time zone NOT NULL,
	"asesor_id" text,
	"datos" jsonb,
	"fuente" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eventos_clave" UNIQUE("clave")
);
--> statement-breakpoint
CREATE TABLE "comercial"."historial_etapas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"location_id" text NOT NULL,
	"contact_id" text,
	"stage_id" text NOT NULL,
	"etapa_estandar" text,
	"desde" timestamp with time zone NOT NULL,
	"hasta" timestamp with time zone,
	"fuente" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comercial"."horarios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"location_id" text NOT NULL,
	"dia_semana" smallint NOT NULL,
	"hora_inicio" time NOT NULL,
	"hora_fin" time NOT NULL,
	"vigente_desde" date NOT NULL,
	"vigente_hasta" date,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "horarios_dia_valido" CHECK ("comercial"."horarios"."dia_semana" BETWEEN 1 AND 7),
	CONSTRAINT "horarios_tramo_valido" CHECK ("comercial"."horarios"."hora_fin" > "comercial"."horarios"."hora_inicio")
);
--> statement-breakpoint
CREATE TABLE "comercial"."leads" (
	"location_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text,
	"opportunity_id" text,
	"canal" text,
	"campana" text,
	"asesor_id" text,
	"asignado_en" timestamp with time zone,
	"asignado_conversacion" text,
	"conversacion_creada_en" timestamp with time zone,
	"ingreso_en" timestamp with time zone,
	"ingreso_anterior_a_carga" boolean DEFAULT false NOT NULL,
	"primera_resp_auto_en" timestamp with time zone,
	"primera_resp_humana_en" timestamp with time zone,
	"primera_resp_humana_por" text,
	"minutos_laborales_respuesta" numeric,
	"ultimo_inbound_en" timestamp with time zone,
	"ultimo_outbound_en" timestamp with time zone,
	"ultimo_humano_en" timestamp with time zone,
	"intentos" integer DEFAULT 0 NOT NULL,
	"respuesta_efectiva" boolean,
	"abandono" boolean DEFAULT false NOT NULL,
	"estado" text,
	"etapa_estandar" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_location_id_contact_id_pk" PRIMARY KEY("location_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "comercial"."mapa_etapas" (
	"location_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"nombre_original" text NOT NULL,
	"etapa_estandar" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapa_etapas_location_id_pipeline_id_stage_id_pk" PRIMARY KEY("location_id","pipeline_id","stage_id")
);
--> statement-breakpoint
CREATE TABLE "comercial"."mensajes" (
	"message_id" text NOT NULL,
	"location_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text,
	"direccion" text NOT NULL,
	"tipo" text,
	"canal" text,
	"contenido" text,
	"adjuntos" smallint DEFAULT 0 NOT NULL,
	"estado" text,
	"source" text,
	"origen" text,
	"user_id" text,
	"origen_verificado_en" timestamp with time zone,
	"texto" text,
	"fecha" timestamp with time zone NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mensajes_message_id_fecha_pk" PRIMARY KEY("message_id","fecha")
) PARTITION BY RANGE ("fecha");
--> statement-breakpoint
CREATE TABLE "comercial"."motivos_perdida" (
	"location_id" text NOT NULL,
	"motivo_id" text NOT NULL,
	"nombre" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "motivos_perdida_location_id_motivo_id_pk" PRIMARY KEY("location_id","motivo_id")
);
--> statement-breakpoint
CREATE TABLE "comercial"."oportunidades" (
	"opportunity_id" text PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"contact_id" text,
	"pipeline_id" text,
	"stage_id" text,
	"status" text NOT NULL,
	"monto" numeric(14, 2),
	"creada_en" timestamp with time zone,
	"cambio_estado_en" timestamp with time zone,
	"cambio_etapa_en" timestamp with time zone,
	"motivo_perdida" text,
	"asesor_id" text,
	"fuente" text,
	"etapa_estandar" text,
	"venta_en" timestamp with time zone,
	"venta_cancelada_en" timestamp with time zone,
	"perdida_en" timestamp with time zone,
	"etapa_perdida" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comercial"."permisos_rol" (
	"rol" "comercial"."rol" NOT NULL,
	"modulo" text NOT NULL,
	"nivel" "comercial"."nivel" NOT NULL,
	CONSTRAINT "permisos_rol_rol_modulo_pk" PRIMARY KEY("rol","modulo")
);
--> statement-breakpoint
CREATE TABLE "comercial"."permisos_usuario" (
	"usuario_id" uuid NOT NULL,
	"modulo" text NOT NULL,
	"nivel" "comercial"."nivel" NOT NULL,
	CONSTRAINT "permisos_usuario_usuario_id_modulo_pk" PRIMARY KEY("usuario_id","modulo")
);
--> statement-breakpoint
CREATE TABLE "comercial"."resumen_diario" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"location_id" text NOT NULL,
	"asesor_id" text,
	"indicadores" jsonb NOT NULL,
	"estados_etapa" jsonb,
	"cuello_botella" text,
	"alertas" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resumen_diario_fecha_location_asesor" UNIQUE NULLS NOT DISTINCT("fecha","location_id","asesor_id")
);
--> statement-breakpoint
CREATE TABLE "comercial"."sesiones" (
	"id" text PRIMARY KEY NOT NULL,
	"usuario_id" uuid NOT NULL,
	"verificada_2fa" boolean DEFAULT false NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"ultimo_uso" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"agente" text
);
--> statement-breakpoint
CREATE TABLE "comercial"."subcuentas" (
	"location_id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"zona_horaria" text DEFAULT 'America/Lima' NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"horario_general" jsonb,
	"metas" jsonb,
	"umbrales" jsonb,
	"etapas_calidad" text[],
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "etapas_calidad_tres" CHECK ("comercial"."subcuentas"."etapas_calidad" IS NULL OR cardinality("comercial"."subcuentas"."etapas_calidad") = 3)
);
--> statement-breakpoint
CREATE TABLE "comercial"."sync_ejecuciones" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"tipo" text NOT NULL,
	"modo" text NOT NULL,
	"inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"fin" timestamp with time zone,
	"estado" text NOT NULL,
	"llamadas" integer DEFAULT 0 NOT NULL,
	"resumen" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "comercial"."sync_estado" (
	"location_id" text NOT NULL,
	"recurso" text NOT NULL,
	"marca_agua" timestamp with time zone,
	"ultimo_ok" timestamp with time zone,
	"ultimo_error" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_estado_location_id_recurso_pk" PRIMARY KEY("location_id","recurso")
);
--> statement-breakpoint
CREATE TABLE "comercial"."tareas" (
	"task_id" text PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"contact_id" text,
	"vence_en" timestamp with time zone,
	"completada" boolean DEFAULT false NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comercial"."usuario_asesor" (
	"usuario_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comercial"."usuario_subcuenta" (
	"usuario_id" uuid NOT NULL,
	"location_id" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_subcuenta_usuario_id_location_id_pk" PRIMARY KEY("usuario_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "comercial"."usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correo" text NOT NULL,
	"nombre" text NOT NULL,
	"hash" text NOT NULL,
	"rol" "comercial"."rol" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"totp_secreto_cifrado" text,
	"debe_cambiar_clave" boolean DEFAULT true NOT NULL,
	"ultimo_ingreso" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_correo" UNIQUE("correo"),
	CONSTRAINT "usuarios_correo_minusculas" CHECK ("comercial"."usuarios"."correo" = lower("comercial"."usuarios"."correo"))
);
--> statement-breakpoint
ALTER TABLE "comercial"."analisis_calidad_muestra" ADD CONSTRAINT "analisis_calidad_muestra_analisis_id_analisis_calidad_id_fk" FOREIGN KEY ("analisis_id") REFERENCES "comercial"."analisis_calidad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."asesor_subcuenta" ADD CONSTRAINT "asesor_subcuenta_user_id_asesores_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "comercial"."asesores"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."asesor_subcuenta" ADD CONSTRAINT "asesor_subcuenta_location_id_subcuentas_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "comercial"."subcuentas"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."ausencias" ADD CONSTRAINT "ausencias_user_id_asesores_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "comercial"."asesores"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."ausencias" ADD CONSTRAINT "ausencias_location_id_subcuentas_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "comercial"."subcuentas"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."clasificaciones" ADD CONSTRAINT "clasificaciones_analisis_id_analisis_calidad_id_fk" FOREIGN KEY ("analisis_id") REFERENCES "comercial"."analisis_calidad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."credenciales" ADD CONSTRAINT "credenciales_location_id_subcuentas_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "comercial"."subcuentas"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."ejemplos_calidad" ADD CONSTRAINT "ejemplos_calidad_analisis_id_analisis_calidad_id_fk" FOREIGN KEY ("analisis_id") REFERENCES "comercial"."analisis_calidad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."horarios" ADD CONSTRAINT "horarios_user_id_asesores_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "comercial"."asesores"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."horarios" ADD CONSTRAINT "horarios_location_id_subcuentas_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "comercial"."subcuentas"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."mapa_etapas" ADD CONSTRAINT "mapa_etapas_location_id_subcuentas_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "comercial"."subcuentas"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."permisos_usuario" ADD CONSTRAINT "permisos_usuario_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "comercial"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."sesiones" ADD CONSTRAINT "sesiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "comercial"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."usuario_asesor" ADD CONSTRAINT "usuario_asesor_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "comercial"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."usuario_subcuenta" ADD CONSTRAINT "usuario_subcuenta_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "comercial"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial"."usuario_subcuenta" ADD CONSTRAINT "usuario_subcuenta_location_id_subcuentas_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "comercial"."subcuentas"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analisis_calidad_location" ON "comercial"."analisis_calidad" USING btree ("location_id","creado_en");--> statement-breakpoint
CREATE INDEX "analisis_calidad_muestra_huella_idx" ON "comercial"."analisis_calidad_muestra" USING btree ("huella");--> statement-breakpoint
CREATE INDEX "auditoria_cuando" ON "comercial"."auditoria" USING btree ("cuando");--> statement-breakpoint
CREATE INDEX "auditoria_que_cuando" ON "comercial"."auditoria" USING btree ("que","cuando");--> statement-breakpoint
CREATE INDEX "ausencias_location_user" ON "comercial"."ausencias" USING btree ("location_id","user_id");--> statement-breakpoint
CREATE INDEX "eventos_location_tipo_fecha" ON "comercial"."eventos" USING btree ("location_id","tipo","ocurrido_en");--> statement-breakpoint
CREATE INDEX "eventos_contacto" ON "comercial"."eventos" USING btree ("location_id","contact_id","ocurrido_en");--> statement-breakpoint
CREATE INDEX "eventos_oportunidad" ON "comercial"."eventos" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "eventos_asesor_fecha" ON "comercial"."eventos" USING btree ("asesor_id","ocurrido_en");--> statement-breakpoint
CREATE INDEX "historial_etapas_oportunidad" ON "comercial"."historial_etapas" USING btree ("opportunity_id","desde");--> statement-breakpoint
CREATE INDEX "historial_etapas_contacto" ON "comercial"."historial_etapas" USING btree ("location_id","contact_id","desde");--> statement-breakpoint
CREATE INDEX "horarios_location_user" ON "comercial"."horarios" USING btree ("location_id","user_id");--> statement-breakpoint
CREATE INDEX "leads_location_ingreso" ON "comercial"."leads" USING btree ("location_id","ingreso_en");--> statement-breakpoint
CREATE INDEX "leads_asesor_ingreso" ON "comercial"."leads" USING btree ("asesor_id","ingreso_en");--> statement-breakpoint
CREATE INDEX "mensajes_conversacion_fecha" ON "comercial"."mensajes" USING btree ("conversation_id","fecha");--> statement-breakpoint
CREATE INDEX "mensajes_contacto_fecha" ON "comercial"."mensajes" USING btree ("location_id","contact_id","fecha");--> statement-breakpoint
CREATE INDEX "oportunidades_location_status_cambio" ON "comercial"."oportunidades" USING btree ("location_id","status","cambio_estado_en");--> statement-breakpoint
CREATE INDEX "oportunidades_contacto" ON "comercial"."oportunidades" USING btree ("location_id","contact_id");--> statement-breakpoint
CREATE INDEX "oportunidades_venta" ON "comercial"."oportunidades" USING btree ("location_id","venta_en");--> statement-breakpoint
CREATE INDEX "resumen_diario_fecha_location" ON "comercial"."resumen_diario" USING btree ("fecha","location_id");--> statement-breakpoint
CREATE INDEX "sesiones_usuario" ON "comercial"."sesiones" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "sync_ejecuciones_location_inicio" ON "comercial"."sync_ejecuciones" USING btree ("location_id","inicio");--> statement-breakpoint
CREATE INDEX "tareas_location_vence" ON "comercial"."tareas" USING btree ("location_id","vence_en");
--> statement-breakpoint
-- Particiones mensuales de "mensajes" (editado a mano: Drizzle no modela particiones).
-- No hay partición por defecto: insertar fuera de un mes creado falla de forma visible.
-- El worker llama a esta función antes de cada carga. SECURITY DEFINER para que el rol del worker
-- pueda crear particiones sin tener permiso CREATE en el esquema.
CREATE OR REPLACE FUNCTION "comercial"."asegurar_particiones_mensajes"(desde date, meses integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, comercial
AS $$
DECLARE
  inicio date;
  fin date;
  nombre text;
  creadas integer := 0;
BEGIN
  FOR i IN 0 .. meses - 1 LOOP
    inicio := (date_trunc('month', desde) + make_interval(months => i))::date;
    fin := (inicio + interval '1 month')::date;
    nombre := format('mensajes_%s', to_char(inicio, 'YYYY_MM'));
    IF to_regclass(format('comercial.%I', nombre)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE comercial.%I PARTITION OF comercial.mensajes FOR VALUES FROM (%L) TO (%L)',
        nombre, inicio::text || ' 00:00:00+00', fin::text || ' 00:00:00+00'
      );
      creadas := creadas + 1;
    END IF;
  END LOOP;
  RETURN creadas;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "comercial"."asegurar_particiones_mensajes"(date, integer) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'comercial_worker') THEN
    GRANT EXECUTE ON FUNCTION "comercial"."asegurar_particiones_mensajes"(date, integer) TO comercial_worker;
  END IF;
END $$;
--> statement-breakpoint
-- Cubre la carga histórica de 90 días y los próximos meses.
SELECT "comercial"."asegurar_particiones_mensajes"((current_date - interval '4 months')::date, 7);
