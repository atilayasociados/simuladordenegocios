/**
 * modules/equipo-hoja.js — SimNego v3.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: hoja de decisiones del equipo
 * Fase 2 — Día 1 del plan de modularización
 *
 * Funciones incluidas:
 *   - sincronizarHojaConEstado, guardarDecision, enviarDecision
 *   - normalizarDecisionMultiproducto, crearProductoDefault
 *   - loadHojaDecision, hojaRenderRonda
 *   - hojaResumenV2, hojaKpiHTML
 *   - window.hojaIrRonda, window.hojaSeleccionarProducto
 *   - window.hojaAgregarProducto, window.hojaEliminarProducto
 *
 * Dependencias: api(), fmt (ui-components.js), state, toast
 * Reversión: comentar <script src="modules/equipo-hoja.js"> en index.html
 * ─────────────────────────────────────────────────────────────────────────────
 */

const INVERSION_ACTIVOS_KEYS = [
  'nuevaPlanta',
  'ampliacionPlanta',
  'maquinaria',
  'vehiculos',
  'muebles',
  'computo',
  'patentes',
];

const INVERSION_ACTIVOS_CON_CAPACIDAD = new Set([
  'nuevaPlanta',
  'ampliacionPlanta',
  'maquinaria',
]);

// FASE 6F-P2B2 — catálogo real de plantas Fase 0 (espejo de constants.NIVELES_PLANTA_FASE0;
// override por sim vía params fase0_af_N_{nombre,monto,capacidad}). La capacidad NO es libre.
const PLANTAS_FASE0_BASE = [
  { n: 1, nombre: 'Micro',     monto: 25000,  capacidad: 300,  operariosMinimos: 2 },
  { n: 2, nombre: 'Pequeña',   monto: 50000,  capacidad: 600,  operariosMinimos: 3 },
  { n: 3, nombre: 'Estándar',  monto: 100000, capacidad: 800,  operariosMinimos: 3 },
  { n: 4, nombre: 'Mediana',   monto: 190000, capacidad: 1150, operariosMinimos: 5 },
  { n: 5, nombre: 'Grande',    monto: 260000, capacidad: 1350, operariosMinimos: 6 },
  { n: 6, nombre: 'Expansiva', monto: 350000, capacidad: 1700, operariosMinimos: 7 },
];
function catalogoPlantasFase0(params = {}) {
  return PLANTAS_FASE0_BASE.map(d => ({
    n: d.n,
    nombre: params['fase0_af_' + d.n + '_nombre'] || d.nombre,
    monto: (params['fase0_af_' + d.n + '_monto'] != null) ? Number(params['fase0_af_' + d.n + '_monto']) : d.monto,
    capacidad: (params['fase0_af_' + d.n + '_capacidad'] != null) ? Number(params['fase0_af_' + d.n + '_capacidad']) : d.capacidad,
    operariosMinimos: d.operariosMinimos,
  }));
}
// Paquetes: factor sobre la capacidad ACTUAL (capacidad calculada, no libre).
const PAQUETES_AMPLIACION = [
  { key: '',      label: 'Ninguna',                factor: 0 },
  { key: 'menor', label: 'Ampliación menor (+25%)', factor: 0.25 },
  { key: 'media', label: 'Ampliación media (+50%)', factor: 0.50 },
  { key: 'alta',  label: 'Ampliación alta (+75%)',  factor: 0.75 },
];
const PAQUETES_MAQUINARIA = [
  { key: '',         label: 'Ninguna',          factor: 0 },
  { key: 'basica',   label: 'Básica (+25%)',    factor: 0.25 },
  { key: 'estandar', label: 'Estándar (+50%)',  factor: 0.50 },
  { key: 'avanzada', label: 'Avanzada (+100%)', factor: 1.00 },
];
function factorPaquete(lista, key) {
  const f = lista.find(x => x.key === String(key || ''));
  return f ? f.factor : 0;
}
// FASE 6F-P2B3 — complementarios por selector (no libre); costo desde params del profesor.
const INVERSION_ACTIVOS_CON_PAQUETE = new Set([
  'ampliacionPlanta', 'maquinaria', 'vehiculos', 'muebles', 'computo', 'patentes',
]);
const OPCIONES_VEHICULO = [['', 'Ninguno'], ['nivel1', 'Nivel 1'], ['nivel2', 'Nivel 2'], ['nivel3', 'Nivel 3']];
const OPCIONES_SI_NO    = [['', 'No'], ['si', 'Sí']];
function montoComplementario(tipo, paquete, params = {}) {
  const p = params || {};
  const key = String(paquete || '');
  if (tipo === 'vehiculos') {
    if (key === 'nivel1') return normalizarNumeroNoNegativo(p.costoVehiculoNivel1);
    if (key === 'nivel2') return normalizarNumeroNoNegativo(p.costoVehiculoNivel2);
    if (key === 'nivel3') return normalizarNumeroNoNegativo(p.costoVehiculoNivel3);
    return 0;
  }
  if (key !== 'si') return 0;
  if (tipo === 'muebles')  return normalizarNumeroNoNegativo(p.costoMuebles);
  if (tipo === 'computo')  return normalizarNumeroNoNegativo(p.costoComputo);
  if (tipo === 'patentes') return normalizarNumeroNoNegativo(p.costoPatentes);
  return 0;
}
/**
 * Tope real de producción del período: min(capacidad de planta, capacidad por operarios).
 *
 * Lee los inputs EN VIVO del DOM (contratar/despedir operarios, monto de capacitación)
 * con fallback a la decisión guardada, así que refleja lo que el equipo tiene en pantalla
 * en este instante, no lo último persistido.
 *
 * Vive acá, a nivel de módulo, porque la consumen dos lugares en scopes distintos: el
 * listener de inputs (avisos en vivo) y el handler del botón "Enviar decisiones". Antes
 * el cálculo estaba declarado con `const` DENTRO del listener de inputs, y el handler del
 * botón lo referenciaba desde fuera de esa clausura: al hacer clic lanzaba
 * `ReferenceError: capMaxProduccionLive is not defined` en su primera línea, antes del
 * confirm() y antes de cualquier toast. Como el handler es async, la excepción quedaba
 * como promesa rechazada sin ningún listener global que la capturara — el botón no hacía
 * absolutamente nada visible, para todos los equipos, excedieran o no la capacidad.
 */
function capacidadMaxLive(cont, decision = {}, params = {}) {
  const num = (sel, fallback) => {
    const el = cont?.querySelector?.(sel);
    const v = (el && el.value !== '' && el.value != null) ? el.value : fallback;
    return Number(v) || 0;
  };
  const opIni       = Number(decision.operariosIniciales ?? params?.operariosIniciales ?? 4) || 0;
  const opContratar = num('[data-hoja-field="contratarOperarios"]', decision.contratarOperarios ?? 0);
  const opDespedir  = num('[data-hoja-field="despedirOperarios"]',  decision.despedirOperarios ?? 0);
  const opFinales   = Math.max(0, opIni + opContratar - opDespedir);
  const capPlanta   = Number(decision.capacidadMaxProduccion ?? params?.capacidadMaxProduccion ?? 1500) || 0;
  const factorCap   = Number(params?.factorCapacitacion ?? 0.05);
  const montoCap    = num('[data-hoja-field="montoCapacitacion"]', decision.montoCapacitacion ?? 0);
  const capOperarios = Math.round(opFinales * Number(params?.productividadBase ?? 440)
    * (1 + factorCap * montoCap / 10000));
  return { capPlanta, capOperarios, opFinales, capMax: Math.min(capPlanta, capOperarios) };
}

/**
 * Capacidad AGREGADA: suma la producción de TODOS los productos y la compara contra el
 * tope real de la planta. Devuelve el mensaje de error, o null si cabe.
 *
 * El aviso por producto (ver el bloque `field === 'produccion'`) evalúa cada input por
 * separado contra el mismo tope, así que 5 productos de 600 unidades mostraban
 * "✓ 100% del tope real" cinco veces mientras la planta sólo puede producir 600 en
 * total. El motor recorta la producción al simular, pero el equipo no se entera al
 * decidir: sus resultados no reflejan lo que cargó.
 */
function excesoCapacidadAgregada(decision, capMax) {
  const prods = Array.isArray(decision?.productos) ? decision.productos : [];
  const activos = prods.filter(p => p && p.activo !== false);
  if (activos.length < 2) return null;   // con 1 producto el clamp por campo ya alcanza
  const total = activos.reduce((s, p) => s + (Number(p.produccion) || 0), 0);
  if (!(total > capMax)) return null;
  return 'La producción total de tus ' + activos.length + ' productos (' + fmt.num(total)
    + ' u) supera la capacidad real de tu planta (' + fmt.num(capMax)
    + ' u). Ajustá las cantidades para que sumen ' + fmt.num(capMax) + ' u o menos.';
}

function capacidadActualHoja(decision = {}, params = {}) {
  return normalizarNumeroNoNegativo(decision.capacidadMaxProduccion ?? params.capacidadMaxProduccion ?? 1500);
}
function operariosPlantaSeleccionada(decision = {}, params = {}) {
  const planta = catalogoPlantasFase0(params)
    .find(c => String(c.n) === String(decision?.inversionActivos?.nuevaPlanta?.tipoPlanta));
  return planta ? planta.operariosMinimos : 0;
}
// Deriva monto+capacidad NO LIBRES desde la selección de catálogo/paquetes.
// Nueva planta: monto y capacidad vienen del catálogo. Ampliación/maquinaria:
// capacidad = capActual × factor; el monto queda EDITABLE (sin parámetro oficial de costo aún).
function resolverInversionActivos(decision = {}, params = {}) {
  const inv = normalizarInversionActivosDecision(decision);
  const cat = catalogoPlantasFase0(params);
  const capActual = capacidadActualHoja(decision, params);

  const planta = cat.find(c => String(c.n) === String(inv.nuevaPlanta.tipoPlanta));
  inv.nuevaPlanta.monto = planta ? normalizarNumeroNoNegativo(planta.monto) : 0;
  inv.nuevaPlanta.incrementoCapacidad = planta ? normalizarNumeroNoNegativo(planta.capacidad) : 0;

  inv.ampliacionPlanta.incrementoCapacidad = Math.round(capActual * factorPaquete(PAQUETES_AMPLIACION, inv.ampliacionPlanta.paquete));
  inv.ampliacionPlanta.monto = Math.round(inv.ampliacionPlanta.incrementoCapacidad * normalizarNumeroNoNegativo(params.costoPorUnidadCapacidadAmpliacion));

  inv.maquinaria.incrementoCapacidad = Math.round(capActual * factorPaquete(PAQUETES_MAQUINARIA, inv.maquinaria.paquete));
  inv.maquinaria.monto = Math.round(inv.maquinaria.incrementoCapacidad * normalizarNumeroNoNegativo(params.costoPorUnidadCapacidadMaquinaria));

  ['vehiculos', 'muebles', 'computo', 'patentes'].forEach(t => {
    inv[t].monto = montoComplementario(t, inv[t].paquete, params);
  });
  return inv;
}

function normalizarNumeroNoNegativo(valor) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normalizarInversionActivosDecision(decision = {}) {
  if (!decision.inversionActivos || typeof decision.inversionActivos !== 'object') {
    decision.inversionActivos = {};
  }

  INVERSION_ACTIVOS_KEYS.forEach(tipo => {
    const actual = decision.inversionActivos[tipo] || {};
    const norm = { monto: normalizarNumeroNoNegativo(actual.monto) };
    if (INVERSION_ACTIVOS_CON_CAPACIDAD.has(tipo)) {
      norm.incrementoCapacidad = normalizarNumeroNoNegativo(actual.incrementoCapacidad);
    }
    // FASE 6F-P2B2 — trazabilidad de la selección (no libre)
    if (tipo === 'nuevaPlanta') {
      norm.tipoPlanta = (actual.tipoPlanta != null && actual.tipoPlanta !== '') ? String(actual.tipoPlanta) : '';
    }
    if (INVERSION_ACTIVOS_CON_PAQUETE.has(tipo)) {
      norm.paquete = (actual.paquete != null) ? String(actual.paquete) : '';
    }
    decision.inversionActivos[tipo] = norm;
  });

  return decision.inversionActivos;
}

function totalesInversionActivos(decision = {}) {
  const inv = normalizarInversionActivosDecision(decision);
  return INVERSION_ACTIVOS_KEYS.reduce((acc, tipo) => {
    acc.total += normalizarNumeroNoNegativo(inv[tipo]?.monto);
    acc.capacidad += INVERSION_ACTIVOS_CON_CAPACIDAD.has(tipo)
      ? normalizarNumeroNoNegativo(inv[tipo]?.incrementoCapacidad)
      : 0;
    return acc;
  }, { total: 0, capacidad: 0 });
}

function sincronizarInversionActivosDesdeDOM(root = document) {
  if (!state.decisiones) return;
  const inv = normalizarInversionActivosDecision(state.decisiones);

  const params = state.ref?.parametros || {};

  root.querySelectorAll('[data-activo-tipo][data-activo-campo]').forEach(el => {
    const tipo = el.dataset.activoTipo;
    const campo = el.dataset.activoCampo;
    if (!INVERSION_ACTIVOS_KEYS.includes(tipo)) return;

    if (campo === 'tipoPlanta' && tipo === 'nuevaPlanta') {
      inv.nuevaPlanta.tipoPlanta = el.value || '';
    } else if (campo === 'paquete' && INVERSION_ACTIVOS_CON_PAQUETE.has(tipo)) {
      inv[tipo].paquete = el.value || '';
    }
    // monto e incrementoCapacidad ya NO se capturan del DOM: son calculados (no libres).
  });

  resolverInversionActivos(state.decisiones, params);
}

function sincronizarHojaConEstado() {
  // P4 FIX: sincroniza el DOM de la hoja con state.decisiones antes de
  // guardar o enviar, capturando cambios no procesados por el change handler.
  document.querySelectorAll('[data-hoja-field]').forEach(el => {
    if (!state.decisiones) return;
    const field = el.dataset.hojaField;
    const v = el.type === 'checkbox' ? el.checked
            : el.type === 'number'   ? +el.value
            : el.tagName === 'SELECT'
              ? el.value.replace(/\s*\(Bs[\d.\s]+\)\s*$/, '').trim()
            : el.value;
    const prodFields = ['producto','segmentoObjetivo','canalPrincipal',
      'canalSecundario','calidad','precioVenta','produccion','publicidad',
      'promocion','eventos','marketingRedes','relacionesPublicas',
      'innovacion','tipoInnovacion','montoInnovacion'];
    const idxActivo = (typeof hojaProductoActivo === 'number') ? hojaProductoActivo : 0;
    if (state.decisiones.productos?.[idxActivo] && prodFields.includes(field)) {
      state.decisiones.productos[idxActivo][field] = v;
    }
    if (idxActivo === 0 && (field === 'producto' || field === 'tipoProducto')) {
      state.decisiones['producto'] = v;
      if (state.decisiones.productos?.[idxActivo]) {
        state.decisiones.productos[idxActivo].producto = v;
      }
    }
    if (!prodFields.includes(field) || idxActivo === 0) {
      state.decisiones[field] = v;
    }
  });
  sincronizarInversionActivosDesdeDOM(document);
}

// ── Control de versión de la hoja (pendiente N.º 10) ─────────────────────────
// GET /api/decisiones trae decision._version y decision._guardadaAt; la hoja los devuelve
// al guardar o enviar. Si otro dispositivo del equipo guardó antes, el servidor responde
// 409 y no sobrescribe: se muestra un aviso fijo y se bloquean Guardar y Enviar hasta
// recargar, sin borrar lo que está en pantalla (para que puedan copiarlo).
function hojaHora(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }) : '';
}
function hojaTextoUltimoGuardado(iso) {
  return iso ? `💾 Último guardado: ${hojaHora(iso)}` : '💾 Sin guardar todavía';
}
// Tras un guardado o envío correcto: versión nueva y hora del último guardado.
function hojaTrasGuardar(r) {
  if (r?.version != null && state.decisiones) {
    state.decisiones._version = r.version;
    state.decisiones._guardadaAt = r.guardadaAt || null;
  }
  document.querySelectorAll('[data-hoja-ultimo-guardado]').forEach(el => {
    el.textContent = hojaTextoUltimoGuardado(r?.guardadaAt);
  });
}
// Devuelve true si el error era el 409 de versión (y ya mostró el aviso), o un 401 de sesión
// cerrada/vencida que app.js ya manejó (sesionTerminada): no se vuelve a habilitar el botón.
function hojaMostrarConflicto(e) {
  if (e?.status === 401 && e.data?.motivo) return true;
  if (!e || e.status !== 409 || !e.data?.conflicto) return false;
  const d = e.data;
  const cuando = d.guardadaAt ? ` (último guardado: ${hojaHora(d.guardadaAt)})` : '';
  const div = document.getElementById('hojaAvisoConflicto');
  if (div) {
    div.hidden = false;
    div.textContent = '';
    const txt = document.createElement('span');
    txt.style.fontWeight = '600';
    txt.textContent = '⚠ ' + e.message + cuando + ' ';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn btn-ghost btn-sm'; btn.textContent = '↺ Recargar la hoja';
    // loadHojaDecision no recarga si hay cambios sin guardar: acá el equipo ya sabe que no se
    // guardaron, así que se confirma y se descartan para traer la versión guardada.
    btn.addEventListener('click', () => {
      if (!confirm('Se descartarán los cambios de esta pantalla y verás la versión guardada por tu equipo. ¿Recargar la hoja?')) return;
      hojaTieneCambiosSinGuardar = false;
      loadHojaDecision();
    });
    div.append(txt, btn);
    div.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  ['btnHojaGuardar', 'btnHojaEnviar'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });
  toast(e.message, 'error');
  return true;
}

async function guardarDecision() {
  try {
    sincronizarHojaConEstado();
    const r = await api('POST','/api/decisiones/guardar',{ decision: state.decisiones });
    hojaTrasGuardar(r);
    toast('💾 Decisiones guardadas','success');
  } catch(e) { if (!hojaMostrarConflicto(e)) toast(e.message,'error'); }
}

async function enviarDecision() {
  if (!confirm('¿Enviar decisiones al simulador?\n\nPodrás ver tus resultados cuando el profesor ejecute la simulación.')) return;
  try {
    sincronizarHojaConEstado();
    const _d1 = JSON.parse(JSON.stringify(state.decisiones, (k,v) => v===undefined?null:v));
    await api('POST','/api/decisiones/enviar',{ decision: _d1 });
    toast('✅ Decisiones enviadas correctamente','success');
    await loadDecisionForm();
  } catch(e) { if (!hojaMostrarConflicto(e)) toast(e.message,'error'); }
}

// ── Hoja de Decisión ──────────────────────────────────────
// Estado local de la hoja (se comparte con el formulario principal)
// ══════════════════════════════════════════════════════════
// HOJA DE DECISIÓN — 20 rondas
// Estado local: no se usa hojaRondaActiva dentro de plantillas
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// HOJA DE DECISIÓN — diseño simple y directo, sin caché
// Carga siempre fresco desde el servidor al abrir la vista
// ══════════════════════════════════════════════════════════

// hojaRondaActual declarada en app.js — no redeclarar aquí

// hojaProductoActivo declarada en app.js

