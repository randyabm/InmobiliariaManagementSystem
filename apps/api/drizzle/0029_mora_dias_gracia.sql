-- 0029_mora_dias_gracia — #30 (PA-30-3): días de gracia configurables por
-- tenant para la morosidad (RF-PA13).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'config_renovacion'
      AND column_name = 'dias_gracia'
  ) THEN
    ALTER TABLE "config_renovacion" ADD COLUMN "dias_gracia" integer NOT NULL DEFAULT 5;
  END IF;
END $$;
--> statement-breakpoint
