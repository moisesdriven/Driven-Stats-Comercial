ALTER TABLE "comercial"."resumen_diario" DROP CONSTRAINT "resumen_diario_fecha_location_asesor";--> statement-breakpoint
ALTER TABLE "comercial"."resumen_diario" ADD COLUMN "canal" text;--> statement-breakpoint
ALTER TABLE "comercial"."resumen_diario" ADD CONSTRAINT "resumen_diario_fecha_location_asesor_canal" UNIQUE NULLS NOT DISTINCT("fecha","location_id","asesor_id","canal");