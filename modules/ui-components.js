/**
 * modules/ui-components.js — SimNego v3.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: componentes de UI reutilizables
 * Fase 1 — Día 1 del plan de modularización
 *
 * Funciones incluidas (copiadas de app.js — NO eliminadas aún):
 *   - fmt        → formateadores de números/fechas
 *   - finRow     → fila de estado financiero
 *   - finRowSub  → fila subtotal de estado financiero
 *   - escapeHtml → sanitización HTML
 *   - toast      → notificaciones UI
 *
 * NOTA: estas funciones también existen en app.js durante el período de
 * transición. Una vez verificado el módulo 24h en producción, se comentarán
 * en app.js. No hay conflicto — las definiciones son idénticas.
 *
 * Reversión: comentar <script src="modules/ui-components.js"> en index.html
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Redondeo ──────────────────────────────────────────────────────────────────
/**
 * Redondeo comercial a n decimales (2 por defecto): la mitad se aleja de cero
 * (56,565 → 56,57; −56,565 → −56,57). Única función de redondeo de las
 * pantallas: la usan fmt.d (app.js y este archivo) y costosUnitariosEquipo.
 *
 * Opera sobre el decimal que JavaScript imprime (String(x)) y corre el exponente
 * por texto: "56.565e2" es 5656,5 exacto. toFixed redondea el valor BINARIO
 * (56,565 se guarda como 56,56499999…) y daba 56,56; multiplicar por 10^n también
 * falla (8,575 × 100 = 857,4999…), aun sumando Number.EPSILON. El split por 'e'
 * cubre la notación científica (1e-7).
 *
 * @param {number} x
 * @param {number} [n=2] decimales
 * @returns {number}
 */
function redondear(x, n) {
  n = n === undefined ? 2 : n;
  x = Number(x);
  if (!isFinite(x) || x === 0) return 0;
  var partes = String(Math.abs(x)).split('e');
  var entero = Math.round(Number(partes[0] + 'e' + (Number(partes[1] || 0) + n)));
  return (x < 0 ? -1 : 1) * Number(entero + 'e' + (-n));
}

// ── Formateadores ─────────────────────────────────────────────────────────────
/**
 * Objeto de utilidades de formato
 * Sobrescribe el fmt de app.js si ya existe (son idénticos)
 */
if (typeof window !== 'undefined') {
  window.fmt = window.fmt || {
    bs:  function(v) { return 'Bs ' + ((+v||0).toLocaleString('es-BO', {maximumFractionDigits:0})); },
    num: function(v) { return (+v||0).toLocaleString('es-BO', {maximumFractionDigits:0}); },
    pct: function(v) { return (((+v||0)*100).toFixed(2)) + '%'; },
    d:   function(v, n) { n = n !== undefined ? n : 2; return redondear(+v||0, n).toFixed(n); },
    dt:  function(s) { return s ? new Date(s).toLocaleString('es-BO', {dateStyle:'short', timeStyle:'short'}) : '—'; },
  };
}

// ── Filas de estados financieros ──────────────────────────────────────────────
/**
 * Genera una fila de estado financiero
 * @param {string} label  - Etiqueta de la fila
 * @param {number} value  - Valor monetario
 * @param {boolean} bold  - Si la fila va en negrita
 * @param {string} type   - 'pos' | 'neg' | 'neutral'
 * @returns {string} HTML de la fila
 */
function finRow(label, value, bold, type) {
  bold = bold || false;
  type = type || 'neutral';
  var col = type === 'pos' ? 'var(--accent5)' : type === 'neg' ? 'var(--accent4)' : 'var(--text)';
  var w = bold ? 'font-weight:700' : '';
  return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:.83rem;' + w + '">'
    + '<span style="color:var(--text2)">' + label + '</span>'
    + '<span style="font-family:var(--font-mono);font-size:.8rem;color:' + col + '">' + fmt.bs(value) + '</span>'
    + '</div>';
}

/**
 * Genera una fila de subtotal de estado financiero
 * @param {string} label  - Etiqueta del subtotal
 * @param {number} value  - Valor monetario
 * @param {boolean} bold  - Si va en negrita (default true)
 * @returns {string} HTML de la fila subtotal
 */
function finRowSub(label, value, bold) {
  bold = bold !== undefined ? bold : true;
  var col = value >= 0 ? 'var(--accent5)' : 'var(--accent4)';
  return '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:.85rem;font-weight:700;margin-top:2px">'
    + '<span>' + label + '</span>'
    + '<span style="font-family:var(--font-mono);color:' + col + '">' + fmt.bs(value) + '</span>'
    + '</div>';
}