function normalizarDecisionMultiproducto(decision) {
  decision = decision || {};

  // FIX: el formulario legado usa data-field="tipoProducto"; mapear a "producto"
  // para garantizar que el motor siempre recibe el campo correcto.
  if (!decision.producto && decision.tipoProducto) {
    decision.producto = decision.tipoProducto;
  }

  if (!Array.isArray(decision.productos) || decision.productos.length === 0) {
    decision.productos = [{
      productoId: 'prod_1',
      activo: true,
      producto: decision.producto || decision.tipoProducto || '',
      segmentoObjetivo: decision.segmentoObjetivo || '',
      canalPrincipal: decision.canalPrincipal || '',
      canalSecundario: decision.canalSecundario || 'Ninguno',
      calidad: decision.calidad ?? 5,
      precioVenta: decision.precioVenta ?? 3.6,
      produccion: decision.produccion ?? 18000,
      publicidad: decision.publicidad ?? 3000,
      promocion: decision.promocion ?? 2000,
      eventos: decision.eventos ?? 1000,
      marketingRedes: decision.marketingRedes ?? 1000,
      relacionesPublicas: decision.relacionesPublicas ?? 1000,
      innovacion: decision.innovacion ?? false,
      tipoInnovacion: decision.tipoInnovacion || '',
      montoInnovacion: decision.montoInnovacion ?? 0
    }];
  }

  // Compatibilidad temporal: el primer producto sigue alimentando los campos antiguos
  const p = decision.productos[0] || {};
  decision.producto = p.producto;
  decision.segmentoObjetivo = p.segmentoObjetivo;
  decision.canalPrincipal = p.canalPrincipal;
  decision.canalSecundario = p.canalSecundario;
  decision.calidad = p.calidad;
  decision.precioVenta = p.precioVenta;
  decision.produccion = p.produccion;
  decision.publicidad = p.publicidad;
  decision.promocion = p.promocion;
  decision.eventos = p.eventos;
  decision.marketingRedes = p.marketingRedes;
  decision.relacionesPublicas = p.relacionesPublicas;
  decision.innovacion = p.innovacion;
  decision.tipoInnovacion = p.tipoInnovacion;
  decision.montoInnovacion = p.montoInnovacion;
  normalizarInversionActivosDecision(decision);

  return decision;
}

function crearProductoDefault(idx) {
  return {
    productoId: 'prod_' + (idx + 1),
    activo: true,
    producto: '',
    segmentoObjetivo: '',
    canalPrincipal: '',
    canalSecundario: 'Ninguno',
    calidad: 5,
    precioVenta: 0,
    produccion: 0,
    publicidad: 0,
    promocion: 0,
    eventos: 0,
    marketingRedes: 0,
    relacionesPublicas: 0,
    innovacion: false,
    tipoInnovacion: 'Producto',
    montoInnovacion: 0,
    vendedoresIniciales: 2,
    contratarVendedores: 0,
    despedirVendedores: 0,
    // Etapa 3.2: Operarios
    contratarOperarios:  0,
    despedirOperarios:   0,
    montoCapacitacion:   0,
    // Campos legado (para no romper motor con decisiones monoproducto viejas)
    tipoPrestamo: 'Ninguno',
    montoPrestamo: 0,
    amortizacion: 0,
  };
}

// ── Pestañas por gerente ──────────────────────────────────────────────────
// La hoja sigue siendo UN solo formulario (ver hojaRenderRonda): cambiar de pestaña
// solo muestra u oculta paneles, sin perder datos ni cambiar el payload.
const HOJA_PESTANAS = [
  { id: 'estrategia', icono: '🎯', titulo: 'Estrategia', gerente: 'Gerente General' },
  { id: 'marketing',  icono: '📣', titulo: 'Marketing',  gerente: 'Gerente de Marketing' },
  { id: 'produccion', icono: '🏭', titulo: 'Producción', gerente: 'Gerente de Producción' },
  { id: 'rrhh',       icono: '👥', titulo: 'RRHH',       gerente: 'Gerente de RRHH' },
  { id: 'finanzas',   icono: '💰', titulo: 'Finanzas',   gerente: 'Gerente General' },
  { id: 'cierre',     icono: '📋', titulo: 'Cierre',     gerente: 'Revisión y envío' },
];
const HOJA_ICONO_ESTADO = { sin: '○', progreso: '●', completa: '✓', alerta: '⚠' };
let hojaPestanaActiva       = 'estrategia';  // se recuerda al cambiar de producto o de ronda
let hojaPestanasVisitadas   = new Set();     // se reinicia al cambiar de ronda
let hojaPestanasRonda       = null;
let hojaHistorialResultados = [];            // historial de /api/resultados que ya pide loadHojaDecision

// Ventas reales de la ronda anterior de un producto, del historial que la hoja ya
// pide (sin endpoint nuevo). null si no hay ronda anterior simulada con ese producto.
function hojaVentasRondaAnterior(n, productoId) {
  const item  = (hojaHistorialResultados || []).find(h => h.ronda === n - 1);
  const prods = item?.resultado?.productos;
  if (!Array.isArray(prods)) return null;
  const pr = prods.find(x => (x.productoId || 'prod_1') === (productoId || 'prod_1'));
  return pr ? Number(pr.ventasReales ?? 0) : null;
}

// Materia prima con la que el motor producirá en la ronda n (engine.js
// procesarPedidosMP + produccionMaxMP): stock heredado + pedidos con
// rondaEntrega <= n + el pedido de esta ronda solo si el proveedor tiene lead time 0
// (sin leadTime en el catálogo el motor asume 1). null = sin límite: sin stock y sin
// proveedor elegido, el motor no limita la producción por MP (Infinity, retrocompat.).
function hojaMPDisponibleRonda(decision, n, proveedores) {
  const ped = Array.isArray(decision?.pedidosPendientes) ? decision.pedidosPendientes : [];
  let mp = Number(decision?.stockMPInicial ?? 0)
    + ped.filter(pp => (pp.rondaEntrega ?? 0) <= n).reduce((s, pp) => s + (pp.cantidad || 0), 0);
  const provId = String(decision?.proveedorElegido || '');
  const cant   = Number(decision?.cantidadMPpedida ?? 0);
  if (provId && cant > 0) {
    const pv = (proveedores || []).find(x => x.id === provId || x.nombre === provId);
    if ((pv?.leadTime ?? 1) === 0) mp += cant;
  }
  // T4: con el módulo de proveedores encendido (y catálogo) la MP es obligatoria; 0 es un
  // límite real (antes devolvía null y la alerta no salía). Sin módulo o sin catálogo, no hay límite.
  if (mp <= 0 && !provId && (hojaModulosActivos?.proveedoresMP === false || !(proveedores || []).length)) return null;
  return mp;
}

// Techo de calidad por proveedor de MP — SOLO AVISO, no bloquea el envío. Mismo criterio
// que aplica el motor (engine.js:2102-2110): la calidad que ve el mercado es la menor entre
// la calidad decidida y la calidad del proveedor elegido en el pedido de la ronda; sin
// pedido no hay techo. La calidad de cada proveedor sale del catálogo de la simulación
// (ref.proveedores, el mismo resolverProveedores que usa el motor), no de este archivo.
// Con el módulo de proveedores apagado o sin catálogo el motor no aplica techo: sin aviso.
function hojaTextoTechoCalidad(calidadDecidida, proveedorId, proveedores) {
  if (hojaModulosActivos?.proveedoresMP === false || !(proveedores || []).length) return null;
  const id = String(proveedorId || '').trim();
  const pv = id ? proveedores.find(x => x.id === id || x.nombre === id) : null;
  if (!pv) return { tipo: 'info', texto: 'Sin pedido de materia prima esta ronda, tu calidad no tiene techo por proveedor.' };
  // Mismo criterio que el motor (`_prov?.calidad ?? _declarada`): solo null/undefined anulan el techo.
  if (pv.calidad == null) {
    return { tipo: 'info', texto: 'El proveedor elegido no tiene una calidad definida: tu calidad no tiene techo por proveedor.' };
  }
  const techo = Number(pv.calidad);   // '' → 0, igual que Math.min en el motor
  if (!Number.isFinite(techo)) return null;   // calidad no numérica: el motor da NaN; sin aviso
  const decidida = Number(calidadDecidida);
  if (Number.isFinite(decidida) && decidida > techo) {
    return { tipo: 'alerta', texto: `Con el proveedor elegido, tu calidad máxima esta ronda será ${techo}. Decidiste ${decidida}: el mercado verá tu producto con calidad ${techo}.` };
  }
  return { tipo: 'info', texto: `Con el proveedor elegido, tu calidad máxima esta ronda es ${techo}. Tu calidad decidida se mantiene.` };
}

// Actualiza todos los avisos de techo de calidad de la hoja con lo que está en pantalla
// (calidad del producto activo y proveedor de la empresa; si el campo no está visible,
// usa lo guardado en la decisión).
function hojaRefrescarAvisoTechoCalidad(cont, decision, productoActivo, proveedores) {
  if (!cont) return;
  const enPantalla = (sel, porDefecto) => { const el = cont.querySelector(sel); return el ? el.value : porDefecto; };
  const r = hojaTextoTechoCalidad(
    enPantalla('[data-hoja-field="calidad"]', productoActivo?.calidad),
    enPantalla('[data-hoja-field="proveedorElegido"]', decision?.proveedorElegido),
    proveedores);
  cont.querySelectorAll('[data-hoja-aviso-calidad]').forEach(div => {
    if (!r) { div.hidden = true; div.textContent = ''; return; }
    div.hidden = false;
    div.textContent = (r.tipo === 'alerta' ? '⚠ ' : 'ℹ ') + r.texto;
    div.style.color = r.tipo === 'alerta' ? 'var(--accent4)' : 'var(--text3)';
    div.dataset.tipo = r.tipo;
  });
}

// Proveedor que está en pantalla (el del selector; si no está visible, el de la decisión).
function hojaProveedorEnPantalla(cont, decision, proveedores) {
  const el = cont.querySelector('[data-hoja-field="proveedorElegido"]');
  const id = String(el ? el.value : (decision?.proveedorElegido || '')).trim();
  return id ? ((proveedores || []).find(x => x.id === id || x.nombre === id) || null) : null;
}

// Selector de proveedor: la opción dice solo nombre y calidad; los demás datos del proveedor
// elegido van en una línea de detalle debajo (factor de costo, llegada, lote mínimo, precio de
// la MP con y sin IVA, descripción), y la referencia de la cantidad muestra el lote mínimo.
// Se actualizan al cambiar el proveedor. textoMP(pv) es el precio estimado de la MP (_textoMP,
// el mismo cálculo de engine.js). Sin lote máximo: el equipo decide cuánto pedir.
function hojaRefrescarDetalleProveedor(cont, decision, proveedores, textoMP) {
  if (!cont) return;
  const pv = hojaProveedorEnPantalla(cont, decision, proveedores);
  const mp = pv ? textoMP(pv) : '';
  cont.querySelectorAll('[data-hoja-detalle-proveedor]').forEach(div => {
    div.textContent = '';
    if (!pv) { div.textContent = 'Sin pedido este trimestre: no llega materia prima nueva.'; return; }
    const lt = Number(pv.leadTime ?? 1);
    const llegada = lt === 0 ? 'Llega en el mismo trimestre' : `Llega en ${lt} trimestre${lt === 1 ? '' : 's'}`;
    // Nombre completo: el selector es angosto y puede cortarlo.
    const nombre = document.createElement('strong');
    nombre.textContent = pv.nombre;
    div.appendChild(nombre);
    const linea = document.createElement('div');
    linea.textContent = [`Costo MP ×${pv.factorCosto ?? 1}`, llegada, `Lote mínimo ${pv.loteMin ?? 0} unid`, mp].filter(Boolean).join(' · ');
    div.appendChild(linea);
    if (pv.descripcion) {
      const d = document.createElement('div');
      d.style.fontStyle = 'italic';
      d.style.marginTop = '2px';
      d.textContent = pv.descripcion;
      div.appendChild(d);
    }
  });
  cont.querySelectorAll('[data-hoja-ref-cantidad-mp]').forEach(td => {
    td.textContent = '';
    if (!pv) { td.textContent = 'Elegí un proveedor para ver el precio de la MP'; return; }
    if (mp) {
      td.appendChild(document.createTextNode(mp + ' por unidad de MP (el IVA vuelve como crédito fiscal)'));
      td.appendChild(document.createElement('br'));
    }
    const s = document.createElement('strong');
    s.textContent = `Lote mínimo de ${pv.nombre}: ${pv.loteMin ?? 0} unid`;
    td.appendChild(s);
  });
}

// Precio de referencia del segmento (shock estructural, regla B). Mismo cálculo que el motor
// (engine.js, elasticidadPrecioRef): Pref = precio de la competencia × margenRef ×
// (1 + k × max(0, calidad efectiva − calidad de la competencia)), con la calidad decidida
// limitada por la del proveedor (solo con el módulo de proveedores, igual que el techo).
// datos = referencia.precioReferencia de GET /api/decisiones (null si la regla no rige).
// Solo el precio: el multiplicador no se muestra.
function hojaPrecioReferencia(datos, segmento, calidadDecidida, pv) {
  if (!datos) return null;
  const comp = (datos.competencia || []).find(c => c.segmento === segmento);
  if (!comp) return null;
  const decidida = Number(calidadDecidida) || 5;
  const techo = (hojaModulosActivos?.proveedoresMP !== false && pv && pv.calidad != null && pv.calidad !== '')
    ? Number(pv.calidad) : NaN;
  const calidadEf = Number.isFinite(techo) ? (Math.min(decidida, techo) || 5) : decidida;
  const extra = Number(datos.k || 0) * Math.max(0, calidadEf - Number(comp.calidad || 0));
  const pref = Math.round(Number(comp.precio) * Number(datos.margenRef) * (1 + extra) * 100) / 100;
  return { pref, comp, calidadEf, extraPct: extra * 100, margenRef: Number(datos.margenRef) };
}

function hojaRefrescarPrecioReferencia(cont, decision, productoActivo, ref) {
  if (!cont) return;
  const enPantalla = (sel, porDefecto) => { const el = cont.querySelector(sel); return el ? el.value : porDefecto; };
  const r = hojaPrecioReferencia(ref?.precioReferencia,
    enPantalla('[data-hoja-field="segmentoObjetivo"]', productoActivo?.segmentoObjetivo),
    enPantalla('[data-hoja-field="calidad"]', productoActivo?.calidad),
    hojaProveedorEnPantalla(cont, decision, ref?.proveedores));
  cont.querySelectorAll('[data-hoja-precio-ref]').forEach(div => {
    if (!r) { div.hidden = true; div.textContent = ''; return; }
    div.hidden = false;
    div.textContent = `Precio de referencia de tu segmento: Bs ${fmt.d(r.pref, 2)} (competencia Bs ${fmt.d(r.comp.precio, 2)} × ${fmt.d(r.margenRef, 2)}`
      + (r.extraPct > 0 ? `, más un ${fmt.d(r.extraPct, 0)} % por tu calidad efectiva ${r.calidadEf} frente a ${r.comp.calidad}` : '') + ')';
  });
}

// Alertas de coherencia de la pestaña Cierre. Son informativas: no bloquean el envío
// (los bloqueos siguen siendo los de siempre: excesoCapacidadAgregada y el servidor).
// Comparan la producción total planificada (todos los productos activos) contra los
// límites de empresa. En R1 con constitución vía Fase 0 no aplican: el motor fuerza
// la producción a 0 (bloquearProduccionR1).
function hojaAlertasCoherencia(cont, decision, params, ref, n) {
  const alertas = [];
  if (n === 1 && ['fase0', 'homogeneo_activos'].includes(ref?.modoInicio)) return alertas;
  const prods = (Array.isArray(decision?.productos) ? decision.productos : []).filter(x => x && x.activo !== false);
  const total = prods.reduce((s, x) => s + (Number(x.produccion) || 0), 0);
  if (!(total > 0)) return alertas;
  const cap = capacidadMaxLive(cont, decision, params);
  if (total > cap.capPlanta) {
    alertas.push({ pestana: 'produccion',
      texto: `La producción planificada (${fmt.num(total)} u) supera la capacidad de tu planta (${fmt.num(cap.capPlanta)} u).` });
  }
  if (total > cap.capOperarios) {
    alertas.push({ pestana: 'rrhh',
      texto: `La producción planificada (${fmt.num(total)} u) supera lo que pueden producir tus operarios (${fmt.num(cap.capOperarios)} u).` });
  }
  const mp = hojaMPDisponibleRonda(decision, n, ref?.proveedores);
  if (mp !== null) {
    const producibles = Math.floor(mp / (params?.unidadesMPporUnidad ?? 1));
    if (total > producibles) {
      alertas.push({ pestana: 'produccion',
        texto: `La materia prima disponible esta ronda alcanza para ${fmt.num(producibles)} u y planificaste ${fmt.num(total)} u. Si no la bajás, el envío se rechaza.` });
    }
  }
  return alertas;
}

// T5 — la hoja no borra lo escrito.
// 1) Una sola carga en vuelo: initEquipo (app.js:1532) y el clic en "Hoja de Decisión"
//    (app.js:271) podían lanzar dos cargas a la vez; la que terminaba última reemplazaba
//    state.decisiones con lo del servidor y pisaba lo escrito entre medio. Ahora la
//    segunda llamada espera la misma carga.
// 2) Volver a la hoja desde el menú con cambios sin guardar ya no recarga: antes cada
//    clic traía la decisión del servidor y descartaba lo escrito sin avisar. Guardar y
//    Enviar ponen hojaTieneCambiosSinGuardar = false antes de recargar, así que siguen
//    trayendo el estado nuevo del servidor.
let hojaCargaEnVuelo = null;
async function loadHojaDecision() {
  if (hojaCargaEnVuelo) return hojaCargaEnVuelo;
  if (hojaTieneCambiosSinGuardar && document.querySelector('#hojaContent [data-hoja-field]')) return;
  hojaCargaEnVuelo = hojaCargarDesdeServidor();
  try { return await hojaCargaEnVuelo; } finally { hojaCargaEnVuelo = null; }
}

