import { forbidden } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { AdminUsuarios, type UsuarioUI } from '@/componentes/panel/AdminUsuarios';
import { haceCuanto, nombreCorto } from '@/lib/formato';
import { obtenerDb } from '@/servidor/db';
import { enPagina, requerirModuloPagina } from '@/servidor/pagina';
import { listarUsuarios } from '@/servidor/usuarios';

export const metadata = { title: 'Usuarios y accesos · Driven Comercial' };

export default async function Usuarios() {
  const { ctx } = await requerirModuloPagina('usuarios', 'editar');
  if (ctx.rol !== 'admin') forbidden();
  const db = obtenerDb();
  const [usuarios, subs, asesores] = await Promise.all([
    enPagina(listarUsuarios(db, ctx)),
    db.execute<{ location_id: string; nombre: string }>(
      sql`select location_id, nombre from comercial.subcuentas order by nombre`,
    ),
    db.execute<{ user_id: string; nombre: string; subcuentas: string[] }>(sql`
      select a.user_id, a.nombre, array_agg(s.location_id) as subcuentas
      from comercial.asesores a join comercial.asesor_subcuenta s on s.user_id = a.user_id
      group by a.user_id, a.nombre order by a.nombre`),
  ]);
  const lista: UsuarioUI[] = usuarios.map((u) => ({
    id: u.id,
    correo: u.correo,
    nombre: u.nombre,
    rol: u.rol,
    activo: u.activo,
    subcuentas: u.subcuentas,
    excepciones: u.excepciones as UsuarioUI['excepciones'],
    userIdGhl: u.userIdGhl,
    totpActivo: u.totpActivo,
    ingreso: haceCuanto(u.ultimoIngreso),
  }));
  return (
    <AdminUsuarios
      usuarios={lista}
      subcuentas={subs.rows.map((s) => ({ id: s.location_id, nombre: s.nombre }))}
      asesores={asesores.rows.map((a) => ({
        userId: a.user_id,
        nombre: nombreCorto(a.nombre),
        subcuentas: a.subcuentas,
      }))}
      yo={ctx.usuarioId}
    />
  );
}
