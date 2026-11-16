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