async function hojaCargarDesdeServidor() {
  const cont = document.getElementById('hojaContent');
  const sel  = document.getElementById('hojaRondaSelector');
  if (!cont) { console.error('hojaContent no encontrado'); return; }

  cont.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Cargando hoja de decisión…</div>';

  let decData, resData;
  try {
    [decData, resData] = await Promise.all([
      api('GET', '/api/decisiones'),
      api('GET', '/api/resultados'),
    ]);
  } catch(e) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p style="color:var(--accent4)">Error de conexión: ${e.message}</p></div>`;
    return;
  }

  hojaRondaActual = decData.ronda;
  hojaTieneCambiosSinGuardar = false;
  hojaModulosActivos = decData.referencia?.modulosActivos || null;
  hojaHistorialResultados = resData.historial || [];

  // Construir navegación de rondas
  const simuladas = new Set((resData.historial || []).map(h => h.ronda));
  let navHTML = '';
  for (let i = 1; i <= 20; i++) {
    const isCurrent = i === decData.ronda;
    const isSim     = simuladas.has(i);
    const isFuture  = i > decData.ronda;
    const cls = isCurrent ? 'active' : isSim ? 'done' : '';
    navHTML += `<button class="hoja-round-btn ${cls}" ${isFuture?'disabled':''} onclick="hojaIrRonda(${i})">T${i}</button>`;
  }
  if (sel) sel.innerHTML = navHTML;

  // Renderizar ronda actual
  await hojaRenderRonda(decData.ronda, decData.decision, decData.roundState, null);
}

// Navegar a otra ronda desde el selector
window.hojaIrRonda = async (n) => {
  if (n === hojaRondaActual) return;
  if (hojaTieneCambiosSinGuardar) {
    if (!confirm('Tienes cambios sin guardar en esta ronda. Si continúas, se perderán. Si quieres conservarlos, cancela y usa el botón "Guardar borrador" antes de navegar. ¿Deseas continuar sin guardarlos?')) {
      return;
    }
  }
  hojaRondaActual = n;
  document.querySelectorAll('.hoja-round-btn').forEach((b, i) => b.classList.toggle('active', i+1===n));

  const cont = document.getElementById('hojaContent');
  if (!cont) return;
  cont.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Cargando…</div>';

  try {
    // Ronda actual: cargar decisión editable
    const decData = await api('GET', '/api/decisiones');
    if (n === decData.ronda) {
      hojaTieneCambiosSinGuardar = false;
      await hojaRenderRonda(n, decData.decision, decData.roundState, null);
      return;
    }
    // Ronda pasada: cargar resultado + decisión del historial
    const resData = await api('GET', '/api/resultados');
    const item = resData.historial?.find(h => h.ronda === n);
    if (item) {
      hojaTieneCambiosSinGuardar = false;
      await hojaRenderRonda(n, item.decision || {}, 'simulated', item.resultado);
    } else {
      cont.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>Sin datos para la ronda ${n}</p></div>`;
    }
  } catch(e) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p style="color:var(--accent4)">${e.message}</p></div>`;
  }
};

// Renderiza la hoja para una ronda específica
// NOTA: existe una copia con la misma firma en app.js (línea ~1810).
// No se ejecuta nunca: en scripts clásicos sin módulos ES, la segunda
// declaración global de una función pisa a la primera, y este archivo
// (equipo-hoja.js) se carga después de app.js en index.html — esta es
// la versión que realmente corre. La de app.js queda muerta pero
// presente; no asumir que ambas están activas.
async function hojaRenderRonda(n, decision, roundState, resultado) {
  const cont = document.getElementById('hojaContent');
  if (!cont) return;
  decision = decision || {};
  decision = normalizarDecisionMultiproducto(decision);
  state.decisiones = decision;

  if (roundState === 'pending') {
    cont.innerHTML = `
      <div class="round-pending-banner">
        <div style="font-size:2.5rem;margin-bottom:14px">⏸</div>
        <h3 style="font-size:1rem;font-weight:700;color:var(--accent3);margin-bottom:8px">Ronda ${n} — Aún no habilitada</h3>
        <p style="color:var(--text2);font-size:.88rem;line-height:1.7;max-width:400px;margin:0 auto">
          El profesor no ha activado la hoja de decisiones para este trimestre.<br>
          <strong>Regresa cuando el profesor indique que está disponible.</strong>
        </p>
        <button class="btn btn-ghost" style="margin-top:20px" onclick="loadHojaDecision()">↺ Verificar estado</button>
      </div>`;
    return;
  }

  // ── ESTADO PRE-SIM: el profesor calculó la demanda, el equipo debe confirmar ──
  if (roundState === 'pre-sim') {
    try {
      const psData = await api('GET', '/api/presim');
      // presim puede ser un objeto (1 producto) o array (múltiples productos)
      const psRaw = psData.presim;
      const psList = Array.isArray(psRaw) ? psRaw : [psRaw];
      const yaConfirmado = psList.every(p => p.confirmado);

      // Construir filas de tabla para cada producto
      const filas = psList.map((ps, idx) => `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:10px 14px;font-weight:700;color:var(--accent3)">
            Producto ${idx+1}
          </td>
          <td style="padding:10px 14px;font-size:.82rem">${ps.producto||'—'}</td>
          <td style="padding:10px 14px;font-size:.82rem">${ps.segmento||'—'}</td>
          <td style="padding:10px 14px;text-align:right;font-family:var(--font-mono)">${fmt.num(ps.demandaFormal)}</td>
          <td style="padding:10px 14px;text-align:right;font-family:var(--font-mono);color:var(--accent3)">${fmt.pct(ps.shareEstimado)}</td>
          <td style="padding:10px 14px;text-align:right;font-family:var(--font-mono);color:var(--accent5);font-weight:700">${fmt.num(ps.demandaAsignada)}</td>
          <td style="padding:10px 14px;text-align:right;font-family:var(--font-mono)">${fmt.num(ps.produccion)}</td>
          <td style="padding:10px 14px;text-align:right;font-family:var(--font-mono);color:var(--accent5);font-weight:700">${fmt.num(ps.ventasEstimadas)}</td>
          <td style="padding:10px 14px;text-align:right;font-family:var(--font-mono);color:${(ps.inventarioFinalEst||0)>0?'var(--accent4)':'var(--text)'}">${fmt.num(ps.inventarioFinalEst)}</td>
        </tr>
      `).join('');

      const totalVentas     = psList.reduce((s,p) => s + (p.ventasEstimadas||0), 0);
      const totalDemanda    = psList.reduce((s,p) => s + (p.demandaAsignada||0), 0);
      const totalProduccion = psList.reduce((s,p) => s + (p.produccion||0), 0);

      cont.innerHTML = `
        <div style="max-width:860px;margin:0 auto;padding:20px">
          <div style="text-align:center;margin-bottom:20px">
            <div style="font-size:2rem;margin-bottom:8px">📊</div>
            <h3 style="font-size:1.05rem;font-weight:700;color:var(--accent3)">Ronda ${n} — Demanda Estimada por Producto</h3>
            <p style="color:var(--text2);font-size:.84rem;margin-top:4px">
              El profesor ejecutó el cálculo de demanda para tus ${psList.length} producto(s). Revisa y confirma.
            </p>
          </div>

          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;margin-bottom:14px">
            <div style="background:var(--bg3);padding:8px 16px;border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:.62rem;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px">
              Resultados del cálculo de mercado
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:.82rem">
                <thead>
                  <tr style="background:rgba(255,255,255,.04)">
                    <th style="padding:8px 14px;text-align:left;font-size:.68rem;color:var(--text3);text-transform:uppercase">#</th>
                    <th style="padding:8px 14px;text-align:left;font-size:.68rem;color:var(--text3);text-transform:uppercase">Producto</th>
                    <th style="padding:8px 14px;text-align:left;font-size:.68rem;color:var(--text3);text-transform:uppercase">Segmento</th>
                    <th style="padding:8px 14px;text-align:right;font-size:.68rem;color:var(--text3);text-transform:uppercase">Demanda formal</th>
                    <th style="padding:8px 14px;text-align:right;font-size:.68rem;color:var(--text3);text-transform:uppercase">Market share</th>
                    <th style="padding:8px 14px;text-align:right;font-size:.68rem;color:var(--accent5);text-transform:uppercase">Demanda asignada</th>
                    <th style="padding:8px 14px;text-align:right;font-size:.68rem;color:var(--text3);text-transform:uppercase">Producción</th>
                    <th style="padding:8px 14px;text-align:right;font-size:.68rem;color:var(--accent5);text-transform:uppercase">Ventas estimadas</th>
                    <th style="padding:8px 14px;text-align:right;font-size:.68rem;color:var(--text3);text-transform:uppercase">Inv. final est.</th>
                  </tr>
                </thead>
                <tbody>${filas}</tbody>
                <tfoot>
                  <tr style="background:rgba(6,255,165,.06);border-top:2px solid var(--border2)">
                    <td colspan="5" style="padding:8px 14px;font-weight:700;font-size:.82rem">TOTAL EMPRESA</td>
                    <td style="padding:8px 14px;text-align:right;font-family:var(--font-mono);font-weight:700;color:var(--accent5)">${fmt.num(totalDemanda)}</td>
                    <td style="padding:8px 14px;text-align:right;font-family:var(--font-mono);font-weight:700">${fmt.num(totalProduccion)}</td>
                    <td style="padding:8px 14px;text-align:right;font-family:var(--font-mono);font-weight:700;color:var(--accent5)">${fmt.num(totalVentas)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div style="background:rgba(255,209,102,.08);border:1px solid rgba(255,209,102,.3);border-radius:var(--r);padding:10px 14px;margin-bottom:16px;font-size:.81rem;color:var(--text2)">
            <strong style="color:var(--accent3)">ℹ️ ¿Qué significa esto?</strong> —
            Valores que el simulador usará en la simulación final. Reflejan tu atractivo competitivo frente a todos los equipos.
            <strong>No puedes modificarlos</strong> — son resultado de tus decisiones enviadas.
            <div style="margin-top:6px">Estimación con los competidores del mercado y sin eventos externos (shocks).</div>
            ${(n === 1 && ['fase0', 'homogeneo_activos'].includes(state.ref?.modoInicio))
              ? '<div style="margin-top:6px;font-weight:700;color:var(--accent3)">En la Ronda 1 no hay producción: tus ventas serán 0.</div>'
              : ''}
          </div>

          ${yaConfirmado
            ? '<div style="text-align:center;padding:14px;background:rgba(6,255,165,.08);border:1px solid rgba(6,255,165,.3);border-radius:var(--r)"><span style="font-size:1.4rem">✅</span><p style="color:var(--accent5);font-weight:700;margin-top:4px">Ya confirmaste la recepción de estos datos</p><p style="color:var(--text2);font-size:.82rem;margin-top:4px">Espera a que el profesor ejecute la simulación final.</p></div>'
            : '<button class="btn btn-success btn-full" style="padding:12px;font-size:.95rem" id="btnConfirmarPresim">✓ Confirmar — Recibí mi demanda estimada</button><p style="text-align:center;font-size:.74rem;color:var(--text3);margin-top:6px">Al confirmar le indicas al profesor que viste estos datos.</p>'
          }
        </div>`;

      if (!yaConfirmado) {
        document.getElementById('btnConfirmarPresim')?.addEventListener('click', async () => {
          try {
            await api('POST', '/api/presim/confirmar');
            toast('✅ Confirmado correctamente', 'success');
            await hojaRenderRonda(n, decision, roundState, resultado);
          } catch(e) { toast(e.message, 'error'); }
        });
      }
    } catch(e) {
      cont.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p style="color:var(--accent4)">${e.message}</p></div>`;
    }
    return;
  }

  const ref = state.ref;
  if (!ref) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Error: datos de referencia no cargados. <button class="btn btn-ghost btn-sm" onclick="location.reload()">Recargar</button></p></div>`;
    return;
  }

  const j = decision.justificaciones || {};
   const productos = decision.productos || [];

      if (hojaProductoActivo >= productos.length) {
        hojaProductoActivo = 0;
      }

      const productoActivo = productos[hojaProductoActivo] || productos[0] || crearProductoDefault(0);

    window.hojaSeleccionarProducto = (idx) => {
      hojaProductoActivo = idx;
      hojaRenderRonda(n, state.decisiones, roundState, resultado);
    };

    window.hojaAgregarProducto = () => {
      if (!Array.isArray(state.decisiones.productos)) {
        state.decisiones.productos = [];
      }

      if (state.decisiones.productos.length >= 5) {
        toast('Máximo 5 productos por empresa', 'info');
        return;
      }

      state.decisiones.productos.push(
        crearProductoDefault(state.decisiones.productos.length)
      );

      hojaProductoActivo = state.decisiones.productos.length - 1;

      hojaRenderRonda(n, state.decisiones, roundState, resultado);
    };

    window.hojaEliminarProducto = (idx) => {
      if (!Array.isArray(state.decisiones.productos) || state.decisiones.productos.length <= 1) {
        toast('No se puede eliminar el único producto', 'info');
        return;
      }
      state.decisiones.productos.splice(idx, 1);
      // Ajustar índice activo si es necesario
      if (hojaProductoActivo >= state.decisiones.productos.length) {
        hojaProductoActivo = state.decisiones.productos.length - 1;
      }
      hojaRenderRonda(n, state.decisiones, roundState, resultado);
    };

  const isEditable = roundState === 'open' && !decision.submitted;
  const isLocked   = roundState === 'locked';

  const inp = (field, val, type='number', extra='') =>
    isEditable
      ? `<input class="hoja-input editable" data-hoja-field="${field}" type="${type}" value="${val??''}" ${extra}/>`
      : `<span class="hoja-value-ro">${val??'—'}</span>`;

  const camposProductoSelect = new Set([
    'producto',
    'segmentoObjetivo',
    'canalPrincipal',
    'canalSecundario',
    'tipoInnovacion'
  ]);
  const sel = (field, opts) => {
    const valorReadOnly = camposProductoSelect.has(field)
      ? (productoActivo?.[field] ?? decision?.[field] ?? '—')
      : (decision?.[field] ?? '—');
    return isEditable
      ? `<select class="hoja-select editable" data-hoja-field="${field}">${opts}</select>`
      : `<span class="hoja-value-ro">${valorReadOnly}</span>`;
  };

  const ta = (jfield, ph) =>
    isEditable
      ? `<textarea class="hoja-textarea editable" data-hoja-just="${jfield}" placeholder="${ph}">${j[jfield]||''}</textarea>`
      : `<span style="color:var(--text3);font-size:.76rem;font-style:italic">${j[jfield]||'—'}</span>`;

  const chk = (field, label) =>
    isEditable
      ? `<input type="checkbox" data-hoja-field="${field}" ${decision[field]?'checked':''} style="width:16px;height:16px;accent-color:var(--accent)"/> ${label}`
      : `<span class="hoja-value-ro">${decision[field]?'✓ Sí':'✗ No'}</span> ${label}`;

  const inpActivo = (tipo, campo, val, extra='') =>
    isEditable
      ? `<input class="hoja-input editable" data-activo-tipo="${tipo}" data-activo-campo="${campo}" type="number" value="${val ?? 0}" min="0" ${extra}/>`
      : `<span class="hoja-value-ro">${campo === 'monto' ? fmt.bs(val ?? 0) : fmt.num(val ?? 0)}</span>`;

    const segOpts = '<option value="">-- Seleccionar segmento --</option>' +
    ref.segmentos.map(s => `<option ${s.nombre === productoActivo.segmentoObjetivo ? 'selected' : ''}>${s.nombre}</option>`).join('');
     // Punto (a), Fase 1 de pantallas: value = el nombre, así el handler guarda
     // el nombre aunque la etiqueta lleve el costo base; "costo base Bs X" y no
     // "(Bs X)", que se leía como precio de venta.
     const prodOpts = '<option value="">-- Seleccionar producto --</option>' +
    ref.tiposProducto.map(t => `<option value="${String(t.nombre).replace(/"/g, '&quot;')}" ${t.nombre === productoActivo.producto ? 'selected' : ''}>${t.nombre} — costo base Bs ${t.costoBase}</option>`).join('');
  
      // canales puede ser array [{nombre,...}] o objeto {nombre:{...}}
  const _canalNames = Array.isArray(ref.canales)
    ? ref.canales.map(c => c.nombre)
    : Object.keys(ref.canales || {});
  // El canal PRINCIPAL no lleva 'Ninguno': toda venta necesita un canal real. Antes
  // ambos selectores compartían la misma lista, así que "Ninguno" era elegible en el
  // principal y pasaba la validación por ser un string no vacío — el motor hacía
  // canales['Ninguno'] || {} (engine.js:565) y el producto competía sin atractivo ni
  // comisión de canal, en silencio. El SECUNDARIO sí lo conserva: "sin canal
  // secundario" es una decisión válida y es el default de storage.defaultDecision.
  // La opción vacía inicial fuerza una elección explícita cuando aún no hay canal.
  const canalOptsBase = _canalNames.map(c => `<option ${c===productoActivo.canalPrincipal?'selected':''}>${c}</option>`).join('');
  const canalOpts  = (productoActivo.canalPrincipal && _canalNames.includes(productoActivo.canalPrincipal))
    ? canalOptsBase
    : '<option value="" selected>-- Seleccionar canal --</option>' + canalOptsBase;
  const canal2Opts = ['Ninguno', ..._canalNames].map(c => `<option ${c===productoActivo.canalSecundario?'selected':''}>${c}</option>`).join('');
  const tipoPresOpts = ['Ninguno','Operativo','Inversión'].map(t=>`<option ${t===decision.tipoPrestamo?'selected':''}>${t}</option>`).join('');
  const tipoInnOpts = ['Producto','Proceso','Canal'].map(t=>`<option ${t===productoActivo.tipoInnovacion?'selected':''}>${t}</option>`).join('');
  const tipoInvOpts  = ['No','Básica','Premium','Estratégico'].map(t=>`<option ${t===decision.tipoInvestigacion?'selected':''}>${t}</option>`).join('');

  const p = ref.parametros || {};
  // Punto (b), Fase 1 de pantallas: precio de la MP que cobraría cada proveedor,
  // el mismo de engine.js (promedioPonderadoMP) con la producción declarada.
  const _textoMP = (pv) => {
    const e = hojaEstimarMPProveedor(productos, ref.tiposProducto, pv, p, hojaModulosActivos);
    return (e && e.bruto > 0)
      ? `MP ≈ Bs ${fmt.d(e.bruto, 2)} con IVA · Bs ${fmt.d(e.neto, 2)} sin IVA${e.nProductos > 1 ? ' (promedio de tus ' + e.nProductos + ' productos)' : ''}`
      : '';
  };
  resolverInversionActivos(decision, p);
  const invActivos = decision.inversionActivos;
  // FASE 6F-P2B2 — selectores no-libres: catálogo de plantas + paquetes de capacidad
  const _catPlantas = catalogoPlantasFase0(p);
  const _capActualHoja = capacidadActualHoja(decision, p);
  const _plantaOpts = '<option value="">Ninguna</option>' + _catPlantas.map(c =>
    `<option value="${c.n}" ${String(c.n)===String(invActivos.nuevaPlanta.tipoPlanta)?'selected':''}>Planta ${c.n} · ${c.nombre} — ${fmt.bs(c.monto)} · +${fmt.num(c.capacidad)} unid · mín ${c.operariosMinimos} op</option>`
  ).join('');
  const _paqueteOpts = (lista, sel) => lista.map(q =>
    `<option value="${q.key}" ${q.key===String(sel||'')?'selected':''}>${q.label}</option>`).join('');
  const selActivo = (tipo, campo, opts, selLabel) => isEditable
    ? `<select class="hoja-input editable" data-activo-tipo="${tipo}" data-activo-campo="${campo}">${opts}</select>`
    : `<span class="hoja-value-ro">${selLabel || '—'}</span>`;
  const _plantaSel = _catPlantas.find(c => String(c.n)===String(invActivos.nuevaPlanta.tipoPlanta));
  const _optCompl = (k, l, tipo) => `<option value="${k}" ${k===String(invActivos[tipo].paquete||'')?'selected':''}>${l}${(k && montoComplementario(tipo,k,p)>0)?` — ${fmt.bs(montoComplementario(tipo,k,p))}`:''}</option>`;
  const _vehOpts  = OPCIONES_VEHICULO.map(([k,l]) => _optCompl(k,l,'vehiculos')).join('');
  const _sinoOpts = (tipo) => OPCIONES_SI_NO.map(([k,l]) => _optCompl(k,l,tipo)).join('');
  const renderResumenInversionActivos = () => {
    const t = totalesInversionActivos(decision);
    return `<strong>Total inversi&oacute;n:</strong> ${fmt.bs(t.total)} &middot; <strong>Capacidad futura agregada:</strong> ${fmt.num(t.capacidad)} unid`;
  };

  // Hidratación de MP para la hoja: misma regla de arribo que el motor
  // (engine.js procesarPedidosMP, líneas 203-212). Los pedidos con
  // rondaEntrega <= n YA llegaron → suman a disponible; solo rondaEntrega > n
  // sigue en tránsito. Es solo presentación: el motor recalcula igual al ejecutar.
  const _pedMP         = Array.isArray(decision.pedidosPendientes) ? decision.pedidosPendientes : [];
  const _mpArriboRonda = _pedMP.filter(pp => (pp.rondaEntrega ?? 0) <= n)
                               .reduce((s, pp) => s + (pp.cantidad || 0), 0);
  const _mpEnTransito  = _pedMP.filter(pp => (pp.rondaEntrega ?? 0) >  n);
  const stockMPVisible = (decision.stockMPInicial ?? 0) + _mpArriboRonda;

  // FIX capacidad de producción R1: tope real = MIN(planta del equipo, operarios × productividadBase)
  const capPlantaEquipo          = decision.capacidadMaxProduccion ?? p.capacidadMaxProduccion ?? 1500;
  const opIniInicial             = decision.operariosIniciales ?? p.operariosIniciales ?? 4;
  const factorCapInicial         = p.factorCapacitacion ?? 0.05;
  const montoCapInicial          = decision.montoCapacitacion ?? 0;
  const capOperariosInicial      = Math.round(opIniInicial * (p.productividadBase ?? 440) * (1 + factorCapInicial * montoCapInicial / 10000));
  const capMaxProduccionInicial  = Math.min(capPlantaEquipo, capOperariosInicial);

  const estadoBadge = roundState==='simulated' ? '<span class="badge badge-simulated">🔒 Simulada</span>'
    : isLocked ? '<span class="badge badge-alert">🔒 Cerrada</span>'
    : decision.submitted ? '<span class="badge badge-sent">✓ Enviada</span>'
    : '<span class="badge badge-open">🟢 Abierta</span>';

  // ── Pestañas por gerente ──────────────────────────────────────────────────
  // La hoja sigue siendo UN solo formulario: cambiar de pestaña solo muestra u
  // oculta paneles, así que todos los campos siguen en el DOM y
  // sincronizarHojaConEstado los lee igual que antes (el payload no cambia).
  // Cada fila conserva su HTML, sus data-hoja-field y su justificación: solo
  // cambió de sección. Las condiciones de visibilidad son las de siempre (módulos
  // ADR-002 y "campos de empresa solo en Producto 1"), más investigacionMercado,
  // que antes no se aplicaba en la hoja.
  if (hojaPestanasRonda !== n) { hojaPestanasRonda = n; hojaPestanasVisitadas = new Set(); }
  const esProducto1      = hojaProductoActivo === 0;
  const conOperarios     = p.costoOperario !== undefined;
  const conFuerzaVentas  = hojaModulosActivos?.fuerzaVentas !== false;
  const conMP            = !!(ref.proveedores && ref.proveedores.length > 0 && hojaModulosActivos?.proveedoresMP !== false && esProducto1);
  const conActivos       = hojaModulosActivos?.inversionActivos !== false && esProducto1;
  const conInnovacion    = hojaModulosActivos?.innovacion !== false;
  const conInvestigacion = hojaModulosActivos?.investigacionMercado !== false && esProducto1;
  // Una pestaña sin campos por los módulos apagados no se muestra (solo puede pasar con RRHH).
  const pestanasVisibles = HOJA_PESTANAS.filter(t => t.id !== 'rrhh' || conOperarios || conFuerzaVentas);
  if (!pestanasVisibles.some(t => t.id === hojaPestanaActiva)) hojaPestanaActiva = pestanasVisibles[0].id;
  hojaPestanasVisitadas.add(hojaPestanaActiva);
  const tituloPestana = (id) => (HOJA_PESTANAS.find(t => t.id === id) || {}).titulo || id;
  const notaProducto1 = (txt) => `<div class="hoja-tab-ref">ℹ️ ${txt} en <strong>Producto 1</strong> · Aplica a toda la empresa.</div>`;
  const productoVivo  = () => state.decisiones?.productos?.[hojaProductoActivo] || productoActivo;

  // Alertas de coherencia: solo con la hoja editable. `raiz` es el contenedor de donde
  // capacidadMaxLive lee los inputs en vivo (null = valores de la decisión).
  const alertasActuales = (raiz) => isEditable
    ? hojaAlertasCoherencia(raiz, state.decisiones || decision, p, ref, n)
    : [];
  const alertasHTML = (alertas) => alertas.length
    ? alertas.map(a => `<div class="hoja-alerta">⚠ ${a.texto} <button type="button" class="hoja-alerta-link" onclick="hojaIrPestana('${a.pestana}')">Ir a ${tituloPestana(a.pestana)} →</button></div>`).join('')
    : '<div class="hoja-alerta hoja-alerta-ok">✓ Sin alertas de coherencia.</div>';
  const textoAlertas = (k) => k ? `⚠ ${k} alerta${k === 1 ? '' : 's'}` : '✓ Sin alertas';

  // Estado de cada pestaña: ○ sin tocar · ● en progreso · ✓ completa · ⚠ con alerta.
  // "Completa" = visitada y con los campos que exige validarDecisionEstudiante llenos
  // (del producto activo); las pestañas sin campos obligatorios se completan al visitarlas.
  const estadoPestana = (id, alertas) => {
    if (alertas.some(a => a.pestana === id) || (id === 'cierre' && alertas.length)) return 'alerta';
    if (!hojaPestanasVisitadas.has(id)) return 'sin';
    const pr = productoVivo();
    const txt = (v) => String(v ?? '').trim();
    // Funciones (no valores): solo se evalúa la de esta pestaña; Cierre consulta a las demás.
    const completa = {
      estrategia: () => !!txt(pr.producto) && !!txt(pr.segmentoObjetivo),
      marketing:  () => !!txt(pr.canalPrincipal) && txt(pr.canalPrincipal) !== 'Ninguno' && Number(pr.precioVenta) > 0,
      produccion: () => txt(pr.produccion) !== '' && Number(pr.produccion) >= 0,
      cierre:     () => pestanasVisibles.every(t => t.id === 'cierre' || estadoPestana(t.id, alertas) === 'completa'),
    }[id];
    return (completa && !completa()) ? 'progreso' : 'completa';
  };

  // Línea de referencia al inicio de cada pestaña: datos ya calculados, sin fórmulas.
  const refLinea = (id, alertas, raiz) => {
    const d  = state.decisiones || decision;
    const pr = productoVivo();
    const partes = [];
    if (id === 'estrategia') {
      partes.push(`Trimestre ${n} / 20`, `Producto ${hojaProductoActivo + 1} de ${(d.productos || []).length || 1}`);
    } else if (id === 'marketing') {
      const tp = (ref.tiposProducto || []).find(t => t.nombre === pr.producto);
      partes.push(`Producto: <strong>${pr.producto || '—'}</strong>${tp ? ` (costo base Bs ${tp.costoBase})` : ''}`,
                  `Segmento: <strong>${pr.segmentoObjetivo || '—'}</strong>`);
    } else if (id === 'produccion') {
      const ventas = hojaVentasRondaAnterior(n, pr.productoId || ('prod_' + (hojaProductoActivo + 1)));
      const invPT  = esProducto1 ? (d.inventarioInicial ?? pr.inventarioInicial) : pr.inventarioInicial;
      if (ventas !== null) partes.push(`Ventas de la ronda anterior: <strong>${fmt.num(ventas)} u</strong>`);
      if (invPT != null)   partes.push(`Inventario de producto terminado: <strong>${fmt.num(invPT)} u</strong>`);
      partes.push(`Tope real de producción: <strong>${fmt.num(capacidadMaxLive(raiz, d, p).capMax)} u</strong>`);
      if (conMP) partes.push(`Stock de MP disponible: <strong>${fmt.num(stockMPVisible)} u</strong>`);
    } else if (id === 'rrhh') {
      if (conOperarios) partes.push(`Operarios actuales: <strong>${d.operariosIniciales ?? p.operariosIniciales ?? 4}</strong>`,
                                    `Producción por operario: <strong>${fmt.num(p.productividadBase ?? 440)} u/trim</strong>`);
      if (conFuerzaVentas) partes.push(`Vendedores actuales: <strong>${d.vendedoresIniciales || 0}</strong>`);
    } else if (id === 'finanzas') {
      partes.push(`Caja <strong>${fmt.bs(d.cajaInicial)}</strong>`, `CxC <strong>${fmt.bs(d.cxcInicial)}</strong>`, `Deuda <strong>${fmt.bs(d.deudaInicial)}</strong>`);
    } else if (id === 'cierre') {
      partes.push(isEditable
        ? `${alertas.length} alerta${alertas.length === 1 ? '' : 's'} de coherencia · Las alertas son informativas: no impiden enviar.`
        : 'Resumen de las decisiones de esta ronda.');
    }
    return partes.join(' · ');
  };

  // Recalcula estados, alertas y líneas de referencia (lo llaman los handlers de los
  // campos y el cambio de pestaña). Usa cont.querySelector, nunca document.getElementById.
  const refrescarPestanas = () => {
    const alertas = alertasActuales(cont);
    cont.querySelectorAll('[data-hoja-tab-estado]').forEach(e => {
      const est = estadoPestana(e.dataset.hojaTabEstado, alertas);
      e.className = 'hoja-tab-estado ' + est;
      e.textContent = isEditable ? HOJA_ICONO_ESTADO[est] : '';
    });
    const cnt = cont.querySelector('#hojaAlertasCount');
    if (cnt) {
      cnt.textContent = textoAlertas(alertas.length);
      cnt.classList.toggle('con-alertas', alertas.length > 0);
    }
    const lista = cont.querySelector('#hojaAlertas');
    if (lista) lista.innerHTML = alertasHTML(alertas);
    pestanasVisibles.forEach(t => {
      const r = cont.querySelector('#hojaRef-' + t.id);
      if (r) r.innerHTML = refLinea(t.id, alertas, cont);
    });
  };

  // Navegación libre entre pestañas: solo muestra/oculta paneles.
  window.hojaIrPestana = (id) => {
    if (!pestanasVisibles.some(t => t.id === id)) return;
    hojaPestanaActiva = id;
    hojaPestanasVisitadas.add(id);
    cont.querySelectorAll('[data-hoja-tab-panel]').forEach(pn => { pn.hidden = pn.dataset.hojaTabPanel !== id; });
    cont.querySelectorAll('[data-hoja-tab-btn]').forEach(b => {
      const activa = b.dataset.hojaTabBtn === id;
      b.classList.toggle('active', activa);
      b.setAttribute('aria-selected', activa ? 'true' : 'false');
      if (activa) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    const i = pestanasVisibles.findIndex(t => t.id === id);
    const ant = cont.querySelector('#btnHojaAnterior');
    if (ant) ant.disabled = i <= 0;
    const sig = cont.querySelector('#btnHojaSiguiente');
    if (sig) sig.disabled = i >= pestanasVisibles.length - 1;
    refrescarPestanas();
    const wrap = cont.querySelector('.hoja-wrap');
    if (wrap && wrap.getBoundingClientRect().top < 0) wrap.scrollIntoView({ block: 'start' });
  };
  window.hojaPestanaRelativa = (delta) => {
    const i = pestanasVisibles.findIndex(t => t.id === hojaPestanaActiva);
    const destino = pestanasVisibles[i + delta];
    if (destino) window.hojaIrPestana(destino.id);
  };

  // ── 1 · Estrategia (Gerente General) ──
  const contenidoEstrategia = `
    <div class="hoja-section">
      <div class="hoja-section-title">Producto y segmento objetivo</div>
      <table class="hoja-table">
        <thead><tr><th>Decisión</th><th>Tu elección</th><th>Referencia</th><th>Justificación</th></tr></thead>
        <tbody>
          <tr><td class="hoja-label">🎯 Segmento objetivo</td>
              <td>${sel('segmentoObjetivo',segOpts)}</td>
              <td class="hoja-ref">Grupo de clientes al que orientarás tu estrategia. Los segmentos disponibles dependen de la industria configurada por el profesor.</td>
              <td>${ta('segmentoProducto','¿Por qué este segmento?')}</td></tr>
          <tr><td class="hoja-label">🧪 Tipo de producto</td>
              <td>${sel('producto',prodOpts)}</td>
              <td class="hoja-ref">Producto con el que competirás en el mercado. Debe ser coherente con el segmento objetivo, precio, canal y propuesta de valor.</td>
              <td></td></tr>
        </tbody>
      </table>
    </div>

    ${conInnovacion ? `
    <div class="hoja-section">
      <div class="hoja-section-title">Innovación</div>
      <table class="hoja-table">
        <thead><tr><th>Decisión</th><th>Tu elección</th><th>Referencia</th><th>Justificación</th></tr></thead>
        <tbody>
          <tr><td class="hoja-label">💡 ¿Innovar este trimestre?</td>
              <td><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" data-hoja-field="innovacion" ${productoActivo.innovacion ? 'checked' : ''} ${isEditable ? '' : 'disabled'}/>
                Sí, innovar
              </label></td>
              <td class="hoja-ref">Afecta costo unitario o atractivo según tipo</td>
              <td>${ta('innovacion','¿Por qué innovar y en qué?')}</td></tr>
          <tr><td class="hoja-label">🔧 Tipo de innovación</td>
              <td>${sel('tipoInnovacion',tipoInnOpts)}</td>
              <td class="hoja-ref">Producto: +CU · Proceso: −CU · Canal: +atractivo</td><td></td></tr>
          <tr><td class="hoja-label">💰 Inversión en innovación (Bs)</td>
              <td>${inp('montoInnovacion',productoActivo.montoInnovacion,'number','min="0" step="1000"')}</td>
              <td class="hoja-ref">Se desembolsa este trimestre (gasto operativo)</td><td></td></tr>
        </tbody>
      </table>
    </div>
    ` : ''}`;

  // ── 2 · Marketing ──
  const contenidoMarketing = `
    ${conInvestigacion ? `
    <div class="hoja-section">
      <div class="hoja-section-title">Investigación de mercado</div>
      <table class="hoja-table">
        <thead><tr><th>Decisión</th><th>Tu elección</th><th>Qué incluye</th><th>Justificación</th></tr></thead>
        <tbody>
          <tr><td class="hoja-label">🔍 Tipo de reporte</td>
              <td>${sel('tipoInvestigacion',tipoInvOpts)}</td>
              <td class="hoja-ref">
                Compra de información para decidir mejor. No genera ventas automáticamente.<br>
                <strong>Básica Bs ${fmt.num(p.costoInvestigacionBasica||5000)}:</strong> información inicial del mercado para orientar decisiones.<br>
                <strong>Premium Bs ${fmt.num(p.costoInvestigacionPremium||12000)}:</strong> información más detallada para comparar segmentos, canales o competencia.<br>
                <strong>Estratégica Bs ${fmt.num(p.costoInvestigacionEstrategico||20000)}:</strong> información más completa para apoyar decisiones de mayor alcance.
              </td>
              <td>${ta('investigacion','¿Por qué comprar este reporte?')}</td></tr>
        </tbody>
      </table>
    </div>
    ` : ''}

    <div class="hoja-section">
      <div class="hoja-section-title">Calidad, precio y canales</div>
      <table class="hoja-table">
        <thead><tr><th>Decisión</th><th>Tu elección</th><th>Referencia</th><th>Justificación</th></tr></thead>
        <tbody>
          <tr><td class="hoja-label">⭐ Calidad (1–10)</td>
              <td>${inp('calidad',productoActivo.calidad,'number','min="1" max="10" step="1"')}</td>
              <td class="hoja-ref">Nivel percibido de desempeño del producto. Mejorar calidad puede aumentar atractivo, pero también puede elevar el costo unitario según el producto y los parámetros de la industria.
                <div data-hoja-aviso-calidad hidden style="font-size:.76rem;margin-top:6px;line-height:1.4;font-weight:600"></div></td>
              <td></td></tr>
          <tr><td class="hoja-label">💰 Precio de venta (Bs)</td>
              <td>${inp('precioVenta',productoActivo.precioVenta,'number','min="0.1" step="0.1"')}</td>
              <td class="hoja-ref">Valor de venta al cliente. Un precio mayor puede mejorar margen, pero reducir atractivo si el mercado percibe alternativas más convenientes.
                <div data-hoja-precio-ref hidden style="font-size:.76rem;margin-top:6px;line-height:1.4;font-weight:600;color:var(--accent3)"></div></td>
              <td>${ta('precios','¿Estrategia de precio?')}</td></tr>
          <tr><td class="hoja-label">📦 Canal principal</td>
              <td>${sel('canalPrincipal',canalOpts)}</td>
              <td class="hoja-ref">Canal más importante para llegar al cliente. Puede afectar costos, comisiones, atractivo y necesidad de vendedores según la industria.</td>
              <td>${ta('canal','¿Por qué este canal?')}</td></tr>
          <tr><td class="hoja-label">📦 Canal secundario</td>
              <td>${sel('canalSecundario',canal2Opts)}</td>
              <td class="hoja-ref">Canal complementario. Sus efectos se combinan con el canal principal según la configuración del simulador.</td>
              <td></td></tr>
        </tbody>
      </table>
    </div>

    <div class="hoja-section">
      <div class="hoja-section-title">Comunicación</div>
      <table class="hoja-table">
        <thead><tr><th>Rubro</th><th>Monto (Bs)</th><th>Referencia</th><th>Justificación</th></tr></thead>
        <tbody>
          <tr><td class="hoja-label">📣 Publicidad</td>
              <td>${inp('publicidad',productoActivo.publicidad,'number','min="0" step="500"')}</td>
              <td class="hoja-ref">Inversión para aumentar visibilidad del producto dentro del esfuerzo total de marketing.</td>
              <td>${ta('marketing','¿Cómo distribuiste el presupuesto?')}</td></tr>
          <tr><td class="hoja-label">🎁 Promoción</td>
              <td>${inp('promocion',productoActivo.promocion,'number','min="0" step="500"')}</td>
              <td class="hoja-ref">Incentivo comercial para estimular la compra. Forma parte del esfuerzo total de marketing.</td><td></td></tr>
          <tr><td class="hoja-label">🎪 Eventos</td>
              <td>${inp('eventos',productoActivo.eventos,'number','min="0" step="500"')}</td>
              <td class="hoja-ref">Acción comercial de contacto directo con clientes. Contribuye al esfuerzo total de marketing.</td><td></td></tr>
          <tr><td class="hoja-label">📱 Marketing en redes</td>
              <td>${inp('marketingRedes',productoActivo.marketingRedes,'number','min="0" step="500"')}</td>
              <td class="hoja-ref">Comunicación digital para reforzar visibilidad, interacción y recordación. Debe adaptarse a la industria activa.</td><td></td></tr>
          <tr><td class="hoja-label">📰 Relaciones públicas</td>
              <td>${inp('relacionesPublicas',productoActivo.relacionesPublicas,'number','min="0" step="500"')}</td>
              <td class="hoja-ref">Acción para fortalecer reputación y confianza del mercado. Forma parte del esfuerzo total de marketing.</td><td></td></tr>
        </tbody>
      </table>
      <div style="padding:8px 14px;background:var(--bg3);font-size:.78rem;color:var(--text2)">
        Estas inversiones se integran al esfuerzo total de marketing del producto. No garantizan ventas por sí solas.
      </div>
    </div>`;

  // ── 3 · Producción ──
  const contenidoProduccion = `
    <div class="hoja-section">
      <div class="hoja-section-title">Plan de producción</div>
      <table class="hoja-table">
        <thead><tr><th>Decisión</th><th>Tu elección</th><th>Referencia</th><th>Justificación</th></tr></thead>
        <tbody>
          <tr>
            <td class="hoja-label">🏭 Producción (unidades)</td>
            <td>${inp('produccion',productoActivo.produccion,'number',`min="0" max="${capMaxProduccionInicial||1500}" step="100"`)}${
              // R1 con constitución vía Fase 0 (mismo criterio que usaConstitucionFase0 del
              // servidor): el motor fuerza la producción a 0 (bloquearProduccionR1). Va en esta
              // celda y no en .hoja-ref, que el aviso de capacidad reescribe al teclear.
              (n === 1 && ['fase0', 'homogeneo_activos'].includes(ref.modoInicio))
                ? '<div style="margin-top:4px;font-size:.78rem;color:var(--accent3)">En la Ronda 1 no hay producción: la maquinaria llega en la Ronda 2</div>'
                : ''}</td>
            <td class="hoja-ref">Tope real: ${fmt.num(capMaxProduccionInicial)} u (planta ${fmt.num(capPlantaEquipo)} u · operarios ${opIniInicial}×${p.productividadBase??440}=${fmt.num(capOperariosInicial)} u). La producción real puede ser menor si falta materia prima.</td>
            <td>${ta('produccion','¿Cómo estimaste la demanda?')}</td>
          </tr>
        </tbody>
      </table>
      ${conOperarios ? `
      <div style="padding:8px 14px;background:var(--bg3);font-size:.78rem;color:var(--text2)">
        La producción efectiva se determina por la menor restricción disponible entre la cantidad planificada, la capacidad de planta, los operarios disponibles y la materia prima utilizable. Si la simulación inició con Fase 0, la R1 puede tener producción bloqueada por instalación de maquinaria.
      </div>
      ` : ''}
    </div>

    ${conMP ? `
    <div class="hoja-section">
      <div class="hoja-section-title">Materia prima — Compra de insumos</div>
      <table class="hoja-table">
        <thead><tr><th>Decisión</th><th>Tu elección</th><th>Referencia</th><th>Nota</th></tr></thead>
        <tbody>
          <tr>
            <td class="hoja-label">📦 Stock MP disponible</td>
            <td><span class="hoja-value-ro">${fmt.num(stockMPVisible)} unid</span></td>
            <td class="hoja-ref">Heredado + pedidos recibidos esta ronda</td>
            <td style="font-size:.78rem;color:var(--text3)">
              Producibles: ${fmt.num(Math.floor(stockMPVisible / (p.unidadesMPporUnidad ?? 1)))} unid
              ${_mpEnTransito.length > 0
                ? ' · <strong style="color:var(--accent3)">Pedidos en tránsito: ' + _mpEnTransito.length + '</strong>'
                : ''}
            </td>
          </tr>
          <tr>
            <td class="hoja-label">🏢 Proveedor a elegir</td>
            <td>${isEditable
              ? `<select class="hoja-select editable" data-hoja-field="proveedorElegido">
                  <option value="">— Sin pedido este trimestre —</option>
                  ${ref.proveedores.map(pv =>
                    `<option value="${pv.id}" ${decision.proveedorElegido===pv.id?'selected':''}>${pv.nombre}${pv.calidad != null && pv.calidad !== '' ? ' · Calidad ' + pv.calidad : ''}</option>`
                  ).join('')}
                </select>`
              : `<span class="hoja-value-ro">${decision.proveedorElegido || '—'}</span>`
            }
              <div data-hoja-detalle-proveedor style="font-size:.76rem;margin-top:6px;line-height:1.4;color:var(--text3)"></div></td>
            <td class="hoja-ref">El stock llega en la ronda indicada por el lead time
              <div data-hoja-aviso-calidad hidden style="font-size:.76rem;margin-top:6px;line-height:1.4;font-weight:600"></div></td>
            <td style="font-size:.78rem;color:var(--accent4)">⚠ Pedir con anticipación</td>
          </tr>
          <tr>
            <td class="hoja-label">🛒 Cantidad a pedir (unid MP)</td>
            <td>${inp('cantidadMPpedida', decision.cantidadMPpedida ?? 0, 'number', 'min="0" step="100"')}</td>
            <td class="hoja-ref" data-hoja-ref-cantidad-mp></td>
            <td style="font-size:.78rem;color:var(--text3)">0 si no vas a pedir. 1 unid MP → ${p.unidadesMPporUnidad ?? 1} unid producidas</td>
          </tr>
        </tbody>
      </table>
    </div>
    ` : ''}

    ${conActivos ? `
    <div class="hoja-section">
      <div class="hoja-section-title">Capacidad de planta</div>
      <table class="hoja-table">
        <thead><tr><th>Activo</th><th>Monto (Bs)</th><th>Capacidad futura</th><th>Nota contable</th></tr></thead>
        <tbody>
          <tr>
            <td class="hoja-label">Nueva planta</td>
            <td>${selActivo('nuevaPlanta', 'tipoPlanta', _plantaOpts, _plantaSel ? `Planta ${_plantaSel.n} · ${_plantaSel.nombre}` : 'Ninguna')}
                <div class="hoja-ref">Costo: <span id="invNuevaPlantaMonto">${fmt.bs(invActivos.nuevaPlanta.monto)}</span> &middot; Op. m&iacute;n: <span id="invNuevaPlantaOp">${fmt.num(operariosPlantaSeleccionada(decision, p))}</span></div></td>
            <td><span id="invNuevaPlantaCap" class="hoja-value-ro">${fmt.num(invActivos.nuevaPlanta.incrementoCapacidad)}</span> unid</td>
            <td class="hoja-ref">Cat&aacute;logo Fase 0. Lead time 1 ronda: capacidad desde la siguiente ronda.</td>
          </tr>
          <tr>
            <td class="hoja-label">Ampliaci&oacute;n de planta</td>
            <td>${selActivo('ampliacionPlanta', 'paquete', _paqueteOpts(PAQUETES_AMPLIACION, invActivos.ampliacionPlanta.paquete), invActivos.ampliacionPlanta.paquete || 'Ninguna')}
                <div class="hoja-ref">Costo: <span id="invAmpliacionMonto">${fmt.bs(invActivos.ampliacionPlanta.monto)}</span></div></td>
            <td><span id="invAmpliacionCap" class="hoja-value-ro">${fmt.num(invActivos.ampliacionPlanta.incrementoCapacidad)}</span> unid</td>
            <td class="hoja-ref">Capacidad = ${fmt.num(_capActualHoja)} actual &times; % paquete. Monto calculado desde par&aacute;metros del profesor.</td>
          </tr>
          <tr>
            <td class="hoja-label">Maquinaria</td>
            <td>${selActivo('maquinaria', 'paquete', _paqueteOpts(PAQUETES_MAQUINARIA, invActivos.maquinaria.paquete), invActivos.maquinaria.paquete || 'Ninguna')}
                <div class="hoja-ref">Costo: <span id="invMaquinariaMonto">${fmt.bs(invActivos.maquinaria.monto)}</span></div></td>
            <td><span id="invMaquinariaCap" class="hoja-value-ro">${fmt.num(invActivos.maquinaria.incrementoCapacidad)}</span> unid</td>
            <td class="hoja-ref">Capacidad = ${fmt.num(_capActualHoja)} actual &times; % paquete. Monto calculado desde par&aacute;metros del profesor.</td>
          </tr>
        </tbody>
      </table>
      <div style="padding:8px 14px;font-size:.76rem;color:var(--text3);font-style:italic">
        La capacidad se calcula autom&aacute;ticamente desde la capacidad actual.
        Monto calculado desde par&aacute;metros del profesor.
      </div>
    </div>
    ` : ''}

    ${esProducto1 ? '' : notaProducto1('La compra de materia prima y la inversión en capacidad se gestionan')}`;

  // ── 4 · RRHH ──
  const contenidoRRHH = `
    ${conOperarios ? `
    <div class="hoja-section">
      <div class="hoja-section-title">Operarios de producción</div>
      <table class="hoja-table">
        <thead><tr><th>Decisión</th><th>Tu elección</th><th>Referencia</th><th>Nota</th></tr></thead>
        <tbody>
          <tr>
            <td class="hoja-label">🏭 Operarios actuales</td>
            <td><span class="hoja-value-ro">${decision.operariosIniciales ?? p.operariosIniciales ?? 4}</span></td>
            <td class="hoja-ref">Personal productivo que permite utilizar la capacidad de planta.${hojaModulosActivos?.operariosProduccion === false ? ' <strong>Dotación fija por configuración del curso</strong> — no se puede contratar, despedir ni capacitar.' : ''}</td>
            <td style="font-size:.78rem;color:var(--text3)">Cap. efectiva: ${fmt.num((decision.operariosIniciales ?? p.operariosIniciales ?? 4) * (p.productividadBase ?? 440))} unid/trim</td>
          </tr>
          ${hojaModulosActivos?.operariosProduccion === false ? '' : `
          ${hojaProductoActivo === 0 ? `
          <tr>
            <td class="hoja-label">➕ Contratar operarios</td>
            <td>${inp('contratarOperarios', decision.contratarOperarios ?? 0, 'number', 'min="0" max="20" step="1"')}</td>
            <td class="hoja-ref">Aumenta la capacidad productiva efectiva, pero incrementa costos laborales.</td>
            <td style="font-size:.78rem;color:var(--text3)">Sueldo: Bs ${fmt.num(p.costoOperario ?? 3200)}/trim/operario</td>
          </tr>
          <tr>
            <td class="hoja-label">➖ Despedir operarios</td>
            <td>${inp('despedirOperarios', decision.despedirOperarios ?? 0, 'number', 'min="0" step="1"')}</td>
            <td class="hoja-ref">Reduce costos laborales futuros, pero puede limitar la producción efectiva.</td>
            <td style="font-size:.78rem;color:var(--text3)">Mínimo final: 0 operarios</td>
          </tr>
          <tr>
            <td class="hoja-label">🎓 Inversión en capacitación (Bs)</td>
            <td>${inp('montoCapacitacion', decision.montoCapacitacion ?? 0, 'number', 'min="0" step="1000"')}</td>
            <td class="hoja-ref">+${fmt.pct(p.factorCapacitacion ?? 0.05)} productividad por cada Bs 10.000</td>
            <td style="font-size:.78rem;color:var(--text3)">Cap. = operarios × ${p.productividadBase ?? 440} × (1 + factor)</td>
          </tr>
          ` : `
          <tr><td colspan="4" style="padding:6px 14px;font-size:.76rem;color:var(--text3);font-style:italic">
            ℹ️ Contratar/despedir operarios y capacitación se gestionan en <strong>Producto 1</strong> · Aplica a toda la empresa.
            Valor actual: ➕ ${decision.contratarOperarios??0} operarios · ➖ ${decision.despedirOperarios??0} · Capacitación Bs ${fmt.num(decision.montoCapacitacion??0)}
          </td></tr>
          `}
          `}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${conFuerzaVentas ? `
    <div class="hoja-section">
      <div class="hoja-section-title">Fuerza de ventas</div>
      <table class="hoja-table">
        <thead><tr><th>Decisión</th><th>Tu elección</th><th>Referencia</th><th>Nota</th></tr></thead>
        <tbody>
          <tr>
            <td class="hoja-label">👥 Vendedores actuales</td>
            <td><span class="hoja-value-ro">${decision.vendedoresIniciales||0}</span></td>
            <td class="hoja-ref">Personal comercial que ayuda a ejecutar la estrategia de ventas. Su impacto depende del canal utilizado.</td><td></td></tr>
          ${hojaProductoActivo === 0 ? `
          <tr><td class="hoja-label">➕ Contratar vendedores</td>
              <td>${inp('contratarVendedores',decision.contratarVendedores??0,'number','min="0" max="10" step="1"')}</td>
              <td class="hoja-ref">Aumenta la fuerza comercial, pero eleva costos.</td><td style="font-size:.78rem;color:var(--text3)">Contratación: Bs ${fmt.num(p.costoContratacionVendedor||500)} c/u · Sueldo: Bs ${fmt.num(p.sueldoTrimestralVendedor||2400)}/trim.</td></tr>
          <tr><td class="hoja-label">➖ Despedir vendedores</td>
              <td>${inp('despedirVendedores',decision.despedirVendedores??0,'number','min="0" step="1"')}</td>
              <td class="hoja-ref">Reduce costos comerciales futuros, pero puede debilitar la ejecución de ventas.</td><td style="font-size:.78rem;color:var(--text3)">Costo despido: Bs ${fmt.num(p.costoDespidoVendedor||800)} c/u</td></tr>
          ` : `
          <tr><td colspan="4" style="padding:6px 14px;font-size:.76rem;color:var(--text3);font-style:italic">
            ℹ️ Contratar/despedir vendedores se gestiona en <strong>Producto 1</strong> · Aplica a toda la empresa.
            Valor actual: ➕ ${decision.contratarVendedores??0} · ➖ ${decision.despedirVendedores??0}
          </td></tr>
          `}
        </tbody>
      </table>
    </div>
    ` : ''}`;

  // ── 5 · Finanzas (Gerente General) ──
  const contenidoFinanzas = esProducto1 ? `
    ${conActivos ? `
    <div class="hoja-section">
      <div class="hoja-section-title">Inversi&oacute;n en activos</div>
      <table class="hoja-table">
        <thead><tr><th>Activo</th><th>Monto (Bs)</th><th>Capacidad futura</th><th>Nota contable</th></tr></thead>
        <tbody>
          <tr>
            <td class="hoja-label">Veh&iacute;culos</td>
            <td>${selActivo('vehiculos', 'paquete', _vehOpts, invActivos.vehiculos.paquete || 'Ninguno')}
                <div class="hoja-ref">Costo: <span id="invVehiculosMonto">${fmt.bs(invActivos.vehiculos.monto)}</span></div></td>
            <td><span class="hoja-value-ro">0 unid</span></td>
            <td class="hoja-ref">Lead time 0. No aumenta capacidad productiva.</td>
          </tr>
          <tr>
            <td class="hoja-label">Muebles</td>
            <td>${selActivo('muebles', 'paquete', _sinoOpts('muebles'), invActivos.muebles.paquete ? 'Sí' : 'No')}
                <div class="hoja-ref">Costo: <span id="invMueblesMonto">${fmt.bs(invActivos.muebles.monto)}</span></div></td>
            <td><span class="hoja-value-ro">0 unid</span></td>
            <td class="hoja-ref">Lead time 0. Se capitaliza, no es gasto operativo.</td>
          </tr>
          <tr>
            <td class="hoja-label">C&oacute;mputo</td>
            <td>${selActivo('computo', 'paquete', _sinoOpts('computo'), invActivos.computo.paquete ? 'Sí' : 'No')}
                <div class="hoja-ref">Costo: <span id="invComputoMonto">${fmt.bs(invActivos.computo.monto)}</span></div></td>
            <td><span class="hoja-value-ro">0 unid</span></td>
            <td class="hoja-ref">Lead time 0. Se capitaliza como activo fijo.</td>
          </tr>
          <tr>
            <td class="hoja-label">Patentes</td>
            <td>${selActivo('patentes', 'paquete', _sinoOpts('patentes'), invActivos.patentes.paquete ? 'Sí' : 'No')}
                <div class="hoja-ref">Costo: <span id="invPatentesMonto">${fmt.bs(invActivos.patentes.monto)}</span></div></td>
            <td><span class="hoja-value-ro">0 unid</span></td>
            <td class="hoja-ref">Intangible: se amortiza contablemente en 20 trimestres.</td>
          </tr>
        </tbody>
      </table>
      <div id="hojaInversionActivosResumen" style="padding:8px 14px;background:var(--bg3);font-size:.78rem;color:var(--text2)">
        ${renderResumenInversionActivos()}
      </div>
      <div style="padding:8px 14px;font-size:.76rem;color:var(--text3);font-style:italic">
        La inversi&oacute;n reduce caja, no es gasto operativo ni costo de ventas, y se capitaliza en el balance.
        El total incluye la nueva planta, la ampliaci&oacute;n y la maquinaria de la pesta&ntilde;a Producci&oacute;n.
      </div>
    </div>
    ` : ''}

    <div class="hoja-section">
      <div class="hoja-section-title">Financiamiento</div>
      <table class="hoja-table">
        <thead><tr><th>Decisión</th><th>Tu elección</th><th>Referencia</th><th>Justificación</th></tr></thead>
        <tbody>
          <tr><td class="hoja-label">🏦 Tipo de préstamo</td>
              <td>${sel('tipoPrestamo',tipoPresOpts)}</td>
              <td class="hoja-ref">Financiamiento que aumenta caja, pero genera deuda, intereses y posible comisión.</td>
              <td>${ta('finanzas','¿Necesitas financiamiento? ¿Por qué?')}</td></tr>
          <tr><td class="hoja-label">💵 Monto (Bs)</td>
              <td>${inp('montoPrestamo', (decision.tipoPrestamo||'Ninguno')==='Ninguno' ? 0 : decision.montoPrestamo, 'number',
                     'min="0" step="1000"' + ((decision.tipoPrestamo||'Ninguno')==='Ninguno' ? ' disabled' : ''))}</td>
              <td class="hoja-ref">Comisión apertura: ${fmt.pct(p.comisionAperturaPrestamo||0.01)}</td><td></td></tr>
          <tr><td class="hoja-label">⏳ Plazo (trimestres)</td>
              <td>${inp('plazoPrestamo',decision.plazoPrestamo,'number','min="1" max="8" step="1"')}</td>
              <td class="hoja-ref">Condición referencial del préstamo. Verifica con el profesor si este campo incide en la simulación activa.</td><td></td></tr>
          <tr><td class="hoja-label">📉 Amortización (Bs)</td>
              <td>${inp('amortizacion',decision.amortizacion,'number','min="0" step="1000"')}</td>
              <td class="hoja-ref">Pago parcial de deuda. Reduce obligaciones, pero consume caja.</td><td></td></tr>
        </tbody>
      </table>
    </div>
    ` : notaProducto1('Finanzas (inversión en activos y financiamiento) se gestiona');

  // ── 6 · Cierre ──
  const alertasIniciales = alertasActuales(null);
  const contenidoCierre = `
    ${isEditable ? `
    <div class="hoja-section">
      <div class="hoja-section-title">Alertas de coherencia</div>
      <div id="hojaAlertas" class="hoja-alertas">${alertasHTML(alertasIniciales)}</div>
    </div>
    ` : ''}

    <div class="hoja-section">
      <div class="hoja-section-title">Resumen de valores</div>
      <div class="hoja-resumen-grid" id="hojaResumen">${hojaResumenV2(decision)}</div>
    </div>

    ${resultado ? hojaKpiHTML(resultado, productoActivo.productoId || ('prod_' + (hojaProductoActivo + 1)), decision) : ''}

    <div class="hoja-actions">
      ${isEditable
        ? `<button class="btn btn-success" id="btnHojaEnviar">✓ Enviar decisiones</button>`
        : `<span style="color:var(--text3);font-size:.82rem">
             ${roundState==='simulated' ? '🔒 Simulada — ver Estados Financieros en el menú 📊'
               : roundState==='pending' ? '⏸ Esperando activación del profesor.'
               : isLocked ? '🔒 Envío cerrado.'
               : '✅ Enviada — esperando simulación.'}
           </span>`}
    </div>`;

  const contenidoPestana = {
    estrategia: contenidoEstrategia, marketing: contenidoMarketing, produccion: contenidoProduccion,
    rrhh: contenidoRRHH, finanzas: contenidoFinanzas, cierre: contenidoCierre,
  };
  const pestanaBtn = (t) => {
    const est = estadoPestana(t.id, alertasIniciales);
    const activa = t.id === hojaPestanaActiva;
    return `
        <button type="button" role="tab" class="hoja-tab-btn${activa ? ' active' : ''}" data-hoja-tab-btn="${t.id}" aria-selected="${activa}" onclick="hojaIrPestana('${t.id}')">
          <span class="hoja-tab-titulo"><span class="hoja-tab-estado ${est}" data-hoja-tab-estado="${t.id}">${isEditable ? HOJA_ICONO_ESTADO[est] : ''}</span>${t.icono} ${t.titulo}</span>
          <span class="hoja-tab-gerente">${t.gerente}</span>
        </button>`;
  };
  const iActiva = pestanasVisibles.findIndex(t => t.id === hojaPestanaActiva);

  cont.innerHTML = `
  <div class="hoja-wrap">
  ${isEditable ? '<div id="hojaAvisoConflicto" class="alert alert-warning" hidden style="margin-bottom:14px;padding:10px 14px;font-size:.84rem;line-height:1.5"></div>' : ''}
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">
  ${productos.map((p, idx) => `
    <button
      type="button"
      class="btn ${idx === hojaProductoActivo ? 'btn-success' : 'btn-ghost'} btn-sm"
      onclick="hojaSeleccionarProducto(${idx})"
      style="padding-right: ${isEditable && idx > 0 ? '4px' : ''}"
    >
      📦 Producto ${idx + 1}
      ${isEditable && idx > 0 ? `<span
        onclick="event.stopPropagation(); hojaEliminarProducto(${idx})"
        style="margin-left:6px;color:#e74c3c;font-weight:bold;font-size:.85rem;cursor:pointer"
        title="Eliminar Producto ${idx + 1}"
      >✕</span>` : ''}
    </button>
  `).join('')}

  ${isEditable ? `
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      onclick="hojaAgregarProducto()"
    >
      ➕ Agregar Producto
    </button>
  ` : ''}
</div>

    <div class="hoja-team-header">
      <span class="hoja-team-nombre">📋 ${state.me?.nombre||''}</span>
      <span class="hoja-team-ronda">Trimestre ${n} / 20</span>
      <span class="hoja-team-estado">${estadoBadge}</span>
    </div>

    <div class="hoja-sticky">
      <div class="hoja-topbar">
        <span>💵 Caja inicial: <strong>${fmt.bs(decision.cajaInicial)}</strong></span>
        ${isEditable ? `<button type="button" id="hojaAlertasCount" class="hoja-topbar-alertas${alertasIniciales.length ? ' con-alertas' : ''}" onclick="hojaIrPestana('cierre')">${textoAlertas(alertasIniciales.length)}</button>` : ''}
      </div>
      <div class="hoja-tabs" role="tablist">${pestanasVisibles.map(pestanaBtn).join('')}
      </div>
    </div>

    ${pestanasVisibles.map(t => `
    <div class="hoja-tab-panel" data-hoja-tab-panel="${t.id}" role="tabpanel"${t.id === hojaPestanaActiva ? '' : ' hidden'}>
      <div class="hoja-tab-ref" id="hojaRef-${t.id}">${refLinea(t.id, alertasIniciales, null)}</div>
      ${contenidoPestana[t.id]}
    </div>`).join('')}

    <div class="hoja-tab-nav">
      <button type="button" class="btn btn-ghost btn-sm" id="btnHojaAnterior" onclick="hojaPestanaRelativa(-1)"${iActiva <= 0 ? ' disabled' : ''}>← Anterior</button>
      ${isEditable ? '<button class="btn btn-ghost" id="btnHojaGuardar">💾 Guardar borrador</button>'
        + `<span data-hoja-ultimo-guardado style="font-size:.76rem;color:var(--text3);align-self:center">${hojaTextoUltimoGuardado(decision._guardadaAt)}</span>` : ''}
      <button type="button" class="btn btn-ghost btn-sm" id="btnHojaSiguiente" onclick="hojaPestanaRelativa(1)"${iActiva >= pestanasVisibles.length - 1 ? ' disabled' : ''}>Siguiente →</button>
    </div>
  </div>`;

if (isEditable) {
  cont.querySelectorAll('[data-hoja-field]').forEach(el => {

    el.addEventListener(
      el.type === 'checkbox' ? 'change' : 'input',
      () => {

        hojaTieneCambiosSinGuardar = true;

        let v =
          el.type === 'checkbox' ? el.checked
          : el.type === 'number' ? +el.value
          : el.tagName === 'SELECT'
            ? el.value.replace(/\s*\(Bs[\s\d.]+\)\s*$/, '').trim()
            : el.value;

        const field = el.dataset.hojaField;
        const v_orig = v;

        // ── Plazo máximo dinámico según tipo de préstamo ──────────────────
        const tipoPrestamoActual = cont.querySelector('[data-hoja-field="tipoPrestamo"]')?.value || 'Ninguno';
        const plazoMaxDinamico = tipoPrestamoActual === 'Operativo'
          ? (p?.plazoPrestamoOperativo || 20)
          : tipoPrestamoActual === 'Inversión'
            ? (p?.plazoPrestamoInversion || 40)
            : Math.max(p?.plazoPrestamoOperativo||20, p?.plazoPrestamoInversion||40);

        // Misma fórmula que usa el handler del botón Enviar — una sola definición.
        const _capLive = capacidadMaxLive(cont, decision, p);
        const opFinalesLive        = _capLive.opFinales;
        const capPlantaLive        = _capLive.capPlanta;
        const capOperariosLive     = _capLive.capOperarios;
        const capMaxProduccionLive = _capLive.capMax;
        const modoInicioHoja = state.ref?.modoInicio || 'fase0';   // fail-safe: sin dato → fase0 (mensaje actual)

        // ── Límites por campo ─────────────────────────────────────────────
        const LIMITES_CAMPO = {
          calidad:             { min:1,  max:10 },
          contratarOperarios:  { min:0,  max:50 },
          despedirOperarios:   { min:0,  max:50 },
          contratarVendedores: { min:0,  max:10 },
          despedirVendedores:  { min:0,  max:10 },
          plazoPrestamo:       { min:1,  max:plazoMaxDinamico },
          precioVenta:         { min:0,  max:9999 },
          produccion:          { min:0,  max:capMaxProduccionLive },
          montoCapacitacion:   { min:0,  max:50000 },
          publicidad:          { min:0,  max:200000 },
          promocion:           { min:0,  max:100000 },
          eventos:             { min:0,  max:100000 },
          marketingRedes:      { min:0,  max:100000 },
          relacionesPublicas:  { min:0,  max:100000 },
        };

        // ── Monto de préstamo: 0 y bloqueado si el tipo es 'Ninguno' ──────
        // Antes el input quedaba siempre editable, así que un monto tipeado para un
        // préstamo que luego se descartó sobrevivía al cambio del select: nada lo
        // limpiaba ni lo ocultaba. Esa combinación ('Ninguno' + monto > 0) hace que
        // traducirFinanciamiento lance al generar los asientos de la ronda.
        // El servidor rechaza la misma combinación, así que saltarse el navegador
        // tampoco sirve.
        if (field === 'tipoPrestamo') {
          const montoInput = cont.querySelector('[data-hoja-field="montoPrestamo"]');
          if (montoInput) {
            const sinPrestamo = v_orig === 'Ninguno';
            montoInput.disabled = sinPrestamo;
            if (sinPrestamo) {
              montoInput.value = 0;
              // Persistir el 0 en el estado: el input deshabilitado ya no dispara
              // su propio evento 'input', así que sin esto el 10000 viejo seguiría
              // viajando en la decisión al guardar o enviar.
              state.decisiones.montoPrestamo = 0;
              decision.montoPrestamo = 0;
              if (Array.isArray(state.decisiones.productos)) {
                state.decisiones.productos.forEach(pr => { pr.montoPrestamo = 0; });
              }
            }
          }
        }

        // ── Actualizar max del input plazo cuando cambia tipoPrestamo ─────
        if (field === 'tipoPrestamo') {
          const plazoInput = cont.querySelector('[data-hoja-field="plazoPrestamo"]');
          if (plazoInput) {
            const nuevoMax = v_orig === 'Operativo'
              ? (p?.plazoPrestamoOperativo || 20)
              : v_orig === 'Inversión'
                ? (p?.plazoPrestamoInversion || 40)
                : Math.max(p?.plazoPrestamoOperativo||20, p?.plazoPrestamoInversion||40);
            plazoInput.max = nuevoMax;
            const refCell = plazoInput.closest('tr')?.querySelector('.hoja-ref');
            if (refCell) {
              const esOp  = v_orig === 'Operativo';
              const esInv = v_orig === 'Inversión';
              refCell.innerHTML = esOp
                ? '<span style="color:var(--accent3)">⚠ Máx. ' + (p?.plazoPrestamoOperativo||20) + ' trim. (operativo)</span>'
                : esInv
                  ? '<span style="color:var(--accent3)">⚠ Máx. ' + (p?.plazoPrestamoInversion||40) + ' trim. (inversión)</span>'
                  : 'Op: ' + (p?.plazoPrestamoOperativo||20) + ' trim. · Inv: ' + (p?.plazoPrestamoInversion||40) + ' trim.';
            }
          }
        }

        // ── Actualizar max del input de producción si cambia capacitación u operarios ──
        if (['montoCapacitacion','contratarOperarios','despedirOperarios'].includes(field)) {
          const produccionInput = cont.querySelector('[data-hoja-field="produccion"]');
          if (produccionInput) produccionInput.max = capMaxProduccionLive;
        }

        // ── Aviso capacidad de producción (planta del equipo ∧ operarios) ─
        if (field === 'produccion') {
          const refCell = el.closest('tr')?.querySelector('.hoja-ref');
          if (refCell) {
            if (opFinalesLive === 0) {
              refCell.innerHTML = '<span style="color:var(--accent4)">⚠ Sin operarios — debes contratar al menos 1. Cap. efectiva = 0 u.</span>';
            } else if (v_orig > capMaxProduccionLive) {
              refCell.innerHTML = '<span style="color:var(--accent4)">⚠ Supera el tope real (' + fmt.num(capMaxProduccionLive) + ' u = min[planta ' + fmt.num(capPlantaLive) + ', ' + opFinalesLive + ' op.×' + (p?.productividadBase||440) + '=' + fmt.num(capOperariosLive) + ']).</span>';
            } else {
              const pct = Math.round(v_orig / capMaxProduccionLive * 100);
              if (modoInicioHoja === 'homogeneo') {
                // Homogéneo: mostrar el desglose planta/operarios también en el mensaje normal
                refCell.innerHTML = '<span style="color:var(--accent5)">✓ ' + pct + '% del tope real (' + fmt.num(capMaxProduccionLive) + ' u = min[planta ' + fmt.num(capPlantaLive) + ', ' + opFinalesLive + ' op.×' + (p?.productividadBase||440) + '=' + fmt.num(capOperariosLive) + ']).</span>';
              } else {
                // Fase 0: mensaje ACTUAL, sin cambios
                refCell.innerHTML = '<span style="color:var(--accent5)">✓ ' + pct + '% del tope real (' + fmt.num(capMaxProduccionLive) + ' u)</span>';
              }
            }
            // Aviso AGREGADO: se antepone al del producto individual, porque un "✓ 100%"
            // por producto puede convivir con un exceso total. Mismo patrón visual
            // (accent4 = rojo de advertencia) que el aviso por producto.
            const dTmp = { productos: (state.decisiones?.productos || []).map((pr, i) =>
              i === hojaProductoActivo ? { ...pr, produccion: v_orig } : pr) };
            const exceso = excesoCapacidadAgregada(dTmp, capMaxProduccionLive);
            if (exceso) {
              refCell.innerHTML = '<span style="color:var(--accent4)">⚠ ' + exceso + '</span>'
                + '<div style="margin-top:2px">' + refCell.innerHTML + '</div>';
            }
          }
        }

        // ── Clamp valores fuera de límites ────────────────────────────────
        if (el.type === 'number' && LIMITES_CAMPO[field]) {
          const lim = LIMITES_CAMPO[field];
          const clamped = Math.min(lim.max, Math.max(lim.min, v));
          if (clamped !== v) { el.value = clamped; v = clamped; }
        }

        const productFields = [
          'producto',
          'segmentoObjetivo',
          'canalPrincipal',
          'canalSecundario',
          'calidad',
          'precioVenta',
          'produccion',
          'publicidad',
          'promocion',
          'eventos',
          'marketingRedes',
          'relacionesPublicas',
          'innovacion',
          'tipoInnovacion',
          'montoInnovacion',
          // Etapa 3.2: Operarios
          'contratarOperarios',
          'despedirOperarios',
          'montoCapacitacion',
          // Etapa 3.1: Materia Prima
          'cantidadMPpedida',
          'proveedorElegido',
        ];


        if (productFields.includes(field)) {

          if (!state.decisiones.productos) {
            state.decisiones.productos = [];
          }

          if (!state.decisiones.productos[hojaProductoActivo]) {
            state.decisiones.productos[hojaProductoActivo] =
              crearProductoDefault(hojaProductoActivo);
          }

          // Campos de EMPRESA: se guardan en state.decisiones raíz (no en el producto)
          const camposEmpresa = [
            'contratarVendedores','despedirVendedores',
            'contratarOperarios','despedirOperarios','montoCapacitacion',
            'tipoPrestamo','montoPrestamo','plazoPrestamo','amortizacion',
            'tipoInvestigacion',
          ];

          if (camposEmpresa.includes(field)) {
            // Campo de empresa: guardar en raíz y sincronizar en todos los productos
            state.decisiones[field] = v;
            if (Array.isArray(state.decisiones.productos)) {
              state.decisiones.productos.forEach(p => { p[field] = v; });
            }
          } else if (field === 'proveedorElegido' || field === 'cantidadMPpedida') {
            // Materia prima: decisión única de empresa, SOLO en raíz — nunca se propaga
            // a productos[] individuales (Diseño 2 completo, ver commits aa5dd05, f6eedf5)
            state.decisiones[field] = v;
          } else {
            // Campo de producto: guardar solo en el producto activo
            const prod = state.decisiones.productos[hojaProductoActivo];
            if (prod) prod[field] = v;
            if (productoActivo) productoActivo[field] = v;
            // Compatibilidad con producto 1
            if (hojaProductoActivo === 0) state.decisiones[field] = v;
          }

          decision = state.decisiones;

        } else {

          decision[field] = v;

          if (state.decisiones) {
            state.decisiones[field] = v;
          }
        }

        const r = document.getElementById('hojaResumen');

        if (r) {
          r.innerHTML = hojaResumenV2(decision);
        }

        // Pestañas: la del campo queda visitada; se recalculan estados, alertas y referencias.
        const pestanaCampo = el.closest('[data-hoja-tab-panel]')?.dataset.hojaTabPanel;
        if (pestanaCampo) hojaPestanasVisitadas.add(pestanaCampo);
        refrescarPestanas();
      }
    );
  });

  // Techo de calidad por proveedor: el aviso se actualiza al cambiar la calidad o el proveedor.
  const _refrescarTechoCalidad = () => hojaRefrescarAvisoTechoCalidad(cont, decision, productoActivo, ref.proveedores);
  cont.querySelectorAll('[data-hoja-field="calidad"], [data-hoja-field="proveedorElegido"]').forEach(el => {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', _refrescarTechoCalidad);
  });
  _refrescarTechoCalidad();

  // Detalle del proveedor elegido, lote mínimo y precio de referencia del segmento: se
  // actualizan al cambiar el proveedor, la calidad, el segmento, la producción o la cantidad
  // (el primer llenado va después de este bloque, también para la hoja de solo lectura).
  const _refrescarProveedorYPrecioRef = () => {
    hojaRefrescarDetalleProveedor(cont, decision, ref.proveedores, _textoMP);
    hojaRefrescarPrecioReferencia(cont, decision, productoActivo, ref);
  };
  cont.querySelectorAll('[data-hoja-field="proveedorElegido"], [data-hoja-field="calidad"], [data-hoja-field="segmentoObjetivo"], [data-hoja-field="produccion"], [data-hoja-field="cantidadMPpedida"]').forEach(el => {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', _refrescarProveedorYPrecioRef);
  });

  cont.querySelectorAll('[data-activo-tipo][data-activo-campo]').forEach(el => {
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      hojaTieneCambiosSinGuardar = true;
      if (el.tagName !== 'SELECT') {
        const valor = normalizarNumeroNoNegativo(el.value);
        if (+el.value !== valor) el.value = valor;
      }

      sincronizarInversionActivosDesdeDOM(cont);
      decision = state.decisiones;

      // Refrescar celdas derivadas (monto/capacidad calculados, no libres)
      const _p2 = state.ref?.parametros || {};
      const _inv = decision.inversionActivos || {};
      const _set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      _set('invNuevaPlantaMonto', fmt.bs(_inv.nuevaPlanta?.monto ?? 0));
      _set('invNuevaPlantaOp',    fmt.num(operariosPlantaSeleccionada(decision, _p2)));
      _set('invNuevaPlantaCap',   fmt.num(_inv.nuevaPlanta?.incrementoCapacidad ?? 0));
      _set('invAmpliacionCap',    fmt.num(_inv.ampliacionPlanta?.incrementoCapacidad ?? 0));
      _set('invAmpliacionMonto',  fmt.bs(_inv.ampliacionPlanta?.monto ?? 0));
      _set('invMaquinariaCap',    fmt.num(_inv.maquinaria?.incrementoCapacidad ?? 0));
      _set('invMaquinariaMonto',  fmt.bs(_inv.maquinaria?.monto ?? 0));
      _set('invVehiculosMonto',   fmt.bs(_inv.vehiculos?.monto ?? 0));
      _set('invMueblesMonto',     fmt.bs(_inv.muebles?.monto ?? 0));
      _set('invComputoMonto',     fmt.bs(_inv.computo?.monto ?? 0));
      _set('invPatentesMonto',    fmt.bs(_inv.patentes?.monto ?? 0));

      const resumenInv = document.getElementById('hojaInversionActivosResumen');
      if (resumenInv) resumenInv.innerHTML = renderResumenInversionActivos();

      const resumen = document.getElementById('hojaResumen');
      if (resumen) resumen.innerHTML = hojaResumenV2(decision);

      const pestanaCampo = el.closest('[data-hoja-tab-panel]')?.dataset.hojaTabPanel;
      if (pestanaCampo) hojaPestanasVisitadas.add(pestanaCampo);
      refrescarPestanas();
    });
  });
}

// Detalle del proveedor, lote mínimo y precio de referencia: primer llenado, también con la
// hoja de solo lectura (ya enviada o ronda calculada), donde los campos no son editables y
// se usa lo guardado en la decisión.
hojaRefrescarDetalleProveedor(cont, decision, ref.proveedores, _textoMP);
hojaRefrescarPrecioReferencia(cont, decision, productoActivo, ref);

  



    cont.querySelectorAll('[data-hoja-just]').forEach(el => {
      el.addEventListener('input', () => {
        hojaTieneCambiosSinGuardar = true;
        if (!decision.justificaciones) decision.justificaciones = {};
        decision.justificaciones[el.dataset.hojaJust] = el.value;
        if (state.decisiones?.justificaciones) state.decisiones.justificaciones[el.dataset.hojaJust] = el.value;
      });
    });
    document.getElementById('btnHojaGuardar')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnHojaGuardar');
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        sincronizarHojaConEstado();
        decision = state.decisiones;
        const r = await api('POST','/api/decisiones/guardar',{decision});
        hojaTieneCambiosSinGuardar = false;
        hojaTrasGuardar(r);
        toast('💾 Guardado','success');
      }
      catch(e) { if (!hojaMostrarConflicto(e)) { toast(e.message,'error'); btn.disabled = false; } }
    });
    document.getElementById('btnHojaEnviar')?.addEventListener('click', async () => {
      // Capacidad AGREGADA: el aviso por producto compara cada input contra el tope,
      // así que 5 productos a 600 c/u mostraban "✓ 100%" cinco veces mientras la planta
      // sólo puede 600 en total. Acá se suma y se bloquea el envío.
      // El tope se recalcula ACÁ (no se toma de la clausura del listener de inputs, que
      // es otro scope) para que use los valores que están en pantalla al hacer clic.
      const excesoCap = excesoCapacidadAgregada(
        state.decisiones,
        capacidadMaxLive(cont, state.decisiones || decision, p).capMax,
      );
      if (excesoCap) {
        toast(excesoCap, 'error');
        return;
      }
      if (!confirm('¿Enviar decisiones?\n\nEl profesor ejecutará la simulación cuando todos los equipos hayan enviado.')) return;
      const btn = document.getElementById('btnHojaEnviar');
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        sincronizarHojaConEstado();
        decision = state.decisiones;
        const _d3 = JSON.parse(JSON.stringify(decision, (k,v) => v===undefined?null:v));
        await api('POST','/api/decisiones/enviar',{decision: _d3});
        hojaTieneCambiosSinGuardar = false;
        toast('✅ Enviado','success');
        await loadHojaDecision();
      } catch(e) { if (!hojaMostrarConflicto(e)) { toast(e.message,'error'); btn.disabled = false; } }
    });
  }


function hojaResumenV2(d) {
  if (!d) return '';
  const inv = totalesInversionActivos(d);
  const rows = [
    ['Producto',        d.producto],
    ['Segmento',        d.segmentoObjetivo],
    ['Canal principal', d.canalPrincipal],
    ['Canal secundario',d.canalSecundario||'Ninguno'],
    ['Calidad',         d.calidad],
    ['Precio venta',    `Bs ${d.precioVenta??0}`],
    ['Producción',      fmt.num(d.produccion??0)+' unid'],
    ['Publicidad',      fmt.bs(d.publicidad??0)],
    ['Promoción',       fmt.bs(d.promocion??0)],
    ['Eventos',         fmt.bs(d.eventos??0)],
    ['Mkt redes',       fmt.bs(d.marketingRedes??0)],
    ['RRPP',            fmt.bs(d.relacionesPublicas??0)],
    ['Contratar vend.', d.contratarVendedores??0],
    ['Despedir vend.',  d.despedirVendedores??0],
    ['Préstamo tipo',   d.tipoPrestamo||'Ninguno'],
    ['Monto préstamo',  fmt.bs(d.montoPrestamo??0)],
    ['Amortización',    fmt.bs(d.amortizacion??0)],
    ['Inversión activos', fmt.bs(inv.total)],
    ['Capacidad futura +', fmt.num(inv.capacidad)+' unid'],
    ['Innovación',      d.innovacion?`Sí — ${d.tipoInnovacion}`:'No'],
    ['Monto innovación',fmt.bs(d.montoInnovacion??0)],
    ['Investigación',   d.tipoInvestigacion||'No'],
  ];
  return rows.map(([l,v])=>`
    <div class="hoja-resumen-row">
      <span class="hoja-resumen-label">${l}</span>
      <span class="hoja-resumen-val">${v??'—'}</span>
    </div>`).join('');
}

// KPI rápido al final de la hoja (cuando la ronda está simulada)
// Fase 1 de pantallas: lo de PRODUCTO (ventas, participación, precio, costo
// variable unitario, margen, inventario) sale de r.productos para el producto
// activo de la hoja; lo financiero de empresa, de `r` (libro mayor en partida
// doble); la alerta de caja, una sola vez de prod_1 (regla del motor: caja
// menor a Bs 500). Antes leía todo de `r`, que en partida doble no trae los
// campos por producto: participación y costo unitario salían en 0.
function hojaKpiHTML(r, productoId, decision) {
  if (!r) return '';
  const prods = (Array.isArray(r.productos) && r.productos.length) ? r.productos : [r];
  const multi = prods.length > 1;
  const p1 = prods.find(x => (x.productoId || 'prod_1') === 'prod_1') || prods[0];
  let iProd = prods.findIndex(x => (x.productoId || 'prod_1') === (productoId || 'prod_1'));
  if (iProd < 0 && !multi) iProd = 0;
  const pr = iProd >= 0 ? prods[iProd] : null;
  const cu = iProd >= 0 ? costosUnitariosEquipo(r, decision).productos[iProd] : null;
  const alerta = p1.alertaCaja ?? r.alertaCaja;
  const fila = (l, v, color) => `<div class="hoja-resumen-row"><span class="hoja-resumen-label">${l}</span><span class="hoja-resumen-val"${color ? ` style="color:${color}"` : ''}>${v}</span></div>`;
  const titulo = (txt) => `<div class="hoja-resumen-row" style="grid-column:1/-1;font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px">${txt}</div>`;
  return `
  <div class="hoja-section">
    <div class="hoja-section-title" style="color:var(--accent5)">📊 Resultados del Trimestre (resumen)</div>
    <div class="hoja-resumen-grid">
      ${pr ? (multi ? titulo('Producto ' + (iProd + 1) + ': ' + (pr.producto || '—')) : '')
        + fila('Ventas reales', `${fmt.num(pr.ventasReales)} unid`)
        + fila('Market share', fmt.pct(pr.shareReal))
        + fila('Precio sin IVA', cu.precioSinIVA !== null ? `Bs ${fmt.d(cu.precioSinIVA, 2)}` : '—')
        + fila('Costo variable unitario', `Bs ${fmt.d(cu.cvUnit, 2)}`)
        + fila('Margen unitario sin IVA', cu.margenUnit !== null ? `Bs ${fmt.d(cu.margenUnit, 2)}` : '—', cu.margenUnit !== null ? (cu.margenUnit >= 0 ? 'var(--accent5)' : 'var(--accent4)') : '')
        + fila('Inventario final', `${fmt.num(pr.inventarioFinal)} unid`)
        : ''}
      ${multi ? titulo('Empresa (todos los productos)') : ''}
      ${fila('Ventas netas', fmt.bs(r.ventasNetas))}
      ${fila('Utilidad bruta', fmt.bs(r.utilidadBruta), r.utilidadBruta>=0?'var(--accent2)':'var(--accent4)')}
      ${fila('Utilidad neta', fmt.bs(r.utilidadNeta), r.utilidadNeta>=0?'var(--accent5)':'var(--accent4)')}
      ${fila('Caja final', `${fmt.bs(r.cajaFinal)} <span class="badge ${alerta==='ALERTA'?'badge-alert':'badge-ok'}">${alerta}</span>`, r.cajaFinal>=0?'var(--accent2)':'var(--accent4)')}
    </div>
    <p style="padding:8px 14px;font-size:.78rem;color:var(--text2)">Ver <strong>📊 Estados Financieros</strong> para P&L completo, Balance General y Flujo de Efectivo.</p>
  </div>`;
}

// Fase 1 de pantallas (punto b) — precio estimado de la materia prima si se le
// pide a `proveedor`. Réplica de promedioPonderadoMP (engine.js): por producto
// redondear(redondear(costoBase × pctMateriaPrima) × factorCosto), ponderado por
// la producción DECLARADA de los productos que el motor simula (activos con
// producción o precio, y siempre el primero: expandirDecisionesMultiproducto);
// sin producción declarada, promedio simple. Es el precio de lista, con IVA; el
// neto descuenta el crédito fiscal del pedido (bruto × tasaIVA, procesarPedidosMP),
// que no existe con el módulo tributario apagado.
// @returns {{bruto:number, neto:number, nProductos:number}|null}
function hojaEstimarMPProveedor(productos, tiposProducto, proveedor, params, modulos) {
  if (!proveedor) return null;
  const rnd   = (x) => Math.round(x * 100) / 100;
  const pctMP = params?.pctMateriaPrima ?? 0.40;
  const tasa  = modulos?.sistemaTributario === false ? 0 : Number(params?.tasaIVA ?? 0.13);
  const tipos = Array.isArray(tiposProducto) ? tiposProducto
    : Object.entries(tiposProducto || {}).map(([nombre, tp]) => ({ nombre, ...tp }));
  const lista = (Array.isArray(productos) ? productos : []).filter((d, i) =>
    d.activo !== false && ((d.produccion || 0) > 0 || (d.precioVenta || 0) > 0 || i === 0));
  if (!lista.length) return null;
  const costoDe = (d) => {
    const tp = tipos.find(x => x.nombre === d.producto || x.nombre === d.tipoProducto);
    return rnd(rnd((tp?.costoBase ?? 0) * pctMP) * (proveedor.factorCosto ?? 1.0));
  };
  const sumaProd = lista.reduce((a, d) => a + Number(d.produccion || 0), 0);
  const bruto = sumaProd > 0
    ? lista.reduce((a, d) => a + costoDe(d) * Number(d.produccion || 0), 0) / sumaProd
    : lista.reduce((a, d) => a + costoDe(d), 0) / lista.length;
  return { bruto, neto: bruto * (1 - tasa), nProductos: lista.length };
}

async function loadEquipoResultados() {
  const data = await api('GET','/api/resultados');
  const el = document.getElementById('equipoResultadosContent');
  if (!el) return;

  if (!data.historial?.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>Aún no hay rondas simuladas.</p></div>`;
    return;
  }

  const latest = data.historial[data.historial.length - 1];
  const nav = data.historial.map(h=>`<button class="ronda-btn simulated" onclick="mostrarKpiRonda(${h.ronda})">Ronda ${h.ronda}</button>`).join('');
  el.innerHTML = `<div class="ronda-selector">${nav}</div><div id="kpiDetalle"></div>`;
  mostrarKpiRonda(latest.ronda, data.historial);
}

