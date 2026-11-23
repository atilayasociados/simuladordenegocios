/**
 * modules/admin-tools.js — SimNego v3.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo independiente: herramientas administrativas
 * Fase 0 del plan de modularización — no modifica app.js
 *
 * Sobrescribe funciones problemáticas de app.js:
 *   - loadAdminRondas      → con fallback directo sin requireSimSelected
 *   - loadAdminResultados  → busca última ronda con datos reales
 *   - loadAdminRecalcular  → pantalla nueva (no existía en app.js)
 *
 * Reversión: comentar <script src="modules/admin-tools.js"> en index.html
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Utilidades internas ───────────────────────────────────────────────────────

/**
 * Espera a que api() esté disponible (definida en app.js)
 * Necesario porque los módulos se cargan después de app.js
 */
function _waitForApi(cb, attempts) {
  attempts = attempts || 0;
  if (typeof api === 'function') { cb(); return; }
  if (attempts > 20) { console.error('[admin-tools] api() no disponible'); return; }
  setTimeout(function() { _waitForApi(cb, attempts + 1); }, 100);
}

// ── loadAdminRondas — SOBRESCRIBE versión de app.js ──────────────────────────
/**
 * Muestra historial de rondas sin depender de state.currentSimId
 * Si requireSimSelected falla, intenta carga directa
 */
async function loadAdminRondas() {
  const el = document.getElementById('rondasContent');
  if (!el) return;

  // Intentar carga directa sin requireSimSelected
  try {
    el.innerHTML = '<p style="color:var(--text3);padding:20px">Cargando historial de rondas...</p>';

    const raw  = await api('GET', '/admin/historial');
    const hist = Array.isArray(raw) ? raw : (raw && raw.rondas ? raw.rondas : (raw && raw.historial ? raw.historial : []));

    if (!hist || !hist.length) {
      el.innerHTML = '<p style="color:var(--text3);padding:20px">Sin rondas ejecutadas aún.</p>';
      return;
    }

    const rows = hist.map(function(h) {
      const estadoClass = (h.estado === 'calculada' || h.estado === 'simulated') ? 'badge-ok' : 'badge-warn';
      const fecha = h.ejecutadaAt ? new Date(h.ejecutadaAt).toLocaleString('es-BO') : '—';
      return '<tr>'
        + '<td style="text-align:center;font-weight:700;color:var(--accent3)">T' + h.ronda + '</td>'
        + '<td style="text-align:center"><span class="badge ' + estadoClass + '">' + h.estado + '</span></td>'
        + '<td style="text-align:center">' + (h.enviados || '—') + ' / ' + (h.total || '—') + '</td>'
        + '<td style="text-align:center;font-size:.78rem;color:var(--text3)">' + fecha + '</td>'
        + '</tr>';
    }).join('');

    el.innerHTML = '<div class="table-wrap">'
      + '<table>'
      + '<thead><tr>'
      + '<th style="text-align:center">Trimestre</th>'
      + '<th style="text-align:center">Estado</th>'
      + '<th style="text-align:center">Decisiones</th>'
      + '<th style="text-align:center">Ejecutada</th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table></div>';






  } catch(e) {
    el.innerHTML = '<p style="color:var(--accent4);padding:20px">Error al cargar rondas: ' + e.message + '</p>';
    console.error('[admin-tools] loadAdminRondas:', e);
  }
}

// ── loadAdminResultados — SOBRESCRIBE versión de app.js ──────────────────────
/**
 * Detecta automáticamente la última ronda con resultados reales
 * No asume que current-1 tiene datos
 */