// ── Sanitización HTML ─────────────────────────────────────────────────────────
/**
 * Escapa caracteres especiales HTML para prevenir XSS
 * @param {string} str - String a escapar
 * @returns {string} String escapado
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ── Notificaciones toast ──────────────────────────────────────────────────────
/**
 * Muestra una notificación toast temporal
 * @param {string} msg    - Mensaje a mostrar
 * @param {string} type   - 'success' | 'error' | 'warning'
 */
function toast(msg, type) {
  type = type || 'success';
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(function() { el.className = 'toast'; }, 3000);
}

// ── Sección de estado financiero ──────────────────────────────────────────────
/**
 * Genera un encabezado de sección para estados financieros
 * @param {string} label - Título de la sección
 * @returns {string} HTML del encabezado
 */
function finSection(label) {
  return '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;'
    + 'letter-spacing:.08em;color:var(--text3);padding:10px 0 4px;margin-top:6px;'
    + 'border-top:1px solid var(--border2)">' + label + '</div>';
}

/**
 * Traduce la tasa de crecimiento de un segmento a su etiqueta de tendencia.
 *
 * Antes 'tendencia' era un campo GUARDADO, editable por un <select> del panel, y
 * 'tasaCrecimiento' un número independiente que nadie podía editar. Los dos venían de
 * la plantilla de industria ya coherentes entre sí, pero esa coherencia era obra del
 * autor del JSON, no del código: cambiar la etiqueta en el panel no alteraba el
 * crecimiento real, y guardar segmentos borraba la tasa (server.js, corregido).
 *
 * Ahora la etiqueta se DERIVA del número, que es el único dato que el motor consume
 * (engine.js:299). Una sola fuente de verdad.
 *
 * Umbrales confirmados contra los 6 segmentos reales de la plantilla
 * Calzados_COM540_1_2026_V2, donde la correspondencia era 1 a 1 sin excepciones:
 *   0.06 → "Alto crecimiento" (×3)   0.03 → "Creciente" (×2)   0 → "Estable" (×1)
 * "Decreciente" no aparece en ningún dato real; es la lectura obvia del patrón para
 * tasas negativas, y la cuarta opción que ya ofrecía el <select> anterior.
 *
 * @param {number} tasaCrecimiento  ej. 0.06
 * @returns {string} "Alto crecimiento" | "Creciente" | "Estable" | "Decreciente"
 */
function calcularTendencia(tasaCrecimiento) {
  var t = Number(tasaCrecimiento);
  if (!isFinite(t)) return 'Estable';   // sin dato → mercado plano, igual que el ?? 0 del motor
  if (t < 0)     return 'Decreciente';
  if (t >= 0.05) return 'Alto crecimiento';
  if (t >= 0.01) return 'Creciente';
  return 'Estable';
}

/**
 * Fase 1 de pantallas (D1) — costo variable unitario por producto, coherente con
 * el libro mayor. Lo usan KPIs (equipo-resultados.js) y la hoja (equipo-hoja.js).
 *
 *   MP neta por unidad  = costoVentas / unidades vendidas: el mismo monto que el
 *                          asiento costoVenta:prod_n (5.1.01). Sin ventas: inventario
 *                          PT valorizado / unidades; sin ninguna de las dos: cuVar
 *                          (MP consumida en la ronda).
 *   Calidad por unidad  = costoCalidadUnit (asiento calidad:prod_n, 5.2.22, ÷ producción).
 *   Redondeo: MP, calidad y precio sin IVA se redondean a centavos (redondear) y
 *   costo variable y margen se calculan desde esos valores ya redondeados: en
 *   pantalla costo variable + margen = precio sin IVA al centavo.
 *   Costo variable unit = MP + calidad. NO incluye transformación (costoBase ×
 *                          (1 − pctMateriaPrima)) ni costo adicional del canal:
 *                          ninguno de los dos entra al costo de ventas.
 *   Precio sin IVA      = ventasBrutas / unidades vendidas (4.1.01 del producto).
 *   Margen unitario     = precio sin IVA − costo variable unitario.
 *   Nómina por unidad   = nómina de operarios de la EMPRESA ÷ producción total de
 *                          la empresa: gasto del trimestre, no costo del producto.
 *
 * Verificado contra sim_mu8g6mzr R1-R20 (200 producto-ronda): 0 diferencias con
 * los asientos costoVenta y calidad, y la nómina igual al saldo de 5.2.06.
 *
 * @param {object} r         resultado de /api/resultados (con r.productos si hay varios)
 * @param {object} decision  decisión de la ronda (solo para la capacitación, en
 *                           simulaciones sin partida doble)
 * @returns {{productos: Array, nominaPeriodo: number, produccionTotal: number, nominaPorUnidad: (number|null)}}
 */
