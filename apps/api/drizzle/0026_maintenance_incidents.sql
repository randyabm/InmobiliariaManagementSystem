-- 0026_maintenance_incidents — #31: autogestión de reclamos y reparaciones
-- (RF-M1..M7, §6.5). Los tickets SON instancias del motor de #7
-- (PA-31-1): esta migración solo siembra la definición.

DO $$
DECLARE
  v_def uuid;
  v_rec uuid; v_asig uuid; v_curso uuid; v_repuesto uuid;
  v_resuelta uuid; v_cerrada uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "workflow_definicion" WHERE "tipo" = 'incidencias'
  ) THEN
    INSERT INTO "workflow_definicion"
      (tenant_id, nombre, tipo, origen, version)
    VALUES ('00000000-0000-0000-0000-000000000000',
            'Reclamos y reparaciones', 'incidencias', 'SISTEMA', 1)
    RETURNING id INTO v_def;

    INSERT INTO "workflow_estado"
      (definicion_id, clave, etiqueta, es_inicial, es_final, orden)
    VALUES
      (v_def, 'recibida',            'Recibida',            true,  false, 10),
      (v_def, 'asignada',            'Asignada',            false, false, 20),
      (v_def, 'en_curso',            'En curso',            false, false, 30),
      (v_def, 'en_espera_repuesto',  'En espera de repuesto', false, false, 40),
      (v_def, 'resuelta',            'Resuelta',            false, false, 50),
      (v_def, 'cerrada',             'Cerrada',             false, true,  60);

    SELECT id INTO v_rec FROM "workflow_estado" WHERE definicion_id = v_def AND clave = 'recibida';
    SELECT id INTO v_asig FROM "workflow_estado" WHERE definicion_id = v_def AND clave = 'asignada';
    SELECT id INTO v_curso FROM "workflow_estado" WHERE definicion_id = v_def AND clave = 'en_curso';
    SELECT id INTO v_repuesto FROM "workflow_estado" WHERE definicion_id = v_def AND clave = 'en_espera_repuesto';
    SELECT id INTO v_resuelta FROM "workflow_estado" WHERE definicion_id = v_def AND clave = 'resuelta';
    SELECT id INTO v_cerrada FROM "workflow_estado" WHERE definicion_id = v_def AND clave = 'cerrada';

    INSERT INTO "workflow_transicion"
      (definicion_id, origen_estado_id, destino_estado_id, clave,
       tipo_ejecucion, roles_requeridos, condicion, orden)
    VALUES
      (v_def, v_rec,     v_asig,    'asignar',            'HUMANA', ARRAY['admin','empleado'], '[]', 10),
      (v_def, v_asig,    v_curso,   'aprobar_costos',     'HUMANA', ARRAY['propietario'],      '[]', 20),
      (v_def, v_asig,    v_curso,   'iniciar_curso',      'HUMANA', ARRAY['admin','empleado'], '[]', 25),
      (v_def, v_curso,   v_repuesto,'esperar_repuesto',   'HUMANA', ARRAY['admin','empleado'], '[]', 30),
      (v_def, v_repuesto,v_curso,   'reanudar',           'HUMANA', ARRAY['admin','empleado'], '[]', 35),
      (v_def, v_curso,   v_resuelta,'marcar_resuelta',    'HUMANA', ARRAY['admin','empleado'], '[]', 40),
      (v_def, v_resuelta,v_cerrada, 'aceptar_resolucion', 'HUMANA', ARRAY['inquilino','propietario'], '[]', 50),
      (v_def, v_resuelta,v_curso,   'reabrir',            'HUMANA', ARRAY['inquilino','propietario'], '[]', 55);
  END IF;
END $$;
--> statement-breakpoint