async function loadAdminResultados(rondaVer) {
  const el = document.getElementById('adminResultadosContent');
  if (!el) return;

  try {
    el.innerHTML = '<p style="color:var(--text3);padding:20px">Cargando resultados...</p>';

    const ronda = await api('GET', '/admin/ronda');
    const current = (ronda && ronda.currentRound) ? ronda.currentRound : 0;

    if (!current) {
      el.innerHTML = '<p style="color:var(--text3);padding:20px">Sin simulación activa.</p>';
      return;
    }

    // Buscar última ronda con resultados reales iterando hacia atrás.
    // Llega hasta 0: la Ronda 0 es el Balance Inicial de Fase 0, que sólo existe en
    // simulaciones con motorContable='partida_doble' (server.js:2758) y no tiene fila
    // en sim_rondas. Sin partida doble, /admin/resultados/0 devuelve 404 igual que
    // cualquier ronda no simulada, así que el bucle sigue de largo y el comportamiento
    // no cambia.
    // El centinela es null, NO 0: con `ultimaSimulada = 0` la guarda `!ultimaSimulada`
    // trataría a la Ronda 0 como "sin datos" (0 es falsy) y cortaría antes de mostrarla.
    let ultimaSimulada = null;
    for (let i = current; i >= 0; i--) {
      try {
        const chk = await api('GET', '/admin/resultados/' + i);
        if (chk && chk.resultados && chk.resultados.length) {
          ultimaSimulada = i;
          break;
        }
      } catch(eIgnore) { /* ronda sin datos */ }
    }

    if (ultimaSimulada === null) {
      el.innerHTML = '<p style="color:var(--text3);padding:20px">Sin rondas ejecutadas aún.</p>';
      return;
    }

    // `rondaVer != null` en vez de truthy: 0 es un valor de ronda válido ahora.
    const n = (rondaVer != null && rondaVer >= 0 && rondaVer <= current) ? rondaVer : ultimaSimulada;
    const rd = await api('GET', '/admin/resultados/' + n);

    if (!rd || !rd.resultados || !rd.resultados.length) {
      el.innerHTML = '<p style="color:var(--text3);padding:20px">Sin resultados para Ronda ' + n + '.</p>';
      return;
    }

    // Selector de rondas. La Ronda 0 se ofrece cuando el Balance Inicial de Fase 0
    // existe de verdad. Se decide con los campos que /admin/ronda YA devolvió arriba
    // (server.js:1843-1844) — sin petición extra:
    //   motorContable === 'partida_doble' && fase0Estado === 'cerrada'
    // que son exactamente las condiciones bajo las cuales GET /admin/resultados/0
    // devuelve datos en vez de 404 (server.js:2758-2772).
    //
    // No alcanza con mirar el bucle de arriba: éste frena en la PRIMERA ronda con
    // datos yendo hacia atrás, así que en una simulación de partida doble ya avanzada
    // (rondas >=1 jugadas) nunca llega a consultar la 0 y ultimaSimulada nunca vale 0.
    // Sin esta comprobación, el profesor perdía el acceso al Balance Inicial desde el
    // desplegable apenas se jugaba la primera ronda.
    // Se conservan los otros dos criterios como respaldo: si el bucle sí encontró la
    // Ronda 0, o si es la que se está viendo, la opción aparece aunque los flags no
    // estuvieran (p.ej. una simulación vieja sin fase0Estado en config).
    const fase0Disponible = !!(ronda
      && ronda.motorContable === 'partida_doble'
      && ronda.fase0Estado === 'cerrada');
    const hayRonda0 = fase0Disponible || (ultimaSimulada === 0) || (n === 0);
    const rondas = Array.from({length: current}, function(_, i) { return i + 1; });
    if (hayRonda0) rondas.unshift(0);
    const opciones = rondas
      .map(function(r) {
        var etiqueta = (r === 0) ? 'Ronda 0 · Balance Inicial' : 'Ronda ' + r;
        return '<option value="' + r + '"' + (r === n ? ' selected' : '') + '>' + etiqueta + '</option>';
      }).join('');

    const selector = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">'
      + '<label style="font-size:.82rem;color:var(--text3)">Ver resultados de:</label>'
      + '<select class="form-input" style="width:auto;padding:4px 10px;font-size:.85rem"'
      + ' onchange="loadAdminResultados(+this.value)">' + opciones + '</select>'
      + '<span style="font-size:.78rem;color:var(--text3)">Última con datos: '
      + (ultimaSimulada === 0 ? 'Ronda 0 · Balance Inicial' : 'Ronda ' + ultimaSimulada) + '</span>'
      + '</div>';

    el.innerHTML = selector + buildAdminResultsHTML(rd);
    if (typeof renderAdminCharts === 'function') setTimeout(renderAdminCharts, 200);

  } catch(e) {
    el.innerHTML = '<p style="color:var(--accent4);padding:20px">Error: ' + e.message + '</p>';
    console.error('[admin-tools] loadAdminResultados:', e);
  }
}