function costosUnitariosEquipo(r, decision) {
  var n = function (v) { return Number(v) || 0; };
  if (!r) return { productos: [], nominaPeriodo: 0, produccionTotal: 0, nominaPorUnidad: null };
  var prods = (Array.isArray(r.productos) && r.productos.length) ? r.productos : [r];
  var productos = prods.map(function (p) {
    var vend = n(p.ventasReales);
    // ADR-005 — costeo por absorción: el costo de ventas incluye el costo fijo
    // aplicado; el costo VARIABLE por unidad sale de su parte variable (MP + gastos
    // indirectos variables, engine.js costoVentasVariable). En costeo variable no
    // existe ese campo y todo sigue igual.
    var costoVentasVar = p.costoVentasVariable !== undefined ? n(p.costoVentasVariable) : n(p.costoVentas);
    var mpUnit = redondear(vend > 0 ? costoVentasVar / vend
      : n(p.inventarioFinal) > 0 ? n(p.invFinalValorizado) / n(p.inventarioFinal)
      : n(p.cuVar), 2);
    var calidadUnit = redondear(n(p.costoCalidadUnit), 2);
    var cvUnit = redondear(mpUnit + calidadUnit, 2);
    var precioSinIVA = vend > 0 ? redondear(n(p.ventasBrutas) / vend, 2) : null;
    return {
      productoId: p.productoId || 'prod_1', producto: p.producto || '',
      precioConIVA: n(p.precioVenta), precioSinIVA: precioSinIVA,
      mpUnit: mpUnit, calidadUnit: calidadUnit, cvUnit: cvUnit,
      margenUnit: precioSinIVA !== null ? redondear(precioSinIVA - cvUnit, 2) : null,
      vendidas: vend, produccion: n(p.produccion),
    };
  });
  var produccionTotal = productos.reduce(function (s, x) { return s + x.produccion; }, 0);
  var nominaPeriodo;
  var p1n = prods.filter(function (p) { return (p.productoId || 'prod_1') === 'prod_1'; })[0] || prods[0];
  var enAbsorcion = p1n && p1n.costoFijoFabricacionEmpresa !== undefined;
  if (r.fuenteER === 'partida_doble' && !enAbsorcion) {
    nominaPeriodo = n(r.pagoOperarios);                        // saldo de 5.2.06
  } else {
    // También en absorción (ADR-005): la nómina va a 5.1.10, no a 5.2.06, así que
    // se toma de Motor 1, igual que sin partida doble.
    // Motor 1: los costos comunes van en prod_1, y costoOperarios incluye
    // contratación, despido y capacitación (engine.js:599-601): se descuentan.
    var p1 = prods.filter(function (p) { return (p.productoId || 'prod_1') === 'prod_1'; })[0] || prods[0];
    nominaPeriodo = n(p1.costoOperarios) - n(p1.costoContratacion) - n(p1.costoDespido)
      - n(decision && decision.montoCapacitacion);
  }
  return {
    productos: productos, nominaPeriodo: nominaPeriodo, produccionTotal: produccionTotal,
    nominaPorUnidad: produccionTotal > 0 ? nominaPeriodo / produccionTotal : null,
  };
}

/**
 * Estructura del Balance del equipo (T18): la misma clasificación en la pantalla de
 * Balance, en KPIs y en Gerencia General. Solo lee campos que ya trae /api/resultados
 * (con partida doble, saldos del libro mayor de Motor 2). Criterio (manual, Anexo G.2):
 *   Activo corriente: caja, CxC, inventarios (MP, en proceso y PT), IVA crédito fiscal y,
 *     si existe, el crédito de IT por compensar (1.1.06).
 *   Pasivo corriente: cuentas por pagar (2.1.01), IVA por pagar (2.1.03), impuestos por
 *     pagar (IVA débito, IT, IUE: 2.1.02/04/05), ingreso diferido tributario (2.1.06),
 *     sobregiro (2.1.07), intereses por pagar (2.1.08) y préstamo operativo (2.2.01).
 *   Pasivo no corriente: préstamo de inversión (2.2.02). Simplificación declarada: el
 *     simulador no genera cuotas (el pago de capital lo decide el equipo), así que no se
 *     separa una porción corriente.
 *   Liquidez = activo corriente ÷ pasivo corriente SIN los dos espejos de la compensación
 *     IUE→IT (1.1.06 y 2.1.06), que no mueven caja.
 * Préstamos = deudaFinal − sobregiro (Motor 2). El reparto operativo/inversión sale de
 * r.creditos (Motor 1, mismos saldos); sin ese reparto todo va como operativo (corriente).
 * Si el total de pasivos o de activos del motor no coincide con la suma de los renglones
 * (simulaciones sin partida doble), la diferencia va a "Otros", para no cambiar totales.
 * @param {Object} r  resultado de una ronda (item.resultado de /api/resultados)
 */
