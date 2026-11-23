/**
 * modules/equipo-fase0.js — SimNego v3.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: Fase 0 del equipo — configuración inicial antes de la R1
 *
 * Funciones incluidas:
 *   - loadEquipoFase0           → carga y renderiza la vista (activa / solo-lectura / formulario)
 *   - window.loadEquipoFase0    → expuesta para setupNav
 *
 * Dependencias: api(), fmt (ui-components.js), state, toast
 * Reversión: comentar <script src="modules/equipo-fase0.js"> en index.html
 *
 * NOTA: los niveles AF (fase0_af_N_*) NO viajan hoy en state.ref.parametros
 *       (el referencia de /api/decisiones expone un subconjunto). Se leen de
 *       state.ref.parametros si existen; si no, se usan defaults del admin.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Helpers de formato/lectura ──────────────────────────────────────────────
function f0bs(n)            { return (typeof fmt !== 'undefined' && fmt.bs) ? fmt.bs(n) : ('Bs ' + (Number(n) || 0)); }
function f0val(id)          { var e = document.getElementById(id); return e ? e.value : ''; }
function f0chk(id)          { var e = document.getElementById(id); return e ? !!e.checked : false; }
function f0setText(id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; }

// Niveles de activos fijos — desde parámetros si están, si no defaults del admin
function f0Niveles(p) {
  p = p || {};
  var defaults = [
    { n: 1, nombre: 'Micro',     monto: 25000,  capacidad: 300,  operariosMinimos: 2 },
    { n: 2, nombre: 'Pequeña',   monto: 50000,  capacidad: 600,  operariosMinimos: 3 },
    { n: 3, nombre: 'Estándar',  monto: 100000, capacidad: 800,  operariosMinimos: 3 },
    { n: 4, nombre: 'Mediana',   monto: 190000, capacidad: 1150, operariosMinimos: 5 },
    { n: 5, nombre: 'Grande',    monto: 260000, capacidad: 1350, operariosMinimos: 6 },
    { n: 6, nombre: 'Expansiva', monto: 350000, capacidad: 1700, operariosMinimos: 7 }
  ];
  return defaults.map(function(d) {
    var nombre = (p['fase0_af_' + d.n + '_nombre'] != null) ? p['fase0_af_' + d.n + '_nombre'] : d.nombre;
    var monto  = (p['fase0_af_' + d.n + '_monto']  != null) ? Number(p['fase0_af_' + d.n + '_monto']) : d.monto;
    var capacidad = (p['fase0_af_' + d.n + '_capacidad'] != null) ? Number(p['fase0_af_' + d.n + '_capacidad']) : d.capacidad;
    // Operarios mínimos y productividad por nivel (fase0_af_N_operariosMin /
    // fase0_af_N_productividad, vía GET /api/fase0); sin el parámetro, lo de siempre:
    // el mínimo de la tabla y la productividadBase de la simulación.
    var opMin = Number(p['fase0_af_' + d.n + '_operariosMin']);
    var prod  = Number(p['fase0_af_' + d.n + '_productividad']);
    return { n: d.n, nombre: nombre, monto: monto || 0, capacidad: capacidad || 0,
      operariosMinimos: (p['fase0_af_' + d.n + '_operariosMin'] != null && opMin > 0) ? opMin : d.operariosMinimos,
      productividad: (p['fase0_af_' + d.n + '_productividad'] != null && prod > 0) ? prod : Number(p.productividadBase ?? 500) };
  });
}

// ── Carga principal ─────────────────────────────────────────────────────────
async function loadEquipoFase0() {
  var el = document.getElementById('eqFase0Content');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">Cargando...</div>';

  try {
    var resp = await api('GET', '/api/fase0');
    var fase0Activa = resp.fase0Activa;
    var fase0Estado = resp.fase0Estado || null;   // 'activa' | 'cerrada' | 'no_activada'
    var registro = resp.registro || null;
    var fase0Params = resp.fase0Params || {};

    // El registro enviado/cerrado manda sobre el estado de la fase: si el equipo ya
    // constituyó su empresa, siempre puede consultar lo que declaró — también con la
    // Fase 0 cerrada. Antes este chequeo estaba DESPUÉS del corte por !fase0Activa, y
    // como el cierre pone fase0Activa=false, la vista de solo lectura era inalcanzable:
    // un equipo con su registro enviado veía "Fase 0 no está activa aún".
    if (registro && (registro.estado === 'enviado' || registro.estado === 'cerrado')) {
      el.innerHTML = f0RenderReadOnly(registro);
      return;
    }

    // Sin registro: hay que distinguir los dos escenarios que fase0Activa=false
    // confunde. fase0Estado los separa (agregado a /api/fase0 junto con este cambio);
    // el `|| !fase0Activa` cubre respuestas de un servidor viejo sin el campo.
    if (fase0Estado === 'cerrada') {
      el.innerHTML = f0MensajeBox('🔒', 'La Fase 0 ya cerró',
        'No llegaste a enviar tu registro de constitución antes del cierre, así que no '
        + 'hay datos que mostrar acá. Consultá con tu profesor: la simulación continúa '
        + 'en las rondas siguientes.');
      return;
    }

    if (!fase0Activa) {
      el.innerHTML = f0MensajeBox('⏸', 'Fase 0 no está activa aún',
        'Espera instrucciones del profesor.');
      return;
    }

    var ref = state.ref;
    if (!ref) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div>'
        + '<p>Datos de referencia no cargados. '
        + '<button class="btn btn-ghost btn-sm" onclick="location.reload()">Recargar</button></p></div>';
      return;
    }

    el.innerHTML = f0RenderForm(registro || {}, ref, fase0Params);
    f0WireForm(registro || {}, fase0Params);

  } catch (e) {
    el.innerHTML = '<p style="color:var(--accent4);padding:16px">' + e.message + '</p>';
    console.error('[equipo-fase0] loadEquipoFase0:', e);
  }
}

function f0MensajeBox(icono, titulo, texto) {
  return '<div class="empty-state" style="padding:48px 20px;text-align:center">'
    + '<div style="font-size:2.6rem;margin-bottom:12px">' + icono + '</div>'
    + '<h3 style="margin-bottom:8px">' + titulo + '</h3>'
    + '<p style="color:var(--text3);font-size:.9rem">' + texto + '</p></div>';
}

// ── Vista de solo lectura (estado enviado / cerrado) ────────────────────────
function f0RenderReadOnly(r) {
  var fila = function(label, val) {
    return '<div class="param-row"><span class="param-label">' + label + '</span>'
      + '<strong>' + (val !== null && val !== undefined && val !== '' ? val : '—') + '</strong></div>';
  };
  return '<div class="param-card" style="max-width:560px">'
    + '<div class="param-card-title">🔒 Fase 0 enviada — solo lectura</div>'
    + '<p style="font-size:.82rem;color:var(--text3);margin:0 0 12px">'
    + 'Tu configuración inicial ya fue enviada al profesor y no puede modificarse.</p>'
    + fila('Segmento objetivo', r.segmento_1)
    + fila('Producto', r.producto_1)
    + fila('Nivel de planta', r.nivel_af)
    + fila('Activos fijos comprados', f0bs(r.activos_fijos_comprados))
    + fila('Capacidad de producción', r.capacidad_produccion_base)
    + fila('Operarios iniciales', r.operarios_iniciales)
    + fila('Costo / operario', f0bs(r.costo_operario))
    + fila('Sueldo / vendedor', f0bs(r.sueldo_vendedor))
    // ADR-005, decisión 8: solo se carga en costeo por absorción.
    + (Number(r.mano_obra_indirecta_planta) > 0 ? fila('Mano de obra indirecta de planta', f0bs(r.mano_obra_indirecta_planta)) : '')
    + fila('Crédito operativo', f0bs(r.credito_operativo_pre_r1))
    + fila('Crédito inversión', f0bs(r.credito_inversion_pre_r1))
    + fila('Capital total otorgado', f0bs(r.capital_total_otorgado))
    + '</div>';
}

// ── Formulario completo ─────────────────────────────────────────────────────
function f0RenderForm(reg, ref, p) {
  var niveles = f0Niveles(p);
  var sueldoAdminFijo = Number(p.sueldosAdministrativosFijos) || 0;

  var segOpts = '<option value="">-- Seleccionar segmento --</option>'
    + ref.segmentos.map(function (s) {
        return '<option ' + (s.nombre === reg.segmento_1 ? 'selected' : '') + '>' + s.nombre + '</option>';
      }).join('');

  // Punto (a), Fase 1 de pantallas: value = el nombre, así f0Collect guarda el
  // nombre aunque la etiqueta lleve el costo base; "costo base Bs X" y no
  // "(Bs X)", que se leía como precio de venta.
  var prodOpts = '<option value="">-- Seleccionar producto --</option>'
    + ref.tiposProducto.map(function (t) {
        return '<option value="' + String(t.nombre).replace(/"/g, '&quot;') + '" ' + (t.nombre === reg.producto_1 ? 'selected' : '') + '>'
          + t.nombre + ' — costo base Bs ' + t.costoBase + '</option>';
      }).join('');

  var nivelRadios = '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:12px 0">'
    + niveles.map(function(nv) {
      var checked = (Number(reg.nivel_af) === nv.n) ? 'checked' : '';
      var selected = (Number(reg.nivel_af) === nv.n);
      var borderColor = selected ? 'var(--accent)' : 'var(--border)';
      var bg = selected ? 'var(--bg2)' : 'var(--bg1)';
      return '<label style="cursor:pointer;display:flex;flex-direction:column;'
        + 'align-items:center;padding:14px 8px;border-radius:var(--r-lg);'
        + 'border:2px solid ' + borderColor + ';background:' + bg + ';'
        + 'text-align:center;gap:6px;transition:border-color .15s">'
        + '<input type="radio" name="f0_nivel" value="' + nv.n + '"'
        + ' data-monto="' + nv.monto + '" data-cap="' + nv.capacidad + '" data-operarios-minimos="' + nv.operariosMinimos + '" '
        + checked + ' style="display:none"/>'
        + '<strong style="font-size:.95rem">' + nv.nombre + '</strong>'
        + '<span style="font-family:var(--font-mono);font-size:.85rem">' + f0bs(nv.monto) + '</span>'
        + '<span style="color:var(--text3);font-size:.75rem">' + nv.capacidad + ' unidades/trim</span>'
        + '<span style="color:var(--text3);font-size:.75rem">Mínimo ' + nv.operariosMinimos + ' operarios</span>'
        + '<span style="color:var(--text3);font-size:.75rem">' + nv.productividad + ' unidades/operario</span>'
        + '</label>';
    }).join('')
    + '</div>';

  var numInput = function (id, value, min) {
    return '<input class="param-input" type="number" step="any" id="' + id + '"'
      + (min != null ? ' min="' + min + '"' : '') + ' value="' + (value != null ? value : '') + '"/>';
  };

  return ''
    // ── SECCIÓN 1 — Estrategia ──
    + '<div class="param-card">'
    +   '<div class="param-card-title">🎯 Estrategia</div>'
    +   '<div class="param-row"><label class="param-label" for="f0_segmento_1">Segmento objetivo</label>'
    +     '<select class="param-input" id="f0_segmento_1">' + segOpts + '</select></div>'
    +   '<p style="font-size:.8rem;color:var(--text3);margin:0 0 10px">Mercado principal al que orientarás tu estrategia inicial. Úsalo para alinear precio, producto, marketing y canales.</p>'
    +   '<div class="param-row"><label class="param-label" for="f0_producto_1">Producto</label>'
    +     '<select class="param-input" id="f0_producto_1">' + prodOpts + '</select></div>'
    +   '<p style="font-size:.8rem;color:var(--text3);margin:0 0 10px">Producto con el que iniciarás la simulación. Debe ser coherente con el segmento objetivo y tu propuesta de valor.</p>'
    + '</div>'
    // ── SECCIÓN 2 — Tamaño de operación ──
    + '<div class="param-card">'
    +   '<div class="param-card-title">🏗️ Tamaño de operación</div>'
    +   '<p style="font-size:.8rem;color:var(--text3);margin:0 0 10px">Cada nivel de planta requiere un mínimo de operarios para operar correctamente. La planta define la capacidad máxima técnica, pero la producción efectiva también depende del personal contratado.</p>'
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0 0 8px">La maquinaria requiere un período de instalación antes de operar. En simulaciones con Fase 0, la producción puede quedar bloqueada en R1 por lead time; la capacidad de planta no se pierde y queda disponible para rondas posteriores. Además, la producción efectiva depende de contar con operarios suficientes para utilizar esa capacidad.</p>'
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0 0 10px">Comprar una planta grande sin operarios suficientes puede generar capacidad ociosa.</p>'
    +   nivelRadios
    + '</div>'
    + '<div class="param-card">'
    +   '<div class="param-card-title">👔 Personal administrativo fijo</div>'
    +   '<p style="font-size:.8rem;color:var(--text3);margin:0 0 10px">Definido por el profesor para toda la simulación. Representa personal administrativo y gerencial, y se aplica por igual a todos los equipos.</p>'
    +   (sueldoAdminFijo > 0
         ? '<p style="font-size:.9rem;margin:0"><strong>' + f0bs(sueldoAdminFijo) + ' por trimestre</strong></p>'
         : '<p style="font-size:.8rem;color:var(--text3);margin:0">Valor no configurado para esta simulación.</p>')
    + '</div>'
    // ── SECCIÓN — Activos Complementarios ──
    + '<div class="param-card">'
    +   '<div class="param-card-title">🚚 Activos Complementarios</div>'
    +   '<p style="font-size:.8rem;color:var(--text3);margin:0 0 8px">Los activos complementarios fortalecen estrategias específicas. No generan un beneficio general: su efecto depende del canal o tipo de innovación que utilices.</p>'
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0 0 10px">Vehículos: selecciona un nivel de inversión (0–3), no una cantidad; fortalecen canales logísticos como Distribuidores B2B, Ferias y Eventos o Convenios Institucionales.<br>Muebles y enseres: fortalecen Tienda Propia.<br>Equipos de cómputo: fortalecen Venta Digital.<br>Patentes: potencian la innovación de Proceso. Representan mejoras técnicas protegidas que ayudan a producir con mayor eficiencia y reducir costos; no aumentan directamente el atractivo del producto.</p>'
    +   '<div class="param-row"><label class="param-label" for="f0_vehiculo_nivel">Vehículo</label>'
    +     '<select class="param-input" id="f0_vehiculo_nivel">'
    +       '<option value="0"' + ((Number(reg.vehiculo_nivel)||0) === 0 ? ' selected' : '') + '>Sin vehículo (Bs 0)</option>'
    +       '<option value="1"' + ((Number(reg.vehiculo_nivel)||0) === 1 ? ' selected' : '') + '>Moto delivery (' + f0bs(p.costoVehiculoNivel1) + ')</option>'
    +       '<option value="2"' + ((Number(reg.vehiculo_nivel)||0) === 2 ? ' selected' : '') + '>Furgoneta (' + f0bs(p.costoVehiculoNivel2) + ')</option>'
    +       '<option value="3"' + ((Number(reg.vehiculo_nivel)||0) === 3 ? ' selected' : '') + '>Flota completa (' + f0bs(p.costoVehiculoNivel3) + ')</option>'
    +     '</select></div>'
    +   '<div class="param-row"><label class="param-label" for="f0_muebles_comprado">Muebles y Enseres (' + f0bs(p.costoMuebles) + ')</label>'
    +     '<input type="checkbox" id="f0_muebles_comprado"' + (reg.muebles_comprado ? ' checked' : '') + '/></div>'
    +   '<div class="param-row"><label class="param-label" for="f0_equipos_computo_comprado">Equipos de Cómputo (' + f0bs(p.costoComputo) + ')</label>'
    +     '<input type="checkbox" id="f0_equipos_computo_comprado"' + (reg.equipos_computo_comprado ? ' checked' : '') + '/></div>'
    +   '<div class="param-row"><label class="param-label" for="f0_patentes_comprado">Patentes (' + f0bs(p.costoPatentes) + ')</label>'
    +     '<input type="checkbox" id="f0_patentes_comprado"' + (reg.patentes_comprado ? ' checked' : '') + '/></div>'
    + '</div>'
    // ── SECCIÓN 3 — Personal ──
    + '<div class="param-card">'
    +   '<div class="param-card-title">👷 Personal</div>'
    +   '<p style="font-size:.8rem;color:var(--text3);margin:0 0 10px">El personal se divide en productivo y comercial. Los operarios ayudan a utilizar la capacidad de planta; los vendedores apoyan la ejecución comercial y los canales. Sus sueldos son costos laborales trimestrales que deben considerarse en la planificación.</p>'
    +   '<p style="font-size:.8rem;color:#f59e0b;margin:0 0 10px">⚠ Estos valores NUNCA pueden bajar en rondas posteriores.</p>'
    +   '<div class="param-row"><label class="param-label" for="f0_operarios_iniciales">Operarios iniciales</label>'
    +     numInput('f0_operarios_iniciales', reg.operarios_iniciales, 1) + '</div>'
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0 0 10px">Personal productivo que permite operar la planta y utilizar la capacidad instalada. Si son insuficientes, la producción efectiva puede quedar limitada.</p>'
    +   '<div class="param-row"><label class="param-label" for="f0_costo_operario">Sueldo por operario (Bs/trim)</label>'
    +     numInput('f0_costo_operario', reg.costo_operario, 0) + '</div>'
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0 0 10px">Remuneración trimestral del personal productivo. Debe considerarse como costo laboral de producción.</p>'
    // ADR-005, decisión 8 — mano de obra indirecta de planta: solo en costeo por
    // absorción (fase0Params.metodoCosteo, GET /api/fase0). La asigna el docente:
    // aquí es de solo lectura y no se envía; la calculadora de caja la lee del input.
    + (p.metodoCosteo === 'absorcion'
      ? '<div class="param-row"><label class="param-label" for="f0_mano_obra_indirecta">Mano de obra indirecta de planta (Bs/trim) — asignado por el docente</label>'
        + '<input class="param-input" type="number" id="f0_mano_obra_indirecta" value="' + (reg.mano_obra_indirecta_planta != null ? reg.mano_obra_indirecta_planta : 0) + '" readonly disabled/></div>'
        + '<p style="font-size:.76rem;color:var(--text3);margin:0 0 10px">Sueldos de quienes trabajan en la planta sin producir directamente: supervisor de producción, guardia de planta. Es un costo indirecto de fabricación: se carga al costo de las unidades producidas y, si la planta no se usa entera, la parte no usada va a capacidad ociosa. El monto lo asigna el docente.</p>'
      : '')
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0 0 6px">Vendedores iniciales: personal comercial que apoya la atención de canales, clientes y ventas. No aumenta la capacidad productiva.</p>'
    +   '<div class="param-row"><label class="param-label" for="f0_sueldo_vendedor">Sueldo / vendedor (Bs/trim)</label>'
    +     numInput('f0_sueldo_vendedor', reg.sueldo_vendedor, 0) + '</div>'
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0">Remuneración trimestral del equipo comercial. Debe evaluarse junto con la estrategia de canales y ventas.</p>'
    + '</div>'
    // ── SECCIÓN 4 — Financiamiento ──
    + '<div class="param-card">'
    +   '<div class="param-card-title">🏦 Financiamiento pre-R1</div>'
    +   '<p style="font-size:.8rem;color:var(--text3);margin:0 0 10px">El financiamiento define los recursos iniciales de la empresa. El capital aportado por inversionistas fortalece caja y patrimonio sin generar deuda; el préstamo aumenta la caja, pero crea obligaciones financieras e intereses futuros.</p>'
    +   '<div class="param-row"><label class="param-label" for="f0_credito_operativo">Crédito operativo (Bs)</label>'
    +     numInput('f0_credito_operativo', reg.credito_operativo_pre_r1, 0) + '</div>'
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0 0 10px">Financiamiento externo solicitado antes de iniciar la Ronda 1. Aumenta la caja disponible, pero también incrementa la deuda de la empresa.</p>'
    +   '<div class="param-row"><label class="param-label" for="f0_credito_inversion">Crédito inversión (Bs)</label>'
    +     numInput('f0_credito_inversion', reg.credito_inversion_pre_r1, 0) + '</div>'
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0">La deuda inicial es una obligación financiera que deberá pagarse en rondas futuras. Puede generar intereses y afectar la utilidad neta; el interés es el costo financiero por usar dinero prestado y reduce la utilidad y la caja cuando se paga.</p>'
    + '</div>'
    // ── CALCULADORA ──
    + '<div class="param-card" style="background:var(--bg2)">'
    +   '<div class="param-card-title">🧮 Calculadora de caja R1</div>'
    +   '<p style="font-size:.76rem;color:var(--text3);margin:0 0 10px">El capital de trabajo y la inversión disponible son aportes de los inversionistas: fortalecen la caja inicial y el patrimonio, pero no generan deuda ni intereses. La caja disponible es el dinero para iniciar operaciones y cubrir producción, personal, marketing, activos y otros pagos iniciales.</p>'
    +   '<div class="param-row"><span class="param-label">Capital de trabajo (docente)</span><strong id="f0_calc_trabajo">Bs 0</strong></div>'
    +   '<div class="param-row"><span class="param-label">Inversión disponible (docente)</span><strong id="f0_calc_inversion">Bs 0</strong></div>'
    +   '<div class="param-row"><span class="param-label">(−) Planta elegida</span><strong id="f0_calc_planta">Bs 0</strong></div>'
    +   '<div class="param-row"><span class="param-label">(−) Vehículo, muebles, cómputo y patentes</span><strong id="f0_calc_complementarios">Bs 0</strong></div>'
    +   '<div class="param-row"><span class="param-label">(+) Crédito operativo</span><strong id="f0_calc_credop">Bs 0</strong></div>'
    +   '<div class="param-row"><span class="param-label">(+) Crédito inversión</span><strong id="f0_calc_credinv">Bs 0</strong></div>'
    +   '<div class="param-row" style="border-top:1px solid var(--border2);padding-top:8px">'
    +     '<span class="param-label">= Caja disponible R1</span>'
    +     '<strong><span id="f0_calc_semaforo">🟢</span> <span id="f0_calc_caja" style="font-family:var(--font-mono)">Bs 0</span></strong></div>'
    +   '<div class="param-row"><span class="param-label">Costos fijos estimados R1</span><strong id="f0_calc_fijos">Bs 0</strong></div>'
    +   '<div class="param-card-title" style="margin-top:14px;font-size:.9rem">📊 Balance inicial proyectado</div>'
    +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">'
    +     '<div>'
    +       '<div style="font-size:.78rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Activos</div>'
    +       '<div class="param-row"><span class="param-label">Caja</span><strong id="f0_bal_caja">Bs 0</strong></div>'
    +       '<div class="param-row"><span class="param-label">Activos Fijos</span><strong id="f0_bal_af">Bs 0</strong></div>'
    +       '<div class="param-row" style="border-top:1px solid var(--border2);padding-top:6px"><span class="param-label">Total Activos</span><strong id="f0_bal_total_activos">Bs 0</strong></div>'
    +     '</div>'
    +     '<div>'
    +       '<div style="font-size:.78rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Pasivos + Patrimonio</div>'
    +       '<div class="param-row"><span class="param-label">Préstamo operativo</span><strong id="f0_bal_deuda_op">Bs 0</strong></div>'
    +       '<div class="param-row"><span class="param-label">Préstamo inversión</span><strong id="f0_bal_deuda_inv">Bs 0</strong></div>'
    +       '<div class="param-row"><span class="param-label">Total Pasivos</span><strong id="f0_bal_total_pasivos">Bs 0</strong></div>'
    +       '<div class="param-row" style="border-top:1px solid var(--border2);padding-top:6px"><span class="param-label">Capital / Patrimonio</span><strong id="f0_bal_capital">Bs 0</strong></div>'
    +     '</div>'
    +   '</div>'
    +   '<div class="param-row" style="margin-top:8px"><span class="param-label">Verificación A = P + Pat</span><strong id="f0_bal_cuadre">—</strong></div>'
    + '</div>'
    // ── BOTONES ──
    + '<div class="param-actions">'
    +   '<button class="btn btn-ghost" id="f0BtnGuardar">💾 Guardar borrador</button>'
    +   '<button class="btn btn-success" id="f0BtnEnviar">✅ Enviar</button>'
    +   '<span id="f0_caja_negativa_msg" style="display:none;font-size:.8rem;color:var(--accent4);margin-left:10px"></span>'
    + '</div>';
}

// ── Cableado de listeners + calculadora en tiempo real ──────────────────────
function f0WireForm(reg, p) {
  p = p || {};
  var cajaDoc = Number(reg.caja_inicial_docente) || 0;
  var invDoc  = Number(reg.capital_inversion)   || 0;
  // Activos complementarios: mismos precios que cobra POST /api/fase0/enviar
  // (traducirActivosComplementariosFase0), que llegan en fase0Params.
  function f0Complementarios() {
    var nivelV = Number(f0val('f0_vehiculo_nivel')) || 0;
    var vehiculo = nivelV === 1 ? Number(p.costoVehiculoNivel1) || 0
                 : nivelV === 2 ? Number(p.costoVehiculoNivel2) || 0
                 : nivelV === 3 ? Number(p.costoVehiculoNivel3) || 0 : 0;
    return vehiculo
      + (f0chk('f0_muebles_comprado') ? Number(p.costoMuebles) || 0 : 0)
      + (f0chk('f0_equipos_computo_comprado') ? Number(p.costoComputo) || 0 : 0)
      + (f0chk('f0_patentes_comprado') ? Number(p.costoPatentes) || 0 : 0);
  }

  function recalc() {
    var sel = document.querySelector('input[name="f0_nivel"]:checked');
    var planta  = sel ? (Number(sel.dataset.monto) || 0) : 0;
    var oper    = Number(f0val('f0_operarios_iniciales')) || 0;
    var costoOp = Number(f0val('f0_costo_operario'))      || 0;
    var sueldoV = Number(f0val('f0_sueldo_vendedor'))     || 0;

    var credOp  = Number(f0val('f0_credito_operativo')) || 0;
    var credInv = Number(f0val('f0_credito_inversion')) || 0;
    var complementarios = f0Complementarios();
    var cajaR1 = cajaDoc + (invDoc - planta) - complementarios + credOp + credInv;
    // ADR-005: la mano de obra indirecta de planta (solo absorción) también es fija.
    var moi    = Number(f0val('f0_mano_obra_indirecta')) || 0;
    var fijos  = oper * costoOp + sueldoV + moi;

    f0setText('f0_calc_trabajo',   f0bs(cajaDoc));
    f0setText('f0_calc_inversion', f0bs(invDoc));
    f0setText('f0_calc_planta',    f0bs(planta));
    f0setText('f0_calc_complementarios', f0bs(complementarios));
    f0setText('f0_calc_credop',    f0bs(credOp));
    f0setText('f0_calc_credinv',   f0bs(credInv));
    f0setText('f0_calc_caja',      f0bs(cajaR1));
    f0setText('f0_calc_fijos',     f0bs(fijos));
    f0setText('f0_calc_semaforo',  cajaR1 < 0 ? '🔴' : (cajaR1 < fijos ? '🟡' : '🟢'));
    // Caja negativa: el servidor rechaza el envío (POST /api/fase0/enviar → 400).
    var cajaNegativa = Math.round(cajaR1 * 100) / 100 < 0;
    var btnEnviar = document.getElementById('f0BtnEnviar');
    if (btnEnviar) btnEnviar.disabled = cajaNegativa;
    var msgCaja = document.getElementById('f0_caja_negativa_msg');
    if (msgCaja) {
      msgCaja.style.display = cajaNegativa ? '' : 'none';
      msgCaja.textContent = cajaNegativa
        ? 'Tu caja inicial quedaría en ' + f0bs(cajaR1) + ': reduce activos o solicita crédito.' : '';
    }

    // ── Balance inicial proyectado ──
    var caja          = cajaR1;
    var af            = planta + complementarios;
    var totalActivos  = caja + af;
    var totalPasivos  = credOp + credInv;
    var capital       = cajaDoc + invDoc;
    var totalPP       = totalPasivos + capital;
    var cuadra        = Math.abs(totalActivos - totalPP) <= 1;

    f0setText('f0_bal_caja',           f0bs(caja));
    f0setText('f0_bal_af',             f0bs(af));
    f0setText('f0_bal_total_activos',  f0bs(totalActivos));
    f0setText('f0_bal_deuda_op',       f0bs(credOp));
    f0setText('f0_bal_deuda_inv',      f0bs(credInv));
    f0setText('f0_bal_total_pasivos',  f0bs(totalPasivos));
    f0setText('f0_bal_capital',        f0bs(capital));
    f0setText('f0_bal_cuadre',         cuadra ? '✅ Cuadra' : '⚠️ No cuadra (Δ ' + f0bs(totalActivos - totalPP) + ')');
  }

  document.querySelectorAll('#eqFase0Content input, #eqFase0Content select').forEach(function (elx) {
    elx.addEventListener('input', recalc);
    elx.addEventListener('change', recalc);
  });

  // Tarjetas de nivel AF: actualizar selección visual al elegir una
  function f0PintarNiveles() {
    document.querySelectorAll('#eqFase0Content input[name="f0_nivel"]').forEach(function (r) {
      var card = r.closest('label');
      if (!card) return;
      card.style.borderColor = r.checked ? 'var(--accent)' : 'var(--border)';
      card.style.background = r.checked ? 'var(--bg2)' : 'var(--bg1)';
    });
  }
  function f0ActualizarMinimoOperarios() {
    var sel = document.querySelector('#eqFase0Content input[name="f0_nivel"]:checked');
    var input = document.getElementById('f0_operarios_iniciales');
    if (sel && input) input.min = Number(sel.dataset.operariosMinimos) || 1;
  }
  document.querySelectorAll('#eqFase0Content input[name="f0_nivel"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      this.checked = true;   // marca el radio elegido
      f0PintarNiveles();     // deselecciona visualmente las demás tarjetas
      f0ActualizarMinimoOperarios();
      recalc();
    });
  });

  document.getElementById('f0BtnGuardar').addEventListener('click', function () { f0Guardar(); });
  document.getElementById('f0BtnEnviar').addEventListener('click', function () { f0Enviar(); });
  f0ActualizarMinimoOperarios();
  recalc();
}

function f0ValidarOperariosMinimos() {
  var sel = document.querySelector('#eqFase0Content input[name="f0_nivel"]:checked');
  var input = document.getElementById('f0_operarios_iniciales');
  var minimo = sel ? Number(sel.dataset.operariosMinimos) : 0;
  var operarios = input ? Number(input.value) : NaN;
  if (!minimo || (Number.isFinite(operarios) && operarios >= minimo)) return true;
  toast('El nivel de planta seleccionado requiere al menos ' + minimo
    + ' operarios iniciales. Ajuste el número de operarios antes de enviar Fase 0.', 'error');
  if (input) {
    input.min = minimo;
    input.focus();
  }
  return false;
}

function f0ValidarCamposRequeridos() {
  var requeridos = [
    { etiqueta: 'Segmento objetivo', valor: f0val('f0_segmento_1') },
    { etiqueta: 'Producto inicial', valor: f0val('f0_producto_1') },
    { etiqueta: 'Nivel de planta', valor: document.querySelector('#eqFase0Content input[name="f0_nivel"]:checked') ? 'seleccionado' : '' },
    { etiqueta: 'Operarios iniciales', valor: f0val('f0_operarios_iniciales') },
    { etiqueta: 'Sueldo por operario', valor: f0val('f0_costo_operario') }
  ];
  var faltante = requeridos.find(function(campo) { return String(campo.valor).trim() === ''; });
  if (!faltante) return true;
  toast('Falta completar el campo requerido: ' + faltante.etiqueta, 'error');
  return false;
}

function f0Collect() {
  var sel = document.querySelector('input[name="f0_nivel"]:checked');
  var data = {
    segmento_1: f0val('f0_segmento_1'),
    producto_1: (f0val('f0_producto_1') || '')
      .replace(/\s*\(Bs[\d.,\s]+\)\s*$/, '').trim(),
    operarios_iniciales: Number(f0val('f0_operarios_iniciales')) || 0,
    costo_operario: Number(f0val('f0_costo_operario')) || 0,
    sueldo_vendedor: Number(f0val('f0_sueldo_vendedor')) || 0,
    credito_operativo_pre_r1: Number(f0val('f0_credito_operativo')) || 0,
    credito_inversion_pre_r1: Number(f0val('f0_credito_inversion')) || 0,
    vehiculo_nivel: Number(f0val('f0_vehiculo_nivel')) || 0,
    muebles_comprado: f0chk('f0_muebles_comprado'),
    equipos_computo_comprado: f0chk('f0_equipos_computo_comprado'),
    patentes_comprado: f0chk('f0_patentes_comprado')
  };
  // ADR-005, decisión 8: la mano de obra indirecta de planta la asigna el docente — no se envía.
  if (sel) {
    data.nivel_af = Number(sel.value);
    data.activos_fijos_comprados = Number(sel.dataset.monto) || 0;
    data.capacidad_produccion_base = Number(sel.dataset.cap) || 0;
  }
  return data;
}

async function f0Guardar() {
  if (!f0ValidarOperariosMinimos()) return;
  try {
    await api('POST', '/api/fase0/guardar', f0Collect());
    toast('✓ Borrador guardado', 'success');
    await loadEquipoFase0();
  } catch (e) { toast(e.message, 'error'); }
}

async function f0Enviar() {
  if (!f0ValidarCamposRequeridos()) return;
  if (!f0ValidarOperariosMinimos()) return;
  if (!confirm('¿Enviar tu Fase 0? Una vez enviada no podrás modificarla.')) return;
  try {
    // Persistir lo escrito antes de validar el envío en el server.
    await api('POST', '/api/fase0/guardar', f0Collect());
    await api('POST', '/api/fase0/enviar', {});
    toast('✓ Fase 0 enviada', 'success');
    await loadEquipoFase0();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Exponer como window.* para setupNav ──────────────────
window.loadEquipoFase0 = loadEquipoFase0;
console.log('[equipo-fase0] ✅ Módulo cargado — loadEquipoFase0 activo');