// ── loadAdminRecalcular — NUEVA función ──────────────────────────────────────
/**
 * Pantalla dedicada para recalcular estados financieros de todas las rondas
 * Invoca /admin/recalcular-balance y muestra reporte de resultados
 *
 * Ahora async: consulta GET /admin/ronda para saber si la simulación usa
 * motorContable=partida_doble (mismo patrón que ya usa loadAdminResultados,
 * admin-tools.js ~95/151-153) y, si aplica, agrega un segundo botón para el
 * recálculo extendido Motor1+Motor2 (Etapa 4 del plan). El listener que
 * engancha esta función (admin-tools.js ~269-286) ya invoca funciones async
 * de la misma forma (loadAdminResultados) sin esperar su retorno — seguro
 * convertirla sin tocar el listener.
 */
async function loadAdminRecalcular() {
  const el = document.getElementById('recalcularContent');
  if (!el) return;

  let esPartidaDoble = false;
  try {
    const ronda = await api('GET', '/admin/ronda');
    esPartidaDoble = ronda && ronda.motorContable === 'partida_doble';
  } catch (e) {
    console.warn('[admin-tools] loadAdminRecalcular: no se pudo leer /admin/ronda', e.message);
  }

  el.innerHTML = '<div style="padding:24px;max-width:600px">'
    + '<h2 style="font-size:1.1rem;font-weight:700;margin-bottom:8px;color:var(--accent3)">'
    + '⚡ Recalcular Estados Financieros</h2>'
    + '<p style="font-size:.84rem;color:var(--text3);margin-bottom:8px;line-height:1.6">'
    + 'Re-ejecuta el motor contable para <strong>todas las rondas ejecutadas</strong> '
    + 'usando los parámetros actuales de la industria.</p>'
    + '<p style="font-size:.82rem;color:var(--text3);margin-bottom:20px;line-height:1.6">'
    + '✅ Conserva las decisiones originales de los equipos.<br>'
    + '✅ Corrige descuadres causados por cambios en parámetros.<br>'
    + '✅ Actualiza: ER, Balance, Flujo de Caja en todas las rondas.</p>'
    + '<button class="btn btn-primary" id="btnRecalcAction" onclick="doRecalcularBalance()">'
    + '🔄 Ejecutar Recálculo de Todas las Rondas</button>'
    + '<div id="recalcularReporte" style="margin-top:24px"></div>'
    + (esPartidaDoble
      ? '<hr style="margin:28px 0;border:none;border-top:1px solid var(--border)">'
        + '<h2 style="font-size:1.1rem;font-weight:700;margin-bottom:8px;color:var(--accent3)">'
        + '⚖️ Recalcular Libro Mayor (Motor 2)</h2>'
        + '<p style="font-size:.84rem;color:var(--text3);margin-bottom:8px;line-height:1.6">'
        + 'Detecta automáticamente desde qué ronda el Motor 1 (Estados Financieros) y el '
        + 'Motor 2 (Libro Mayor de partida doble) dejaron de coincidir, corrige el Motor 1 '
        + 'en ese rango, y anula + regenera los asientos del Motor 2 ronda por ronda.</p>'
        + '<button class="btn btn-primary" id="btnRecalcPD" onclick="doRecalcularPartidaDoble()">'
        + '🔄 Recalcular también el Libro Mayor (Motor 2, partida doble)</button>'
        + '<div id="recalcularPDReporte" style="margin-top:24px"></div>'
      : '')
    + '</div>';
}

/**
 * Ejecuta el recálculo y muestra el reporte
 * Separado de loadAdminRecalcular para poder reusar
 */
