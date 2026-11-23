/**
 * modules/equipo-financiero.js — SimNego v3.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: estados financieros del equipo
 * Fase 2 — Día 2 del plan de modularización
 *
 * Funciones incluidas:
 *   - loadEquipoFinanciero  → ER, Balance, Flujo, Tributario
 *   - buildEvoChart         → gráfica evolución
 *   - renderEvoCharts       → render gráficas
 *
 * Dependencias: api(), fmt (ui-components.js), finRow, finRowSub, state, toast
 * Reversión: comentar <script src="modules/equipo-financiero.js"> en index.html
 * ─────────────────────────────────────────────────────────────────────────────
 */

async function loadEquipoFinanciero() {
  const el = document.getElementById('eq-financiero-content');
  const nav = document.getElementById('eq-financiero-nav');
  if (!el) return;

  const data = await api('GET','/api/resultados');
  if (!data.historial?.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>Sin rondas simuladas aún.</p></div>`;
    return;
  }

  const latest = data.historial[data.historial.length-1].ronda;
  if (nav) {
    nav.innerHTML = data.historial.map(h =>
      `<button class="ronda-btn simulated" onclick="mostrarFinanciero(${h.ronda})">${h.ronda===latest?'<strong>':''}Ronda ${h.ronda}${h.ronda===latest?'</strong>':''}</button>`
    ).join('');
  }

  // Store historial globally for tab switching
  window._finHistorial = data.historial;
  mostrarFinanciero(latest);
}

/**
 * Fase 1 de pantallas — líneas y subtotales del Estado de Resultados del equipo.
 *
 * Cada subtotal se CALCULA sumando las líneas que se muestran (nunca se toma
 * suelto de otro lado), y se compara contra el del motor: si difiere en más de
 * 1 Bs, la pantalla lo avisa en vez de mostrar una suma que no cierra.
 *
 *   - Partida doble (r.fuenteER): las líneas son las cuentas del libro mayor que
 *     expone el adaptador de Motor 2. Si alguno de los 6 gastos que el adaptador
 *     agregó en la Fase 1 no llega (dist viejo), se toma de Motor 1.
 *   - Motor 1: los costos COMUNES van solo en prod_1 (engine.js esProductoPrincipal);
 *     los específicos se suman por producto. Así la nómina y los sueldos de
 *     vendedores aparecen UNA vez, no × la cantidad de productos.
 *
 * Verificado contra sim_mu8g6mzr R1-R20 por las dos vías: 0 diferencias.
 */
// ADR-005 — estado gerencial en costeo variable y línea de conciliación, debajo
// del estado oficial por absorción. Recibe los helpers de fila del bloque del
// estado detallado (dos decimales).
function bloqueGerencial(g, s, fila2, sub2, secER, linea, sep) {
  const nota = (txt, color) => '<div style="margin-top:8px;padding:8px 10px;background:' + (color || 'rgba(59,130,246,.07)')
    + ';border-radius:6px;font-size:.73rem;color:var(--text3);line-height:1.6">' + txt + '</div>';
  return ''
    + nota('<strong style="color:#3B82F6">ⓘ Costeo por absorción (NIC 2)</strong><br>'
      + 'La nómina de operarios, la mano de obra indirecta, el gasto fijo de planta y la depreciación de planta y maquinaria '
      + 'son costo del producto: van al costo de ventas y al inventario. Costo fijo por unidad = costos fijos de fabricación ÷ '
      + 'máx(capacidad normal, producción) = ' + fmt.bs(g.costoFijoFabricacion) + ' ÷ ' + fmt.num(Math.max(g.capacidadNormal, g.produccion))
      + ' = Bs ' + Number(g.costoFijoUnitario).toFixed(2) + '. Lo que corresponde a la planta no usada es capacidad ociosa (gasto del trimestre).')
    + sep('border-top:2px solid var(--border2)')
    + secER('Estado gerencial — costeo variable (para decidir precios y cantidades)')
    + fila2('Ventas netas', s.ventasNetas, false, 'neutral')
    + fila2('(−) Costo variable de lo vendido (MP + indirectos variables)', -g.costoVariableVentas, false, 'neg')
    + sub2('= Margen de contribución', g.margenContribucion, true)
    + linea('(−) Costos fijos de fabricación del trimestre', g.costoFijoFabricacion)
    + linea('(−) Gastos comerciales, administrativos y otros', g.otrosGastosOperativos)
    + linea('(−) Gastos financieros', s.financieros)
    + linea('(−) Impuestos', s.impuestos)
    + sub2('= Utilidad gerencial (costeo variable)', g.utilidadNeta, true)
    + sep('border-top:1px dashed var(--border)')
    + secER('Conciliación absorción − variable')
    + fila2('Utilidad oficial (absorción)', s.utilidadNeta, false, 'neutral')
    + fila2('(−) Utilidad gerencial (costeo variable)', -g.utilidadNeta, false, 'neg')
    + sub2('= Costo fijo que quedó en el inventario', g.conciliacion, true)
    + nota('Diferencia = variación del inventario en unidades × costo fijo por unidad: el costo fijo de las unidades que no se vendieron '
      + 'queda en el inventario (absorción) en vez de ir a gasto (variable). Cuando esas unidades se venden, vuelve al resultado.')
    + (g.desvio
        ? nota('⚠ La conciliación de la pantalla (' + fmt.bs(g.conciliacion) + ') no coincide con la del motor (' + fmt.bs(g.conciliacionMotor) + '). Avisá al profesor.', 'rgba(255,107,107,.08)')
        : '');
}

function construirLineasER(r, decision) {
  const n = (v) => Number(v) || 0;
  const pd = r.fuenteER === 'partida_doble';
  const P  = (Array.isArray(r.productos) && r.productos.length) ? r.productos : [r];
  const p1 = P.find(p => (p.productoId || 'prod_1') === 'prod_1') || P[0];
  const sum = (f) => P.reduce((s, p) => s + n(f(p)), 0);
  const oM2 = (campo, respaldo) => (r[campo] !== undefined ? n(r[campo]) : n(respaldo));
  // ADR-005 — costeo por absorción: engine.js lo marca con los campos de empresa
  // de la pasada de absorción (costoFijoFabricacionEmpresa en cada producto).
  const abs = P.some(p => p.costoFijoFabricacionEmpresa !== undefined);
  const v = pd ? {
    facturado: n(r.totalFacturado), ivaDebito: n(r.ivaDebito), comisiones: n(r.comisionesNeto),
    costoVentas: n(r.costoVentas),
    publicidad: n(r.gastoPublicidad), promocion: n(r.gastoPromocion), eventos: n(r.gastoEventos),
    redes: n(r.gastoMktRedes), rrpp: n(r.gastoRRPP), vendedores: n(r.costoVendedores),
    investigacion: oM2('gastoInvMktNeto', p1.gastoInvMktNeto),
    operarios: n(r.pagoOperarios), calidad: oM2('gastoCalidad', sum(p => p.pagoCalidad)),
    planta: n(r.gastoFijoPlanta), almacenamiento: oM2('gastoAlmacenamiento', sum(p => p.costoAlmacenamiento)),
    innovacion: n(r.gastoInnovacion),
    contratacion: oM2('gastoContratacion', n(p1.costoContratacion) + n(p1.costoContratacionVendedores)),
    indemnizacion: oM2('gastoIndemnizacion', n(p1.costoDespido) + n(p1.costoDespidoVendedor)),
    capacitacion: oM2('gastoCapacitacion', decision && decision.montoCapacitacion),
    adminFijo: n(r.gastoAdminFijo), sueldosAdmin: n(r.gastoSueldosAdmin),
    depreciacion: n(r.depreciacion), amortizacion: n(r.amortizacionPatentes),
    intereses: n(r.interesesPrestamo), comisionApertura: n(r.comisionApertura),
    sobregiroNuevo: n(r.interesSobregiro), sobregiroHeredado: n(r.interesSobregiroHeredado),
    it: n(r.impuestoIT), iue: n(r.impuestoIUE),
    // ADR-005: capacidad ociosa (5.1.02) — 0 en costeo variable.
    capacidadOciosa: oM2('capacidadOciosa', p1.capacidadOciosa),
    ref: { utilidadBruta: n(r.utilidadBruta), ebit: n(r.ebit), uai: n(r.ebit) - n(r.gastoFinanciero), utilidadNeta: n(r.utilidadNeta) },
  } : {
    facturado: sum(p => n(p.ventasBrutas) + n(p.ivaDebito)), ivaDebito: sum(p => p.ivaDebito),
    comisiones: sum(p => p.comisionesNeto), costoVentas: sum(p => p.costoVentas),
    publicidad: sum(p => p.gastoPublicidad), promocion: sum(p => p.gastoPromocion), eventos: sum(p => p.gastoEventos),
    redes: sum(p => p.gastoMktRedes), rrpp: sum(p => p.gastoRRPP),
    vendedores: n(p1.gastoCostoVend), investigacion: n(p1.gastoInvMktNeto),
    operarios: n(p1.pagoOperarios),   // Motor 1: incluye contratación, despido y capacitación
    calidad: sum(p => p.pagoCalidad), planta: n(p1.gastoFijoPlanta),
    almacenamiento: sum(p => p.costoAlmacenamiento), innovacion: sum(p => p.gastoInnovacionNeto),
    contratacion: 0, indemnizacion: 0, capacitacion: 0,
    adminFijo: n(p1.gastoAdminFijo), sueldosAdmin: n(p1.gastoSueldosAdmin),
    depreciacion: n(p1.depreciacion), amortizacion: n(p1.amortizacionPatentes),
    intereses: n(p1.interesesPrestamo), comisionApertura: n(p1.comisionAperturaNeta),
    sobregiroNuevo: n(p1.interesSobregiro), sobregiroHeredado: n(p1.interesSobregiroHeredado),
    it: sum(p => p.ITefectivoCaja ?? p.impuestoIT), iue: sum(p => p.impuestoIUE),
    capacidadOciosa: n(p1.capacidadOciosa),   // ADR-005: 0 en costeo variable
    ref: { utilidadBruta: sum(p => p.utilidadBruta), ebit: sum(p => p.ebit), uai: null, utilidadNeta: sum(p => p.utilidadNeta) },
  };
  // Cada línea al centavo, y cada subtotal = suma de las líneas YA redondeadas
  // (redondeada al centavo para quitar el ruido de coma flotante): la suma
  // visual de cada bloque es exactamente su subtotal. Con partida doble las
  // líneas son saldos de cuentas, ya en centavos: no cambia ningún monto.
  const c2 = (x) => Math.round(x * 100) / 100;
  Object.keys(v).forEach(k => { if (k !== 'ref') v[k] = c2(v[k]); });
  const s = {};
  s.ventasBrutas  = v.facturado - v.ivaDebito;
  s.ventasNetas   = s.ventasBrutas - v.comisiones;
  s.utilidadBruta = s.ventasNetas - v.costoVentas;
  // ADR-005: costo fijo de fabricación no absorbido (capacidad ociosa), gasto del
  // período entre la utilidad bruta y los gastos operativos. 0 en costeo variable.
  s.noAbsorbidos  = v.capacidadOciosa;
  s.gastosComerciales = v.publicidad + v.promocion + v.eventos + v.redes + v.rrpp + v.vendedores + v.investigacion;
  s.gastosProduccion  = v.operarios + v.calidad + v.planta + v.almacenamiento + v.innovacion;
  s.gastosRRHH        = v.contratacion + v.indemnizacion + v.capacitacion;
  s.gastosAdmin       = v.adminFijo + v.sueldosAdmin;
  s.ebitda = s.utilidadBruta - s.noAbsorbidos - s.gastosComerciales - s.gastosProduccion - s.gastosRRHH - s.gastosAdmin;
  s.ebit   = s.ebitda - v.depreciacion - v.amortizacion;
  s.gastosOp = s.utilidadBruta - s.ebit;
  s.financieros = v.intereses + v.comisionApertura + v.sobregiroNuevo + v.sobregiroHeredado;
  s.uai    = s.ebit - s.financieros;
  s.impuestos = v.it + v.iue;
  s.utilidadNeta = s.uai - s.impuestos;
  Object.keys(s).forEach(k => { s[k] = c2(s[k]); });
  const desvios = ['utilidadBruta', 'ebit', 'uai', 'utilidadNeta']
    .filter(k => v.ref[k] !== null && Math.abs(s[k] - v.ref[k]) > 1)
    .map(k => ({ campo: k, pantalla: s[k], motor: v.ref[k] }));

  // ADR-005, decisión 6 — estado GERENCIAL en costeo variable (para decidir precios
  // y cantidades), con los mismos datos: ventas netas − costo variable de lo
  // vendido (MP + gastos indirectos variables, de engine.js por producto) = margen
  // de contribución − costos fijos de fabricación del trimestre (con partida doble,
  // los débitos de 5.1.10 + 5.1.11) − el resto de los gastos, financieros e
  // impuestos del estado oficial. La conciliación oficial − gerencial es el costo
  // fijo que quedó en el inventario (unidades en inventario × costo fijo por unidad).
  let gerencial = null;
  if (abs) {
    const g = {
      costoVariableVentas: c2(sum(p => p.costoVentasVariable)),
      costoFijoFabricacion: c2(pd ? oM2('costoFijoFabricacion', p1.costoFijoFabricacionEmpresa) : n(p1.costoFijoFabricacionEmpresa)),
    };
    g.margenContribucion = c2(s.ventasNetas - g.costoVariableVentas);
    g.otrosGastosOperativos = c2(s.gastosOp - s.noAbsorbidos);
    g.utilidadNeta = c2(g.margenContribucion - g.costoFijoFabricacion - g.otrosGastosOperativos - s.financieros - s.impuestos);
    g.conciliacion = c2(s.utilidadNeta - g.utilidadNeta);
    g.conciliacionMotor = c2(n(p1.conciliacionAbsorcionEmpresa));
    g.costoFijoUnitario = n(p1.costoFijoUnitarioEmpresa);
    g.capacidadNormal = n(p1.capacidadNormalEmpresa);
    g.produccion = n(p1.produccionEmpresa);
    g.desvio = Math.abs(g.conciliacion - g.conciliacionMotor) > 1;
    gerencial = g;
  }
  return { pd, v, s, desvios, abs, gerencial };
}

window.mostrarFinanciero = (n) => {
  document.querySelectorAll('#eq-financiero-nav .ronda-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.textContent.replace(/\D+/g,''))===n);
  });
  const item = (window._finHistorial||[]).find(h=>h.ronda===n);
  const el = document.getElementById('eq-financiero-content');
  if (!item || !el) return;
  const r = item.resultado;
  if (!r || typeof r !== 'object') { el.innerHTML = '<p style="padding:20px;color:var(--text3)">Sin datos para esta ronda.</p>'; return; }

  // Ronda 0 = Balance Inicial de Fase 0. Se renderizan las 4 pestañas estándar, con el
  // mismo criterio que el panel del profesor (admin-dashboard.js, esFase0): Balance y
  // Flujo con contenido real, ER "No aplica", Tributario con el IVA Crédito Fiscal real.
  // Antes esta rama cortaba a una pantalla única con sólo el balance.
  if (n === 0) {
    el.innerHTML = buildFase0PestanasHTML(r);
    return;
  }

  // T18: clasificación corriente / no corriente compartida con KPIs y Gerencia General.
  const est = estructuraBalanceEquipo(r);
  const filasBalance = (xs, tipoPorDefecto) => xs
    .filter(x => x.fijo || Math.abs(x.valor) >= 0.005)
    .map(x => finRow(x.label, x.valor, false, x.tipo || tipoPorDefecto)).join('');

  el.innerHTML = `
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <button class="btn btn-ghost" id="tabPL" onclick="showFinTab('pl')" style="background:var(--accent);color:#fff">📋 Estado de Resultados</button>
    <button class="btn btn-ghost" id="tabBG" onclick="showFinTab('bg')">🏦 Balance General</button>
    <button class="btn btn-ghost" id="tabFC" onclick="showFinTab('fc')">💧 Flujo de Efectivo</button>
    <button class="btn btn-ghost" id="tabTR" onclick="showFinTab('tr')">📊 Reporte Tributario</button>
  </div>

  <!-- Estado de Resultados -->
  <div id="finPL">
    <div class="result-round-card">
      <div class="result-round-header" style="display:flex;align-items:center;justify-content:space-between">
        <h3>Estado de Resultados — Ronda ${n}</h3>
        <button class="btn btn-ghost btn-sm no-print" style="font-size:.72rem;padding:3px 10px" onclick="printFinancieroCompleto((state.me&&state.me.nombre)||'',${n})">🖨️ Imprimir completo</button>
      </div>
      <div style="padding:16px 20px">

        ${/* ER desglosado por producto — multiproducto */
          (r.productos && r.productos.length > 1) ? (() => {
            const PROD_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899'];
            const fR = (lbl, v, neg, tipo) => {
              const val = neg ? -(v||0) : (v||0);
              const color = tipo==='pos'?'var(--accent2)':tipo==='neg'?'var(--accent4)':'var(--text1)';
              return '<tr><td style="padding:3px 8px;font-size:.75rem;color:var(--text2)">' + lbl + '</td>'
                + '<td style="padding:3px 8px;text-align:right;font-family:var(--font-mono);font-size:.75rem;color:'+color+'">'
                + (val<0?'(':'') + 'Bs ' + Math.round(Math.abs(val)).toLocaleString('es') + (val<0?')':'') + '</td></tr>';
            };
            const fRS = (lbl, v) => {
              const color = (v||0)>=0?'var(--accent2)':'var(--accent4)';
              return '<tr style="border-top:1px solid var(--border)"><td style="padding:4px 8px;font-size:.75rem;font-weight:700">' + lbl + '</td>'
                + '<td style="padding:4px 8px;text-align:right;font-family:var(--font-mono);font-size:.75rem;font-weight:700;color:'+color+'">'
                + 'Bs ' + Math.round(v||0).toLocaleString('es') + '</td></tr>';
            };
            const secR = lbl => '<tr><td colspan="2" style="padding:4px 8px 2px;font-family:var(--font-mono);font-size:.6rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border)">' + lbl + '</td></tr>';

            const cards = r.productos.map((p,i) => {
              const col = PROD_COLORS[i % PROD_COLORS.length];
              const utilColor = (p.utilidadNeta||0)>=0?'var(--accent2)':'var(--accent4)';
              const gastosOp = p.gastosOp || 0;
              const ebit     = p.ebit ?? ((p.utilidadBruta||0) - gastosOp);
              const utilNeta = p.utilidadNeta || 0;
              const utilBruta  = p.utilidadBruta || 0;
              // Ventas netas = brutas − comisión NETA de IVA (la que resta el motor
              // para llegar a utilidadBruta); p.ventasNetas resta la comisión bruta.
              const ventasNetasP = p.ventasNetasReal ?? p.ventasNetas ?? 0;
              const margenBrutoPct = ventasNetasP>0 ? ((utilBruta/ventasNetasP)*100).toFixed(1)+'%' : '—';
              const margenNetoPct  = ventasNetasP>0 ? ((utilNeta/ventasNetasP)*100).toFixed(1)+'%' : '—';
              // Gastos financieros e impuestos del producto: sin ellos la tarjeta no
              // llegaba de EBIT a utilidad neta (los financieros van en prod_1).
              const finP = p.gastoFinanciero || 0;
              const itP  = p.ITefectivoCaja ?? p.impuestoIT ?? 0;
              const iueP = p.impuestoIUE || 0;
              const mbColor = utilBruta>=0?'var(--accent2)':'var(--accent4)';
              return '<div style="background:var(--bg2);border:0.5px solid var(--border);border-top:3px solid '+col
                + ';border-radius:var(--r);padding:12px 14px;min-width:200px;flex:1">'
                + '<div style="font-weight:700;font-size:.78rem;color:'+col+';margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
                + (p.producto||'Producto '+(i+1)) + '</div>'
                + '<table style="width:100%;border-collapse:collapse">'
                + fR('Ventas netas', ventasNetasP, false, 'neutral')
                + fR('(−) Costo ventas', p.costoVentas||0, true, 'neg')
                + fRS('= Utilidad bruta', utilBruta)
                + '<tr><td style="padding:2px 8px;font-size:.72rem;color:var(--text3)">Margen bruto</td>'
                + '<td style="padding:2px 8px;text-align:right;font-family:var(--font-mono);font-size:.72rem;color:'+mbColor+'">' + margenBrutoPct + '</td></tr>'
                + fR('(−) Gastos operativos', gastosOp, true, 'neg')
                + fRS('= EBIT', ebit)
                + (finP !== 0 ? fR('(−) Gastos financieros', finP, true, 'neg') : '')
                + fR('(−) Impuesto IT', itP, true, 'neg')
                + (iueP > 0 ? fR('(−) Impuesto IUE', iueP, true, 'neg') : '')
                + '<tr style="border-top:2px solid var(--border2);background:rgba(255,255,255,.03)">'
                + '<td style="padding:5px 8px;font-size:.76rem;font-weight:700">= Utilidad neta</td>'
                + '<td style="padding:5px 8px;text-align:right;font-family:var(--font-mono);font-size:.78rem;font-weight:700;color:'+utilColor+'">'
                + 'Bs ' + Math.round(utilNeta).toLocaleString('es') + '</td></tr>'
                + '<tr><td style="padding:3px 8px;font-size:.72rem;color:var(--text3)">Margen neto</td>'
                + '<td style="padding:3px 8px;text-align:right;font-family:var(--font-mono);font-size:.72rem;color:'+utilColor+'">' + margenNetoPct + '</td></tr>'
                + '<tr><td style="padding:3px 8px;font-size:.72rem;color:var(--text3)">Unidades vendidas</td>'
                + '<td style="padding:3px 8px;text-align:right;font-family:var(--font-mono);font-size:.72rem">' + Math.round(p.ventasReales||0).toLocaleString('es') + '</td></tr>'
                + '</table></div>';
            }).join('');

            // Totales empresa — los MISMOS subtotales que el ER detallado de abajo
            // (construirLineasER): cada uno es la suma de sus líneas.
            const { s: erS, v: erV } = construirLineasER(r, item.decision);
            const totVN   = erS.ventasNetas;
            const totCV   = erV.costoVentas;
            const totUB   = erS.utilidadBruta;
            const totGO   = erS.gastosOp;
            const totEBIT = erS.ebit;
            const totFin  = erS.financieros;
            const totIT   = erV.it;
            const totIUE  = erV.iue;
            const totUN   = erS.utilidadNeta;
            const totMgn  = totVN>0 ? (totUN/totVN*100).toFixed(1)+'%' : '—';
            const totColor= totUN>=0?'var(--accent2)':'var(--accent4)';

            return '<div style="font-family:var(--font-mono);font-size:.63rem;color:var(--accent3);text-transform:uppercase;letter-spacing:1px;padding:4px 0 8px 0;border-bottom:1px solid var(--border);margin-bottom:10px">📦 ER por Producto</div>'
              + '<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px">' + cards + '</div>'
              + '<div style="background:var(--bg2);border:0.5px solid var(--border2);border-radius:var(--r);padding:10px 14px;margin-bottom:14px">'
              + '<div style="font-family:var(--font-mono);font-size:.63rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">📊 Consolidado empresa</div>'
              + '<table style="width:100%;border-collapse:collapse">'
              + fR('Ventas netas', totVN, false, 'neutral')
              + fR('(−) Costo ventas', totCV, true, 'neg')
              + fRS('= Utilidad bruta', totUB)
              + fR('(−) Gastos operativos', totGO, true, 'neg')
              + fRS('= EBIT', totEBIT)
              + (totFin !== 0 ? fR('(−) Gastos financieros', totFin, true, 'neg') : '')
              + fR('(−) Impuesto IT', totIT, true, 'neg')
              + (totIUE > 0 ? fR('(−) Impuesto IUE', totIUE, true, 'neg') : '')
              + '<tr style="border-top:2px solid var(--border2);background:rgba(255,255,255,.03)">'
              + '<td style="padding:5px 8px;font-size:.76rem;font-weight:700">= Utilidad neta empresa</td>'
              + '<td style="padding:5px 8px;text-align:right;font-family:var(--font-mono);font-size:.78rem;font-weight:700;color:'+totColor+'">'
              + 'Bs ' + Math.round(totUN).toLocaleString('es') + '</td></tr>'
              + '<tr><td style="padding:3px 8px;font-size:.72rem;color:var(--text3)">Margen neto empresa</td>'
              + '<td style="padding:3px 8px;text-align:right;font-family:var(--font-mono);font-size:.72rem;color:'+totColor+'">' + totMgn + '</td></tr>'
              + '</table></div>'
              + '<div style="font-family:var(--font-mono);font-size:.63rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border);margin-bottom:4px">📋 Estado de Resultados Detallado</div>';
          })() : ''
        }

        ${(() => {
          // Fase 1 de pantallas: el ER detallado sale de construirLineasER. Cada
          // subtotal es la suma de las líneas visibles y coincide con el motor
          // (con partida doble, con el libro mayor). Las líneas opcionales en 0 se
          // ocultan: no cambian ninguna suma.
          const { pd, v, s, desvios, abs, gerencial } = construirLineasER(r, item.decision);
          // Montos con dos decimales (mismas filas que finRow/finRowSub): con
          // enteros, la suma de las líneas redondeadas podía diferir del subtotal.
          const bs2  = (x) => 'Bs ' + (+x || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const fila2 = (label, value, bold, type) => {
            const col = type === 'pos' ? 'var(--accent5)' : type === 'neg' ? 'var(--accent4)' : 'var(--text)';
            return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:.83rem;' + (bold ? 'font-weight:700' : '') + '">'
              + '<span style="color:var(--text2)">' + label + '</span>'
              + '<span style="font-family:var(--font-mono);font-size:.8rem;color:' + col + '">' + bs2(value) + '</span></div>';
          };
          const sub2 = (label, value) =>
            '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:.85rem;font-weight:700;margin-top:2px">'
            + '<span>' + label + '</span>'
            + '<span style="font-family:var(--font-mono);color:' + (value >= 0 ? 'var(--accent5)' : 'var(--accent4)') + '">' + bs2(value) + '</span></div>';
          const multi = (r.productos?.length || 0) > 1;
          const multiLabel = multi ? ' <span style="font-size:.58rem;color:var(--accent3)">(empresa, todos los productos)</span>' : '';
          const secER = lbl => '<div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border);margin-top:4px">'+lbl+multiLabel+'</div>';
          const sep = (estilo) => '<div style="height:4px;' + (estilo || '') + '"></div>';
          const linea   = (lbl, val) => fila2(lbl, -val, false, 'neg');
          const opcional = (lbl, val) => (val ? linea(lbl, val) : '');
          const etqDesvio = { utilidadBruta: 'utilidad bruta', ebit: 'EBIT', uai: 'utilidad antes de impuestos', utilidadNeta: 'utilidad neta' };

          return ''
            // ── INGRESOS ────────────────────────────────────────
            + secER('Ingresos')
            + fila2('Precio facturado al cliente (con IVA)', v.facturado, false, 'neutral')
            + fila2('(−) IVA débito fiscal', -v.ivaDebito, false, 'neg')
            + sub2('= Ventas brutas (sin IVA)', s.ventasBrutas, true)
            + fila2('(−) Comisiones canal (neto)', -v.comisiones, false, 'neg')
            + sub2('= Ventas netas', s.ventasNetas, true)
            + sep()
            // ── COSTO DE VENTAS ─────────────────────────────────
            // Solo materia prima, a promedio ponderado (cuenta 5.1.01). La mano de
            // obra y la calidad son gastos del trimestre: van más abajo.
            + secER('Costo de Ventas')
            + fila2(abs
                ? '(−) Costo de ventas (absorción: MP + indirectos variables + costo fijo aplicado)'
                : '(−) Costo de ventas (materia prima, promedio ponderado)', -v.costoVentas, false, 'neg')
            + sub2('= Utilidad bruta', s.utilidadBruta, true)
            + sep()
            // ── COSTO FIJO NO ABSORBIDO (ADR-005, solo absorción) ──
            + (abs
                ? secER('(−) Costo fijo de fabricación no absorbido')
                  + linea('Capacidad ociosa (planta no usada)', v.capacidadOciosa)
                : '')
            // ── GASTOS COMERCIALES ──────────────────────────────
            + secER('(−) Gastos Comerciales')
            + linea('Publicidad', v.publicidad)
            + opcional('Promoción y descuentos', v.promocion)
            + opcional('Eventos y activaciones', v.eventos)
            + opcional('Marketing en redes', v.redes)
            + opcional('Relaciones públicas', v.rrpp)
            + linea(pd ? 'Sueldos de vendedores' : 'Fuerza de ventas (sueldos, contratación y despido)', v.vendedores)
            + opcional('Investigación de mercado', v.investigacion)
            // ── GASTOS DE PRODUCCIÓN DEL TRIMESTRE ─────────────
            + secER('(−) Gastos de Producción del Trimestre')
            // En absorción la nómina de operarios y el gasto fijo de planta son costo del
            // producto (están en el costo de ventas y en el inventario): sus líneas quedan
            // en 0 y no se muestran.
            + (abs ? opcional : linea)(pd ? 'Sueldos de operarios' : 'Operarios (sueldos, contratación, despido y capacitación)', v.operarios)
            + opcional('Calidad / control', v.calidad)
            + (abs ? opcional : linea)('Gasto fijo de planta', v.planta)
            + opcional('Almacenamiento de inventario', v.almacenamiento)
            + opcional('Innovación y desarrollo', v.innovacion)
            // ── RECURSOS HUMANOS (solo partida doble: Motor 1 los incluye arriba) ──
            + ((v.contratacion || v.indemnizacion || v.capacitacion)
                ? secER('(−) Recursos Humanos')
                  + opcional('Contratación (operarios y vendedores)', v.contratacion)
                  + opcional('Indemnizaciones', v.indemnizacion)
                  + opcional('Capacitación', v.capacitacion)
                : '')
            // ── GASTOS ADMINISTRATIVOS ──────────────────────────
            + secER('(−) Gastos Administrativos')
            + linea('Gastos administrativos fijos', v.adminFijo)
            + linea('Sueldos administrativos fijos', v.sueldosAdmin)
            // ── EBITDA → EBIT ───────────────────────────────────
            + sep('border-top:1px dashed var(--border)')
            + sub2('= EBITDA', s.ebitda, true)
            + linea('(−) Depreciación', v.depreciacion)
            + opcional('(−) Amortización de patentes', v.amortizacion)
            + sep('border-top:1px dashed var(--border)')
            + sub2('= EBIT / Utilidad Operativa', s.ebit, true)
            + sep()
            // ── GASTOS FINANCIEROS ──────────────────────────────
            + secER('(−) Gastos Financieros')
            + linea('Intereses préstamo', v.intereses)
            + opcional('Comisión de apertura (neta de IVA)', v.comisionApertura)
            + opcional('Interés del sobregiro de esta ronda', v.sobregiroNuevo)
            + opcional('Interés del sobregiro heredado', v.sobregiroHeredado)
            + sep('border-top:1px dashed var(--border)')
            + sub2('= Utilidad antes de impuestos', s.uai, true)
            + sep()
            // ── IMPUESTOS ───────────────────────────────────────
            + secER('(−) Impuestos')
            + linea('IT (neto de la compensación con IUE)', v.it)
            + opcional('IUE', v.iue)
            + `<div style="margin-top:10px;padding:8px 10px;background:rgba(59,130,246,.07);border-radius:6px;border-left:3px solid #3B82F6;font-size:.73rem;color:var(--text3);line-height:1.6">
          <strong style="color:#3B82F6">ⓘ IVA — tributo neutro para la empresa (Ley 843)</strong><br>
          Débito fiscal (ventas): ${fmt.bs(r.ivaDebito||0)}&nbsp;&nbsp;·&nbsp;&nbsp;
          Crédito fiscal (compras + servicios con factura): ${fmt.bs(r.ivaCredito||0)}<br>
          ${(r.ivaSaldoAFavorAnterior||0) > 0 ? '(−) Saldo a favor anterior: ' + fmt.bs(r.ivaSaldoAFavorAnterior) + '<br>' : ''}
          <strong>IVA neto a pagar al Estado: ${fmt.bs(r.ivaAPagar||0)}</strong><br>
          El IVA no es gasto — la empresa lo cobra al cliente y entrega el neto al Estado.
        </div>`
            + sep('border-top:2px solid var(--border2)')
            + sub2('= Utilidad neta', s.utilidadNeta, true)
            + (desvios.length
                ? '<div style="margin-top:8px;padding:8px 10px;background:rgba(255,107,107,.08);border-radius:6px;font-size:.74rem;color:var(--accent4)">⚠ Las líneas no reconstruyen el resultado del motor en: '
                  + desvios.map(d => etqDesvio[d.campo] + ' (pantalla ' + fmt.bs(d.pantalla) + ' · motor ' + fmt.bs(d.motor) + ')').join('; ')
                  + '. Avisá al profesor.</div>'
                : '')
            + (gerencial ? bloqueGerencial(gerencial, s, fila2, sub2, secER, linea, sep) : '');
        })()}
      </div>
    </div>
  </div>

  <!-- Balance General -->
  <div id="finBG" style="display:none">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

      <!-- ACTIVOS -->
      <div>
        <div class="result-round-card" style="margin-bottom:12px">
          <div class="result-round-header"><h3>Activos</h3></div>
          <div style="padding:16px 20px">

            <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border)">Activo Corriente</div>
            ${filasBalance(est.activoCorriente, 'neutral')}
            <div style="height:4px;border-top:1px dashed var(--border)"></div>
            ${finRowSub('= Total Activo Corriente', est.totalActivoCorriente, false)}

            <div style="height:8px"></div>
            <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border)">Activo No Corriente</div>
            ${((r.activosFijosBrutos ?? r.activosFijosIniciales ?? 0)>0) ? finRow('Activos fijos (valor inicial)', (r.activosFijosBrutos ?? r.activosFijosIniciales ?? 0), false,'neutral') : ''}
            ${((r.activosFijosBrutos ?? r.activosFijosIniciales ?? 0)>0) ? finRow('(-) Depreciación acumulada', -(r.depreciacionAcumulada||r.depreciacion||0), false,'neg') : ''}
            ${finRow('Activos fijos netos', (r.afNetos ?? r.activosFijosNetos ?? 0), false,'neutral')}
            ${((r.intangiblesBrutos ?? 0)>0) ? finRow('Activos intangibles (patentes)', (r.intangiblesBrutos ?? 0), false,'neutral') : ''}
            ${((r.intangiblesBrutos ?? 0)>0) ? finRow('(-) Amortización acumulada', -(r.amortizacionAcumulada ?? 0), false,'neg') : ''}
            ${((r.intangiblesBrutos ?? 0)>0) ? finRow('Intangibles netos', (r.intangiblesNetos ?? ((r.intangiblesBrutos ?? 0)-(r.amortizacionAcumulada ?? 0))), false,'neutral') : ''}
            <div style="height:4px;border-top:1px dashed var(--border)"></div>
            ${finRowSub('= Total Activo No Corriente', (r.afNetos ?? r.activosFijosNetos ?? 0) + (r.intangiblesNetos ?? 0), false)}

            <div style="height:8px"></div>
            <div style="height:4px;border-top:2px solid var(--border2)"></div>
            ${finRowSub('= TOTAL ACTIVOS', r.totalActivos||(r.cajaFinal||0)+(r.cxcFinal||0)+(r.invFinalValorizado||0)+(r.afNetos||0), true)}
            ${((r.incrementoCapacidadPeriodo ?? 0)>0 || (r.capacidadMaxProduccion ?? 0)>0) ? `<div style="margin-top:8px;padding:6px 10px;background:var(--bg3);border-radius:6px;font-size:.72rem;color:var(--text3)">Capacidad agregada en la ronda: <strong>${fmt.num(r.incrementoCapacidadPeriodo ?? 0)}</strong> unid &middot; Capacidad disponible pr&oacute;xima ronda: <strong>${fmt.num(r.capacidadMaxProduccion ?? 0)}</strong> unid</div>` : ''}
          </div>
        </div>
      </div>

      <!-- PASIVOS + PATRIMONIO -->
      <div>
        <div class="result-round-card" style="margin-bottom:12px">
          <div class="result-round-header"><h3>Pasivos</h3></div>
          <div style="padding:16px 20px">

            <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border)">Pasivo Corriente</div>
            ${filasBalance(est.pasivoCorriente, 'neg')}
            <div style="height:4px;border-top:1px dashed var(--border)"></div>
            ${finRowSub('= Total Pasivo Corriente', est.totalPasivoCorriente, false)}

            <div style="height:8px"></div>
            <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border)">Pasivo No Corriente</div>
            ${filasBalance(est.pasivoNoCorriente, 'neg')}
            <div style="height:4px;border-top:1px dashed var(--border)"></div>
            ${finRowSub('= Total Pasivo No Corriente', est.totalPasivoNoCorriente, false)}
            <div style="font-size:.7rem;color:var(--text3);margin-top:4px;line-height:1.4">El préstamo de inversión se presenta como no corriente: el simulador no genera cuotas, el pago de capital lo decide tu equipo.</div>

            <div style="height:8px"></div>
            <div style="height:4px;border-top:2px solid var(--border2)"></div>
            ${finRowSub('= TOTAL PASIVOS', est.totalPasivos, true)}
          </div>
        </div>

        <div class="result-round-card" style="margin-bottom:12px">
          <div class="result-round-header"><h3>Patrimonio</h3></div>
          <div style="padding:16px 20px">
            ${(() => {
              // Usar valores del engine directamente — no recalcular
              const capital  = Number(r.capitalContable ?? 0);
              const utilidad = r.utilidadNeta    || 0;
              const acumAnt  = r.resultadoAcumulado != null
                ? (r.resultadoAcumulado - utilidad)   // acumulado ANTES de esta ronda
                : 0;
              const patrimonioVisible = capital + acumAnt + utilidad;
              // FASE 6D-5 — patrimonio real: usar r.patrimonio (totalActivos-totalPasivos,
              // ya calculado por el motor) en vez de recomponerlo, para no perder
              // efectos contables que no pasan por utilidadNeta (ej. IVA a favor).
              const patrimonio = Number(r.patrimonio ?? patrimonioVisible);
              const otrosEfectos = patrimonio - patrimonioVisible;
              return finRow('Capital contable / social', capital,  false, 'neutral')
                + finRow('Resultados acumulados', acumAnt, false, acumAnt>=0?'pos':'neg')
                + finRow('Utilidad / pérdida del período', utilidad, false, utilidad>=0?'pos':'neg')
                + (Math.abs(otrosEfectos) >= 1 ? finRow('Otros efectos (IVA a favor y similares)', otrosEfectos, false, otrosEfectos>=0?'pos':'neg') : '')
                + '<div style="height:4px;border-top:2px solid var(--border2)"></div>'
                + finRowSub('= TOTAL PATRIMONIO', patrimonio, true);
            })()}
          </div>
        </div>

        <div class="result-round-card">
          <div style="padding:12px 16px">
            ${(() => {
              const totalA   = r.totalActivos||(r.cajaFinal||0)+(r.cxcFinal||0)+(r.invFinalValorizado||0)+(r.afNetos||0);
              const totalP   = est.totalPasivos;
              // FASE 6D-5 — usar r.patrimonio (verdad del motor) en vez del plug
              // "partidas visibles", que no incluye efectos como IVA a favor.
              const patrimonio = Number(r.patrimonio ?? (totalA - totalP));
              const totalPP    = totalP + patrimonio;
              const diff       = totalA - totalPP;
              const cuadra    = Math.abs(diff) < 2;
              return finRowSub('TOTAL PASIVOS + PATRIMONIO', totalPP, true)
                + '<div style="margin-top:8px;padding:8px 12px;background:'
                + (cuadra?'rgba(6,255,165,.08)':'rgba(255,107,107,.08)')
                + ';border-radius:var(--r);font-size:.78rem;font-family:var(--font-mono)">'
                + (cuadra ? '✓ Balance cuadra' : '⚠ Descuadre ' + fmt.bs(diff))
                + ' (Activos = ' + fmt.bs(totalA) + ' | P+P visible = ' + fmt.bs(totalPP) + ')'
                + '</div>';
            })()}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Flujo de Efectivo -->
  <div id="finFC" style="display:none">
    <div class="result-round-card">
      <div class="result-round-header"><h3>Estado de Flujo de Efectivo — Ronda ${n}</h3></div>
      <div style="padding:16px 20px">

        ${finRow('Caja inicial', r.cajaInicial, false, 'neutral')}
        <div style="height:12px"></div>

        <!-- ── ACTIVIDADES DE OPERACIÓN ── -->
        <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--accent3);text-transform:uppercase;letter-spacing:1px;padding:6px 0;border-bottom:2px solid var(--border2);margin-bottom:4px">
          Flujo de Efectivo por Actividades de Operación
        </div>

        <div style="font-family:var(--font-mono);font-size:.6rem;color:var(--accent2);text-transform:uppercase;letter-spacing:1px;padding:4px 0">Entradas Operativas</div>
        ${finRow('Cobros por ventas al contado',      r.cobrosContado||0,                        false,'pos')}
        <div style="height:4px"></div>
        <div style="font-family:var(--font-mono);font-size:.6rem;color:var(--accent4);text-transform:uppercase;letter-spacing:1px;padding:4px 0">Salidas Operativas</div>
        ${(r.pagoMPbruto||0)>0       ? finRow('Pago materia prima (bruto)',    -(r.pagoMPbruto||0),          false,'neg') : ''}
        ${(r.pagoComisiones||0)>0    ? finRow('Pago comisión canal',           -(r.pagoComisiones||0),       false,'neg') : ''}
        ${(r.pagoOperarios2||r.pagoOperarios||0)>0 ? finRow('Pago de operarios', -(r.pagoOperarios2||r.pagoOperarios||0), false,'neg') : ''}
        ${(r.costoVendedores||0)>0   ? finRow('Pago fuerza de ventas',         -(r.costoVendedores||0),      false,'neg') : ''}
        ${(r.pagoMktTotal||0)>0      ? finRow('Pago de marketing total',        -(r.pagoMktTotal||0),         false,'neg') : ''}
        ${(r.pagoInnovacion||0)>0    ? finRow('Pago de innovación operativa',   -(r.pagoInnovacion||0),       false,'neg') : ''}
        ${(r.pagoCalidad||0)>0       ? finRow('Pago de calidad',                -(r.pagoCalidad||0),          false,'neg') : ''}
        ${(r.pagoGastosAdmin||r.pagoAdmin||r.gastoAdminFijo||0)>0   ? finRow('Pago de gastos administrativos', -(r.pagoGastosAdmin||r.pagoAdmin||r.gastoAdminFijo||0), false,'neg') : ''}
        ${(r.pagoGastosPlanta||r.pagoPlanta||r.gastoFijoPlanta||0)>0 ? finRow('Pago de gastos de planta',     -(r.pagoGastosPlanta||r.pagoPlanta||r.gastoFijoPlanta||0), false,'neg') : ''}
        ${(r.pagoAlmacenamiento||r.pagoAlmacen||0)>0 ? finRow('Pago de almacenamiento', -(r.pagoAlmacenamiento||r.pagoAlmacen||0), false,'neg') : ''}
        ${(r.pagoIVAPeriodoAnterior||0)>0 ? finRow('Pago IVA trimestre anterior al Estado', -(r.pagoIVAPeriodoAnterior||0), false,'neg') : ''}
        ${(r.ivaAPagar||0)>0 ? '<div style="font-size:.72rem;color:var(--text3);padding:3px 0 3px 12px;border-bottom:0.5px solid var(--border)">IVA generado este trimestre: Bs '+Math.round(r.ivaAPagar||0).toLocaleString()+' (se pagará en el siguiente trimestre)</div>' : ''}
        ${(r.compensacionIT||0)>0
          ? finRow('IT devengado período', -(r.impuestoIT||0), false,'neg') +
            finRow('(+) Compensado con saldo IUE', +(r.compensacionIT||0), false,'pos') +
            finRow('Pago IT efectivo en caja', -(r.pagoIT||0), false,'neutral')
          : finRow('Pago IT (efectivo)', -(r.pagoIT??r.impuestoIT??0), false,'neg')}

        ${(r.pagoIUE||0)>0 ? finRow('Pago IUE',              -(r.pagoIUE||0), false,'neg') : ''}
        ${(r.saldoIUEfinal||0)>0 ? finRow('Saldo IUE compensable próx. trimestre', r.saldoIUEfinal||0, false,'neutral') : ''}
        <div style="height:4px;border-top:1px dashed var(--border)"></div>
        ${(() => {
          const entOp = (r.cobrosContado||0);
          const salOp = (r.pagoMPbruto||0)+(r.pagoComisiones||0)
                       +(r.pagoOperarios2||r.pagoOperarios||0)+(r.costoVendedores||0)
                       +(r.pagoMktTotal||0)+(r.pagoInnovacion||0)+(r.pagoCalidad||0)
                       +(r.pagoGastosAdmin||r.pagoAdmin||r.gastoAdminFijo||0)
                       +(r.pagoGastosPlanta||r.pagoPlanta||r.gastoFijoPlanta||0)
                       +(r.pagoAlmacenamiento||r.pagoAlmacen||0)
                       +(r.pagoIVAPeriodoAnterior||0)+(r.pagoIT??r.impuestoIT??0)+(r.pagoIUE||0);
          return finRowSub('= Flujo Neto de Actividades de Operación', entOp - salOp, false);
        })()}
        <div style="height:12px"></div>

        <!-- ── ACTIVIDADES DE INVERSIÓN ── -->
        <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--accent3);text-transform:uppercase;letter-spacing:1px;padding:6px 0;border-bottom:2px solid var(--border2);margin-bottom:4px">
          Flujo de Efectivo por Actividades de Inversión
        </div>
        <div style="font-family:var(--font-mono);font-size:.6rem;color:var(--accent2);text-transform:uppercase;letter-spacing:1px;padding:4px 0">Entradas de Inversión</div>
        ${finRow('Venta de activos fijos', r.ventaActivosFijos||0, false,'pos')}
        <div style="height:4px"></div>
        <div style="font-family:var(--font-mono);font-size:.6rem;color:var(--accent4);text-transform:uppercase;letter-spacing:1px;padding:4px 0">Salidas de Inversión</div>
        ${finRow('Compra de activos fijos / maquinaria', -(r.inversionActivosTotal ?? 0), false,'neg')}
        ${(r.pagoInnovacionCapital||0)>0 ? finRow('Innovación capitalizable', -(r.pagoInnovacionCapital||0), false,'neg') : ''}
        <div style="height:4px;border-top:1px dashed var(--border)"></div>
        ${finRowSub('= Flujo Neto de Actividades de Inversión', (r.ventaActivosFijos||0)-(r.inversionActivosTotal ?? 0)-(r.pagoInnovacionCapital||0), false)}
        <div style="height:12px"></div>

        <!-- ── ACTIVIDADES DE FINANCIAMIENTO ── -->
        <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--accent3);text-transform:uppercase;letter-spacing:1px;padding:6px 0;border-bottom:2px solid var(--border2);margin-bottom:4px">
          Flujo de Efectivo por Actividades de Financiamiento
        </div>
        <div style="font-family:var(--font-mono);font-size:.6rem;color:var(--accent2);text-transform:uppercase;letter-spacing:1px;padding:4px 0">Entradas de Financiamiento</div>
        ${(r.ingresoPrestamo||0)>0 ? finRow('Ingreso por préstamo',   r.ingresoPrestamo||0, false,'pos') : ''}
        ${(r.sobregiro||0)>0       ? finRow('Sobregiro tomado',        r.sobregiro||0,       false,'pos') : ''}
        <div style="height:4px"></div>
        <div style="font-family:var(--font-mono);font-size:.6rem;color:var(--accent4);text-transform:uppercase;letter-spacing:1px;padding:4px 0">Salidas de Financiamiento</div>
        ${(r.pagoCapitalPrestamo||0)>0    ? finRow('Pago de capital préstamo',      -(r.pagoCapitalPrestamo||0),   false,'neg') : ''}
        ${(r.pagoIntereses||r.interesesPrestamo||0)>0 ? finRow('Pago de intereses préstamo', -(r.pagoIntereses||r.interesesPrestamo||0), false,'neg') : ''}
        ${(r.interesSobregiro||0)>0       ? finRow('Pago de intereses sobregiro',  -(r.interesSobregiro||0),      false,'neg') : ''}
        ${(r.comisionApertura||0)>0       ? finRow('Pago de comisión de apertura', -(r.comisionApertura||0),      false,'neg') : ''}
        <div style="height:4px;border-top:1px dashed var(--border)"></div>
        ${(() => {
          const entFin = (r.ingresoPrestamo||0)+(r.sobregiro||0);
          const salFin = (r.pagoCapitalPrestamo||0)+(r.pagoIntereses||r.interesesPrestamo||0)+(r.interesSobregiro||0)+(r.comisionApertura||0);
          return finRowSub('= Flujo Neto de Actividades de Financiamiento', entFin - salFin, false);
        })()}
        <div style="height:12px"></div>

        <!-- ── RESUMEN ── -->
        <div style="height:4px;border-top:2px solid var(--border2)"></div>
        ${(() => {
          const entOp = (r.cobrosContado||0);
          const salOp = (r.pagoMPbruto||0)+(r.pagoComisiones||0)
                       +(r.pagoOperarios2||r.pagoOperarios||0)+(r.costoVendedores||0)
                       +(r.pagoMktTotal||0)+(r.pagoInnovacion||0)+(r.pagoCalidad||0)
                       +(r.pagoGastosAdmin||r.pagoAdmin||r.gastoAdminFijo||0)
                       +(r.pagoGastosPlanta||r.pagoPlanta||r.gastoFijoPlanta||0)
                       +(r.pagoAlmacenamiento||r.pagoAlmacen||0)
                       +(r.pagoIVAPeriodoAnterior||0)+(r.pagoIT??r.impuestoIT??0)+(r.pagoIUE||0);
          const entFin = (r.ingresoPrestamo||0)+(r.sobregiro||0);
          const salFin = (r.pagoCapitalPrestamo||0)+(r.pagoIntereses||r.interesesPrestamo||0)+(r.interesSobregiro||0)+(r.comisionApertura||0);
          const entInv = (r.ventaActivosFijos||0);
          const salInv = (r.inversionActivosTotal ?? 0)+(r.pagoInnovacionCapital||0);
          const varNeta = (entOp - salOp) + (entInv - salInv) + (entFin - salFin);
          return finRowSub('Aumento / Disminución Neta de Caja', varNeta, false);
        })()}
        <div style="height:4px"></div>
        ${finRowSub('= CAJA FINAL', r.cajaFinal, true)}
        ${(r.sobregiro||0)>0 ? '<div style="padding:6px 0;font-size:.76rem;color:var(--accent4)">⚠ Sobregiro activado: Bs ' + fmt.num(r.sobregiro) + ' · Interés: Bs ' + fmt.num(r.interesSobregiro||0) + '</div>' : ''}
      </div>
    </div>
  </div>

  <!-- Reporte Tributario -->
  <div id="finTR" style="display:none">
    <div class="result-round-card">
      <div class="result-round-header">
        <h3>📊 Reporte Gerencial Tributario — Ronda ${n}</h3>
      </div>
      <div style="padding:16px 20px;max-width:640px">
        ${(() => {
          const sec = (num, titulo) =>
            '<div style="font-family:var(--font-mono);font-size:.65rem;color:var(--accent3);text-transform:uppercase;letter-spacing:1px;padding:6px 0 4px;border-bottom:2px solid var(--border2);margin:16px 0 8px">'
            + num + '. ' + titulo + '</div>';
          const rowT = (lbl, v, neg) => {
            const val = neg ? -(v||0) : (v||0);
            const col = val < 0 ? 'var(--accent4)' : 'var(--text1)';
            return '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:.82rem">'
              + '<span style="color:var(--text2)">' + lbl + '</span>'
              + '<span style="font-family:var(--font-mono);color:' + col + '">'
              + (val<0?'(':'' ) + 'Bs ' + Math.abs(Math.round(val)).toLocaleString('es') + (val<0?')':'')
              + '</span></div>';
          };
          const rowSubT = (lbl, v, color) => {
            const c = color || ((v||0)>=0?'var(--accent2)':'var(--accent4)');
            return '<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:.84rem;font-weight:700;border-top:1px solid var(--border2);margin-top:2px">'
              + '<span>' + lbl + '</span>'
              + '<span style="font-family:var(--font-mono);color:'+c+'">Bs ' + Math.round(v||0).toLocaleString('es') + '</span></div>';
          };
          const badgeT = (lbl, v, tipo) => {
            const c = tipo==='pos'?'var(--accent2)':tipo==='neg'?'var(--accent4)':'var(--accent3)';
            return '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:4px;background:rgba(255,255,255,.05);margin:4px 4px 4px 0;font-size:.78rem">'
              + '<span style="color:var(--text3)">' + lbl + ':</span>'
              + '<span style="font-family:var(--font-mono);font-weight:700;color:'+c+'">Bs ' + Math.round(v||0).toLocaleString('es') + '</span></div>';
          };

          const ivaDebito  = r.ivaDebito  || 0;
          const ivaCredito = r.ivaCredito || 0;
          const ivaAPagar  = r.ivaAPagar  || 0;
          const ivaFavor   = ivaCredito > ivaDebito ? ivaCredito - ivaDebito : 0;
          const itDet      = r.impuestoIT  || 0;
          // totalFacturado: usar directo, o calcular desde IT (IT = totalFact × 3%)
          const totalFact  = r.totalFacturado
            || (itDet > 0 ? Math.round(itDet / 0.03) : 0)
            || ((r.ventasBrutas||0) + ivaDebito);
          const itComp     = r.compensacionIUE || 0;
          const itPagar    = Math.max(0, itDet - itComp);
          const utilAntesIT= (r.ebit||0) - (r.gastoFinanciero||0);
          const iueDet     = r.impuestoIUE || 0;
          const saldoIUE   = r.saldoIUEfinal || 0;
          const pagoIVAAnt = r.pagoIVAPeriodoAnterior || 0;

          return sec('1','IVA — Impuesto al Valor Agregado')
            + rowT('IVA Débito Fiscal por ventas', ivaDebito)
            + rowT('(−) IVA Crédito Fiscal por compras y gastos', ivaCredito, true)
            + rowSubT('= IVA neto del período', ivaDebito - ivaCredito)
            + '<div style="margin-top:6px">'
            + (ivaAPagar > 0 ? badgeT('IVA por pagar', ivaAPagar, 'neg') : badgeT('IVA a favor', ivaFavor, 'pos'))
            + '</div>'

            + sec('2','IT — Impuesto a las Transacciones')
            + rowT('Ventas facturadas del período (con IVA)', totalFact)
            + rowT('× Alícuota IT (3%)', Math.round(totalFact * 0.03))
            + rowSubT('= IT determinado', itDet)
            + rowT('(−) Compensación con IUE pagado disponible', itComp, true)
            + rowSubT('= IT por pagar en efectivo', itPagar)

            + sec('3','IUE — Impuesto a las Utilidades de las Empresas')
            + rowT('Utilidad antes de impuestos', utilAntesIT)
            + rowT('(+/−) Ajustes tributarios', 0)
            + rowSubT('= Utilidad imponible', utilAntesIT)
            + rowT('× Alícuota IUE (25%)', utilAntesIT > 0 ? Math.round(utilAntesIT * 0.25) : 0)
            + rowSubT('= IUE determinado (acumulado)', utilAntesIT > 0 ? Math.round(utilAntesIT * 0.25) : 0)
            + '<div style="padding:4px 0 6px;font-size:.74rem;color:var(--accent3);font-style:italic">'
            + 'ⓘ El IUE se liquida al cierre del año fiscal (R4 / R8 / R12). '
            + 'El monto acumulado queda disponible para compensar IT en trimestres siguientes.'
            + '</div>'
            + rowT('IUE efectivamente pagado este período', iueDet)
            + rowT('(−) Pagos a cuenta', 0, true)
            + rowSubT('= IUE por pagar en efectivo este trimestre', Math.max(0, iueDet))

            + sec('4','Saldo de IUE Compensable')
            + rowT('IUE pagado en la gestión', iueDet)
            + rowT('(−) IT compensado con IUE', itComp, true)
            + rowSubT('= Saldo IUE disponible para compensar IT futuro', saldoIUE, 'var(--accent3)')

            + sec('5','Resumen de Caja Tributaria')
            + rowT('IVA período anterior pagado en efectivo', pagoIVAAnt)
            + rowT('IT pagado en efectivo', itPagar)
            + rowT('IUE pagado en efectivo', Math.max(0, iueDet))
            + rowSubT('= Salida total de caja por impuestos', pagoIVAAnt + itPagar + Math.max(0, iueDet))

            + sec('6','Situación Tributaria Final')
            + '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">'
            + badgeT('IVA ' + (ivaAPagar>0?'por pagar':'a favor'), ivaAPagar>0?ivaAPagar:ivaFavor, ivaAPagar>0?'neg':'pos')
            + badgeT('IT por pagar', itPagar, itPagar>0?'neg':'pos')
            + badgeT('IUE por pagar', Math.max(0,iueDet), iueDet>0?'neg':'pos')
            + badgeT('Saldo IUE compensable', saldoIUE, 'pos')
            + '</div>';
        })()}
      </div>
    </div>
  </div>`;
};

// ── Balance Inicial de Fase 0 (Ronda 0) — vista del equipo ───────────────────
// Espejo de buildBalanceInicialHTML() del panel del profesor (admin-dashboard.js,
// commit d3d668a): mismos campos, misma conciliación, mismo criterio de cuadre.
// Diferencias: un solo equipo (el estudiante ve solo el suyo), sin fila de
// resumen ni toggle — no hay nada que colapsar.
// Provee el contenido de la pestaña Balance General en Ronda 0: buildFase0PestanasHTML
// lo embebe en el pane #finBG, junto a las otras 3 pestañas. Definido acá una sola vez
// para no duplicar el desglose.
function buildBalanceInicialEquipoHTML(r) {
  const ta = r.totalActivos || 0, tp = r.totalPasivos || 0, pat = r.patrimonio || 0;
  const cuadra = Math.abs(ta - (tp + pat)) < 2;   // misma tolerancia que el resto de las vistas de balance

  // Conciliación del IVA Crédito Fiscal (cuenta 1.1.05), que EstadoFinanciero.ts suma
  // a totalActivos (d2d127d): sin esta línea el itemizado no llegaría al total.
  // Desde 24ce867 el adaptador transporta el saldo contable como campo propio, así que
  // se usa ése. El cálculo por RESTA queda como fallback para respuestas anteriores a
  // ese commit; era la única vía disponible y sólo válida en Ronda 0, donde las 8 reglas
  // de Fase 0 no generan CxC ni inventario y 1.1.05 es la única cuenta en ese hueco.
  // Mismo criterio que buildBalanceInicialHTML del profesor (admin-dashboard.js).
  const otrosActivos = r.ivaCreditoFiscal ?? (ta - (
    (r.cajaFinal||0) + (r.cxcFinal||0) + (r.invFinalValorizado||0) +
    (r.afNetos||0) + (r.intangiblesNetos||0)
  ));

  const sec = lbl => '<div style="font-family:var(--font-mono);font-size:.65rem;color:var(--accent3);text-transform:uppercase;letter-spacing:1px;padding:6px 0;border-bottom:2px solid var(--border2);margin:12px 0 4px">'+lbl+'</div>';

  return `
  <div class="result-round-card">
    <div class="result-round-header"><h3>🏦 Balance Inicial — Constitución (Fase 0)</h3></div>
    <div style="padding:16px 20px;max-width:640px">
      <p style="font-size:.78rem;color:var(--text3);margin:0 0 10px">
        Estado de tu empresa al constituirse, antes de la primera ronda. Refleja el capital
        recibido, los créditos tomados y los activos comprados en Fase 0.
      </p>
      ${sec('Activo')}
      ${finRow('Caja y bancos', r.cajaFinal || 0, false, 'neutral')}
      ${finRow('Cuentas por cobrar', r.cxcFinal || 0, false, 'neutral')}
      ${finRow('Inventarios', r.invFinalValorizado || 0, false, 'neutral')}
      ${finRow('Activo fijo neto', r.afNetos || 0, false, 'neutral')}
      ${finRow('Intangibles netos', r.intangiblesNetos || 0, false, 'neutral')}
      ${otrosActivos > 0.5 ? finRow('IVA Crédito Fiscal (Ley 843 — saldo a favor)', otrosActivos, false, 'neutral') : ''}
      ${finRowSub('= Total Activos', ta, true)}
      ${sec('Pasivo')}
      ${finRow('Cuentas por pagar', r.cxpFinal || 0, false, 'neutral')}
      ${finRow('Préstamos', r.deudaFinal || 0, false, 'neg')}
      ${finRowSub('= Total Pasivos', tp, true)}
      ${sec('Patrimonio')}
      ${finRow('Capital social', r.capitalContable || 0, false, 'neutral')}
      ${finRow('Resultado acumulado', r.resultadoAcumulado || 0, false, 'neutral')}
      ${finRowSub('= Patrimonio', pat, true)}
      <div style="margin-top:12px;padding:8px 12px;background:${cuadra?'rgba(6,255,165,.08)':'rgba(255,107,107,.08)'};border-radius:var(--r);font-size:.78rem;font-family:var(--font-mono)">
        ${cuadra ? '✓ Balance cuadra' : '⚠ Verificar balance'} (Activos = ${fmt.bs(ta)} | Pasivo + Patrimonio = ${fmt.bs(tp + pat)})
      </div>
    </div>
  </div>`;
}

// ── Ronda 0: las 4 pestañas estándar para el estudiante ──────────────────────
// Espejo de lo que ve el profesor en Fase 0 (admin-dashboard.js, esFase0), adaptado a
// un solo equipo: ER "No aplica", Balance y Flujo reales, Tributario con el IVA Crédito
// Fiscal. Reusa buildBalanceInicialEquipoHTML para el Balance, así que ese contenido
// tiene una sola definición.
function buildFase0PestanasHTML(r) {
  const noAplica = (titulo, motivo) =>
    `<div class="empty-state">
      <div class="empty-icon">🗓️</div>
      <p style="font-weight:700;color:var(--text2);margin-bottom:6px">${titulo} — No aplica en Fase 0</p>
      <p style="max-width:520px;line-height:1.5">La Ronda 0 registra únicamente los asientos
      de constitución de tu empresa (aportes de capital, créditos y compras de activos).
      ${motivo}</p>
    </div>`;

  // Flujo: se usan los flujo* del adaptador (derivados del Libro Mayor) como totales, y
  // las filas itemizan de dónde sale cada uno. Cuadre: cajaInicial + los 3 = cajaFinal.
  const fIni = r.cajaInicial || 0, fOp = r.flujoOperativo || 0;
  const fInv = r.flujoInversion || 0, fFin = r.flujoFinanciamiento || 0;
  const cajaCalc = fIni + fOp + fInv + fFin;
  const cuadraCaja = Math.abs(cajaCalc - (r.cajaFinal || 0)) < 2;

  // Tributario: mismo criterio y misma nota que el profesor. El IVA Crédito Fiscal viene
  // del adaptador (cuenta 1.1.05); IVA débito, IT e IUE no aplican sin ventas.
  const ivaCF = r.ivaCreditoFiscal ?? 0;
  const filaNA = (lbl) =>
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:.83rem">
      <span style="color:var(--text2)">${lbl}</span>
      <span style="font-size:.8rem;color:var(--text3);font-style:italic">No aplica</span>
    </div>`;
  const secT = lbl => `<div style="font-family:var(--font-mono);font-size:.65rem;color:var(--accent3);text-transform:uppercase;letter-spacing:1px;padding:6px 0;border-bottom:2px solid var(--border2);margin:12px 0 4px">${lbl}</div>`;

  return `
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <button class="btn btn-ghost" id="tabPL" onclick="showFinTab('pl')" style="background:var(--accent);color:#fff">📋 Estado de Resultados</button>
    <button class="btn btn-ghost" id="tabBG" onclick="showFinTab('bg')">🏦 Balance General</button>
    <button class="btn btn-ghost" id="tabFC" onclick="showFinTab('fc')">💧 Flujo de Efectivo</button>
    <button class="btn btn-ghost" id="tabTR" onclick="showFinTab('tr')">📊 Reporte Tributario</button>
  </div>

  <div id="finPL">
    <div class="result-round-card">
      <div class="result-round-header"><h3>📋 Estado de Resultados — Ronda 0</h3></div>
      <div style="padding:16px 20px">
        ${noAplica('Estado de Resultados', 'No hubo ventas ni operaciones, así que no existen ingresos, costos ni gastos del período que reportar.')}
      </div>
    </div>
  </div>

  <div id="finBG" style="display:none">${buildBalanceInicialEquipoHTML(r)}</div>

  <div id="finFC" style="display:none">
    <div class="result-round-card">
      <div class="result-round-header"><h3>💧 Flujo de Efectivo — Constitución (Fase 0)</h3></div>
      <div style="padding:16px 20px;max-width:640px">
        <p style="font-size:.78rem;color:var(--text3);margin:0 0 10px">
          De dónde salió la caja con la que arrancás: el financiamiento recibido menos lo
          invertido en activos. Todavía no hay actividad operativa.
        </p>
        ${secT('A · Financiamiento')}
        ${finRow('(+) Aportes de capital', r.capitalContable || 0, false, 'pos')}
        ${finRow('(+) Préstamos recibidos', r.deudaFinal || 0, false, 'pos')}
        ${finRowSub('= Flujo de financiamiento', fFin, true)}
        ${secT('B · Inversión')}
        ${finRow('(−) Compra de activos fijos', r.afNetos || 0, false, 'neg')}
        ${finRow('(−) Compra de intangibles', r.intangiblesNetos || 0, false, 'neg')}
        ${finRow('(−) IVA pagado en las compras', ivaCF, false, 'neg')}
        ${finRowSub('= Flujo de inversión', fInv, true)}
        ${secT('C · Operativo')}
        ${finRow('Flujo operativo del período', fOp, false, 'neutral')}
        ${secT('D · Posición de caja')}
        ${finRow('Saldo inicial de caja', fIni, false, 'neutral')}
        ${finRowSub('= Caja Final', r.cajaFinal || 0, true)}
        <div style="margin-top:12px;padding:8px 12px;background:${cuadraCaja?'rgba(6,255,165,.08)':'rgba(255,107,107,.08)'};border-radius:var(--r);font-size:.78rem;font-family:var(--font-mono)">
          ${cuadraCaja ? '✓ Flujo cuadra' : '⚠ Verificar flujo'} (${fmt.bs(fFin)} − ${fmt.bs(Math.abs(fInv))} = ${fmt.bs(r.cajaFinal || 0)})
        </div>
      </div>
    </div>
  </div>

  <div id="finTR" style="display:none">
    <div class="result-round-card">
      <div class="result-round-header"><h3>📊 Reporte Gerencial Tributario — Ronda 0</h3></div>
      <div style="padding:16px 20px;max-width:640px">
        ${secT('1 · IVA — Crédito Fiscal por compras de constitución')}
        ${finRow('IVA Crédito Fiscal acumulado (cuenta 1.1.05)', ivaCF, false, 'pos')}
        ${finRowSub('= Saldo a favor ante el fisco', ivaCF, true)}
        ${secT('2 · Impuestos que no aplican en Fase 0')}
        ${filaNA('IVA Débito Fiscal (ventas)')}
        ${filaNA('IT — Impuesto a las Transacciones (3%)')}
        ${filaNA('IUE — Impuesto a las Utilidades (25%)')}
        <div style="margin-top:12px;font-size:.74rem;color:var(--text3);font-style:italic;line-height:1.5">
          ⓘ En Fase 0 la empresa se constituye y adquiere activos, pero no vende. El IVA
          pagado en esas compras queda como crédito fiscal a favor (Ley 843, art. 8),
          compensable contra el IVA débito de las rondas siguientes. IT e IUE gravan
          transacciones y utilidades: sin ventas, no se generan.
        </div>
      </div>
    </div>
  </div>`;
}

