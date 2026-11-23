/**
 * modules/admin-parametros.js — SimNego v3.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: parámetros, segmentos, afinidad y competencia
 * Fase 1 — Día 4 del plan de modularización
 *
 * Funciones incluidas:
 *   - loadAdminParametros, saveParametros, cambiarCodigoAcceso
 *   - loadAdminSegmentos, renderSegmentosEditor, saveSegmentos
 *   - loadAdminAfinidad, renderAfinidadEditor
 *   - loadAdminCompetencia, renderCompetenciaEditor
 *   - window.eliminarCompetidor
 *
 * Dependencias: api(), fmt (ui-components.js), state, toast
 * Reversión: comentar <script src="modules/admin-parametros.js"> en index.html
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Parámetros ────────────────────────────────────────────────────────────────
async function loadAdminParametros() {
  if (!requireSimSelected('adminParametrosContent')) return;
  const data = await api('GET', '/admin/config');
  let p   = data.parametros  || {};
  const tp  = data.tiposProducto || {};
  const can = data.canales      || {};
  const ref = data;

  // Si la sim no tiene parámetros ni proveedores, cargar defaults desde V1
  let proveedoresDefault = data.proveedores || [];
  if (!Object.keys(p).length || !proveedoresDefault.length) {
    try {
      const v1 = await api('GET', '/admin/plantillas/Calzados_COM540_1_2026_V1');
      if (v1?.params && !Object.keys(p).length) p = v1.params;
      if (v1?.proveedores?.length && !proveedoresDefault.length) proveedoresDefault = v1.proveedores;
    } catch {}
  }
  ref.proveedores = proveedoresDefault;

  const CAMPOS_INVERSION_ACTIVOS = [
    ['costoPorUnidadCapacidadAmpliacion', 'Ampliación de planta'],
    ['costoPorUnidadCapacidadMaquinaria', 'Maquinaria'],
    ['costoVehiculoNivel1', 'Vehículo nivel 1'],
    ['costoVehiculoNivel2', 'Vehículo nivel 2'],
    ['costoVehiculoNivel3', 'Vehículo nivel 3'],
    ['costoMuebles', 'Muebles'],
    ['costoComputo', 'Cómputo'],
    ['costoPatentes', 'Patentes'],
  ];
  const faltantesInversionActivos = CAMPOS_INVERSION_ACTIVOS.filter(([key]) => p[key] == null).map(([, label]) => label);

  const pf = (label, key, hint='', step='any') => `
    <div class="param-row">
      <label class="param-label">${label}</label>
      <input class="param-input" type="number" step="${step}" data-pkey="${key}" value="${p[key]??''}"/>
      ${hint?`<span class="param-hint">${hint}</span>`:''}
    </div>`;

  // ── Módulos opcionales (ADR-002) ────────────────────────────────────────────
  // Candado del Día 6: los módulos solo se configuran antes de simular la Ronda 1.
  // Fuera de ese estado los controles se muestran DESHABILITADOS (no ocultos), para
  // que el docente entienda por qué no puede cambiarlos.
  const _cr = Number(ref.currentRound || 1);
  const _rs = ref.roundState || 'pending';
  const modulosEditables = (_cr === 1 && _rs === 'pending');
  // RBAC Bloque 3: solo superadmin guarda parámetros/shocks/segmentos/afinidad.
  // El profesor sigue viendo todo (GET en needAdmin(), sin cambios) — solo se
  // deshabilita la escritura, con el mismo criterio visual que modulosEditables.
  const esSuperAdminRol = esSuperAdmin();
  const mods = p.modulosActivos || {};

  // ── Método de costeo (ADR-005, decisión 5) ─────────────────────────────────
  // Se elige antes de jugar y se bloquea al CALCULAR la Ronda 1 (cambiarlo después
  // es un cambio de política contable, NIC 8). R1 calculada = ronda actual > 1 o la
  // R1 ya simulada. El backend (PUT /admin/parametros) aplica el mismo candado.
  const metodoCosteo = p.metodoCosteo || 'variable';
  const r1Calculada  = _cr > 1 || (_cr === 1 && _rs === 'simulated');
  const metodoEditable = !r1Calculada && esSuperAdminRol;
  const esPartidaDoble = p.motorContable === 'partida_doble';
  const esAbsorcion = metodoCosteo === 'absorcion';
  const tarjetaMetodo = `
      <div class="param-card">
        <div class="param-card-title">🧮 Método de costeo</div>
        <div class="param-row">
          <label class="param-label">Método</label>
          <select class="param-input" data-metodo-costeo="1" ${metodoEditable ? '' : 'disabled'}>
            <option value="variable" ${metodoCosteo === 'variable' ? 'selected' : ''}>Costeo variable</option>
            <option value="absorcion" ${esAbsorcion ? 'selected' : ''} ${esPartidaDoble ? '' : 'disabled'}>Costeo por absorción (NIC 2)</option>
          </select>
        </div>
        <p style="font-size:.76rem;color:var(--text3);margin:6px 0 0;line-height:1.5">
          Absorción: la nómina de operarios, la mano de obra indirecta, el gasto fijo de planta y la depreciación de
          planta y maquinaria van al costo de las unidades producidas (costo fijo por unidad = costos fijos ÷
          máx(capacidad de planta, producción)); la planta no usada es capacidad ociosa. El estado gerencial en
          costeo variable y la conciliación se muestran al lado.
          ${esPartidaDoble ? '' : '<br><strong>Requiere el motor de partida doble.</strong>'}
          ${r1Calculada ? '<br>🔒 <strong>Bloqueado:</strong> la Ronda 1 ya está calculada.' : ''}
        </p>
      </div>`;

  // ── Regla de cobranza de las cuentas por cobrar ────────────────────────────
  // 'saldo' (por defecto si no existe) o 'cohorte'. Solo superadmin la cambia, y no
  // con cuentas por cobrar pendientes al cierre de la última ronda calculada
  // (ref.cxcPendiente, mismo candado que PUT /admin/parametros).
  const reglaCobranza = p.reglaCobranza || 'saldo';
  const cxcPend = ref.cxcPendiente || { pendiente: false, ronda: null };
  const reglaEditable = esSuperAdminRol && !cxcPend.pendiente;
  const tarjetaCobranza = `
      <div class="param-card">
        <div class="param-card-title">💳 Regla de cobranza</div>
        <div class="param-row">
          <label class="param-label">Cobro de ventas a crédito</label>
          <select class="param-input" data-regla-cobranza="1" ${reglaEditable ? '' : 'disabled'}>
            <option value="saldo" ${reglaCobranza === 'saldo' ? 'selected' : ''}>Saldo</option>
            <option value="cohorte" ${reglaCobranza === 'cohorte' ? 'selected' : ''}>Cohorte</option>
          </select>
        </div>
        <p style="font-size:.76rem;color:var(--text3);margin:6px 0 0;line-height:1.5">
          Cohorte: cada venta a crédito se cobra en partes iguales dentro del plazo de cobro.
          Saldo: cada trimestre se cobra una parte del saldo pendiente.
          ${cxcPend.pendiente ? `<br>🔒 <strong>Bloqueado:</strong> hay cuentas por cobrar pendientes al cierre de la ronda ${cxcPend.ronda}.` : ''}
          ${esSuperAdminRol ? '' : '<br>Solo el superadministrador puede cambiarla.'}
        </p>
      </div>`;

  // `mods[clave] !== false` — default TRUE, mismo criterio que resolverModulosActivos()
  // en engine.js: un módulo sin valor explícito está activo. Usar `=== true` rompería
  // ese default en toda simulación que todavía no tenga modulosActivos guardado.
  const mt = (clave) => {
    const activo = mods[clave] !== false;
    return `<label class="mod-toggle" title="${modulosEditables
        ? 'Activar o desactivar este módulo para todos los equipos'
        : 'Los módulos se configuran antes de iniciar la simulación'}">
      <input type="checkbox" data-modact="${clave}" ${activo ? 'checked' : ''}
        ${modulosEditables ? '' : 'disabled'}
        style="width:15px;height:15px;accent-color:var(--accent);cursor:${modulosEditables?'pointer':'not-allowed'}"/>
      <span style="font-size:.7rem;color:var(--text3);font-weight:400">${activo ? 'Activo' : 'Apagado'}</span>
    </label>`;
  };

  const avisoModulos = modulosEditables ? '' : `
      <div class="param-card" style="grid-column:1/-1;border-left:3px solid var(--accent3)">
        <div style="font-size:.8rem;color:var(--text2)">
          🔒 <strong>Módulos bloqueados</strong> — los módulos se configuran antes de iniciar
          la simulación. Esta simulación ya está en ronda ${_cr} (${_rs}), así que los
          controles quedan deshabilitados para no cambiar las reglas del juego a mitad de
          partida.
        </div>
      </div>`;

  document.getElementById('adminParametrosContent').innerHTML = `
    <div class="param-grid">
${avisoModulos}
${tarjetaMetodo}
${tarjetaCobranza}
      <div class="param-card">
        <div class="param-card-title">💳 Ventas y Cobranzas</div>
        ${pf('% Ventas al contado','pctVentasContado','0.70 = 70%')}
        ${pf('% Ventas a crédito','pctVentasCredito','0.30 = 30%')}
        ${pf('Plazo cobro (trimestres)','plazoCobro','1 = siguiente trimestre','1')}
      </div>

      <div class="param-card">
        <div class="param-card-title">🏦 Financiamiento</div>
        ${pf('Tasa préstamo operativo (trim.)','tasaPrestamoOperativo','0.04 = 4%')}
        ${pf('Tasa préstamo inversión (trim.)','tasaPrestamoInversion','0.03 = 3%')}
        ${pf('Tasa sobregiro (trim.)','tasaSobregiro','0.06 = 6%')}
        ${pf('Comisión apertura préstamo','comisionAperturaPrestamo','0.01 = 1%')}
        ${pf('Plazo préstamo operativo (trim.)','plazoPrestamoOperativo','','1')}
        ${pf('Plazo préstamo inversión (trim.)','plazoPrestamoInversion','','1')}
      </div>

      <div class="param-card">
        <div class="param-card-title">👥 Fuerza de Ventas ${mt('fuerzaVentas')}</div>
        ${pf('Vendedores iniciales por equipo','vendedoresIniciales','','1')}
        ${pf('Sueldo trimestral / vendedor (Bs)','sueldoTrimestralVendedor','Valor de respaldo — si Fase 0 define un sueldo por equipo, ese tiene prioridad')}
        ${pf('Costo contratación / vendedor (Bs)','costoContratacionVendedor')}
        ${pf('Costo despido / vendedor (Bs)','costoDespidoVendedor')}
      </div>

      <div class="param-card">
        <div class="param-card-title">👷 Operarios y Producción ${mt('operariosProduccion')}</div>
        ${pf('Operarios iniciales por equipo','operariosIniciales','Aplica desde la próxima ronda','1')}
        ${pf('Productividad base (unid/operario)','productividadBase','Unidades por operario por trimestre')}
        ${pf('Costo trimestral / operario (Bs)','costoOperario','Valor de respaldo — si Fase 0 define un costo por equipo, ese tiene prioridad')}
        ${pf('Costo contratación / operario (Bs)','costoContratacionOperario')}
        ${pf('Costo despido / operario (Bs)','costoDespidoOperario')}
        ${pf('Factor capacitación','factorCapacitacion','0.05 = +5% productividad por inversión en capacitación')}
      </div>

      <div class="param-card">
        <div class="param-card-title">🏗️ Inversión en activos por ronda ${mt('inversionActivos')}</div>
        ${pf('Costo por unidad de ampliación de planta','costoPorUnidadCapacidadAmpliacion','Bs por unidad de capacidad agregada')}
        ${pf('Costo por unidad de maquinaria','costoPorUnidadCapacidadMaquinaria','Bs por unidad de capacidad agregada')}
        ${pf('Vehículo nivel 1 (Bs)','costoVehiculoNivel1','Costo compra por ronda')}
        ${pf('Vehículo nivel 2 (Bs)','costoVehiculoNivel2','Costo compra por ronda')}
        ${pf('Vehículo nivel 3 (Bs)','costoVehiculoNivel3','Costo compra por ronda')}
        ${pf('Muebles (Bs)','costoMuebles','Costo compra por ronda')}
        ${pf('Cómputo (Bs)','costoComputo','Costo compra por ronda')}
        ${pf('Patentes (Bs)','costoPatentes','Costo compra por ronda')}
        ${faltantesInversionActivos.length
          ? `<span class="param-warning">⚠ Sin configurar: ${faltantesInversionActivos.join(', ')} — los equipos verán costo Bs 0 en estos rubros hasta que se completen.</span>`
          : ''}
      </div>

      <div class="param-card">
        <div class="param-card-title">🔍 Investigación de Mercado ${mt('investigacionMercado')}</div>
        ${pf('Reporte Básico (Bs)','costoInvestigacionBasica')}
        ${pf('Reporte Premium (Bs)','costoInvestigacionPremium')}
        ${pf('Reporte Estratégico (Bs)','costoInvestigacionEstrategico')}
      </div>

      <div class="param-card">
        <div class="param-card-title">💡 Innovación ${mt('innovacion')}</div>
        ${pf('Factor innovación Producto','factorInnovacionProducto','0.333 = 1/3 del monto/unid')}
        ${pf('Factor innovación Proceso','factorInnovacionProceso','0.333 = reducción de CU')}
      </div>

      <div class="param-card">
        <div class="param-card-title">🧾 Sistema Tributario Bolivia — Etapa 3.5 ${mt('sistemaTributario')}</div>
        ${pf('IVA (tasa)','tasaIVA','0.13 = 13%')}
        ${pf('IT — Impuesto a las Transacciones (tasa)','tasaIT','0.03 = 3% sobre ventas brutas')}
        ${pf('IUE — Impuesto s/Utilidades (tasa)','tasaIUE','0.25 = 25% sobre utilidad gravable')}
        ${pf('Períodos para pago IUE (trimestres)','periodosIUE','4 = pago anual')}
      </div>

      <div class="param-card">
        <div class="param-card-title">📈 Demanda y Marca</div>
        ${pf('λ Logit — Sensibilidad competitiva','lambdaLogit','1.0 = neutro · >1 más diferenciado · <1 más aleatorio')}
        ${pf('Coef. Precio (sensibilidad al precio en Logit)','coefPrecio','-0.7 = jaboncillos (Bs 2-10) · -0.005 = calzados (Bs 90-310) · valor negativo')}
        ${pf('Factor canibalización','factorCanibalizacion','0.15 = penaliza 15% el atractivo al competir en varios segmentos · 0 = sin penalización')}
        ${pf('Tasa de decaimiento de marca','tasaDecaimiento','0.05 = Brand Equity cae 5% por ronda sin ventas · 0 = sin decaimiento')}
      </div>

      <div class="param-card">
        <div class="param-card-title">🧪 Costo Base — Parámetros Generales</div>
        <p style="font-size:.78rem;color:var(--text3);margin:0 0 12px">
          Valores compartidos por todos los productos de la simulación.
        </p>
        ${pf('Costo almacenamiento / unid (Bs)','costoAlmacenamientoUnidad','Bs/unid final')}
        ${pf('% Costo por punto de calidad sobre/bajo 5 (ej. 0.08 = 8% del costoBase)','pctCostoCalidad','0.08')}
        ${pf('% Materia Prima del costoBase (ej. 0.40 = 40% del costo base es MP)','pctMateriaPrima','0.40')}
      </div>

      <div class="param-card">
        <div class="param-card-title">🏷️ Costo Base — Precio de Costo por Producto</div>
        <p style="font-size:.78rem;color:var(--text3);margin:0 0 12px">
          Costo de producción por unidad (Bs) de cada producto de esta simulación. Sobre
          este valor se aplican el % de calidad y el % de materia prima de la tarjeta anterior.
        </p>
        ${Object.keys(tp).length
          ? Object.entries(tp).map(([n,v])=>`
          <div class="param-row">
            <label class="param-label">${n}</label>
            <input class="param-input" type="number" step="0.01" data-tp="${n}" value="${v.costoBase}"/>
          </div>${esAbsorcion ? `
          <div class="param-row">
            <label class="param-label" style="padding-left:12px;font-size:.76rem">└ Gastos indirectos variables (Bs/unidad)</label>
            <input class="param-input" type="number" step="0.01" min="0" data-tpgiv="${n}" value="${v.gastosIndirectosVariables ?? 0}"/>
          </div>` : ''}`).join('')
          : `<span class="param-warning">⚠ Esta simulación no tiene productos configurados.</span>`}
      </div>

      <!-- Meta-tarjeta "⚙️ Módulos Activos — Control de Funcionalidades" ELIMINADA.
           ADR-002 (Día 4) la declaró reemplazada por el sistema de módulos por tarjeta
           (modulosActivos, toggles agregados en bde7bab), pero la limpieza nunca se
           ejecutó: quedaron 2 controles distintos y parcialmente redundantes en la
           misma pantalla.
           De sus 9 checkboxes, 7 no tenían ningún consumidor en el código (verificado
           con barrido: 0 coincidencias en engine.js y fuera de esta propia tarjeta).
           Los 2 restantes (modOperarios, modMateriaPrima) sí controlaban la visibilidad
           de las secciones 2.5 y 2.6 de la hoja del equipo; se migraron a
           hojaModulosActivos en equipo-hoja.js — ver el commit de esta eliminación. -->

      <div class="param-card" style="grid-column:span 2">
        <div class="param-card-title">📦 Canales — Costos y Comisiones</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th style="width:20%">Canal</th>
              <th style="width:20%">Costo adicional<br>/unid (Bs)</th>
              <th style="width:20%">Comisión<br>sobre ventas</th>
              <th style="width:20%">Factor impacto<br>vendedores</th>
              <th style="width:20%">Bono<br>atractivo</th>
            </tr></thead>
            <tbody>
              ${Object.entries(can).map(([n,v])=>`
                <tr>
                  <td><strong>${n}</strong></td>
                  <td><input class="param-input" type="number" step="0.01" data-canal="${n}" data-canal-field="costoAdicionalUnitario" value="${v.costoAdicionalUnitario}" style="width:90px"/></td>
                  <td><input class="param-input" type="number" step="0.01" data-canal="${n}" data-canal-field="comisionPct" value="${v.comisionPct}" style="width:90px"/></td>
                  <td><input class="param-input" type="number" step="0.01" data-canal="${n}" data-canal-field="factorImpactoVendedores" value="${v.factorImpactoVendedores}" style="width:90px"/></td>
                  <td><input class="param-input" type="number" step="0.1"  data-canal="${n}" data-canal-field="bonoAtractivo" value="${v.bonoAtractivo}" style="width:90px"/></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="param-card" style="grid-column:span 2">
        <div class="param-card-title">🏭 Proveedores de Materia Prima ${mt('proveedoresMP')}</div>
        <p style="font-size:.78rem;color:var(--text3);margin:0 0 12px">
          Factor = multiplicador sobre el costo estándar de MP (costoBase × pctMateriaPrima).
          Factor 1.10 = 10% más caro · Factor 0.75 = 25% más barato.
        </p>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Proveedor</th>
              <th>Factor costo</th>
              <th>Calidad (1-10)</th>
              <th>Lead time (trim.)</th>
            </tr></thead>
            <tbody>
              ${(ref.proveedores || []).map((pv,i) => `
                <tr>
                  <td><strong>${pv.nombre}</strong></td>
                  <td><input class="param-input" type="number" step="0.01" min="0.1" max="3"
                    data-prov-idx="${i}" data-prov-field="factorCosto"
                    value="${pv.factorCosto ?? 1.0}" style="width:90px"/>
                    <span style="font-size:.7rem;color:var(--text3)"> (1.0 = estándar)</span>
                  </td>
                  <td><input class="param-input" type="number" step="1" min="1" max="10"
                    data-prov-idx="${i}" data-prov-field="calidad"
                    value="${pv.calidad ?? 5}" style="width:70px"/></td>
                  <td><input class="param-input" type="number" step="1" min="1" max="4"
                    data-prov-idx="${i}" data-prov-field="leadTime"
                    value="${pv.leadTime ?? 1}" style="width:70px"/></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

    </div>
    <div class="param-actions">
      <button class="btn btn-primary" id="btnSaveParams" ${esSuperAdminRol ? '' : 'disabled'}
        title="${esSuperAdminRol ? '' : 'Solo superadmin puede guardar cambios'}"
        style="${esSuperAdminRol ? '' : 'cursor:not-allowed;opacity:.6'}">💾 Guardar Parámetros</button>
      <span class="param-warning">⚠ Los cambios aplican desde la próxima simulación</span>
    </div>
    ${esSuperAdminRol ? '' : `
    <div class="param-card" style="grid-column:1/-1;border-left:3px solid var(--accent3);margin-top:12px">
      <div style="font-size:.8rem;color:var(--text2)">
        🔒 <strong>Solo lectura</strong> — el superadmin gestiona estos valores. Podés verlos pero no modificarlos.
      </div>
    </div>`}

    <div class="param-card" style="margin-top:16px;max-width:480px">
      <div class="param-card-title">🔑 Código de Acceso al Simulador</div>
      <div style="font-size:.8rem;color:var(--text3);margin-bottom:12px">
        Los estudiantes usan este código para ingresar. Cámbialo cuando necesites.
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <input id="inputCodigoAcceso" class="param-input" type="text"
          style="flex:1;font-family:var(--font-mono);letter-spacing:2px;font-size:1rem;text-transform:uppercase"
          placeholder="Ej: TIGRES2026"
          value="${data.codigoAcceso || ''}"/>
        <button class="btn btn-primary btn-sm" onclick="cambiarCodigoAcceso()">🔄 Cambiar</button>
      </div>
      <div id="codigoAccesoStatus" style="font-size:.75rem;margin-top:8px;color:var(--text3)">
        Código actual: <span style="font-family:var(--font-mono);color:var(--accent3);font-weight:700">${data.codigoAcceso || '—'}</span>
      </div>
    </div>`;

  document.getElementById('btnSaveParams').addEventListener('click', saveParametros);
}

async function cambiarCodigoAcceso() {
  var input = document.getElementById('inputCodigoAcceso');
  var nuevo = (input && input.value ? input.value : '').trim().toUpperCase();
  if (!nuevo || nuevo.length < 3) { toast('El código debe tener al menos 3 caracteres', 'error'); return; }
  try {
    var simId = state.ref && state.ref.simId ? state.ref.simId : state.simId;
    if (!simId) { toast('Sin simulación activa', 'error'); return; }
    await api('PUT', '/admin/simulaciones/' + simId, { codigoAcceso: nuevo });
    var st = document.getElementById('codigoAccesoStatus');
    if (st) st.innerHTML = 'Código actualizado: <span style="font-family:var(--font-mono);color:var(--accent2);font-weight:700">' + nuevo + '</span> ✅';
    if (input) input.value = nuevo;
    toast('✅ Código de acceso actualizado: ' + nuevo, 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function saveParametros() {
  var parametros = {};
  document.querySelectorAll('[data-pkey]').forEach(function(el) { parametros[el.dataset.pkey] = +el.value; });
  document.querySelectorAll('[data-pkey-str]').forEach(function(el) { parametros[el.dataset.pkeyStr] = el.value; });
  // modulosActivos (ADR-002) — objeto anidado, distinto del sistema viejo `modulos_*`
  // de la meta-tarjeta decorativa (que ningún cálculo lee). Se envían SIEMPRE los 7
  // juntos, no solo el que cambió: el backend hace `{ ...sim.parametros, ...parametros }`
  // (server.js ~3048), así que un objeto parcial pisaría los módulos no enviados.
  // Solo se envía si los controles están habilitados — con el candado del Día 6 activo
  // están `disabled` y no deben sobrescribir lo ya guardado.
  var _modact = document.querySelectorAll('[data-modact]');
  if (_modact.length && !_modact[0].disabled) {
    var modulosActivos = {};
    _modact.forEach(function(el) { modulosActivos[el.dataset.modact] = el.checked; });
    parametros.modulosActivos = modulosActivos;
  }
  // Método de costeo (ADR-005): solo si el selector está habilitado; con el candado
  // activo no se reenvía.
  var _metodoEl = document.querySelector('[data-metodo-costeo]');
  var _metodoAnterior = (state.ref && state.ref.parametros && state.ref.parametros.metodoCosteo) || 'variable';
  if (_metodoEl && !_metodoEl.disabled) parametros.metodoCosteo = _metodoEl.value;
  // Regla de cobranza: solo si el selector está habilitado (rol y candado de CxC).
  var _reglaEl = document.querySelector('[data-regla-cobranza]');
  if (_reglaEl && !_reglaEl.disabled) parametros.reglaCobranza = _reglaEl.value;
  var tiposProducto = {};
  document.querySelectorAll('[data-tp]').forEach(function(el) { tiposProducto[el.dataset.tp] = { costoBase: +el.value }; });
  // Gastos indirectos variables por tipo (ADR-005, decisión 6): solo se muestran en absorción.
  document.querySelectorAll('[data-tpgiv]').forEach(function(el) {
    if (!tiposProducto[el.dataset.tpgiv]) tiposProducto[el.dataset.tpgiv] = {};
    tiposProducto[el.dataset.tpgiv].gastosIndirectosVariables = el.value === '' ? 0 : +el.value;
  });
  var canales = {};
  document.querySelectorAll('[data-canal]').forEach(function(el) {
    if (!canales[el.dataset.canal]) canales[el.dataset.canal] = {};
    canales[el.dataset.canal][el.dataset.canalField] = +el.value;
  });
  try {
    await api('PUT', '/admin/parametros', { parametros });
    await api('PUT', '/admin/tiposproducto', { tiposProducto });
    await api('PUT', '/admin/canales', { canales });
    toast('✓ Parámetros guardados', 'success');
    state.ref = await api('GET', '/admin/config');
    // ADR-005: al cambiar de método se vuelve a dibujar la pantalla (en absorción
    // aparecen los gastos indirectos variables por producto).
    if (parametros.metodoCosteo !== undefined && parametros.metodoCosteo !== _metodoAnterior) await loadAdminParametros();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Segmentos ─────────────────────────────────────────────────────────────────
// segmentosLocal declarada en app.js

async function loadAdminSegmentos() {
  if (!requireSimSelected('adminSegmentosContent')) return;
  segmentosLocal = await api('GET', '/admin/segmentos');
  renderSegmentosEditor();
}

function renderSegmentosEditor() {
  var esSuperAdminRol = esSuperAdmin();
  var tabs = segmentosLocal.map(function(s, i) {
    return '<button class="seg-tab ' + (i === 0 ? 'active' : '') + '" data-seg="' + i + '">' + s.nombre + '</button>';
  }).join('');

  var panels = segmentosLocal.map(function(s, i) {
    return '<div class="seg-panel ' + (i === 0 ? 'active' : '') + '" id="segPanel_' + i + '">'
      + '<div class="seg-rename-row"><label class="param-label" style="color:var(--accent3);font-weight:700">✏️ Nombre del segmento</label>'
      + '<input class="param-input seg-nombre-input" style="font-weight:700;font-size:.95rem;max-width:340px" data-seg-idx="' + i + '" data-seg-field="nombre" value="' + s.nombre + '"/></div>'
      + '<div class="seg-fields-grid"><div class="param-card"><div class="param-card-title">📊 Mercado</div>'
      + '<div class="param-row"><label class="param-label">Demanda base (unidades)</label><input class="param-input" type="number" step="1000" data-seg-idx="' + i + '" data-seg-field="demandaBase" value="' + s.demandaBase + '"/></div>'
      + '<div class="param-row"><label class="param-label">% Contrabando (0–1)</label><input class="param-input" type="number" step="0.01" min="0" max="1" data-seg-idx="' + i + '" data-seg-field="pctContrabando" value="' + s.pctContrabando + '"/><span class="param-hint">Demanda formal = Demanda base × (1 − %)</span></div>'
      + '<div class="param-row"><label class="param-label">Índice externo</label><input class="param-input" type="number" step="0.1" data-seg-idx="' + i + '" data-seg-field="indiceExterno" value="' + s.indiceExterno + '"/></div>'
      // Antes acá había un <select> de "Tendencia" que guardaba texto y no afectaba el
      // cálculo. Ahora se edita la TASA (el número que consume engine.js:299) y la
      // etiqueta se muestra derivada, en vivo, vía calcularTendencia (ui-components.js).
      + '<div class="param-row"><label class="param-label">Tasa de crecimiento (0–1)</label><input class="param-input" type="number" step="0.01" data-seg-idx="' + i + '" data-seg-field="tasaCrecimiento" value="' + (s.tasaCrecimiento != null ? s.tasaCrecimiento : 0) + '"/><span class="param-hint">Demanda base crece este % por ronda</span></div>'
      + '<div class="param-row"><label class="param-label">Tendencia (calculada)</label><span class="param-input" style="border:none;background:none;padding-left:0;font-weight:700;color:var(--accent2)" id="tendCalc_' + i + '">' + calcularTendencia(s.tasaCrecimiento) + '</span><span class="param-hint">Se deriva de la tasa — no se edita a mano</span></div>'
      + '</div></div>'
      + '<div style="margin-top:10px;padding:10px;background:var(--bg3);border-radius:var(--r);font-family:var(--font-mono);font-size:.78rem;color:var(--accent2)">Demanda formal = <strong id="demFormal_' + i + '">' + Math.round(s.demandaBase * (1 - s.pctContrabando)).toLocaleString('es-BO') + '</strong> unidades</div></div>';
  }).join('');

  document.getElementById('adminSegmentosContent').innerHTML =
    '<div class="seg-tabs-bar">' + tabs + '</div><div class="seg-panels">' + panels + '</div>'
    + '<div class="param-actions"><button class="btn btn-primary" id="btnSaveSegs"' + (esSuperAdminRol ? '' : ' disabled title="Solo superadmin puede guardar cambios" style="cursor:not-allowed;opacity:.6"') + '>💾 Guardar Segmentos</button><button class="btn btn-ghost" id="btnResetSegs">↺ Recargar</button></div>'
    + (esSuperAdminRol ? '' : '<div class="param-card" style="border-left:3px solid var(--accent3);margin-top:12px"><div style="font-size:.8rem;color:var(--text2)">🔒 <strong>Solo lectura</strong> — el superadmin gestiona estos valores. Podés verlos pero no modificarlos.</div></div>');

  document.querySelectorAll('.seg-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.seg-tab').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.seg-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      var el = document.getElementById('segPanel_' + btn.dataset.seg);
      if (el) el.classList.add('active');
    });
  });

  document.querySelectorAll('[data-seg-idx][data-seg-field]').forEach(function(el) {
    el.addEventListener('input', function() {
      var idx = +el.dataset.segIdx;
      var field = el.dataset.segField;
      var val = el.tagName === 'SELECT' ? el.value : (el.type === 'number' ? +el.value : el.value);
      segmentosLocal[idx][field] = val;
      if (field === 'nombre') { var tab = document.querySelectorAll('.seg-tab')[idx]; if (tab) tab.textContent = val || ('Seg ' + (idx + 1)); }
      if (field === 'demandaBase' || field === 'pctContrabando') {
        var seg = segmentosLocal[idx];
        var df = Math.round(seg.demandaBase * (1 - seg.pctContrabando));
        var el2 = document.getElementById('demFormal_' + idx);
        if (el2) el2.textContent = df.toLocaleString('es-BO');
      }
      // Etiqueta de tendencia en vivo: el profesor ve el efecto de la tasa que escribe
      // sin esperar a guardar, igual que ya pasaba con "Demanda formal".
      if (field === 'tasaCrecimiento') {
        var el3 = document.getElementById('tendCalc_' + idx);
        if (el3) el3.textContent = calcularTendencia(segmentosLocal[idx].tasaCrecimiento);
      }
    });
  });

  document.getElementById('btnSaveSegs').addEventListener('click', saveSegmentos);
  document.getElementById('btnResetSegs').addEventListener('click', loadAdminSegmentos);
}

async function saveSegmentos() {
  try {
    for (var i = 0; i < segmentosLocal.length; i++) {
      if (!segmentosLocal[i].nombre || !segmentosLocal[i].nombre.trim()) { toast('Todos los segmentos deben tener nombre', 'error'); return; }
    }
    await api('PUT', '/admin/segmentos', { segmentos: segmentosLocal });
    toast('✓ Segmentos guardados', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

// ── Matriz Afinidad ───────────────────────────────────────────────────────────
// afinidadLocal declarada en app.js
// segmentosForAfinidad declarada en app.js

async function loadAdminAfinidad() {
  if (!requireSimSelected('adminAfinidadContent')) return;
  const [afData, segData] = await Promise.all([
    api('GET','/admin/afinidad'),
    api('GET','/admin/segmentos'),
  ]);
  afinidadLocal = afData;
  segmentosForAfinidad = segData;
  renderAfinidadEditor();
}

function renderAfinidadEditor() {
  var esSuperAdminRol = esSuperAdmin();
  var productos = Object.keys(afinidadLocal);
  var segNombres = segmentosForAfinidad.map(function(s) { return s.nombre; });

  var colorCell = function(v) {
    if (v >= 3)  return 'background:rgba(6,255,165,.15);color:var(--accent5)';
    if (v >= 1)  return 'background:rgba(78,205,196,.1);color:var(--accent2)';
    if (v === 0) return 'background:var(--bg3);color:var(--text3)';
    return 'background:rgba(255,107,107,.12);color:var(--accent4)';
  };

  var headerCols = segNombres.map(function(n) {
    return '<th style="padding:8px 6px;font-size:.68rem;text-align:center;white-space:nowrap;max-width:90px;overflow:hidden">' + n + '</th>';
  }).join('');

  var rows = productos.map(function(prod) {
    var vals = afinidadLocal[prod] || [];
    var cells = segNombres.map(function(_, j) {
      var v = vals[j] != null ? vals[j] : 0;
      return '<td style="padding:4px;text-align:center"><input type="number" min="-3" max="3" step="1" data-af-prod="' + prod + '" data-af-seg="' + j + '" value="' + v + '" style="width:52px;text-align:center;padding:4px;border-radius:4px;border:1px solid var(--border2);' + colorCell(v) + ';font-family:var(--font-mono);font-size:.82rem;outline:none"/></td>';
    }).join('');
    return '<tr><td style="padding:8px 12px;font-weight:600;white-space:nowrap">' + prod + '</td>' + cells + '</tr>';
  }).join('');

  document.getElementById('adminAfinidadContent').innerHTML =
    '<div class="table-wrap"><table style="border-collapse:collapse;width:100%"><thead><tr><th style="padding:8px 12px;text-align:left;background:var(--bg3)">Producto \\ Segmento</th>' + headerCols + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<div style="margin-top:12px;font-size:.78rem;color:var(--text3);display:flex;gap:16px;flex-wrap:wrap"><span style="color:var(--accent5)">■ +3 Ajuste perfecto</span><span style="color:var(--accent2)">■ +1 Aceptable</span><span style="color:var(--text3)">■ 0 Neutro</span><span style="color:var(--accent4)">■ -2 Mal ajuste</span></div>'
    + '<div class="param-actions"><button class="btn btn-primary" id="btnSaveAfinidad"' + (esSuperAdminRol ? '' : ' disabled title="Solo superadmin puede guardar cambios" style="cursor:not-allowed;opacity:.6"') + '>💾 Guardar Matriz</button><button class="btn btn-ghost" id="btnResetAfinidad">↺ Recargar</button></div>'
    + (esSuperAdminRol ? '' : '<div class="param-card" style="border-left:3px solid var(--accent3);margin-top:12px"><div style="font-size:.8rem;color:var(--text2)">🔒 <strong>Solo lectura</strong> — el superadmin gestiona estos valores. Podés verlos pero no modificarlos.</div></div>');

  document.querySelectorAll('[data-af-prod]').forEach(function(inp) {
    inp.addEventListener('input', function() {
      var prod = inp.dataset.afProd; var j = +inp.dataset.afSeg; var v = +inp.value;
      if (afinidadLocal[prod]) afinidadLocal[prod][j] = v;
      inp.style.cssText = 'width:52px;text-align:center;padding:4px;border-radius:4px;border:1px solid var(--border2);' + colorCell(v) + ';font-family:var(--font-mono);font-size:.82rem;outline:none';
    });
  });

  document.getElementById('btnSaveAfinidad').addEventListener('click', async function() {
    try { await api('PUT', '/admin/afinidad', { afinidadMatrix: afinidadLocal }); toast('✓ Matriz guardada', 'success'); } catch(e) { toast(e.message, 'error'); }
  });
  document.getElementById('btnResetAfinidad').addEventListener('click', loadAdminAfinidad);
}

// ── Competidores de Mercado (bots fijos) ───────────────────────────────────────
// Reemplaza el editor de competenciaExterna (eliminada de generarReporteEstrategico
// y sin ningún otro consumidor real, ver auditoría) por una vista de solo lectura
// de los 12 bots fijos (2 por segmento) que sí compiten de verdad. Precio/calidad
// de referencia se calculan igual que bot_service.js (mismo costoBase × 1.10/1.40,
// mismo mejorProductoParaSegmento por afinidad) — no dependen de ninguna ronda.
// Ventas/share reales sí dependen de una ronda calculada — ver Caso A/B abajo.

function mejorProductoParaSegmentoUI(segIdx, tiposProducto, afinidadMatrix) {
  var mejor = null, mejorAf = -Infinity;
  Object.keys(tiposProducto || {}).forEach(function(tipo) {
    var af = (afinidadMatrix[tipo] || [])[segIdx] ?? 0;
    if (af > mejorAf) { mejorAf = af; mejor = tipo; }
  });
  return mejor;
}

function calibracionBotsFija(cfg) {
  var segmentos = cfg.mercadoSegmentos || cfg.segmentos || [];
  var tiposProducto = cfg.tiposProducto || {};
  var afinidadMatrix = cfg.afinidadMatrix || {};
  return segmentos.map(function(seg, idx) {
    var producto = mejorProductoParaSegmentoUI(idx, tiposProducto, afinidadMatrix);
    var costoBase = producto ? (tiposProducto[producto]?.costoBase || 0) : 0;
    return {
      segmento: seg.nombre, producto: producto || '—',
      lider:         { precio: Math.round(costoBase * 1.10), calidad: 5 },
      diferenciador: { precio: Math.round(costoBase * 1.40), calidad: 6 },
    };
  });
}

async function loadAdminCompetencia() {
  if (!requireSimSelected('adminCompetenciaContent')) return;
  var cfg = state.ref || await api('GET', '/admin/config');
  state.ref = cfg;
  state.botsCalibracion = calibracionBotsFija(cfg);

  // Rondas calculadas — mismo patrón que admin-tools.js/admin-creditos.js
  try {
    var hist = await api('GET', '/admin/historial');
    state.rondasCalculadas = hist.filter(function(h) { return h.estado === 'simulated' || h.estado === 'calculada'; }).map(function(h) { return h.ronda; });
  } catch { state.rondasCalculadas = []; }

  renderCompetenciaBots(state.rondasCalculadas.length ? state.rondasCalculadas[state.rondasCalculadas.length - 1] : null);
}

async function renderCompetenciaBots(rondaSeleccionada) {
  var el = document.getElementById('adminCompetenciaContent');
  var rondas = state.rondasCalculadas || [];
  var calib = state.botsCalibracion || [];

  var bots = null; // datos reales de la ronda elegida (ventas/share), null en Caso A
  if (rondaSeleccionada) {
    try { bots = (await api('GET', '/admin/resultados/' + rondaSeleccionada)).bots || []; }
    catch { bots = []; }
  }

  var selector = rondas.length
    ? '<div class="param-row"><label class="param-label">Ronda</label>'
      + '<select class="param-input" id="selRondaCompBots" style="width:auto">'
      + rondas.map(function(r) { return '<option value="' + r + '"' + (r === rondaSeleccionada ? ' selected' : '') + '>Ronda ' + r + '</option>'; }).join('')
      + '</select></div>'
    : '<p class="param-hint">Aún no hay rondas calculadas.</p>';

  var botsPorSegSeg = {};
  (bots || []).forEach(function(b) { botsPorSegSeg[b.segmento] = botsPorSegSeg[b.segmento] || {}; botsPorSegSeg[b.segmento][b.arquetipo] = b; });

  var bs = function(v) { return (v == null) ? '—' : 'Bs ' + Math.round(v).toLocaleString('es-BO').replace(/,/g, '.'); };
  var pct = function(v) { return (v == null) ? '—' : (v * 100).toFixed(1) + '%'; };

  var filaArq = function(seg, arqLabel, refPrecio, refCalidad) {
    var real = botsPorSegSeg[seg] && botsPorSegSeg[seg][arqLabel];
    var cols = '<td>' + refPrecio + '</td><td>' + refCalidad + '</td>';
    if (rondaSeleccionada) {
      cols += '<td class="num">' + (real ? Math.round(real.ventasReales).toLocaleString('es-BO') : '—') + '</td>'
        + '<td class="num">' + (real ? bs(real.ventasBrutas) : '—') + '</td>'
        + '<td class="num">' + (real ? pct(real.shareReal) : '—') + '</td>'
        + '<td style="text-align:center">' + (real ? (real.alertaCaja === 'OK' ? '✓' : '⚠ ' + real.alertaCaja) : '—') + '</td>';
    }
    return '<tr><td>' + seg + '</td><td>' + arqLabel + '</td>' + cols + '</tr>';
  };

  var rows = calib.map(function(c) {
    return filaArq(c.segmento, 'Líder en Costos', bs(c.lider.precio), c.lider.calidad)
      + filaArq(c.segmento, 'Diferenciador', bs(c.diferenciador.precio), c.diferenciador.calidad);
  }).join('');

  var colsExtra = rondaSeleccionada
    ? '<th>Ventas (unid.)</th><th>Ventas brutas</th><th>Market share</th><th>Caja</th>'
    : '';

  el.innerHTML = selector
    + '<div class="table-wrap"><table><thead><tr><th>Segmento</th><th>Arquetipo</th><th>Precio</th><th>Calidad</th>' + colsExtra + '</tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>'
    + '<p class="param-hint" style="margin-top:8px">2 bots fijos por segmento (Líder en Costos y Diferenciador), siempre activos, sin configuración. Precio y calidad son fijos desde el inicio de la simulación'
    + (rondaSeleccionada ? '.' : ' — ventas y participación de mercado se muestran una vez que se calcule la primera ronda.')
    + '</p>';

  document.getElementById('selRondaCompBots')?.addEventListener('change', function(e) {
    renderCompetenciaBots(+e.target.value);
  });
}

// ── Shocks de Mercado ───────────────────────────────────────────────────────
// Catálogo UI de los 8 shocks editables (+ neutral fijo). Valores 'def' = defaults
// del SHOCKS_CATALOGO del motor; sirven de fallback si la sim aún no los tiene.
var SHOCKS_CATALOGO_UI = [
  { id:'boom_macro',  tipo:'boom',   icono:'📈', desc:'Crecimiento económico regional', def:1.18 },
  { id:'boom_feria',  tipo:'boom',   icono:'🏪', desc:'Feria comercial internacional',  def:1.12 },
  { id:'boom_tend',   tipo:'boom',   icono:'🚀', desc:'Tendencia viral en redes',        def:1.25 },
  { id:'boom_export', tipo:'boom',   icono:'🌍', desc:'Acuerdo comercial regional',      def:1.15 },
  { id:'crisis_rec',  tipo:'crisis', icono:'📉', desc:'Recesión económica',              def:0.82 },
  { id:'crisis_imp',  tipo:'crisis', icono:'⚠️', desc:'Importaciones ilegales',          def:0.87 },
  { id:'crisis_reg',  tipo:'crisis', icono:'🏛️', desc:'Nueva regulación sectorial',      def:0.88 },
  { id:'crisis_inf',  tipo:'crisis', icono:'💸', desc:'Inflación segmento premium',      def:0.80 },
];

async function loadAdminShocks() {
  if (!requireSimSelected('adminShocksContent')) return;
  var data = await api('GET', '/admin/config');
  var p   = data.parametros || {};
  var sf  = p.shockFactores || {};
  var pctBoom   = (p.shockPctBoom   != null) ? p.shockPctBoom   : 0.35;
  var pctCrisis = (p.shockPctCrisis != null) ? p.shockPctCrisis : 0.35;
  var esSuperAdminRol = esSuperAdmin();

  var filaShock = function(s) {
    var val   = (sf[s.id] != null) ? sf[s.id] : s.def;
    var pct   = Math.round((val - 1) * 100);
    var color = s.tipo === 'boom' ? '#10B981' : '#EF4444';
    return '<tr>'
      + '<td style="padding:8px 12px;font-size:1.2rem">' + s.icono + '</td>'
      + '<td style="padding:8px 12px;font-size:.85rem">' + s.desc + '</td>'
      + '<td style="padding:8px 12px"><span style="color:' + color + ';font-weight:600;text-transform:uppercase;font-size:.72rem">' + s.tipo + '</span></td>'
      + '<td style="padding:8px 12px;text-align:right"><input class="param-input" type="number" step="0.01" data-shock-id="' + s.id + '" value="' + val + '" style="width:90px"/></td>'
      + '<td style="padding:8px 12px;text-align:right;font-family:var(--font-mono);font-size:.8rem;color:var(--text3)" data-shock-pct="' + s.id + '">' + (pct > 0 ? '+' : '') + pct + '%</td>'
      + '</tr>';
  };

  var filas = SHOCKS_CATALOGO_UI.map(filaShock).join('');
  var pctNeutral = Math.round((1 - pctBoom - pctCrisis) * 100) / 100;

  document.getElementById('adminShocksContent').innerHTML =
    '<div class="param-grid">'
    + '<div class="param-card" style="grid-column:1/-1">'
    +   '<div class="param-card-title">⚡ Factores de Shock de Mercado</div>'
    +   '<p class="param-hint" style="margin-bottom:12px">Multiplican la demanda al ejecutar la ronda — &gt;1 favorable, &lt;1 adverso. Aplican a TODOS los segmentos.</p>'
    +   '<div class="table-wrap"><table style="width:100%;border-collapse:collapse">'
    +     '<thead><tr>'
    +       '<th style="padding:6px 12px"></th>'
    +       '<th style="padding:6px 12px;text-align:left;font-size:.72rem">Evento</th>'
    +       '<th style="padding:6px 12px;text-align:left;font-size:.72rem">Tipo</th>'
    +       '<th style="padding:6px 12px;text-align:right;font-size:.72rem">Factor</th>'
    +       '<th style="padding:6px 12px;text-align:right;font-size:.72rem">Impacto</th>'
    +     '</tr></thead><tbody>' + filas
    +     '<tr style="opacity:.55"><td style="padding:8px 12px;font-size:1.2rem">⚖️</td><td style="padding:8px 12px;font-size:.85rem">Mercado estable</td><td style="padding:8px 12px"><span style="color:var(--text3);font-weight:600;text-transform:uppercase;font-size:.72rem">neutral</span></td><td style="padding:8px 12px;text-align:right;font-family:var(--font-mono)">1.00</td><td style="padding:8px 12px;text-align:right;font-family:var(--font-mono);font-size:.8rem;color:var(--text3)">0%</td></tr>'
    +   '</tbody></table></div>'
    + '</div>'
    + '<div class="param-card" style="grid-column:1/-1">'
    +   '<div class="param-card-title">🎲 Probabilidades del shock aleatorio</div>'
    +   '<p class="param-hint" style="margin-bottom:12px">Cuando el docente elige "Aleatorio", el sistema sortea Boom / Crisis / Neutral con estos pesos.</p>'
    +   '<div class="param-row"><label class="param-label">Prob. Boom</label><input class="param-input" type="number" step="0.01" min="0" max="1" id="shockPctBoom" value="' + pctBoom + '"/><span class="param-hint">0.35 = 35% de un evento favorable</span></div>'
    +   '<div class="param-row"><label class="param-label">Prob. Crisis</label><input class="param-input" type="number" step="0.01" min="0" max="1" id="shockPctCrisis" value="' + pctCrisis + '"/><span class="param-hint">0.35 = 35% de un evento adverso</span></div>'
    +   '<div class="param-row"><label class="param-label">Prob. Neutral</label><input class="param-input" type="number" id="shockPctNeutral" value="' + pctNeutral + '" disabled style="opacity:.6"/><span class="param-hint">Calculado: 1 − Boom − Crisis</span></div>'
    + '</div>'
    + '<div class="param-actions" style="grid-column:1/-1"><button class="btn btn-primary" id="btnSaveShocks"' + (esSuperAdminRol ? '' : ' disabled title="Solo superadmin puede guardar cambios" style="cursor:not-allowed;opacity:.6"') + '>💾 Guardar shocks</button></div>'
    + (esSuperAdminRol ? '' : '<div class="param-card" style="grid-column:1/-1;border-left:3px solid var(--accent3);margin-top:12px"><div style="font-size:.8rem;color:var(--text2)">🔒 <strong>Solo lectura</strong> — el superadmin gestiona estos valores. Podés verlos pero no modificarlos.</div></div>')
    + '</div>';

  // Recalcular impacto % al cambiar un factor
  document.querySelectorAll('[data-shock-id]').forEach(function(el) {
    el.addEventListener('input', function() {
      var pct = Math.round((+el.value - 1) * 100);
      var cell = document.querySelector('[data-shock-pct="' + el.dataset.shockId + '"]');
      if (cell) cell.textContent = (pct > 0 ? '+' : '') + pct + '%';
    });
  });

  // Recalcular pctNeutral al cambiar Boom/Crisis
  function recalcNeutral() {
    var b = +document.getElementById('shockPctBoom').value || 0;
    var c = +document.getElementById('shockPctCrisis').value || 0;
    document.getElementById('shockPctNeutral').value = Math.round((1 - b - c) * 100) / 100;
  }
  document.getElementById('shockPctBoom').addEventListener('input', recalcNeutral);
  document.getElementById('shockPctCrisis').addEventListener('input', recalcNeutral);

  document.getElementById('btnSaveShocks').addEventListener('click', async function() {
    var shockFactores = {};
    document.querySelectorAll('[data-shock-id]').forEach(function(el) {
      shockFactores[el.dataset.shockId] = +el.value;
    });
    var shockPctBoom   = +document.getElementById('shockPctBoom').value;
    var shockPctCrisis = +document.getElementById('shockPctCrisis').value;
    if (shockPctBoom < 0 || shockPctCrisis < 0 || (shockPctBoom + shockPctCrisis) > 1) {
      toast('Boom + Crisis no puede ser negativo ni superar 1 (100%)', 'error');
      return;
    }
    try {
      await api('PUT', '/admin/parametros', { parametros: {
        shockFactores: shockFactores,
        shockPctBoom: shockPctBoom,
        shockPctCrisis: shockPctCrisis,
      } });
      toast('✓ Shocks guardados', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
}


// ── Exponer como window.* para setupNav ──────────────────
window.loadAdminParametros = loadAdminParametros;
window.loadAdminSegmentos = loadAdminSegmentos;
window.loadAdminAfinidad = loadAdminAfinidad;
window.loadAdminCompetencia = loadAdminCompetencia;
window.loadAdminShocks = loadAdminShocks;
window.cambiarCodigoAcceso = cambiarCodigoAcceso;
window.saveParametros = saveParametros;
console.log('[admin-parametros] ✅ Módulo cargado — Parámetros, Segmentos, Afinidad, Competencia activos');
