import { NOMBRES_ROL } from '@driven/core';
import { BotonSalir } from '@/componentes/BotonSalir';
import { iniciales } from '@/lib/formato';
import { tonoDe } from '@/lib/semaforo';
import type { ContextoAcceso } from '@/servidor/acceso';
import type { SubcuentaMenu } from '@/servidor/consultas/menu';
import { EnlaceMenu } from './EnlaceMenu';
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
      : `/subcuentas/${primera}#asesores`;
  const admin = m.usuarios !== 'ninguno' || m.configuracion !== 'ninguno';
  const nombreSubcuenta =
    ctx.rol === 'admin'
      ? 'Todas las subcuentas'
      : subcuentas.length === 1
        ? subcuentas[0]!.nombre
        : `${subcuentas.length} subcuentas`;
  return (
    <nav aria-label="Navegación principal" className="menu">
      <div className="menu__marca">
        <div className="menu__logo">
          <IconoTendencia />
        </div>
        <div>
          <span className="menu__nombre">Driven Comercial</span>
          <span className="menu__lema">Medición de equipos</span>
        </div>
      </div>
      <div className="menu__grupo">
        <span className="menu__titulo">Vistas</span>
        {m.vista_general !== 'ninguno' && (
          <EnlaceMenu href="/" clase="menu__enlace" exacto>
            <IconoGeneral /> Vista general
          </EnlaceMenu>
        )}
        {m.vista_subcuenta !== 'ninguno' && primera && (
          <EnlaceMenu href="/subcuentas" clase="menu__enlace">
            <IconoSubcuenta /> Subcuentas
          </EnlaceMenu>
        )}
        {verAsesores && (
          <EnlaceMenu href={enlaceAsesores} clase="menu__enlace">
            <IconoAsesor /> {ctx.rol === 'asesor' ? 'Mi detalle' : 'Asesores'}
          </EnlaceMenu>
        )}
        {m.horarios !== 'ninguno' && primera && (
          <EnlaceMenu href="/horarios" clase="menu__enlace">
            <IconoReloj /> Horarios
          </EnlaceMenu>
        )}
        {m.metas !== 'ninguno' && primera && (
          <EnlaceMenu href="/metas" clase="menu__enlace">
            <IconoMetas /> Metas y etapas
          </EnlaceMenu>
        )}
      </div>
      {admin && (
        <div className="menu__grupo">
          <span className="menu__titulo">Administración</span>
          {m.usuarios !== 'ninguno' && (
            <EnlaceMenu href="/usuarios" clase="menu__enlace">
              <IconoEscudo /> Usuarios y accesos
            </EnlaceMenu>
          )}
          {m.configuracion !== 'ninguno' && (
            <EnlaceMenu href="/configuracion" clase="menu__enlace">
              <IconoEngranaje /> Configuración
            </EnlaceMenu>
          )}
        </div>
      )}
      {m.vista_subcuenta !== 'ninguno' && subcuentas.length > 0 && (
        <div className="menu__grupo">
          <span className="menu__titulo">Subcuentas</span>
          {subcuentas.map((s) => (
            <EnlaceMenu
              key={s.locationId}
              href={`/subcuentas/${s.locationId}`}
              clase="menu__subcuenta"
            >
              <span>{s.nombre}</span>
              <span className={`punto punto--${tonoDe(s.peor)}`} aria-hidden="true" />
            </EnlaceMenu>
          ))}
        </div>
      )}
      <div className="menu__usuario">
        <div className="menu__avatar" aria-hidden="true">
          {iniciales(ctx.nombre)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{ctx.nombre}</span>
          <span style={{ fontSize: 12, color: '#9AA3B5' }}>
            {NOMBRES_ROL[ctx.rol]} · {nombreSubcuenta}
          </span>
        </div>
        <BotonSalir clase="menu__salir" texto="Salir" />
      </div>
    </nav>
  );
}
