import { useEffect, useRef, useState } from 'react';
import { almacen } from '../offline/almacen-local';
import { hayPendientes } from '../offline/cola-sync';
import type { MotorSync } from '../offline/motor-sync';

/**
 * Indicador permanente de pendientes (feature #15, R5, R7).
 *
 * - Se enciende con CUALQUIER operación no confirmada y NO se apaga hasta
 *   que el backend confirme cada una (R5).
 * - Disparadores: evento `online`, botón manual «Sincronizar ahora» y
 *   apertura — todos comparten el MISMO motor (R7, sin duplicar).
 */
export interface EstadoSync {
  pendientes: number;
  conflictos: number;
  sincronizando: boolean;
  enLinea: boolean;
  sincronizarAhora: () => Promise<void>;
}

export function useSync(motor: MotorSync | null): EstadoSync {
  const [pendientes, setPendientes] = useState(0);
  const [conflictos, setConflictos] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const motorRef = useRef(motor);
  motorRef.current = motor;

  useEffect(() => {
    let activo = true;

    const contar = async () => {
      const cola = await almacen.listarCola();
      if (!activo) return;
      setPendientes(cola.filter((o) => o.estado !== 'confirmada').length);
      setConflictos(cola.filter((o) => o.estado === 'conflicto').length);
    };
    void contar();

    const enLineaHandler = () => {
      setEnLinea(true);
      void sincronizarAhora();
    };
    const fueraDeLineaHandler = () => setEnLinea(false);

    window.addEventListener('online', enLineaHandler);
    window.addEventListener('offline', fueraDeLineaHandler);
    return () => {
      activo = false;
      window.removeEventListener('online', enLineaHandler);
      window.removeEventListener('offline', fueraDeLineaHandler);
    };
  }, []);

  const sincronizarAhora = async () => {
    const actual = motorRef.current;
    if (!actual) return;
    if (!navigator.onLine) return;
    setSincronizando(true);
    try {
      await actual.sincronizar();
    } finally {
      const cola = await almacen.listarCola();
      setPendientes(cola.filter((o) => o.estado !== 'confirmada').length);
      setConflictos(cola.filter((o) => o.estado === 'conflicto').length);
      setSincronizando(false);
    }
  };

  return { pendientes, conflictos, sincronizando, enLinea, sincronizarAhora };
}

export { hayPendientes };
