CREATE TABLE "comercial"."ajustes" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" jsonb NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por" uuid
);
--> statement-breakpoint
ALTER TABLE "comercial"."ajustes" ADD CONSTRAINT "ajustes_actualizado_por_usuarios_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "comercial"."usuarios"("id") ON DELETE set null ON UPDATE no action;