function finRow(label, value, bold=false, type='neutral') {
  const col = type==='pos' ? 'var(--accent5)' : type==='neg' ? 'var(--accent4)' : 'var(--text)';
  const w = bold ? 'font-weight:700' : '';
  return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:.83rem;${w}">
    <span style="color:var(--text2)">${label}</span>
    <span style="font-family:var(--font-mono);font-size:.8rem;color:${col}">${fmt.bs(value)}</span>
  </div>`;
}

function finRowSub(label, value, bold=false) {
  const col = value>=0 ? 'var(--accent5)' : 'var(--accent4)';
  return `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:.85rem;font-weight:700;margin-top:2px">
    <span>${label}</span>
    <span style="font-family:var(--font-mono);color:${col}">${fmt.bs(value)}</span>
  </div>`;
}

window.showFinTab = (tab) => {
  ['pl','bg','fc','tr'].forEach(t => {
    const el = document.getElementById(`fin${t.toUpperCase()}`);
    if (el) el.style.display = t===tab ? '' : 'none';
  });
  const labels = {pl:'tabPL',bg:'tabBG',fc:'tabFC',tr:'tabTR'};
  Object.entries(labels).forEach(([t,id]) => {
    const btn = document.getElementById(id);
    if (btn) { btn.style.background = t===tab?'var(--accent)':''; btn.style.color = t===tab?'#fff':''; }
  });
};

window.mostrarRondaResultado = async (n, historial) => {
  // Update active btn
  document.querySelectorAll('#equipoResultadosContent .ronda-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.textContent.replace('Ronda ','')) === n);
  });

  if (!historial) {
    const data = await api('GET','/api/resultados');
    historial = data.historial;
  }
  const item = historial.find(h => h.ronda === n);
  if (!item) return;
  const r = item.resultado;

  document.getElementById('resultadoRondaDetalle').innerHTML = `
    <div class="result-round-card">
      <div class="result-round-header">
        <h3>Ronda ${n} — ${r.segmento} · ${r.tipoProducto}</h3>
        <span style="font-size:.74rem;color:var(--text3)">${fmt.dt(item.ejecutadaAt)}</span>
      </div>
      <div class="kpi-grid">
        <div>
          <div class="kpi-row"><span class="kpi-label">Demanda estimada</span><span class="kpi-value">${fmt.num(r.demandaEstimada)} unid</span></div>
          <div class="kpi-row"><span class="kpi-label">Ventas reales</span><span class="kpi-value warn">${fmt.num(r.ventasReales)} unid</span></div>
          <div class="kpi-row"><span class="kpi-label">Inventario final</span><span class="kpi-value">${fmt.num(r.inventarioFinal)} unid</span></div>
          <div class="kpi-row"><span class="kpi-label">Ingresos</span><span class="kpi-value">${fmt.bs(r.ingresos)}</span></div>
          <div class="kpi-row"><span class="kpi-label">Costo de ventas</span><span class="kpi-value">${fmt.bs(r.costoVentas)}</span></div>
          <div class="kpi-row"><span class="kpi-label">EBIT</span><span class="kpi-value ${r.ebit>=0?'up':'down'}">${fmt.bs(r.ebit)}</span></div>
          <div class="kpi-row"><span class="kpi-label">Utilidad neta</span><span class="kpi-value ${r.utilidadNeta>=0?'up':'down'}">${fmt.bs(r.utilidadNeta)}</span></div>
        </div>
        <div>
          <div class="kpi-row"><span class="kpi-label">Caja final</span><span class="kpi-value ${r.cajaFinal>=0?'up':'down'}">${fmt.bs(r.cajaFinal)} <span class="badge ${r.alertaCaja==='ALERTA'?'badge-alert':'badge-ok'}">${r.alertaCaja}</span></span></div>
          <div class="kpi-row"><span class="kpi-label">CxC final</span><span class="kpi-value">${fmt.bs(r.cxcFinal)}</span></div>
          <div class="kpi-row"><span class="kpi-label">Deuda final</span><span class="kpi-value">${fmt.bs(r.deudaFinal)}</span></div>
          <div class="kpi-row"><span class="kpi-label">Market share seg.</span>
            <div class="share-bar-wrap">
              <div class="share-bar-bg"><div class="share-bar-fill" style="width:${Math.min(100,r.shareReal*100)}%"></div></div>
              <span class="share-val">${fmt.pct(r.shareReal)}</span>
            </div>
          </div>
          <div class="kpi-row"><span class="kpi-label">Costo unitario</span><span class="kpi-value">Bs ${fmt.d(r.costoUnitario,3)}</span></div>
          <div class="kpi-row"><span class="kpi-label">ROI Marketing</span><span class="kpi-value ${r.roiMarketing>=1?'up':'down'}">${fmt.d(r.roiMarketing,2)}x</span></div>
          <div class="kpi-row"><span class="kpi-label">Brand Equity</span><span class="kpi-value" style="color:var(--accent3)">${(r.brandEquityFinal ?? 50).toFixed(1)} <span style="font-size:.7rem;color:var(--text3)">pts</span></span></div>
          <div class="kpi-row"><span class="kpi-label">Dotación (Op/Adm/Vend)</span><span class="kpi-value">${r.operarios}/${r.admins}/${r.vendedoresFinales}</span></div>
        </div>
      </div>
    </div>
    ${buildEvoChart(historial)}
  `;
  renderEvoCharts(historial);
};

function buildEvoChart(historial) {
  if (historial.length < 2) return '';
  return `<div class="charts-row" style="margin-top:16px">
    <div class="chart-card"><h4>Evolución EBIT (Bs)</h4><div class="chart-wrap"><canvas id="chartEvo"></canvas></div></div>
    <div class="chart-card"><h4>Evolución Caja (Bs)</h4><div class="chart-wrap"><canvas id="chartCajaEvo"></canvas></div></div>
  </div>`;
}

function renderEvoCharts(historial) {
  ['chartEvo','chartCajaEvo'].forEach(id => {
    const c = document.getElementById(id);
    if (!c) return;
    const labels = historial.map(h => `R${h.ronda}`);
    const defOpts = { responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#9BA3C4',font:{family:'Space Mono',size:9}},grid:{color:'#2A2F45'}},y:{ticks:{color:'#9BA3C4',font:{family:'Space Mono',size:9}},grid:{color:'#2A2F45'}}} };
    const isEBIT = id === 'chartEvo';
    const values = historial.map(h => isEBIT ? h.resultado.ebit : h.resultado.cajaFinal);
    new Chart(c, { type:'line', data:{ labels, datasets:[{data:values, borderColor:isEBIT?'#6C63FF':'#4ECDC4', backgroundColor:isEBIT?'rgba(108,99,255,.1)':'rgba(78,205,196,.1)', fill:true, tension:.3, pointRadius:4}]}, options:defOpts });
  });
}

// ── Equipo Reportes ────────────────────────────────────────


// ── Exponer como window.* para setupNav ──────────────────
window.loadEquipoFinanciero = loadEquipoFinanciero;
console.log('[equipo-financiero] ✅ Módulo cargado — Estados Financieros activos');