window.doRecalcularBalance = async function() {
  const btn = document.getElementById('btnRecalcAction');
  const rep = document.getElementById('recalcularReporte');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Recalculando todas las rondas...'; }
  if (rep) rep.innerHTML = '<p style="color:var(--text3);font-size:.84rem">Procesando...</p>';

  try {
    const r = await api('POST', '/admin/recalcular-balance');

    const rondasOK    = r.rondas || r.actualizadas || r.ok || 0;
    const errores     = r.errores || [];
    const detalles    = r.detalles || r.detalle || [];

    let html = '<div style="background:rgba(158,216,48,0.08);border:1px solid rgba(158,216,48,0.3);'
      + 'border-radius:var(--r);padding:16px 20px">'
      + '<div style="font-weight:700;color:var(--accent3);margin-bottom:12px;font-size:.95rem">'
      + '✅ Recálculo completado exitosamente</div>'
      + '<div style="font-size:.84rem;color:var(--text2);margin-bottom:8px">'
      + 'Rondas actualizadas: <strong>' + rondasOK + '</strong></div>';

    if (detalles.length) {
      html += '<div style="font-size:.78rem;color:var(--text3);margin-top:8px">';
      detalles.forEach(function(d) {
        html += '• Ronda ' + d.ronda + ': ' + (d.equipos || 0) + ' equipos actualizados<br>';
      });
      html += '</div>';
    }

    if (errores.length) {
      html += '<div style="color:var(--accent4);font-size:.8rem;margin-top:8px">'
        + 'Errores: ' + errores.join(', ') + '</div>';
    }

    html += '<div style="font-size:.78rem;color:var(--text3);margin-top:12px;border-top:1px solid var(--border);padding-top:10px">'
      + '→ Ve a <strong>Resultados</strong> para verificar los estados financieros actualizados.</div>'
      + '</div>';

    if (rep) rep.innerHTML = html;

  } catch(e) {
    if (rep) rep.innerHTML = '<div style="color:var(--accent4);padding:12px;background:rgba(255,59,48,0.08);'
      + 'border-radius:var(--r)">Error: ' + e.message + '</div>';
    console.error('[admin-tools] doRecalcularBalance:', e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Ejecutar Recálculo de Todas las Rondas';
    }
  }
};

/**
 * Arma el HTML de detalle de conciliación para cada ronda del array
 * `verificacion` que devuelve POST /admin/recalcular-partida-doble
 * (server.js, Etapa 4). Cada entrada es { ronda, todosCoinciden, equipos }
 * o { ronda, error } — misma forma que conciliador.conciliarRonda().
 * equipos[] trae { equipoId, equipoNombre, diferencia: { totalActivos,
 * totalPasivos, patrimonio }, coincide, ... } — mismo campo ya usado en
 * la verificación funcional de la Etapa 4.
 */
function renderVerificacionPD(verificacion) {
  if (!verificacion || !verificacion.length) return '';
  return verificacion.map(function(v) {
    if (v.error) {
      return '⚠️ Ronda ' + v.ronda + ': error al conciliar — ' + v.error;
    }
    if (v.todosCoinciden) {
      return '✅ Ronda ' + v.ronda + ': concilia';
    }
    var detalles = (v.equipos || []).filter(function(eq) { return !eq.coincide; })
      .map(function(eq) {
        return eq.equipoNombre + ' (Δ activos: ' + eq.diferencia.totalActivos
          + ', Δ patrimonio: ' + eq.diferencia.patrimonio + ')';
      }).join(', ');
    return '⚠️ Ronda ' + v.ronda + ': NO concilia — ' + detalles;
  }).join('<br>');
}

/**
 * Ejecuta el recálculo extendido Motor1+Motor2 (POST
 * /admin/recalcular-partida-doble, Etapa 4) y muestra el reporte.
 * Mismo esqueleto que doRecalcularBalance (deshabilitar botón mientras
 * corre, try/catch, reporte en un <div> separado) — 4 casos según la
 * forma de la respuesta del endpoint:
 *   1. sincronizado: true       → informativo, nada que corregir.
 *   2. fase2 === null           → Fase 1 con errores, Fase 2 no corrió.
 *   3. fase2.detenido === true  → parcial: hasta dónde llegó y por qué.
 *   4. éxito completo           → rango recalculado + verificación por ronda.
 */