function estructuraBalanceEquipo(r) {
  var n = function (v) { return Number(v) || 0; };
  r = r || {};
  var pd = r.fuenteER === 'partida_doble';
  var sobregiro = pd ? n(r.sobregiro) : n(r.saldoSobregiroFinal != null ? r.saldoSobregiroFinal : r.sobregiro);
  var prestamos = Math.max(0, n(r.deudaFinal) - sobregiro);
  var cr = r.creditos || {};
  var operativo = (cr.saldoPrestamoOperativoFinal != null) ? Math.min(prestamos, Math.max(0, n(cr.saldoPrestamoOperativoFinal))) : prestamos;
  var inversion = Math.round((prestamos - operativo) * 100) / 100;
  var ivaFavor = n(r.ivaCreditoFiscal != null ? r.ivaCreditoFiscal : r.ivaSaldoAFavor);
  var itppa = n(r.itppa);
  var intereses = n(r.interesesPorPagar != null ? r.interesesPorPagar : r.interesesPorPagarFinal);
  var diferido = n(r.ingresoDiferidoTributario);

  var ac = [
    { label: 'Caja y bancos', valor: n(r.cajaFinal), tipo: 'pos', fijo: true },
    { label: 'Cuentas por cobrar (CxC)', valor: n(r.cxcFinal), fijo: true },
    { label: 'Inventarios', valor: n(r.invFinalValorizado), fijo: true },
    { label: 'IVA crédito fiscal (a favor)', valor: ivaFavor },
    { label: 'Crédito de IT por compensar (IUE)', valor: itppa },
  ];
  var anc = n(r.afNetos != null ? r.afNetos : r.activosFijosNetos) + n(r.intangiblesNetos);
  var sumaA = ac.reduce(function (s, x) { return s + x.valor; }, 0) + anc;
  if (r.totalActivos != null && Math.abs(n(r.totalActivos) - sumaA) >= 1) {
    ac.push({ label: 'Otros activos corrientes', valor: Math.round((n(r.totalActivos) - sumaA) * 100) / 100 });
  }
  var pc = [
    { label: 'Cuentas por pagar', valor: n(r.cxpFinal) },
    { label: 'IVA por pagar (saldo trimestre)', valor: n(r.ivaAPagar) },
    { label: 'Impuestos por pagar (IVA débito, IT, IUE)', valor: n(r.impuestosPorPagar) },
    { label: 'Ingreso diferido tributario', valor: diferido },
    { label: 'Intereses por pagar', valor: intereses },
    { label: 'Sobregiro bancario', valor: sobregiro },
    { label: 'Préstamo operativo', valor: operativo, fijo: true },
  ];
  var pnc = [{ label: 'Préstamo de inversión', valor: inversion, fijo: true }];
  var suma = function (xs) { return xs.reduce(function (s, x) { return s + x.valor; }, 0); };
  var sumaP = suma(pc) + suma(pnc);
  if (r.totalPasivos != null && Math.abs(n(r.totalPasivos) - sumaP) >= 1) {
    pc.push({ label: 'Otros pasivos', valor: Math.round((n(r.totalPasivos) - sumaP) * 100) / 100 });
  }
  var totalAC = suma(ac), totalPC = suma(pc), totalPNC = suma(pnc);
  var activoLiq = totalAC - itppa, pasivoLiq = totalPC - diferido;
  return {
    activoCorriente: ac, totalActivoCorriente: totalAC, totalActivoNoCorriente: anc,
    pasivoCorriente: pc, totalPasivoCorriente: totalPC,
    pasivoNoCorriente: pnc, totalPasivoNoCorriente: totalPNC,
    totalPasivos: totalPC + totalPNC,
    sobregiro: sobregiro, prestamoOperativo: operativo, prestamoInversion: inversion,
    liquidez: { activo: activoLiq, pasivo: pasivoLiq, valor: pasivoLiq > 0 ? activoLiq / pasivoLiq : null },
  };
}

console.log('[ui-components] ✅ Módulo cargado — redondear, fmt, finRow, finRowSub, escapeHtml, toast, finSection, calcularTendencia, costosUnitariosEquipo, estructuraBalanceEquipo');
