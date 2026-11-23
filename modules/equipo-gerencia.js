/**
 * modules/equipo-gerencia.js — T18: cuadro de mando integral del Gerente General
 * ─────────────────────────────────────────────────────────────────────────────
 * Pestaña "🧭 Gerencia General" del equipo. SOLO LECTURA:
 *   - GET /api/resultados → historial ronda a ronda (lo financiero de Motor 2 y lo
 *     físico de Motor 1 por producto, igual que KPIs);
 *   - GET /api/dashboard/:n → posición en el ranking de la ronda elegida, solo si el
 *     equipo compró investigación esa ronda (si no, 🔒).
 * No recalcula nada del motor: arma razones con campos que ya están en los
 * resultados. Cuatro perspectivas; cada indicador muestra el valor de la ronda, la
 * flecha frente a la ronda anterior y una línea con la evolución.
 *
 * Colores (decisión del docente, T18):
 *   - Utilidad neta, EBIT, margen neto, margen unitario: ≥ 0 verde, < 0 rojo.
 *   - Endeudamiento: ≤ 30 % verde, ≤ 50 % amarillo, > 50 % rojo.
 *   - Cobertura de la demanda asignada: ≥ 80 % verde, ≥ 50 % amarillo, < 50 % rojo.
 *   - Inventario / producción: ≤ 20 % verde, > 20 % rojo (mismo umbral que KPIs).
 *   - Caja: rojo con sobregiro o caja ≤ 0; amarillo si el flujo operativo neto de la
 *     ronda es negativo y la caja no cubre un trimestre más a ese ritmo; verde el resto.
 *   - El resto (participación, atractivo, marca, ventas por Bs de marketing, ROA, ROE,
 *     liquidez, utilización, crecimiento, personal): solo tendencia, sin color.
 *
 * Dependencias: api(), fmt, escapeHtml, costosUnitariosEquipo y
 * estructuraBalanceEquipo (ui-components.js).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const GER_VERDE = 'var(--accent5)', GER_AMARILLO = 'var(--accent3)', GER_ROJO = 'var(--accent4)';

async function loadEquipoGerencia() {
  const el = document.getElementById('eqGerenciaContent');
  if (!el) return;
  el.innerHTML = '<p style="padding:20px;color:var(--text3)">Cargando…</p>';
  let data;
  try {
    data = await api('GET', '/api/resultados');
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escapeHtml(e.message)}</p></div>`;
    return;
  }
  // La ronda 0 (balance inicial de la Fase 0) no tiene operación: se omite.
  const hist = (data.historial || []).filter(h => h.ronda > 0 && h.resultado && typeof h.resultado === 'object');
  if (!hist.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🧭</div><p>Aún no hay rondas simuladas.</p></div>';
    return;
  }
  window._gerHistorial = hist;
  const nav = hist.map(h => `<button class="ronda-btn simulated" data-ger-ronda="${h.ronda}" onclick="mostrarGerencia(${h.ronda})">Ronda ${h.ronda}</button>`).join('');
  el.innerHTML = `<div class="ronda-selector">${nav}</div><div id="gerDetalle"></div>`;
  mostrarGerencia(hist[hist.length - 1].ronda);
}

// Indicadores de una ronda. `prev` es la ronda anterior del historial (o null).
function metricasGerencia(item, prev) {
  const r = item.resultado;
  const n = (v) => Number(v) || 0;
  const prods = (Array.isArray(r.productos) && r.productos.length) ? r.productos : [r];
  const p1 = prods.find(p => (p.productoId || 'prod_1') === 'prod_1') || prods[0];
  const suma = (k) => prods.reduce((s, p) => s + n(p[k]), 0);
  const prom = (k, def) => prods.reduce((s, p) => s + (p[k] != null ? n(p[k]) : def), 0) / prods.length;
  const est = estructuraBalanceEquipo(r);
  const cu = costosUnitariosEquipo(r, item.decision);

  const ventasNetas = n(r.ventasNetas);
  const vendidas = suma('ventasReales'), demandaAsignada = suma('demandaAsignada');
  const produccion = suma('produccion'), inventario = suma('inventarioFinal');
  const mkt = suma('pagoMktTotal');
  const capOper = n(p1.capacidadEfectiva), capPlanta = n(p1.capacidadMaxProduccion);
  const capReal = (capOper > 0 && capPlanta > 0) ? Math.min(capOper, capPlanta) : (capOper || capPlanta);
  const vend = n(p1.vendedoresFinales);
  const prevVentas = prev ? n(prev.resultado.ventasNetas) : 0;

  // Margen unitario de la empresa: promedio de los productos ponderado por unidades vendidas.
  const conMargen = cu.productos.filter(x => x.margenUnit !== null && x.vendidas > 0);
  const vendConMargen = conMargen.reduce((s, x) => s + x.vendidas, 0);
  const margenUnit = vendConMargen > 0 ? conMargen.reduce((s, x) => s + x.margenUnit * x.vendidas, 0) / vendConMargen : null;

  // Caja: flujo operativo neto de la ronda (Motor 2). Si es negativo, cuántos
  // trimestres más cubre la caja a ese ritmo.
  const caja = n(r.cajaFinal);
  const flujoOp = (r.flujoOperativo === undefined || r.flujoOperativo === null) ? null : n(r.flujoOperativo);
  const trimestres = (flujoOp !== null && flujoOp < 0) ? caja / -flujoOp : null;
  const colorCaja = (est.sobregiro > 0 || caja <= 0) ? GER_ROJO
    : (trimestres !== null && trimestres < 1) ? GER_AMARILLO : GER_VERDE;

  return {
    utilidadNeta: n(r.utilidadNeta),
    ebit: n(r.ebit),
    margenNeto: ventasNetas > 0 ? n(r.utilidadNeta) / ventasNetas * 100 : null,
    caja, flujoOp, trimestres, colorCaja, sobregiro: est.sobregiro,
    endeudamiento: n(r.totalActivos) > 0 ? n(r.deudaFinal) / n(r.totalActivos) * 100 : null,
    liquidez: est.liquidez.valor,
    roa: n(r.totalActivos) > 0 ? n(r.utilidadNeta) / n(r.totalActivos) * 100 : null,
    // ROE solo con patrimonio positivo: con patrimonio ≤ 0 una pérdida daría un ROE positivo engañoso.
    roe: n(r.patrimonio) > 0 ? n(r.utilidadNeta) / n(r.patrimonio) * 100 : null,
    roeNoAplica: n(r.patrimonio) <= 0,
    participacion: prom('shareReal', 0) * 100,
    cobertura: demandaAsignada > 0 ? vendidas / demandaAsignada * 100 : null,
    marca: prom('brandEquityFinal', 50),
    atractivo: prom('atractivo', 0),
    crecimiento: prevVentas > 0 ? (ventasNetas / prevVentas - 1) * 100 : null,
    invProd: produccion > 0 ? inventario / produccion * 100 : null,
    margenUnit,
    ventasPorMkt: mkt > 0 ? ventasNetas / mkt : null,
    nominaUnidad: cu.nominaPorUnidad,
    utilizacion: capReal > 0 ? produccion / capReal * 100 : null,
    ventasPorVendedor: vend > 0 ? vendidas / vend : null,
    ingresosPorVendedor: vend > 0 ? ventasNetas / vend : null,
    operarios: n(p1.operariosFinales),
    vendedores: vend,
    capacitacion: n(r.gastoCapacitacion),
    innovacion: n(r.gastoInnovacion),
  };
}

// Definición de cada indicador: clave en metricasGerencia, formato y color (null = solo tendencia).
const GER_PERSPECTIVAS = [
  { titulo: '💰 Financiera', items: [
    { k: 'utilidadNeta', label: 'Utilidad neta', f: 'bs', color: v => v >= 0 ? GER_VERDE : GER_ROJO },
    { k: 'ebit', label: 'EBIT (utilidad operativa)', f: 'bs', color: v => v >= 0 ? GER_VERDE : GER_ROJO },
    { k: 'margenNeto', label: 'Margen neto', f: 'pct', color: v => v >= 0 ? GER_VERDE : GER_ROJO },
    { k: 'caja', label: 'Caja final', f: 'bs', caja: true },
    { k: 'endeudamiento', label: 'Endeudamiento (deuda ÷ activos)', f: 'pct', color: v => v <= 30 ? GER_VERDE : v <= 50 ? GER_AMARILLO : GER_ROJO },
    { k: 'liquidez', label: 'Liquidez corriente (activo ÷ pasivo corriente)', f: 'x', vacio: '∞ (sin pasivo corriente)' },
    { k: 'roa', label: 'ROA (utilidad ÷ activos)', f: 'pct' },
    { k: 'roe', label: 'ROE (utilidad ÷ patrimonio)', f: 'pct', noAplica: 'roeNoAplica' },
  ]},
  { titulo: '🎯 Clientes y mercado', items: [
    { k: 'participacion', label: 'Participación de mercado (promedio de productos)', f: 'pct' },
    { k: 'cobertura', label: 'Cobertura de la demanda asignada (ventas ÷ demanda asignada)', f: 'pct', color: v => v >= 80 ? GER_VERDE : v >= 50 ? GER_AMARILLO : GER_ROJO },
    { k: 'crecimiento', label: 'Crecimiento de ventas netas frente a la ronda anterior', f: 'pct', signo: true },
    { k: 'marca', label: 'Brand Equity (promedio)', f: 'd1' },
    { k: 'atractivo', label: 'Atractivo competitivo (promedio)', f: 'd2' },
    { k: 'ranking', label: 'Posición en el ranking', f: 'ranking' },
  ]},
  { titulo: '⚙️ Procesos internos', items: [
    { k: 'utilizacion', label: 'Utilización de capacidad (producción ÷ capacidad real)', f: 'pct' },
    { k: 'invProd', label: 'Inventario ÷ producción', f: 'pct', color: v => v <= 20 ? GER_VERDE : GER_ROJO },
    { k: 'margenUnit', label: 'Margen unitario sin IVA (promedio ponderado)', f: 'bs2', color: v => v >= 0 ? GER_VERDE : GER_ROJO },
    { k: 'ventasPorMkt', label: 'Ventas por Bs de marketing', f: 'x' },
    { k: 'nominaUnidad', label: 'Nómina por unidad producida', f: 'bs2' },
  ]},
  { titulo: '🌱 Aprendizaje y crecimiento', items: [
    { k: 'ventasPorVendedor', label: 'Ventas por vendedor (unid)', f: 'num' },
    { k: 'ingresosPorVendedor', label: 'Ingresos netos por vendedor', f: 'bs' },
    { k: 'operarios', label: 'Operarios', f: 'num' },
    { k: 'vendedores', label: 'Vendedores', f: 'num' },
    { k: 'capacitacion', label: 'Gasto en capacitación', f: 'bs' },
    { k: 'innovacion', label: 'Gasto en innovación', f: 'bs' },
  ]},
];

function gerFormato(v, f) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  switch (f) {
    case 'bs':  return fmt.bs(Math.round(v));
    case 'bs2': return 'Bs ' + fmt.d(v, 2);
    case 'pct': return fmt.d(v, 1) + ' %';
    case 'x':   return fmt.d(v, 2) + ' x';
    case 'd1':  return fmt.d(v, 1);
    case 'd2':  return fmt.d(v, 2);
    case 'num': return fmt.num(Math.round(v));
    default:    return String(v);
  }
}

// Flecha frente a la ronda anterior (solo indica el sentido del cambio, no si es bueno o malo).
function gerFlecha(v, ant) {
  if (v === null || ant === null || v === undefined || ant === undefined || !isFinite(v) || !isFinite(ant)) return '';
  if (Math.abs(v - ant) < 1e-9) return '<span style="color:var(--text3)">＝</span>';
  return v > ant ? '<span style="color:var(--text2)">▲</span>' : '<span style="color:var(--text2)">▼</span>';
}

// Línea de evolución (SVG simple): una marca por ronda hasta la elegida; los "—" se saltean.
function gerLinea(valores) {
  const pts = valores.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined && isFinite(v));
  if (pts.length < 2) return '';
  const W = 90, H = 22, xs = valores.length - 1 || 1;
  const vs = pts.map(p => p[1]), min = Math.min(...vs), max = Math.max(...vs), rango = (max - min) || 1;
  const coord = pts.map(([i, v]) => `${(i / xs * W).toFixed(1)},${(H - 2 - (v - min) / rango * (H - 4)).toFixed(1)}`).join(' ');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="vertical-align:middle"><polyline points="${coord}" fill="none" stroke="var(--accent3)" stroke-width="1.5"/></svg>`;
}

window.mostrarGerencia = async (n) => {
  const hist = window._gerHistorial || [];
  document.querySelectorAll('#eqGerenciaContent .ronda-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.gerRonda) === n));
  const idx = hist.findIndex(h => h.ronda === n);
  const det = document.getElementById('gerDetalle');
  if (idx < 0 || !det) return;
  const serie = hist.slice(0, idx + 1).map((h, i) => metricasGerencia(h, i > 0 ? hist[i - 1] : null));
  const m = serie[serie.length - 1];
  const ant = serie.length > 1 ? serie[serie.length - 2] : null;

  const fila = (it) => {
    let valor, color = 'var(--text)', extra = '';
    if (it.f === 'ranking') {
      return `<tr><td style="padding:7px 14px;color:var(--text2);font-size:.82rem">${it.label}</td>
        <td id="gerRanking" style="padding:7px 14px;font-family:var(--font-mono);font-size:.82rem;text-align:right;color:var(--text3)">…</td><td></td><td></td></tr>`;
    }
    const v = m[it.k];
    if (it.noAplica && m[it.noAplica]) {
      valor = 'No aplica (patrimonio ≤ 0)';
      color = 'var(--text3)';
    } else if (v === null && it.vacio) {
      valor = it.vacio;
      color = 'var(--text3)';
    } else {
      valor = gerFormato(v, it.f);
      if (it.signo && v !== null && v > 0) valor = '+' + valor;
      if (it.color && v !== null) color = it.color(v);
    }
    if (it.caja) {
      color = m.colorCaja;
      // Caja y sobregiro a la vez (como NIX en la R3): el sobregiro heredado solo baja con la
      // amortización que decide el equipo; mientras tanto paga su interés cada trimestre.
      const conCaja = m.sobregiro > 0 && m.caja > 0 ? ' · Tenés caja: podés amortizarlo en Finanzas' : '';
      const estado = color === GER_ROJO ? (m.sobregiro > 0 ? '🔴 Con sobregiro de ' + fmt.bs(Math.round(m.sobregiro)) + conCaja : '🔴 Sin caja')
        : color === GER_AMARILLO ? '🟡 No cubre un trimestre más' : '🟢';
      const cubre = m.trimestres !== null ? `Cubre ${fmt.d(m.trimestres, 1)} trimestres al ritmo actual` : '';
      extra = `<div style="font-size:.7rem;color:var(--text3);font-family:inherit">${estado}${cubre ? ' · ' + cubre : ''}</div>`;
    }
    const tendencia = gerLinea(serie.map(x => (it.noAplica && x[it.noAplica]) ? null : x[it.k]));
    const flecha = (it.noAplica && (m[it.noAplica] || (ant && ant[it.noAplica]))) ? '' : gerFlecha(v, ant ? ant[it.k] : null);
    return `<tr><td style="padding:7px 14px;color:var(--text2);font-size:.82rem">${it.label}</td>
      <td style="padding:7px 14px;font-family:var(--font-mono);font-size:.82rem;text-align:right;color:${color}"><span style="white-space:nowrap">${valor}</span>${extra}</td>
      <td style="padding:7px 6px;text-align:center;width:24px">${flecha}</td>
      <td style="padding:7px 14px;width:100px">${tendencia}</td></tr>`;
  };

  det.innerHTML = `
    <p style="font-size:.8rem;color:var(--text3);margin:4px 0 14px;line-height:1.5">
      Ronda ${n}. La flecha compara con la ronda anterior y la línea muestra la evolución desde la ronda 1.
      Los colores solo se usan donde hay una referencia clara; el resto se lee por su tendencia.
      La liquidez corriente es activo corriente ÷ pasivo corriente en todas las rondas, también en las anteriores a este cambio.
    </p>
    <div class="results-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">
      ${GER_PERSPECTIVAS.map(p => `
        <div class="result-round-card">
          <div class="result-round-header"><h3>${p.titulo}</h3></div>
          <table style="width:100%;border-collapse:collapse">${p.items.map(fila).join('')}</table>
        </div>`).join('')}
    </div>`;

  // Posición en el ranking: solo si el equipo compró investigación de mercado esa ronda.
  const celda = document.getElementById('gerRanking');
  try {
    const d = await api('GET', '/api/dashboard/' + n);
    if (!celda || !document.body.contains(celda)) return;
    if (d.bloqueado || !Array.isArray(d.ranking) || !d.ranking.length) {
      celda.textContent = '🔒 Solo con investigación de mercado';
    } else {
      const pos = d.ranking.findIndex(x => x.esYo);
      celda.textContent = pos >= 0 ? `${pos + 1}.º de ${d.ranking.length}` : '—';
      celda.style.color = 'var(--text)';
    }
  } catch (e) {
    if (celda) celda.textContent = '—';
  }
};

window.loadEquipoGerencia = loadEquipoGerencia;
console.log('[equipo-gerencia] ✅ Módulo cargado — Gerencia General (cuadro de mando integral)');