window.doRecalcularPartidaDoble = async function() {
  const btn = document.getElementById('btnRecalcPD');
  const rep = document.getElementById('recalcularPDReporte');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Recalculando Libro Mayor...'; }
  if (rep) rep.innerHTML = '<p style="color:var(--text3);font-size:.84rem">Procesando...</p>';

  try {
    const r = await api('POST', '/admin/recalcular-partida-doble');
    let html;

    if (r.sincronizado) {
      html = '<div style="background:rgba(78,205,196,0.08);border:1px solid rgba(78,205,196,0.3);'
        + 'border-radius:var(--r);padding:16px 20px">'
        + '<div style="font-weight:700;color:#4ECDC4;margin-bottom:6px;font-size:.95rem">'
        + 'ℹ️ Sin nada que recalcular</div>'
        + '<div style="font-size:.84rem;color:var(--text2)">' + r.mensaje + '</div>'
        + '</div>';

    } else if (r.fase2 === null) {
      const errs = (r.fase1?.errores || []).map(function(e) {
        return 'Ronda ' + e.ronda + ': ' + e.error;
      }).join('<br>');
      html = '<div style="background:rgba(255,59,48,0.08);border:1px solid rgba(255,59,48,0.3);'
        + 'border-radius:var(--r);padding:16px 20px">'
        + '<div style="font-weight:700;color:var(--accent4);margin-bottom:6px;font-size:.95rem">'
        + '❌ Fase 1 (Motor 1) con errores</div>'
        + '<div style="font-size:.84rem;color:var(--text2);margin-bottom:8px">' + r.mensaje + '</div>'
        + (errs ? '<div style="font-size:.78rem;color:var(--text3)">' + errs + '</div>' : '')
        + '</div>';

    } else if (r.fase2.detenido) {
      html = '<div style="background:rgba(230,160,23,0.1);border:1px solid rgba(230,160,23,0.35);'
        + 'border-radius:var(--r);padding:16px 20px">'
        + '<div style="font-weight:700;color:var(--accent3);margin-bottom:6px;font-size:.95rem">'
        + '⚠️ Recálculo detenido a mitad de camino</div>'
        + '<div style="font-size:.84rem;color:var(--text2);margin-bottom:8px">' + r.mensaje + '</div>'
        + (r.verificacion && r.verificacion.length
          ? '<div style="font-size:.78rem;color:var(--text3);margin-top:8px">' + renderVerificacionPD(r.verificacion) + '</div>'
          : '')
        + '</div>';

    } else {
      html = '<div style="background:rgba(158,216,48,0.08);border:1px solid rgba(158,216,48,0.3);'
        + 'border-radius:var(--r);padding:16px 20px">'
        + '<div style="font-weight:700;color:var(--accent3);margin-bottom:6px;font-size:.95rem">'
        + '✅ Recálculo completado</div>'
        + '<div style="font-size:.84rem;color:var(--text2);margin-bottom:8px">' + r.mensaje + '</div>'
        + (r.verificacion && r.verificacion.length
          ? '<div style="font-size:.78rem;color:var(--text3);margin-top:8px">' + renderVerificacionPD(r.verificacion) + '</div>'
          : '')
        + '</div>';
    }

    if (rep) rep.innerHTML = html;

  } catch(e) {
    if (rep) rep.innerHTML = '<div style="color:var(--accent4);padding:12px;background:rgba(255,59,48,0.08);'
      + 'border-radius:var(--r)">Error: ' + e.message + '</div>';
    console.error('[admin-tools] doRecalcularPartidaDoble:', e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Recalcular también el Libro Mayor (Motor 2, partida doble)';
    }
  }
};

// ── Registrar en el router de navegación ─────────────────────────────────────
/**
 * Espera a que setupNav haya registrado los handlers base
 * y agrega el handler para admin-recalcular
 */
_waitForApi(function() {
  // Interceptar clics en el nav para admin-recalcular
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    if (btn.dataset.view === 'admin-recalcular') {
      // vista se activa via setupNav
      setTimeout(loadAdminRecalcular, 100);
    }
    if (btn.dataset.view === 'admin-rondas') {
      // No stopPropagation — dejamos que app.js también maneje
      // pero sobreescribimos el resultado
      setTimeout(loadAdminRondas, 50);
    }
    if (btn.dataset.view === 'admin-resultados') {
      setTimeout(function() { loadAdminResultados(); }, 50);
    }
  }, true); // useCapture=true para interceptar antes que app.js

  