window.mostrarKpiRonda = (n, historial) => {
  document.querySelectorAll('#equipoResultadosContent .ronda-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.textContent.replace('Ronda ',''))===n);
  });
  if (!historial) { api('GET','/api/resultados').then(d=>mostrarKpiRonda(n,d.historial)); return; }
  const item = historial.find(h=>h.ronda===n);
  if (!item) return;
  const r = item.resultado;

  // ── Calculated KPIs ──
  const mgBruto   = r.ventasNetas>0 ? (r.utilidadBruta/r.ventasNetas*100).toFixed(2) : '—';
  const mgNeto    = r.ventasNetas>0 ? (r.utilidadNeta/r.ventasNetas*100).toFixed(2)  : '—';
  const endeud    = r.totalActivos>0 ? (r.deudaFinal/r.totalActivos*100).toFixed(2)  : '0.00';
  const invProd   = r.produccion>0 ? (r.inventarioFinal/r.produccion*100).toFixed(1) : '0.0';
  const vendFin   = r.vendedoresFinales || 0;
  const ventasPorVend = vendFin>0 ? fmt.num(Math.round(r.ventasReales/vendFin)) : '—';
  const ingrPorVend  = vendFin>0 ? fmt.bs(Math.round(r.ventasNetas/vendFin))   : '—';
  const utilPorUnid  = r.ventasReales>0 ? fmt.d((r.ventasNetas-r.costoVentas)/r.ventasReales,3) : '—';
  const liquidez  = r.deudaFinal>0 ? fmt.d((r.cajaFinal+r.cxcFinal+r.invFinalValorizado)/r.deudaFinal,2) : '∞';

  const kpiSection = (title) =>
    '<tr><td colspan="3" style="padding:6px 14px 2px;font-family:var(--font-mono);font-size:.63rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;border-top:1px solid var(--border)">' + title + '</td></tr>';

  const kpiRow = (label, value, color='', hint='') =>
    `<tr><td style="padding:8px 14px;color:var(--text2);font-size:.82rem">${label}</td>
         <td style="padding:8px 14px;font-family:var(--font-mono);font-size:.82rem;text-align:right;color:${color||'var(--text)'}">${value}</td></tr>`;

  document.getElementById('kpiDetalle').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;margin-top:14px">

      <!-- ── Gerente de Marketing ────────────────────── -->
      <div class="result-round-card">
        <div class="result-round-header"><h3>📣 Gerente de Marketing</h3></div>
        <table style="width:100%;border-collapse:collapse">

          ${/* ─ Penetración y posicionamiento ─ */kpiSection('🎯 Penetración y Posicionamiento')}
          ${kpiRow('Market Share real',
              fmt.pct(r.shareReal),
              r.shareReal>0.35?'var(--accent5)':r.shareReal>0.15?'var(--accent3)':'var(--accent4)',
              r.shareReal>0.35?'Líder de mercado':r.shareReal>0.15?'Posición competitiva':'Posición débil')}
          ${kpiRow('Demanda formal del segmento',   fmt.num(r.demandaFormal||0),     'var(--text2)')}
          ${kpiRow('Demanda asignada a la empresa', fmt.num(r.demandaAsignada||0),   'var(--accent3)')}
          ${kpiRow('Unidades vendidas',             fmt.num(r.ventasReales||0),      r.ventasReales>0?'var(--accent5)':'var(--accent4)')}
          ${kpiRow('% Demanda capturada',
              r.demandaFormal>0 ? fmt.pct((r.ventasReales||0)/(r.demandaFormal)) : '—',
              'var(--text2)')}

          ${kpiSection('💰 Rentabilidad Comercial')}
          ${kpiRow('Ventas brutas (Bs)',            fmt.bs(r.ventasBrutas||0),       'var(--text2)')}
          ${kpiRow('Ventas netas (Bs)',             fmt.bs(r.ventasNetas||0),        'var(--accent3)')}
          ${kpiRow('Margen bruto (%)',
              r.ventasNetas>0 ? ((r.utilidadBruta||0)/r.ventasNetas*100).toFixed(1)+'%' : '—',
              (r.utilidadBruta||0)>=0?'var(--accent5)':'var(--accent4)',
              (r.utilidadBruta||0)>=0?'Margen positivo':'Margen negativo')}
          ${kpiRow('Precio de venta (Bs)',
              fmt.bs(r.precioVenta||0),
              'var(--text2)')}
          ${kpiRow('Costo unitario (Bs)',
              fmt.bs(r.costoUnitario||0),
              'var(--text2)')}
          ${kpiRow('Margen unitario (Bs)',
              fmt.bs((r.precioVenta||0)-(r.costoUnitario||0)),
              (r.precioVenta||0)>(r.costoUnitario||0)?'var(--accent5)':'var(--accent4)')}

          ${kpiSection('📢 Inversión y Eficiencia de Marketing')}
          ${kpiRow('Gasto publicidad (Bs)',         fmt.bs(r.publicidad||0),         'var(--text2)')}
          ${kpiRow('Gasto total marketing (Bs)',    fmt.bs(r.pagoMktTotal||0),       'var(--text2)')}
          ${kpiRow('ROI Marketing',
              fmt.d(r.roiMarketing??0,2)+'x',
              (r.roiMarketing??0)>=2?'var(--accent5)':(r.roiMarketing??0)>=1?'var(--accent3)':'var(--accent4)',
              (r.roiMarketing??0)>=2?'Excelente':(r.roiMarketing??0)>=1?'Aceptable':'Bajo')}
          ${kpiRow('Costo Mkt por unidad vendida (Bs)',
              r.ventasReales>0 ? fmt.bs((r.pagoMktTotal||0)/(r.ventasReales)) : '—',
              'var(--text2)')}
          ${kpiRow('Ingresos por Bs 1 de publicidad (x)',
              r.publicidad>0 ? fmt.d((r.ventasNetas||0)/(r.publicidad),1)+'x' : '—',
              (r.publicidad||0)>0&&(r.ventasNetas||0)/(r.publicidad)>3?'var(--accent5)':'var(--text2)')}

          ${kpiSection('⭐ Marca y Posicionamiento')}
          ${kpiRow('Brand Equity',
              (r.brandEquityFinal ?? 50).toFixed(1)+' pts',
              (r.brandEquityFinal||50)>70?'var(--accent5)':(r.brandEquityFinal||50)>50?'var(--accent3)':'var(--accent4)',
              (r.brandEquityFinal||50)>70?'Marca fuerte':(r.brandEquityFinal||50)>50?'En construcción':'Marca débil')}
          ${kpiRow('Atractivo competitivo',
              fmt.d(r.atractivo||0,2)+' pts',
              (r.atractivo||0)>10?'var(--accent5)':(r.atractivo||0)>5?'var(--accent3)':'var(--accent4)')}

        </table>
      </div>

      <!-- ── Gerente de Producción ───────────────────── -->
      <div class="result-round-card">
        <div class="result-round-header"><h3>🏭 Gerente de Producción</h3></div>
        <table style="width:100%;border-collapse:collapse">
          ${kpiRow('Producción (unidades)',             fmt.num(r.produccion))}
          ${kpiRow('Inventario final (unidades)',   fmt.num(r.inventarioFinal))}
          ${kpiRow('Inventario / Producción',       invProd+'%', +invProd>20?'var(--accent4)':'var(--accent5)')}
          ${kpiRow('Capacidad efectiva (unidades)',    fmt.num(r.capacidadEfectiva ?? '—'))}
          ${kpiRow('Stock MP disponible (unid)',    fmt.num(r.stockMPFinal ?? '—'))}
          <tr><td colspan="2" style="padding:4px 12px;font-family:var(--font-mono);font-size:.6rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;background:rgba(255,255,255,.03)">Desglose Costo Unitario</td></tr>
          ${kpiRow('Costo unitario TOTAL (Bs)',     fmt.d(r.costoUnitario,2))}
          ${kpiRow('  └ Transformación (MOD+OH, Bs)', (() => {
            if (r.costoTransformacion!=null) return fmt.d(r.costoTransformacion,2);
            if (r.costoBaseProducto)         return fmt.d(Math.round((r.costoBaseProducto||0)*0.60*100)/100,2);
            // fallback: CU - MPneto - calidad - canal_aprox
            const pct = 0.60;
            return fmt.d(Math.round((r.costoUnitario||0)*pct*100)/100,2);
          })())}
          ${kpiRow('  └ Factor calidad (Bs)',       r.costoCalidadUnit!=null?fmt.d(r.costoCalidadUnit,2):'—')}
          ${kpiRow('  └ Canal distribución (Bs)', (() => {
            if (r.costoCanal_calc!=null) return fmt.d(Math.max(0,r.costoCanal_calc),2);
            // fallback: CU − trans − calidad − MPneto − efInnovacion
            const trans  = r.costoTransformacion || Math.round((r.costoBaseProducto||0)*0.60*100)/100;
            const cal    = r.costoCalidadUnit    || Math.round(0.20*(r.calidad||5)*100)/100;
            const mpNeto = Math.round((r.costoMPunitario||0)*0.87*100)/100;
            const ef     = r.efInnovacionUnit    || 0;
            return fmt.d(Math.max(0, Math.round(((r.costoUnitario||0)-trans-cal-mpNeto-ef)*100)/100),2);
          })())}
          ${kpiRow('  └ MP proveedor — factura (Bs)', r.costoMPunitario>0?fmt.d(r.costoMPunitario,2):'—', r.costoMPunitario>0?'var(--accent3)':'')}
          ${kpiRow('  └   IVA crédito MP (13%)',    r.costoMPunitario>0?fmt.d(Math.round(r.costoMPunitario*0.13*100)/100,2):'—', 'var(--accent5)')}
          ${kpiRow('  └   Costo neto MP en ER',      r.costoMPunitario>0?fmt.d(Math.round((r.costoMPunitario-r.costoMPunitario*0.13)*100)/100,2):'—')}
          ${r.efInnovacionUnit?kpiRow('  └ Innovación/proceso (Bs)', fmt.d(r.efInnovacionUnit,2)):''}
          ${kpiRow('Proveedor activo',              r.proveedorElegido||'Sin proveedor')}
        </table>
      </div>

      <!-- ── Gerente de RRHH ─────────────────────────── -->
      <div class="result-round-card">
        <div class="result-round-header"><h3>👥 Gerente de RRHH</h3></div>
        <table style="width:100%;border-collapse:collapse">
          ${(() => {
            const prods = r.productos?.length > 1 ? r.productos : null;
            if (prods) {
              // Multiproducto: mostrar por producto
              return prods.map((p, i) => {
                const vf  = p.vendedoresFinales || 0;
                const vpu = vf>0 ? fmt.num(Math.round((p.ventasReales||0)/vf)) : '—';
                const ipu = vf>0 ? fmt.bs(Math.round((p.ventasNetas||0)/vf)) : '—';
                const of  = p.operariosFinales || 0;
                const co  = p.costoOperarios!=null ? fmt.bs(p.costoOperarios) : '—';
                const hdr = '<tr><td colspan="2" style="padding:4px 12px;font-family:var(--font-mono);'
                  + 'font-size:.6rem;color:var(--accent3);text-transform:uppercase;letter-spacing:1px;'
                  + 'background:rgba(255,255,255,.03)">Producto ' + (i+1) + ': ' + (p.producto||'—') + '</td></tr>';
                return hdr
                  + kpiRow('Vendedores finales', fmt.num(vf))
                  + kpiRow('Ventas por vendedor (unid)', vpu)
                  + kpiRow('Ingresos netos por vendedor', ipu)
                  + kpiRow('Operarios finales', fmt.num(of))
                  + kpiRow('Costo operarios (Bs)', co);
              }).join('');
            }
            // Monoproducto: vista simple
            return kpiRow('Vendedores finales', vendFin)
              + kpiRow('Ventas por vendedor (unid)', ventasPorVend)
              + kpiRow('Ingresos netos por vendedor', ingrPorVend)
              + kpiRow('Operarios finales', fmt.num(r.operariosFinales ?? '—'))
              + kpiRow('Costo operarios (Bs)', r.costoOperarios!=null?fmt.bs(r.costoOperarios):'—');
          })()}
        </table>
      </div>

      <!-- ── Gerente Financiero ──────────────────────── -->
      <div class="result-round-card" style="grid-column:span 2">
        <div class="result-round-header"><h3>💰 Gerente Financiero</h3></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
          <table style="width:100%;border-collapse:collapse">
            ${kpiRow('Costo unitario (Bs)',           fmt.d(r.costoUnitario,3))}
            ${kpiRow('Margen bruto',                  mgBruto+'%',  +mgBruto<0?'var(--accent4)':'var(--accent5)')}
            ${kpiRow('Margen neto',                   mgNeto+'%',   +mgNeto<0?'var(--accent4)':'var(--accent5)')}
            ${kpiRow('Utilidad por unidad vendida',   utilPorUnid)}
            ${kpiRow('Utilidad neta (Bs)',             fmt.bs(r.utilidadNeta), r.utilidadNeta<0?'var(--accent4)':'var(--accent5)')}
            ${kpiRow('EBIT (Bs)',                      fmt.bs(r.ebit??0),      (r.ebit??0)<0?'var(--accent4)':'var(--accent5)')}
            ${kpiRow('Caja final (Bs)',                fmt.bs(r.cajaFinal),    r.cajaFinal<=0?'var(--accent4)':'var(--accent5)')}
            ${kpiRow('Sobregiro (Bs)',                 r.sobregiro>0?fmt.bs(r.sobregiro):'—', r.sobregiro>0?'var(--accent4)':'')}
          </table>
          <table style="width:100%;border-collapse:collapse">
            ${kpiRow('Deuda total (Bs)',               fmt.bs(r.deudaFinal))}
            ${kpiRow('Endeudamiento (Deuda/Activos)',  endeud+'%', +endeud>50?'var(--accent4)':+endeud>30?'var(--accent3)':'var(--accent5)')}
            ${kpiRow('Liquidez corriente',             liquidez)}
            ${kpiRow('IVA neto pagado (Bs)',           r.ivaAPagar!=null?fmt.bs(r.ivaAPagar):'—', 'var(--accent4)')}
            ${kpiRow('IT pagado (Bs)',                 r.impuestoIT!=null?fmt.bs(r.impuestoIT):'—', 'var(--accent4)')}
            ${kpiRow('IUE pagado (Bs)',                r.impuestoIUE>0?fmt.bs(r.impuestoIUE):'(pago anual)', r.impuestoIUE>0?'var(--accent4)':'')}
            ${kpiRow('Provisión IUE (Bs)',             r.provisionIUE!=null?fmt.bs(r.provisionIUE):'—', 'var(--accent3)')}
          </table>
        </div>

        <!-- ── Compensación IUE→IT (DS 5563) ── -->
        ${(r.compensacionIT>0 || r.saldoIUEfinal>0 || r.saldoIUEant>0) ? `
        <div style="margin:12px 0 0;padding:12px 16px;background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(59,130,246,.08));border-radius:8px;border:1px solid rgba(16,185,129,.2)">
          <div style="font-family:var(--font-mono);font-size:.65rem;color:#10B981;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:10px">
            ⚖️ Compensación IUE → IT — Decreto Supremo 5563
          </div>
          <div style="font-size:.76rem;color:var(--text3);margin-bottom:10px;line-height:1.6">
            El IUE efectivamente pagado genera un saldo compensable que se descuenta del IT de los períodos siguientes, hasta agotarse.
          </div>
          <table style="width:100%;border-collapse:collapse">
            ${kpiRow('Saldo IUE disponible inicio', r.saldoIUEant>0?fmt.bs(r.saldoIUEant):'Bs 0', r.saldoIUEant>0?'var(--accent5)':'')}
            ${kpiRow('IT devengado (gasto ER)', fmt.bs(r.impuestoIT||0), 'var(--accent4)')}
            ${r.compensacionIT>0?kpiRow('IT compensado con saldo IUE', fmt.bs(r.compensacionIT), 'var(--accent5)'):''}
            ${kpiRow('IT efectivo pagado en caja', fmt.bs(r.ITefectivoCaja??r.impuestoIT??0), (r.ITefectivoCaja??r.impuestoIT??0)>0?'var(--accent4)':'var(--accent5)')}
            ${r.impuestoIUE>0?kpiRow('IUE pagado → recarga saldo', fmt.bs(r.impuestoIUE), 'var(--accent3)'):''}
            ${kpiRow('Saldo IUE para próximo trimestre', r.saldoIUEfinal>0?fmt.bs(r.saldoIUEfinal):'Bs 0 (agotado)', r.saldoIUEfinal>0?'var(--accent5)':'var(--text3)')}
          </table>
          ${r.compensacionIT>0?`<div style="margin-top:8px;padding:6px 10px;background:rgba(16,185,129,.1);border-radius:4px;font-size:.73rem;color:#10B981">
            ✅ Ahorro de caja este trimestre: ${fmt.bs(r.compensacionIT)} (IT compensado con IUE pagado en R${Math.floor(((r.rondaNumero||1)-1)/4)*4||4})
          </div>`:''}
        </div>` : ''}
      </div>

    </div>`;
};

// ─── Estados Financieros Completos ───────────────────────────
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

window.mostrarFinanciero = (n) => {
  document.querySelectorAll('#eq-financiero-nav .ronda-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.textContent.replace(/\D+/g,''))===n);
  });
  const item = (window._finHistorial||[]).find(h=>h.ronda===n);
  const el = document.getElementById('eq-financiero-content');
  if (!item || !el) return;
  const r = item.resultado;
  if (!r || typeof r !== 'object') { el.innerHTML = '<p style="padding:20px;color:var(--text3)">Sin datos para esta ronda.</p>'; return; }

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
              const margenBrutoPct = (p.ventasNetas||0)>0 ? ((utilBruta/(p.ventasNetas))*100).toFixed(1)+'%' : '—';
              const margenNetoPct  = (p.ventasNetas||0)>0 ? ((utilNeta/(p.ventasNetas))*100).toFixed(1)+'%' : '—';
              const mbColor = utilBruta>=0?'var(--accent2)':'var(--accent4)';
              return '<div style="background:var(--bg2);border:0.5px solid var(--border);border-top:3px solid '+col
                + ';border-radius:var(--r);padding:12px 14px;min-width:200px;flex:1">'
                + '<div style="font-weight:700;font-size:.78rem;color:'+col+';margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
                + (p.producto||'Producto '+(i+1)) + '</div>'
                + '<table style="width:100%;border-collapse:collapse">'
                + fR('Ventas netas', p.ventasNetas||0, false, 'neutral')
                + fR('(−) Costo ventas', p.costoVentas||0, true, 'neg')
                + fRS('= Utilidad bruta', utilBruta)
                + '<tr><td style="padding:2px 8px;font-size:.72rem;color:var(--text3)">Margen bruto</td>'
                + '<td style="padding:2px 8px;text-align:right;font-family:var(--font-mono);font-size:.72rem;color:'+mbColor+'">' + margenBrutoPct + '</td></tr>'
                + fR('(−) Gastos operativos', gastosOp, true, 'neg')
                + fRS('= EBIT', ebit)
                + fR('(−) Impuesto IT', p.impuestoIT||0, true, 'neg')
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

            // Totales empresa — usar ventasNetasReal (S11: comisiones netas)
            const totVN   = r.ventasNetasReal||r.ventasNetas||0;
            const totCV   = r.costoVentas||0;
            const totUB   = r.utilidadBruta||0;
            const totGO   = r.gastosOp||0;
            const totEBIT = r.ebit||0;
            const totIT   = r.impuestoIT||0;
            const totUN   = r.utilidadNeta||0;
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
              + fR('(−) Impuesto IT', totIT, true, 'neg')
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
          // Opción 1: consolidar gastos de todos los productos para multiproducto
          const prods = r.productos?.length > 1 ? r.productos : null;
          const sumP  = (fn) => prods ? prods.reduce((s,p) => s + (fn(p)||0), 0) : null;

          // Gastos comerciales — suma todos los productos
          const gPub  = prods ? sumP(p=>p.gastoPublicidad||Math.round((p.publicidad||0)*0.87))
                               : (r.gastoPublicidad||Math.round((r.publicidad||0)*0.87));
          const gProm = prods ? sumP(p=>p.gastoPromocion||Math.round((p.promocion||0)*0.87))
                               : (r.gastoPromocion||Math.round((r.promocion||0)*0.87));
          const gEv   = prods ? sumP(p=>p.gastoEventos||Math.round((p.eventos||0)*0.87))
                               : (r.gastoEventos||Math.round((r.eventos||0)*0.87));
          const gRed  = prods ? sumP(p=>p.gastoMktRedes||Math.round((p.marketingRedes||0)*0.87))
                               : (r.gastoMktRedes||Math.round((r.marketingRedes||0)*0.87));
          const gRRPP = prods ? sumP(p=>p.gastoRRPP||Math.round((p.relacionesPublicas||0)*0.87))
                               : (r.gastoRRPP||Math.round((r.relacionesPublicas||0)*0.87));
          // Fuerza de ventas y operarios — específicos por producto
          const gVend = prods ? sumP(p=>p.costoVendedores||p.gastoCostoVend||0)
                               : (r.costoVendedores||0);
          const gOper = prods ? sumP(p=>p.pagoOperarios||p.costoOperarios||0)
                               : (r.pagoOperarios||r.costoOperarios||0);
          // Costos fijos comunes — solo prod_1 (Alternativa 3)
          const gAdmin  = r.gastoAdminFijo || 0;
          const gPlanta = r.gastoFijoPlanta || 0;
          const gAlmac  = prods ? sumP(p=>p.costoAlmacenamiento||0) : (r.costoAlmacenamiento||0);
          const gInnov  = prods ? sumP(p=>p.gastoInnovacionNeto||Math.round((p.gastoInnovacion||0)*0.87))
                                 : (r.gastoInnovacionNeto||Math.round((r.gastoInnovacion||0)*0.87));
          const tieneInnov = prods ? prods.some(p=>p.gastoInnovacion>0) : r.gastoInnovacion>0;

          // Consolidados de ventas
          const totVentasBrutas = prods ? sumP(p=>p.ventasBrutas||0) : (r.ventasBrutas||0);
          const totIvaDebito    = prods ? sumP(p=>p.ivaDebito||0)    : (r.ivaDebito||0);
          const totTotalFact    = prods ? sumP(p=>p.totalFacturado||((p.ventasBrutas||0)+(p.ivaDebito||0))) : (r.totalFacturado||0);
          const totComisNeto    = prods ? sumP(p=>p.comisionesNeto||Math.round((p.comisiones||0)*0.87)) : (r.comisionesNeto||Math.round((r.comisiones||0)*0.87));
          const totVentasNetas  = prods ? sumP(p=>p.ventasNetasReal||p.ventasNetas||0) : (r.ventasNetasReal||r.ventasNetas||0);
          // Costo de ventas detalle
          const totCVmp    = prods ? sumP(p=>p.cvMP||(p.costoVentas-(p.pagoCalidad||0))||0) : (r.cvMP||(r.costoVentas-(r.pagoCalidad||0))||0);
          const totCVcalid = prods ? sumP(p=>p.pagoCalidad||0) : (r.pagoCalidad||0);
          // Gastos operativos adicionales
          const gCostoVend = prods ? sumP(p=>p.gastoCostoVend||p.costoVendedores||0) : (r.gastoCostoVend||r.costoVendedores||0);
          // gastoInvMkt es decisión de empresa (no por producto) — usar consolidado r
          const gInvMkt    = r.gastoInvMktNeto || 0;
          const tieneInvMkt= gInvMkt > 0;

          const multiLabel = prods ? ' <span style="font-size:.58rem;color:var(--accent3)">(suma todos los productos)</span>' : '';
          const secER = lbl => '<div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border);margin-top:4px">'+lbl+multiLabel+'</div>';

          return ''
            // ── VENTAS ──────────────────────────────────────────
            + secER('Ingresos')
            + finRow('Precio facturado al cliente (con IVA)', totTotalFact, false, 'neutral')
            + finRow('(−) IVA débito fiscal (13%)', -totIvaDebito, false, 'neg')
            + finRowSub('= Ventas brutas (sin IVA)', totVentasBrutas, true)
            + finRow('(−) Comisiones canal (neto)', -totComisNeto, false, 'neg')
            + finRowSub('= Ventas netas', totVentasNetas, true)
            + '<div style="height:4px"></div>'
            // ── COSTO DE VENTAS ─────────────────────────────────
            + secER('Costo de Ventas')
            + finRow('Costo materia prima neto', -totCVmp, false, 'neg')
            + finRow('Costo calidad / control', -totCVcalid, false, 'neg')
            + finRowSub('= Total costo de ventas', -r.costoVentas, true)
            + finRowSub('= Utilidad bruta', r.utilidadBruta, true)
            + '<div style="height:4px"></div>'
            // ── GASTOS COMERCIALES ──────────────────────────────
            + secER('(-) Gastos Comerciales')
            + finRow('Publicidad', -gPub, false, 'neg')
            + finRow('Promoción y descuentos', -gProm, false, 'neg')
            + finRow('Eventos y activaciones', -gEv, false, 'neg')
            + finRow('Marketing en redes', -gRed, false, 'neg')
            + finRow('Relaciones públicas', -gRRPP, false, 'neg')
            + finRow('Fuerza de ventas (sueldos)', -gCostoVend, false, 'neg')
            + (tieneInvMkt ? finRow('Investigación de mercado', -gInvMkt, false, 'neg') : '')
            // ── GASTOS ADMINISTRATIVOS ──────────────────────────
            + secER('(-) Gastos Administrativos')
            + finRow('Sueldos operarios de producción', -gOper, false, 'neg')
            + finRow('Gastos administrativos fijos', -gAdmin, false, 'neg')
            // ── GASTOS PLANTA ───────────────────────────────────
            + secER('(-) Gastos Operativos de Planta')
            + finRow('Gasto fijo de planta', -gPlanta, false, 'neg')
            + finRow('Almacenamiento de inventario', -gAlmac, false, 'neg')
            + (tieneInnov ? finRow('Innovación y desarrollo', -gInnov, false, 'neg') : '');
        })()}

        <!-- EBITDA -->
        <div style="height:4px;border-top:1px dashed var(--border)"></div>
        ${finRowSub('= EBITDA', (r.ebit??0)+(r.depreciacion??0)+(r.amortizacionPatentes??0), true, 'var(--accent3)')}

        <!-- DEPRECIACIÓN -->
        <div style="height:2px"></div>
        ${finRow('(-) Depreciación',           -r.depreciacion,        false,'neg')}

        <!-- EBIT -->
        <div style="height:4px;border-top:1px dashed var(--border)"></div>
        ${finRowSub('= EBIT / Utilidad Operativa', r.ebit??0, true)}
        <div style="height:6px"></div>

        <!-- GASTOS FINANCIEROS -->
        <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border)">(-) Gastos Financieros</div>
        ${finRow('Intereses préstamo',         -r.interesesPrestamo,   false,'neg')}
        ${r.interesSobregiro>0 ? finRow('Intereses sobregiro',-(r.interesSobregiro), false,'neg') : ''}
        ${(r.comisionApertura||0)>0 ? finRow('Comisión apertura devengada',-(r.comisionApertura), false,'neg') : ''}
        <div style="height:4px;border-top:1px dashed var(--border)"></div>
        ${finRowSub('= Utilidad antes de impuestos', (r.ebit??0)-(r.gastoFinanciero??0), true)}
        <div style="height:6px"></div>

        <!-- IMPUESTOS -->
        <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border)">(-) Impuestos</div>
        ${finRow('IT (3% precio facturado)',     -r.impuestoIT,          false,'neg')}
        ${r.impuestoIUE>0 ? finRow('IUE (25% utilidad gravable)', -(r.impuestoIUE), false,'neg') : ''}
        <div style="margin-top:10px;padding:8px 10px;background:rgba(59,130,246,.07);border-radius:6px;border-left:3px solid #3B82F6;font-size:.73rem;color:var(--text3);line-height:1.6">
          <strong style="color:#3B82F6">ⓘ IVA — tributo neutro para la empresa (Ley 843)</strong><br>
          Débito fiscal (ventas): ${fmt.bs(r.ivaDebito||0)}&nbsp;&nbsp;·&nbsp;&nbsp;
          Crédito fiscal (compras + servicios con factura): ${fmt.bs(r.ivaCredito||0)}<br>
          <strong>IVA neto a pagar al Estado: ${fmt.bs(r.ivaAPagar||0)}</strong><br>
          El IVA no es gasto — la empresa lo cobra al cliente y entrega el neto al Estado.
        </div>
        <div style="height:4px;border-top:2px solid var(--border2)"></div>
        ${finRowSub('= Utilidad neta',         r.utilidadNeta,         true)}
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
            ${finRow('Caja y bancos',              r.cajaFinal,           false,'pos')}
            ${finRow('Cuentas por cobrar (CxC)',   r.cxcFinal,            false,'neutral')}
            ${finRow('Inventarios',                r.invFinalValorizado,  false,'neutral')}
            <div style="height:4px;border-top:1px dashed var(--border)"></div>
            ${finRowSub('= Total Activo Corriente', (r.cajaFinal||0)+(r.cxcFinal||0)+(r.invFinalValorizado||0), false)}

            <div style="height:8px"></div>
            <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border)">Activo No Corriente</div>
            ${(r.activosFijosIniciales||0)>0 ? finRow('Activos fijos (valor inicial)', r.activosFijosIniciales, false,'neutral') : ''}
            ${(r.activosFijosIniciales||0)>0 ? finRow('(-) Depreciación acumulada', -(r.depreciacionAcumulada||r.depreciacion||0), false,'neg') : ''}
            ${finRow('Activos fijos netos', r.afNetos||0, false,'neutral')}
            <div style="height:4px;border-top:1px dashed var(--border)"></div>
            ${((r.intangiblesBrutos||0)>0) ? finRow('Activos intangibles (patentes)', r.intangiblesBrutos||0, false,'neutral') : ''}
            ${((r.intangiblesBrutos||0)>0) ? finRow('(-) Amortización acumulada', -(r.amortizacionAcumulada||0), false,'neg') : ''}
            ${((r.intangiblesBrutos||0)>0) ? finRow('Intangibles netos', r.intangiblesNetos||0, false,'neutral') : ''}
            ${finRowSub('= Total Activo No Corriente', (r.afNetos||0)+(r.intangiblesNetos||0), false)}

            <div style="height:8px"></div>
            <div style="height:4px;border-top:2px solid var(--border2)"></div>
            ${finRowSub('= TOTAL ACTIVOS', r.totalActivos||(r.cajaFinal||0)+(r.cxcFinal||0)+(r.invFinalValorizado||0)+(r.afNetos||0)+(r.intangiblesNetos||0), true)}
          </div>
        </div>
      </div>

      <!-- PASIVOS + PATRIMONIO -->
      <div>
        <div class="result-round-card" style="margin-bottom:12px">
          <div class="result-round-header"><h3>Pasivos</h3></div>
          <div style="padding:16px 20px">

            <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border)">Pasivo Corriente</div>
            ${(r.ivaAPagar||0)>0 ? finRow('IVA por pagar (saldo trimestre)', r.ivaAPagar, false,'neg') : ''}
            ${(r.sobregiro||0)>0 ? finRow('Sobregiro bancario',        r.sobregiro, false,'neg') : ''}
            ${finRow('Préstamos y deuda total',    r.deudaFinal,        false,'neg')}
            <div style="height:4px;border-top:1px dashed var(--border)"></div>
            ${finRowSub('= Total Pasivo Corriente', (r.deudaFinal||0)+(r.ivaAPagar||0)+(r.sobregiro||0), false)}

            <div style="height:8px"></div>
            <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid var(--border)">Pasivo No Corriente</div>
            ${finRow('Deuda largo plazo',           0,                   false,'neutral')}
            <div style="height:4px;border-top:1px dashed var(--border)"></div>
            ${finRowSub('= Total Pasivo No Corriente', 0,               false)}

            <div style="height:8px"></div>
            <div style="height:4px;border-top:2px solid var(--border2)"></div>
            ${finRowSub('= TOTAL PASIVOS', (r.deudaFinal||0)+(r.ivaAPagar||0)+(r.sobregiro||0), true)}
          </div>
        </div>

        <div class="result-round-card" style="margin-bottom:12px">
          <div class="result-round-header"><h3>Patrimonio</h3></div>
          <div style="padding:16px 20px">
            ${(() => {
              // Usar valores del engine directamente — no recalcular
              const capital  = r.capitalContable ?? 0;
              const utilidad = r.utilidadNeta    || 0;
              const acumAnt  = r.resultadoAcumulado != null
                ? (r.resultadoAcumulado - utilidad)   // acumulado ANTES de esta ronda
                : 0;
              const patrimonio = capital + acumAnt + utilidad;
              return finRow('Capital contable / social', capital,  false, 'neutral')
                + finRow('Resultados acumulados', acumAnt, false, acumAnt>=0?'pos':'neg')
                + finRow('Utilidad / pérdida del período', utilidad, false, utilidad>=0?'pos':'neg')
                + '<div style="height:4px;border-top:2px solid var(--border2)"></div>'
                + finRowSub('= TOTAL PATRIMONIO', patrimonio, true);
            })()}
          </div>
        </div>

        <div class="result-round-card">
          <div style="padding:12px 16px">
            ${(() => {
              const totalA   = r.totalActivos||(r.cajaFinal||0)+(r.cxcFinal||0)+(r.invFinalValorizado||0)+(r.afNetos||0)+(r.intangiblesNetos||0);
              const totalP   = (r.deudaFinal||0)+(r.ivaAPagar||0);
              const patrim   = r.patrimonio || (totalA - totalP);
              const totalPP  = totalP + patrim;
              const cuadra   = Math.abs(totalA - totalPP) < 2;
              return finRowSub('TOTAL PASIVOS + PATRIMONIO', totalPP, true)
                + '<div style="margin-top:8px;padding:8px 12px;background:'
                + (cuadra?'rgba(6,255,165,.08)':'rgba(255,107,107,.08)')
                + ';border-radius:var(--r);font-size:.78rem;font-family:var(--font-mono)">'
                + (cuadra ? '✓ Balance cuadra' : '⚠ Verificar balance')
                + ' (Activos = ' + fmt.bs(totalA) + ' | P+P = ' + fmt.bs(totalPP) + ')</div>';
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
        ${finRow('Compra de activos fijos / maquinaria', -(r.compraActivosFijos||0), false,'neg')}
        ${(r.pagoInnovacionCapital||0)>0 ? finRow('Innovación capitalizable', -(r.pagoInnovacionCapital||0), false,'neg') : ''}
        <div style="height:4px;border-top:1px dashed var(--border)"></div>
        ${finRowSub('= Flujo Neto de Actividades de Inversión', (r.ventaActivosFijos||0)-(r.compraActivosFijos||0)-(r.pagoInnovacionCapital||0), false)}
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
          const salInv = (r.compraActivosFijos||0)+(r.pagoInnovacionCapital||0);
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

function finRow(label, value, bold=false, type='neutral') {
  const col = type==='pos' ? 'var(--accent5)' : type==='neg' ? 'var(--accent4)' : 'var(--text)';
  const w = bold ? 'font-weight:700' : '';
  return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:.83rem;${w}">
    <span style="color:var(--text2)">${label}</span>
    <span style="font-family:var(--font-mono);font-size:.8rem;color:${col}">${fmt.bs(value)}</span>
  </div>`;
}

console.log('[equipo-hoja] ✅ Módulo cargado — Hoja de Decisiones activa');
