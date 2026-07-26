import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { CuentasBancariasController } from './cuentas-bancarias.controller';
import { CuentasBancariasRepository } from './cuentas-bancarias.repository';
import { CuentasBancariasService } from './cuentas-bancarias.service';
import { IdentidadService } from './identidad.service';
import { InquilinosController } from './inquilinos.controller';
import { InquilinosRepository } from './inquilinos.repository';
import { InquilinosService } from './inquilinos.service';
import { PropietariosController } from './propietarios.controller';
import { PropietariosRepository } from './propietarios.repository';
import { PropietariosService } from './propietarios.service';

/**
 * Hoja de vida de propietario e inquilino (feature #5).
 *
 * Vive dentro de `core/` y no como `modules/clientes/` porque es
 * funcionalidad **Core** del PRD (§6.2), no un paquete comercial
 * desactivable, y porque la feature #6 (`properties`) necesitará resolver la
 * cuenta de giro del propietario: `properties → core/clientes` es una
 * dependencia legal, mientras que entre módulos hermanos habría que inventar
 * un contrato (design.md §2).
 *
 * `CuentasBancariasService` se exporta porque es el punto de extensión que
 * consumirá la feature #6 (`resolverCuentaDeGiro`, design.md §6).
 *
 * La feature #25 **extiende este mismo módulo** (retención, codeudores y
 * referencias); no crea uno paralelo.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    PropietariosController,
    CuentasBancariasController,
    InquilinosController,
  ],
  providers: [
    IdentidadService,
    PropietariosRepository,
    PropietariosService,
    CuentasBancariasRepository,
    CuentasBancariasService,
    InquilinosRepository,
    InquilinosService,
  ],
  exports: [CuentasBancariasService, PropietariosService, InquilinosService],
})
export class ClientesModule {}