// ── doBackupTodas ─────────────────────────────────────────────────────────────
// Descarga el backup de TODAS las simulaciones, una por una (fetch directo de blob,
// no api() porque devuelve archivo). 800ms entre descargas para no saturar el navegador.
window.doBackupTodas = async function() {
  var btn = event && event.target ? event.target : document.querySelector('[onclick*="doBackupTodas"]');
  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
    var sims = await api('GET', '/admin/simulaciones');
    if (!sims || !sims.length) {
      if (typeof toast === 'function') toast('No hay simulaciones para respaldar', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Backup de todas'; }
      return;
    }
    if (typeof toast === 'function') toast('Generando backup de ' + sims.length + ' simulación(es)…');
    var ok = 0, fallidas = 0;
    for (var i = 0; i < sims.length; i++) {
      var s = sims[i];
      if (btn) btn.textContent = '⏳ ' + (i + 1) + '/' + sims.length + '…';
      try {
        var resp = await fetch('/admin/backup/' + encodeURIComponent(s.id), {
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
        });
        if (!resp.ok) { fallidas++; continue; }
        var disposition = resp.headers.get('Content-Disposition') || '';
        var match = disposition.match(/filename="([^"]+)"/);
        var filename = match ? match[1] : 'backup_' + s.id + '.json';
        var blob = await resp.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        ok++;
      } catch (e) { fallidas++; }
      // 800ms entre descargas (no tras la última)
      if (i < sims.length - 1) await new Promise(function(r) { setTimeout(r, 800); });
    }
    if (typeof toast === 'function') {
      toast('✓ ' + ok + ' backup(s) descargado(s)' + (fallidas ? ' · ' + fallidas + ' fallida(s)' : ''), fallidas ? 'error' : 'success');
    }
    if (btn) {
      btn.disabled = false; btn.textContent = '✅ Listo';
      setTimeout(function() { if (btn) btn.textContent = '💾 Backup de todas'; }, 3000);
    }
  } catch (e) {
    if (typeof toast === 'function') toast('Error en backup masivo: ' + e.message, 'error');
    else alert('Error en backup masivo: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Backup de todas'; }
  }
};

// ── doBackupSimulacion ────────────────────────────────────────────────────────
window.doBackupSimulacion = async function(simIdParam) {
  var btn = event && event.target ? event.target : document.querySelector('[onclick*="doBackupSimulacion"]');
  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
    var resp = await fetch('/admin/backup' + (simIdParam ? '/' + encodeURIComponent(simIdParam) : ''), { headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') } });
    if (!resp.ok) { var e = await resp.json().catch(function(){return{};}); throw new Error(e.error || resp.statusText); }
    var disposition = resp.headers.get('Content-Disposition') || '';
    var match = disposition.match(/filename="([^"]+)"/);
    var filename = match ? match[1] : 'backup_simnego_' + new Date().toISOString().slice(0,10) + '.json';
    var blob = await resp.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    if (btn) { btn.disabled = false; btn.textContent = '✅ Descargado'; }
    setTimeout(function() { if (btn) btn.textContent = '💾 Backup'; }, 3000);
  } catch(e) {
    alert('Error en backup: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Backup'; }
  }
};


// ── doRestaurarSimulacion ─────────────────────────────────────────────────────
window.doRestaurarSimulacion = function(simIdParam) {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = function(e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var backup = JSON.parse(ev.target.result);
        _mostrarModalRestaurar(backup, file.name);
      } catch(err) { alert('❌ Archivo inválido'); }
    };
    reader.readAsText(file);
  };
  input.click();
};

