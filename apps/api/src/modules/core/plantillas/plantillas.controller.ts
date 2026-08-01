import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type {
  PlantillaCompleta,
  PlantillaInmueble,
  PlantillaItem,
  PlantillaZona,
} from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  type ActualizarItemDto,
  type ActualizarZonaDto,
  type CrearItemDto,
  type CrearZonaDto,
  esquemaActualizarItem,
  esquemaActualizarZona,
  esquemaItem,
  esquemaZona,
} from './dto/plantillas.dto';
import { PlantillasService } from './plantillas.service';

/**
 * Plantillas de inmuebles (feature #11, RF-I22/RF-I23).
 *
 * Lectura: admin/empleado. **Gestión (clonar, zonas, ítems): solo `admin`**
 * (PA-11-4). `@Audit` en las mutaciones con `metadata` vacío (R13).
 */
@Controller('plantillas')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class PlantillasController {
  constructor(private readonly plantillas: PlantillasService) {}

  @Get()
  async listar(@Req() request: unknown): Promise<PlantillaInmueble[]> {
    return this.plantillas.listar(construirContextoPeticion(request));
  }

  @Get(':id')
  async obtener(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<PlantillaCompleta> {
    return this.plantillas.obtener(id, construirContextoPeticion(request));
  }

  /** R5. */
  @Roles('admin')
  @Post(':id/clonar')
  @Audit('crear', 'plantilla_inmueble')
  async clonar(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<PlantillaInmueble> {
    return this.plantillas.clonar(id, construirContextoPeticion(request));
  }

  /** R7. */
  @Roles('admin')
  @Post(':id/zonas')
  @Audit('crear', 'plantilla_zona')
  async crearZona(
    @Param('id') plantillaId: string,
    @Body(new ZodValidationPipe(esquemaZona)) dto: CrearZonaDto,
    @Req() request: unknown,
  ): Promise<PlantillaZona> {
    return this.plantillas.crearZona(
      plantillaId,
      {
        nombre: dto.nombre,
        repetible: dto.repetible,
        obligatoria: dto.obligatoria,
        orden: dto.orden,
      },
      construirContextoPeticion(request),
    );
  }

  /** R7. */
  @Roles('admin')
  @Patch(':id/zonas/:idZona')
  @Audit('actualizar', 'plantilla_zona')
  async actualizarZona(
    @Param('id') plantillaId: string,
    @Param('idZona') idZona: string,
    @Body(new ZodValidationPipe(esquemaActualizarZona)) dto: ActualizarZonaDto,
    @Req() request: unknown,
  ): Promise<PlantillaZona> {
    return this.plantillas.actualizarZona(
      plantillaId,
      idZona,
      dto,
      construirContextoPeticion(request),
    );
  }

  /** R7 — baja lógica. */
  @Roles('admin')
  @Delete(':id/zonas/:idZona')
  @Audit('baja', 'plantilla_zona')
  async darDeBajaZona(
    @Param('id') plantillaId: string,
    @Param('idZona') idZona: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.plantillas.darDeBajaZona(
      plantillaId,
      idZona,
      construirContextoPeticion(request),
    );
  }

  /** R8, R9. */
  @Roles('admin')
  @Post(':id/zonas/:idZona/items')
  @Audit('crear', 'plantilla_item')
  async crearItem(
    @Param('idZona') zonaId: string,
    @Body(new ZodValidationPipe(esquemaItem)) dto: CrearItemDto,
    @Req() request: unknown,
  ): Promise<PlantillaItem> {
    return this.plantillas.crearItem(
      zonaId,
      {
        nombre: dto.nombre,
        fieldType: dto.field_type,
        opcionesJson: dto.opciones_json ?? null,
        obligatorio: dto.obligatorio,
        fotoObligatoria: dto.foto_obligatoria,
        orden: dto.orden,
      },
      construirContextoPeticion(request),
    );
  }

  /** R8, R9. */
  @Roles('admin')
  @Patch(':id/zonas/:idZona/items/:idItem')
  @Audit('actualizar', 'plantilla_item')
  async actualizarItem(
    @Param('idZona') idZona: string,
    @Param('idItem') idItem: string,
    @Body(new ZodValidationPipe(esquemaActualizarItem)) dto: ActualizarItemDto,
    @Req() request: unknown,
  ): Promise<PlantillaItem> {
    return this.plantillas.actualizarItem(
      idZona,
      idItem,
      {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.field_type !== undefined ? { fieldType: dto.field_type } : {}),
        ...(dto.opciones_json !== undefined
          ? { opcionesJson: dto.opciones_json }
          : {}),
        ...(dto.obligatorio !== undefined ? { obligatorio: dto.obligatorio } : {}),
        ...(dto.foto_obligatoria !== undefined
          ? { fotoObligatoria: dto.foto_obligatoria }
          : {}),
        ...(dto.orden !== undefined ? { orden: dto.orden } : {}),
      },
      construirContextoPeticion(request),
    );
  }

  /** R8 — baja lógica. */
  @Roles('admin')
  @Delete(':id/zonas/:idZona/items/:idItem')
  @Audit('baja', 'plantilla_item')
  async darDeBajaItem(
    @Param('idZona') idZona: string,
    @Param('idItem') idItem: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.plantillas.darDeBajaItem(
      idZona,
      idItem,
      construirContextoPeticion(request),
    );
  }
}
