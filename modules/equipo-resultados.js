/**
 * modules/equipo-resultados.js — SimNego v3.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo: KPIs y resultados del equipo
 * Fase 2 — Día 3 del plan de modularización
 *
 * Funciones incluidas:
 *   - loadEquipoResultados → KPIs, comparativa, gráficas
 *
 * Dependencias: api(), fmt (ui-components.js), state, toast
 * Reversión: comentar <script src="modules/equipo-resultados.js"> en index.html
 * ─────────────────────────────────────────────────────────────────────────────
 */

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

  // ── Fuentes (Fase 1 de pantallas) ──
  // Con partida doble la base `r` trae lo financiero de Motor 2 y, con varios
  // productos, solo volúmenes sumados: ningún campo de producto ni de empresa
  // que Motor 1 repite en cada fila. Por eso:
  //   - lo de PRODUCTO (participación, demanda, ventas, precio, marca,
  //     inventario, costo unitario) se lee de r.productos, uno por uno;
  //   - lo de EMPRESA que Motor 1 repite por producto (operarios, vendedores,
  //     capacidad, stock de MP, proveedor) se lee UNA vez, de prod_1;
  //   - lo financiero de empresa (ventas, utilidades, caja, deuda, impuestos)
  //     sigue saliendo de `r`: con partida doble es el libro mayor.
  const prods = (Array.isArray(r.productos) && r.productos.length) ? r.productos : [r];
  const p1    = prods.find(p => (p.productoId || 'prod_1') === 'prod_1') || prods[0];
  const multi = prods.length > 1;
  const cu    = costosUnitariosEquipo(r, item.decision);
  const suma  = (k) => prods.reduce((s, p) => s + (Number(p[k]) || 0), 0);
  const vendidasTot   = suma('ventasReales');
  const produccionTot = suma('produccion');
  const inventarioTot = suma('inventarioFinal');
  const publicidadTot = suma('publicidad');
  const mktTot        = suma('pagoMktTotal');
  // Costo variable unitario de la empresa: promedio de los productos ponderado
  // por unidades vendidas (por producción si no hubo ventas).
  const _pesoCV = vendidasTot > 0 ? 'vendidas' : 'produccion';
  const _baseCV = cu.productos.reduce((s, x) => s + x[_pesoCV], 0);
  const cvEmpresa = redondear(_baseCV > 0
    ? cu.productos.reduce((s, x) => s + x.cvUnit * x[_pesoCV], 0) / _baseCV
    : (cu.productos[0] ? cu.productos[0].cvUnit : 0), 2);
  // ROI de marketing de la EMPRESA, misma fórmula que engine.js (ventas netas /
  // gasto total de marketing). El de cada fila no sirve: Motor 1 carga todo el
  // marketing común en prod_1.
  const roiMkt = mktTot > 0 ? (r.ventasNetas || 0) / mktTot : 0;
  const stockMP     = p1.stockMPFinal ?? 0;
  const stockMPValor = p1.stockMPValorizado ?? 0;
  const saldoIUEant  = r.saldoIUEant  ?? p1.saldoIUEant;
  const provisionIUE = r.provisionIUE ?? p1.provisionIUE;

  // ── Calculated KPIs ──
  const mgBruto   = r.ventasNetas>0 ? (r.utilidadBruta/r.ventasNetas*100).toFixed(2) : '—';
  const mgNeto    = r.ventasNetas>0 ? (r.utilidadNeta/r.ventasNetas*100).toFixed(2)  : '—';
  const endeud    = r.totalActivos>0 ? (r.deudaFinal/r.totalActivos*100).toFixed(2)  : '0.00';
  const invProd   = produccionTot>0 ? (inventarioTot/produccionTot*100).toFixed(1) : '0.0';
  const vendFin   = p1.vendedoresFinales || 0;
  const ventasPorVend = vendFin>0 ? fmt.num(Math.round(vendidasTot/vendFin)) : '—';
  const ingrPorVend  = vendFin>0 ? fmt.bs(Math.round(r.ventasNetas/vendFin))   : '—';
  const utilPorUnid  = vendidasTot>0 ? fmt.d((r.ventasNetas-r.costoVentas)/vendidasTot,3) : '—';
  // T18: activo corriente ÷ pasivo corriente (antes dividía por la deuda total), con la
  // misma clasificación que el Balance (estructuraBalanceEquipo, ui-components.js).
  const _liq      = estructuraBalanceEquipo(r).liquidez;
  const liquidez  = _liq.valor === null ? '∞' : fmt.d(_liq.valor, 2);

  const kpiSection = (title) =>
    '<tr><td colspan="3" style="padding:6px 14px 2px;font-family:var(--font-mono);font-size:.63rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;border-top:1px solid var(--border)">' + title + '</td></tr>';

  const kpiRow = (label, value, color='', hint='') =>
    `<tr><td style="padding:8px 14px;color:var(--text2);font-size:.82rem">${label}</td>
         <td style="padding:8px 14px;font-family:var(--font-mono);font-size:.82rem;text-align:right;color:${color||'var(--text)'}">${value}</td></tr>`;

  // ── Indicadores por producto: una columna por producto ──
  const celda = 'padding:7px 12px;font-family:var(--font-mono);font-size:.8rem;text-align:right;white-space:nowrap';
  const filaProd = (label, valores, color) =>
    `<tr><td style="padding:7px 14px;color:var(--text2);font-size:.8rem;white-space:nowrap">${label}</td>`
    + valores.map((v, i) => `<td style="${celda};color:${(typeof color === 'function' ? color(i) : color) || 'var(--text)'}">${v}</td>`).join('')
    + '</tr>';
  const seccionProd = (title) =>
    `<tr><td colspan="${prods.length + 1}" style="padding:6px 14px 2px;font-family:var(--font-mono);font-size:.63rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;border-top:1px solid var(--border)">${title}</td></tr>`;
  const porProd = (f) => prods.map((p, i) => f(p, cu.productos[i], i));
  const colorShare = (s) => s>0.35?'var(--accent5)':s>0.15?'var(--accent3)':'var(--accent4)';
  const colorBE    = (b) => b>70?'var(--accent5)':b>50?'var(--accent3)':'var(--accent4)';
  const colorAtr   = (a) => a>10?'var(--accent5)':a>5?'var(--accent3)':'var(--accent4)';

  const tablaProductos = `
      <div class="result-round-card" style="grid-column:1/-1">
        <div class="result-round-header"><h3>📦 Indicadores por producto</h3></div>
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <tr><td></td>${prods.map((p, i) => `<td style="${celda};font-family:inherit;color:var(--accent3);font-weight:700">${multi ? 'P' + (i+1) + ': ' : ''}${p.producto || '—'}<div style="font-weight:400;font-size:.68rem;color:var(--text3)">${p.segmento || ''}</div></td>`).join('')}</tr>
          ${seccionProd('🎯 Mercado')}
          ${filaProd('Market Share real',               porProd(p => fmt.pct(p.shareReal)), i => colorShare(prods[i].shareReal || 0))}
          ${filaProd('Demanda formal del segmento',     porProd(p => fmt.num(p.demandaFormal || 0)), 'var(--text2)')}
          ${filaProd('Demanda asignada a la empresa',   porProd(p => fmt.num(p.demandaAsignada || 0)), 'var(--accent3)')}
          ${filaProd('Unidades vendidas',               porProd(p => fmt.num(p.ventasReales || 0)), i => (prods[i].ventasReales || 0) > 0 ? 'var(--accent5)' : 'var(--accent4)')}
          ${filaProd('% Demanda capturada',             porProd(p => p.demandaFormal > 0 ? fmt.pct((p.ventasReales || 0) / p.demandaFormal) : '—'), 'var(--text2)')}
          ${filaProd('Producción (unid)',               porProd(p => fmt.num(p.produccion || 0)))}
          ${filaProd('Inventario final (unid)',         porProd(p => fmt.num(p.inventarioFinal || 0)))}
          ${seccionProd('💰 Precio, costo y margen por unidad')}
          ${filaProd('Precio de venta con IVA (Bs)',    porProd((p, c) => fmt.d(c.precioConIVA, 2)), 'var(--text2)')}
          ${filaProd('Precio de venta sin IVA (Bs)',    porProd((p, c) => c.precioSinIVA !== null ? fmt.d(c.precioSinIVA, 2) : '—'))}
          ${filaProd('  └ Materia prima neta (Bs)',     porProd((p, c) => fmt.d(c.mpUnit, 2)), 'var(--text2)')}
          ${filaProd('  └ Calidad (Bs)',                porProd((p, c) => fmt.d(c.calidadUnit, 2)), 'var(--text2)')}
          ${filaProd('Costo variable unitario (Bs)',    porProd((p, c) => fmt.d(c.cvUnit, 2)))}
          ${filaProd('Margen unitario sin IVA (Bs)',    porProd((p, c) => c.margenUnit !== null ? fmt.d(c.margenUnit, 2) : '—'), i => (cu.productos[i].margenUnit || 0) >= 0 ? 'var(--accent5)' : 'var(--accent4)')}
          ${seccionProd('⭐ Marca y posicionamiento')}
          ${filaProd('Calidad (nivel)',                 porProd(p => p.calidad != null ? fmt.num(p.calidad) : '—'), 'var(--text2)')}
          ${filaProd('Brand Equity (pts)',              porProd(p => (p.brandEquityFinal ?? 50).toFixed(1)), i => colorBE(prods[i].brandEquityFinal ?? 50))}
          ${filaProd('Atractivo competitivo (pts)',     porProd(p => fmt.d(p.atractivo || 0, 2)), i => colorAtr(prods[i].atractivo || 0))}
        </table>
        </div>
        <div style="padding:8px 14px;font-size:.72rem;color:var(--text3);line-height:1.5">
          Costo variable unitario = materia prima neta de IVA por unidad vendida (la misma del costo de ventas) + calidad por unidad.
          La nómina de operarios no es costo del producto: es gasto del trimestre (ver Gerente de Producción).${multi ? ' La materia prima se valúa con un solo promedio ponderado para toda la empresa, por eso su costo por unidad sale igual en los productos que la consumen del mismo almacén.' : ''}
        </div>
      </div>`;

  document.getElementById('kpiDetalle').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;margin-top:14px">

      ${tablaProductos}

      <!-- ── Gerente de Marketing (empresa) ──────────── -->
      <div class="result-round-card">
        <div class="result-round-header"><h3>📣 Gerente de Marketing</h3></div>
        <table style="width:100%;border-collapse:collapse">

          ${kpiSection('💰 Rentabilidad Comercial' + (multi ? ' (empresa)' : ''))}
          ${kpiRow('Unidades vendidas',             fmt.num(vendidasTot),            vendidasTot>0?'var(--accent5)':'var(--accent4)')}
          ${kpiRow('Ventas brutas (Bs)',            fmt.bs(r.ventasBrutas||0),       'var(--text2)')}
          ${kpiRow('Ventas netas (Bs)',             fmt.bs(r.ventasNetas||0),        'var(--accent3)')}
          ${kpiRow('Margen bruto (%)',
              r.ventasNetas>0 ? ((r.utilidadBruta||0)/r.ventasNetas*100).toFixed(1)+'%' : '—',
              (r.utilidadBruta||0)>=0?'var(--accent5)':'var(--accent4)',
              (r.utilidadBruta||0)>=0?'Margen positivo':'Margen negativo')}

          ${kpiSection('📢 Inversión y Eficiencia de Marketing')}
          ${kpiRow('Gasto publicidad (Bs)',         fmt.bs(publicidadTot),           'var(--text2)')}
          ${kpiRow('Gasto total marketing (Bs)',    fmt.bs(mktTot),                  'var(--text2)')}
          ${kpiRow('ROI Marketing',
              fmt.d(roiMkt,2)+'x',
              roiMkt>=2?'var(--accent5)':roiMkt>=1?'var(--accent3)':'var(--accent4)',
              roiMkt>=2?'Excelente':roiMkt>=1?'Aceptable':'Bajo')}
          ${kpiRow('Costo Mkt por unidad vendida (Bs)',
              vendidasTot>0 ? fmt.d(mktTot/vendidasTot,2) : '—',
              'var(--text2)')}
          ${kpiRow('Ingresos por Bs 1 de publicidad (x)',
              publicidadTot>0 ? fmt.d((r.ventasNetas||0)/publicidadTot,1)+'x' : '—',
              publicidadTot>0&&(r.ventasNetas||0)/publicidadTot>3?'var(--accent5)':'var(--text2)')}

        </table>
      </div>

      <!-- ── Gerente de Producción (empresa) ─────────── -->
      <div class="result-round-card">
        <div class="result-round-header"><h3>🏭 Gerente de Producción</h3></div>
        <table style="width:100%;border-collapse:collapse">
          ${kpiRow('Producción (unid)',             fmt.num(produccionTot))}
          ${kpiRow('Inventario final (unidades)',   fmt.num(inventarioTot))}
          ${kpiRow('Inventario / Producción',       invProd+'%', +invProd>20?'var(--accent4)':'var(--accent5)')}
          ${kpiRow('Capacidad efectiva (unid)',     p1.capacidadEfectiva!=null?fmt.num(p1.capacidadEfectiva):'—')}
          ${kpiRow('Proveedor activo',              p1.proveedorElegido||'Sin proveedor')}
          <tr><td colspan="2" style="padding:4px 12px;font-family:var(--font-mono);font-size:.6rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;background:rgba(255,255,255,.03)">Materia prima en almacén (contable)</td></tr>
          ${kpiRow('Stock de MP disponible (unid)', fmt.num(stockMP))}
          ${kpiRow('Valor del stock de MP (Bs)',    fmt.bs(stockMPValor), 'var(--accent3)')}
          ${kpiRow('Costo promedio por unidad de MP (Bs)', stockMP>0?fmt.d(stockMPValor/stockMP,2):'—')}
          <tr><td colspan="2" style="padding:2px 12px 6px;font-size:.68rem;color:var(--text3);line-height:1.4">Neto de IVA y a promedio ponderado: es el mismo valor de la materia prima en el Balance (sin los pedidos en tránsito).</td></tr>
          <tr><td colspan="2" style="padding:4px 12px;font-family:var(--font-mono);font-size:.6rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;background:rgba(255,255,255,.03)">Nómina de operarios (gasto del trimestre)</td></tr>
          ${kpiRow('Sueldos de operarios (Bs)',     fmt.bs(cu.nominaPeriodo))}
          ${kpiRow('Nómina por unidad producida (Bs)', cu.nominaPorUnidad!==null?fmt.d(cu.nominaPorUnidad,2):'—')}
          <tr><td colspan="2" style="padding:2px 12px 6px;font-size:.68rem;color:var(--text3);line-height:1.4">Referencia: la nómina se paga igual aunque se produzca menos. Va al Estado de Resultados como gasto del trimestre, no al costo de ventas.</td></tr>
        </table>
      </div>

      <!-- ── Gerente de RRHH (empresa: una sola vez) ─── -->
      <div class="result-round-card">
        <div class="result-round-header"><h3>👥 Gerente de RRHH</h3></div>
        <table style="width:100%;border-collapse:collapse">
          ${kpiRow('Vendedores finales', fmt.num(vendFin))}
          ${kpiRow('Gasto de vendedores (Bs)', r.costoVendedores!=null?fmt.bs(r.costoVendedores):'—')}
          ${kpiRow('Ventas por vendedor (unid)', ventasPorVend)}
          ${kpiRow('Ingresos netos por vendedor', ingrPorVend)}
          ${kpiRow('Operarios finales', p1.operariosFinales!=null?fmt.num(p1.operariosFinales):'—')}
          ${kpiRow('Sueldos de operarios (Bs)', fmt.bs(cu.nominaPeriodo))}
        </table>
      </div>

      <!-- ── Gerente Financiero ──────────────────────── -->
      <div class="result-round-card" style="grid-column:span 2">
        <div class="result-round-header"><h3>💰 Gerente General — Finanzas</h3></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
          <table style="width:100%;border-collapse:collapse">
            ${kpiRow('Costo variable unitario (Bs)' + (multi ? ' — promedio' : ''), fmt.d(cvEmpresa,2))}
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
            <tr><td colspan="2" style="padding:0 14px 8px;font-size:.7rem;color:var(--text3);line-height:1.4">Activo corriente ÷ pasivo corriente (∞ = sin pasivo corriente). Desde la ronda 4 todas las rondas se muestran con esta fórmula, también las anteriores: antes se dividía por la deuda total y daba otro valor.</td></tr>
            ${kpiRow('IVA neto pagado (Bs)',           r.ivaAPagar!=null?fmt.bs(r.ivaAPagar):'—', 'var(--accent4)')}
            ${kpiRow('IT pagado (Bs)',                 r.impuestoIT!=null?fmt.bs(r.impuestoIT):'—', 'var(--accent4)')}
            ${kpiRow('IUE pagado (Bs)',                r.impuestoIUE>0?fmt.bs(r.impuestoIUE):'(pago anual)', r.impuestoIUE>0?'var(--accent4)':'')}
            ${kpiRow('Provisión IUE (Bs)',             provisionIUE!=null?fmt.bs(provisionIUE):'—', 'var(--accent3)')}
          </table>
        </div>

        <!-- ── Compensación IUE→IT (DS 5563) ── -->
        ${(r.compensacionIT>0 || r.saldoIUEfinal>0 || saldoIUEant>0) ? `
        <div style="margin:12px 0 0;padding:12px 16px;background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(59,130,246,.08));border-radius:8px;border:1px solid rgba(16,185,129,.2)">
          <div style="font-family:var(--font-mono);font-size:.65rem;color:#10B981;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:10px">
            ⚖️ Compensación IUE → IT — Decreto Supremo 5563
          </div>
          <div style="font-size:.76rem;color:var(--text3);margin-bottom:10px;line-height:1.6">
            El IUE efectivamente pagado genera un saldo compensable que se descuenta del IT de los períodos siguientes, hasta agotarse.
          </div>
          <table style="width:100%;border-collapse:collapse">
            ${kpiRow('Saldo IUE disponible inicio', saldoIUEant>0?fmt.bs(saldoIUEant):'Bs 0', saldoIUEant>0?'var(--accent5)':'')}
            ${kpiRow('IT devengado (gasto ER)', fmt.bs(r.impuestoIT||0), 'var(--accent4)')}
            ${r.compensacionIT>0?kpiRow('IT compensado con saldo IUE', fmt.bs(r.compensacionIT), 'var(--accent5)'):''}
            ${kpiRow('IT efectivo pagado en caja', fmt.bs(r.ITefectivoCaja??r.impuestoIT??0), (r.ITefectivoCaja??r.impuestoIT??0)>0?'var(--accent4)':'var(--accent5)')}
            ${r.impuestoIUE>0?kpiRow('IUE pagado → recarga saldo', fmt.bs(r.impuestoIUE), 'var(--accent3)'):''}
            ${kpiRow('Saldo IUE para próximo trimestre', r.saldoIUEfinal>0?fmt.bs(r.saldoIUEfinal):'Bs 0 (agotado)', r.saldoIUEfinal>0?'var(--accent5)':'var(--text3)')}
          </table>
          ${r.compensacionIT>0?`<div style="margin-top:8px;padding:6px 10px;background:rgba(16,185,129,.1);border-radius:4px;font-size:.73rem;color:#10B981">
            ✅ Ahorro de caja este trimestre: ${fmt.bs(r.compensacionIT)} (IT compensado con IUE pagado en R${Math.floor((n-1)/4)*4||4})
          </div>`:''}
        </div>` : ''}
      </div>

    </div>`;
};

// ─── Estados Financieros Completos ───────────────────────────


// ── Exponer como window.* para setupNav ──────────────────
window.loadEquipoResultados = loadEquipoResultados;
console.log('[equipo-resultados] ✅ Módulo cargado — KPIs activos');