function _mostrarModalRestaurar(backup, filename) {
  if (!backup._meta || !backup.simulacion) { alert('❌ Backup inválido'); return; }
  var meta    = backup._meta;
  var equipos = (backup.equipos    || []).length;
  var rondas  = (backup.rondas     || []).length;
  var decs    = (backup.decisiones || []).length;

  var contenedor = document.getElementById('restaurarModal') || document.createElement('div');
  if (!contenedor.id) {
    contenedor.id = 'restaurarModal';
    document.body.appendChild(contenedor);
  }
  contenedor.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1000;background:var(--bg2);border:1px solid rgba(255,193,7,0.3);border-radius:10px;padding:20px;min-width:400px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.5)';

  contenedor.innerHTML =
    '<div style="font-size:.85rem;font-weight:700;color:#FFC107;margin-bottom:12px">📂 Restaurar backup</div>'
    + '<div style="font-size:.78rem;color:var(--text3);margin-bottom:14px;line-height:1.6">'
    + '<strong style="color:var(--white)">Archivo:</strong> ' + filename + '<br>'
    + '<strong style="color:var(--white)">Simulación:</strong> ' + meta.simulacion + '<br>'
    + '<strong style="color:var(--white)">Fecha:</strong> ' + new Date(meta.fecha).toLocaleString('es-BO') + '<br>'
    + 'Ronda T' + meta.ronda_actual + ' &nbsp;·&nbsp; ' + equipos + ' equipos &nbsp;·&nbsp; ' + rondas + ' rondas &nbsp;·&nbsp; ' + decs + ' decisiones'
    + '</div>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">'
    + '<button class="btn btn-ghost" id="btnRestNueva" style="border-color:rgba(158,216,48,0.4);color:#9ED830">🆕 Nueva simulación</button>'
    + '<button class="btn btn-ghost" id="btnRestSobrescribir" style="border-color:rgba(239,83,80,0.4);color:#EF5350">⚠️ Sobrescribir activa</button>'
    + '<button class="btn btn-ghost" id="btnRestCancelar">✕ Cancelar</button>'
    + '</div>'
    + '<div id="confirmSobrescribir" style="display:none;padding:10px;background:rgba(239,83,80,0.08);border:1px solid rgba(239,83,80,0.3);border-radius:6px;font-size:.78rem;color:#EF5350;margin-bottom:8px">'
    + '⚠️ <strong>Eliminará TODAS las rondas y decisiones actuales.</strong><br>'
    + '<button class="btn btn-ghost" id="btnConfirmarSobrescribir" style="margin-top:8px;border-color:rgba(239,83,80,0.5);color:#EF5350">Sí, sobrescribir</button>'
    + '</div>'
    + '<div id="restaurarReporte"></div>';

  contenedor._backup = backup;

  // Event listeners — sin comillas problemáticas en onclick
  document.getElementById('btnRestNueva').onclick        = function() { window._ejecutarRestaurar('nueva'); };
  document.getElementById('btnRestSobrescribir').onclick = function() { window._pedirConfirmacionSobrescribir(); };
  document.getElementById('btnRestCancelar').onclick     = function() { contenedor.remove(); };
  var btnConf = document.getElementById('btnConfirmarSobrescribir');
  if (btnConf) btnConf.onclick = function() { window._ejecutarRestaurar('sobrescribir'); };
}

window._pedirConfirmacionSobrescribir = function() {
  var c = document.getElementById('confirmSobrescribir'); if (c) c.style.display = 'block';
};

window._ejecutarRestaurar = async function(modo) {
  var modal = document.getElementById('restaurarModal');
  var reporte = document.getElementById('restaurarReporte');
  var backup = modal && modal._backup;
  if (!backup) { alert('Error: backup no encontrado'); return; }
  if (reporte) reporte.innerHTML = '<span style="color:var(--text3)">⏳ Restaurando...</span>';
  modal.querySelectorAll('button').forEach(function(b){b.disabled=true;});
  try {
    var resp = await fetch('/admin/restaurar', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('token')||'') },
      body: JSON.stringify({ backup: backup, modo: modo, confirmar: true })
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || resp.statusText);
    var r = data.reporte || {};
    if (reporte) reporte.innerHTML = '<div style="padding:10px;background:rgba(158,216,48,0.08);border:1px solid rgba(158,216,48,0.2);border-radius:6px;font-size:.78rem">'
      + '✅ <strong style="color:#9ED830">Restauración completada</strong><br>'
      + 'Modo: ' + (modo==='nueva'?'🆕 Nueva':'⚠️ Sobrescrita') + ' · Nombre: ' + data.nombre + '<br>'
      + 'Equipos: ' + r.equipos + ' · Rondas: ' + r.rondas + ' · Decisiones: ' + r.decisiones + '</div>';
    // Cerrar modal y refrescar tras 1.5s
    setTimeout(function() {
      var modal = document.getElementById('restaurarModal');
      if (modal) modal.remove();
      if (typeof loadAdminSimulaciones === 'function') loadAdminSimulaciones();
    }, 1500);
  } catch(e) {
    if (reporte) reporte.innerHTML = '<span style="color:#EF5350">❌ ' + e.message + '</span>';
    modal.querySelectorAll('button').forEach(function(b){b.disabled=false;});
  }
};

console.log('[admin-tools] ✅ Módulo cargado — Recalcular, Rondas, Resultados activos');
});


