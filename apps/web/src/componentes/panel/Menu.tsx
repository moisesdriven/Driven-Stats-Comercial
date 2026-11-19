import { NOMBRES_ROL } from '@driven/core';
import { BotonSalir } from '@/componentes/BotonSalir';
import { iniciales } from '@/lib/formato';
import { textoEstado, tonoDe } from '@/lib/semaforo';
import { IconoTono } from './Bloques';
import type { ContextoAcceso } from '@/servidor/acceso';
import type { SubcuentaMenu } from '@/servidor/consultas/menu';
import { EnlaceMenu } from './EnlaceMenu';
import { BotonContraer, BotonTema } from './MarcoPanel';
import {
  IconoAsesor,
  IconoEngranaje,
  IconoEscudo,
  IconoGeneral,
  IconoMetas,
  IconoReloj,
  IconoSubcuenta,
  IconoTendencia,
} from './Iconos';

/** Menú lateral: solo muestra los módulos a los que el usuario tiene acceso (§10.1). */
export function Menu({ ctx, subcuentas }: { ctx: ContextoAcceso; subcuentas: SubcuentaMenu[] }) {
  const m = ctx.modulos;
  const primera = subcuentas[0]?.locationId;
  const verAsesores = m.detalle_asesores !== 'ninguno' && primera;
  const enlaceAsesores =
    ctx.rol === 'asesor' && ctx.userIdGhl
      ? `/subcuentas/${primera}/asesores/${ctx.userIdGhl}`
      : '/asesores';
  const admin = m.usuarios !== 'ninguno' || m.configuracion !== 'ninguno';
  const nombreSubcuenta =
    ctx.rol === 'admin'
      ? 'Todas las subcuentas'
      : subcuentas.length === 1
        ? subcuentas[0]!.nombre
        : `${subcuentas.length} subcuentas`;
  return (
    <nav id="menu-lateral" aria-label="Navegación principal" className="menu">
      <div className="menu__marca">
        <div className="menu__logo">
          <IconoTendencia />
        </div>
        <div className="menu__textos-marca">
          <span className="menu__nombre">Driven Comercial</span>
          <span className="menu__lema">Medición de equipos</span>
        </div>
        <BotonContraer />
      </div>
      <div className="menu__grupo">
        <span className="menu__titulo">Vistas</span>
        {m.vista_general !== 'ninguno' && (
          <EnlaceMenu href="/" clase="menu__enlace" exacto titulo="Vista general">
            <IconoGeneral /> <span className="menu__texto">Vista general</span>
          </EnlaceMenu>
        )}
        {m.vista_subcuenta !== 'ninguno' && primera && (
          <EnlaceMenu
            href="/subcuentas"
            clase="menu__enlace"
            titulo="Subcuentas"
            salvo="/asesores/"
          >
            <IconoSubcuenta /> <span className="menu__texto">Subcuentas</span>
          </EnlaceMenu>
        )}
        {verAsesores && (
          <EnlaceMenu
            href={enlaceAsesores}
            clase="menu__enlace"
            conSubcuenta={enlaceAsesores === '/asesores'}
            tambien="/asesores/"
            titulo={ctx.rol === 'asesor' ? 'Mi detalle' : 'Asesores'}
          >
            <IconoAsesor />{' '}
            <span className="menu__texto">{ctx.rol === 'asesor' ? 'Mi detalle' : 'Asesores'}</span>
          </EnlaceMenu>
        )}
        {m.horarios !== 'ninguno' && primera && (
          <EnlaceMenu href="/horarios" clase="menu__enlace" titulo="Horarios" conSubcuenta>
            <IconoReloj /> <span className="menu__texto">Horarios</span>
          </EnlaceMenu>
        )}
        {m.metas !== 'ninguno' && primera && (
          <EnlaceMenu href="/metas" clase="menu__enlace" titulo="Metas y etapas" conSubcuenta>
            <IconoMetas /> <span className="menu__texto">Metas y etapas</span>
          </EnlaceMenu>
        )}
      </div>
      {admin && (
        <div className="menu__grupo menu__grupo--secundario">
          <span className="menu__titulo">Administración</span>
          {m.usuarios !== 'ninguno' && (
            <EnlaceMenu href="/usuarios" clase="menu__enlace" titulo="Usuarios y accesos">
              <IconoEscudo /> <span className="menu__texto">Usuarios y accesos</span>
            </EnlaceMenu>
          )}
          {m.configuracion !== 'ninguno' && (
            <EnlaceMenu href="/configuracion" clase="menu__enlace" titulo="Configuración">
              <IconoEngranaje /> <span className="menu__texto">Configuración</span>
            </EnlaceMenu>
          )}
        </div>
      )}
      {m.vista_subcuenta !== 'ninguno' && subcuentas.length > 0 && (
        <div className="menu__grupo menu__grupo--secundario menu__grupo--subcuentas">
          <span className="menu__titulo">Subcuentas</span>
          {subcuentas.map((s) => (
            <EnlaceMenu
              key={s.locationId}
              href={`/subcuentas/${s.locationId}`}
              clase="menu__subcuenta"
            >
              <span>{s.nombre}</span>
              <span className={`estado estado--${tonoDe(s.peor)}`} title={textoEstado(s.peor)}>
                <IconoTono tono={tonoDe(s.peor)} />
                <span className="oculto">({textoEstado(s.peor)})</span>
              </span>
            </EnlaceMenu>
          ))}
        </div>
      )}
      <div className="menu__grupo menu__grupo--tema">
        <BotonTema />
      </div>
      <div className="menu__usuario">
        <div className="menu__avatar" aria-hidden="true">
          {iniciales(ctx.nombre)}
        </div>
        <div className="menu__datos-usuario">
          <span style={{ fontSize: 13, fontWeight: 600 }}>{ctx.nombre}</span>
          <span style={{ fontSize: 12, color: 'var(--gris)' }}>
            {NOMBRES_ROL[ctx.rol]} · {nombreSubcuenta}
          </span>
        </div>
        <BotonSalir clase="menu__salir" texto="Salir" />
      </div>
    </nav>
  );
}
