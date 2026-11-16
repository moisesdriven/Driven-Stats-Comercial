import { describe, expect, it } from 'vitest';
import {
  intervalosDesdeActividades,
  transicionesOportunidad,
  type FotoOportunidad,
} from './oportunidades';

const t = (h: number) => new Date(Date.UTC(2026, 10, 10, h));
const foto = (
  stageId: string,
  etapaEstandar: FotoOportunidad['etapaEstandar'],
  status: FotoOportunidad['status'] = 'open',
): FotoOportunidad => ({ stageId, etapaEstandar, status });
const sinVenta = { ventaEn: null, ventaCanceladaEn: null };

describe('transicionesOportunidad', () => {
  it('oportunidad nueva: cambio de etapa inicial, sin venta', () => {
    const r = transicionesOportunidad({
      anterior: null,
      actual: foto('nuevo', 'nuevo'),
      venta: sinVenta,
      enEtapa: t(1),
      enEstado: t(1),
    });
    expect(r.eventos.map((e) => e.tipo)).toEqual(['cambio_etapa']);
    expect(r.venta.ventaEn).toBeNull();
  });

  it('entrar a Adelanto (mapeada como ganado) es venta, con la fecha del cambio de etapa', () => {
    const r = transicionesOportunidad({
      anterior: foto('cotizado', 'por_cerrar'),
      actual: foto('adelanto', 'ganado'),
      venta: sinVenta,
      enEtapa: t(5),
      enEstado: t(1),
    });
    expect(r.eventos.map((e) => e.tipo)).toEqual(['cambio_etapa', 'venta']);
    expect(r.venta.ventaEn).toEqual(t(5));
  });

  it('avanzar dentro de las etapas ganadas no duplica la venta', () => {
    const r = transicionesOportunidad({
      anterior: foto('adelanto', 'ganado'),
      actual: foto('produccion', 'ganado'),
      venta: { ventaEn: t(5), ventaCanceladaEn: null },
      enEtapa: t(8),
      enEstado: t(1),
    });
    expect(r.eventos.map((e) => e.tipo)).toEqual(['cambio_etapa']);
  });

  it('marcar won sin etapa ganada también es venta (fecha del cambio de estado)', () => {
    const r = transicionesOportunidad({
      anterior: foto('cotizado', 'por_cerrar'),
      actual: foto('cotizado', 'por_cerrar', 'won'),
      venta: sinVenta,
      enEtapa: t(2),
      enEstado: t(6),
    });
    expect(r.eventos.map((e) => e.tipo)).toEqual(['venta']);
    expect(r.venta.ventaEn).toEqual(t(6));
  });

  it('una venta que vuelve a Cotizado se cancela', () => {
    const r = transicionesOportunidad({
      anterior: foto('adelanto', 'ganado'),
      actual: foto('cotizado', 'por_cerrar'),
      venta: { ventaEn: t(5), ventaCanceladaEn: null },
      enEtapa: t(9),
      enEstado: t(1),
    });
    expect(r.eventos.map((e) => e.tipo)).toEqual(['cambio_etapa', 'venta_cancelada']);
    expect(r.venta.ventaCanceladaEn).toEqual(t(9));
  });

  it('una venta que termina perdida se cancela y cuenta como pérdida', () => {
    const r = transicionesOportunidad({
      anterior: foto('adelanto', 'ganado'),
      actual: foto('adelanto', 'ganado', 'lost'),
      venta: { ventaEn: t(5), ventaCanceladaEn: null },
      enEtapa: t(5),
      enEstado: t(10),
    });
    expect(r.eventos.map((e) => e.tipo)).toEqual(['perdida', 'venta_cancelada']);
    expect(r.venta.ventaCanceladaEn).toEqual(t(10));
  });

  it('una cancelada que vuelve a Adelanto es una venta nueva', () => {
    const r = transicionesOportunidad({
      anterior: foto('cotizado', 'por_cerrar'),
      actual: foto('adelanto', 'ganado'),
      venta: { ventaEn: t(5), ventaCanceladaEn: t(9) },
      enEtapa: t(12),
      enEstado: t(1),
    });
    expect(r.eventos.map((e) => e.tipo)).toEqual(['cambio_etapa', 'venta']);
    expect(r.venta).toEqual({ ventaEn: t(12), ventaCanceladaEn: null });
  });

  it('pérdida y reapertura', () => {
    const p = transicionesOportunidad({
      anterior: foto('contactado', 'contactado'),
      actual: foto('contactado', 'contactado', 'abandoned'),
      venta: sinVenta,
      enEtapa: t(1),
      enEstado: t(3),
    });
    expect(p.eventos).toEqual([{ tipo: 'perdida', en: t(3), etapa: 'contactado' }]);
    const r = transicionesOportunidad({
      anterior: foto('contactado', 'contactado', 'lost'),
      actual: foto('contactado', 'contactado'),
      venta: sinVenta,
      enEtapa: t(1),
      enEstado: t(4),
    });
    expect(r.eventos.map((e) => e.tipo)).toEqual(['reapertura']);
  });
});

describe('intervalosDesdeActividades', () => {
  it('arma intervalos consecutivos y deja abierto el último', () => {
    const r = intervalosDesdeActividades([
      { opportunityId: 'o1', en: t(3), etapaAnterior: 'Nuevo', etapaNueva: 'Contactado' },
      { opportunityId: 'o1', en: t(1), etapaAnterior: null, etapaNueva: 'Nuevo' },
      { opportunityId: 'o1', en: t(7), etapaAnterior: 'Contactado', etapaNueva: 'Cotizado' },
      { opportunityId: 'o2', en: t(2), etapaAnterior: null, etapaNueva: 'Nuevo' },
    ]);
    expect(r.filter((i) => i.opportunityId === 'o1')).toEqual([
      { opportunityId: 'o1', etapa: 'Nuevo', desde: t(1), hasta: t(3) },
      { opportunityId: 'o1', etapa: 'Contactado', desde: t(3), hasta: t(7) },
      { opportunityId: 'o1', etapa: 'Cotizado', desde: t(7), hasta: null },
    ]);
    expect(r.filter((i) => i.opportunityId === 'o2')).toHaveLength(1);
  });

  it('ignora actividades repetidas de la misma etapa', () => {
    const r = intervalosDesdeActividades([
      { opportunityId: 'o1', en: t(1), etapaAnterior: null, etapaNueva: 'Nuevo' },
      { opportunityId: 'o1', en: t(2), etapaAnterior: 'Nuevo', etapaNueva: 'Nuevo' },
    ]);
    expect(r).toHaveLength(1);
  });
});
