// ---- LISTADO DEL DÍA ----

function renderListado() {
  const container = document.getElementById('view-listado');
  if (!container) return;

  const hoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  container.innerHTML = `
    <div class="listado-view">

      <div class="listado-header no-print">
        <h2>Listado del día</h2>
        <p class="listado-fecha">${hoy}</p>
        <button class="btn-print" onclick="window.print()">🖨 Imprimir</button>
      </div>

      <!-- FILTROS -->
      <div class="listado-filtros no-print">
        <div class="filtro-grupo">
          <label class="filtro-label">Sector</label>
          <select id="filtro-sector" onchange="aplicarFiltrosListado()">
            <option value="">Todos los sectores</option>
            ${sectors.map(s => `
              <option value="${s.id}">${s.nombre}</option>
            `).join('')}
          </select>
        </div>
        <div class="filtro-grupo">
          <label class="filtro-label">Fecha taller</label>
          <input type="date" id="filtro-fecha-taller"
            onchange="aplicarFiltrosListado()" />
        </div>
        <div class="filtro-grupo">
          <label class="filtro-label">Fecha entrega</label>
          <input type="date" id="filtro-fecha-entrega"
            onchange="aplicarFiltrosListado()" />
        </div>
        <div class="filtro-grupo">
          <label class="filtro-label">Estado</label>
          <select id="filtro-estado" onchange="aplicarFiltrosListado()">
            <option value="">Todos</option>
            <option value="pendiente">Pendiente</option>
            <option value="esperando_repuestos">Esp. repuestos</option>
            <option value="programado">Programado</option>
            <option value="finalizado">Finalizado</option>
            <option value="cancelado">Cancelado</option>
            <option value="entregado">Entregado</option>
          </select>
        </div>
        <button class="btn-limpiar-filtros"
          onclick="limpiarFiltrosListado()">
          ✕ Limpiar
        </button>
      </div>

      <!-- ENCABEZADO SOLO PARA IMPRESIÓN -->
      <div class="print-header print-only">
        <div class="print-logo">OpsMin — Cerrito Car</div>
        <div class="print-fecha">
          Generado: ${new Date().toLocaleString('es-AR')}
        </div>
      </div>

      <div class="table-wrap">
        <table class="listado-table" id="listado-table">
          <thead>
            <tr>
              <th>INT</th>
              <th>Modelo</th>
              <th>Color</th>
              <th>VIN / Chasis</th>
              <th>Cliente</th>
              <th>Sector</th>
              <th>Trabajos</th>
              <th>Estado</th>
              <th>F. Taller</th>
            </tr>
          </thead>
          <tbody id="listado-tbody">
          </tbody>
        </table>
      </div>

      <div class="listado-footer">
        <span id="listado-count">0 vehículos</span>
        <span class="print-only">
          OpsMin · Cerrito Car · ${new Date().toLocaleDateString('es-AR')}
        </span>
      </div>

    </div>
  `;

  // Renderizar con filtros vacíos (muestra todo)
  aplicarFiltrosListado();
}

function aplicarFiltrosListado() {
  const filtroSector  = document.getElementById('filtro-sector')?.value  ?? '';
  const filtroFechaTaller  = document.getElementById('filtro-fecha-taller')?.value  ?? '';
  const filtroFechaEntrega = document.getElementById('filtro-fecha-entrega')?.value ?? '';
  const filtroEstado  = document.getElementById('filtro-estado')?.value  ?? '';

  const asnByVehicle = new Map(assignments.map(a => [a.vehicle_id, a]));

  // Construir filas con filtros aplicados
  const filas = vehicles
    .filter(v => {
      const asn = asnByVehicle.get(v.id);
      if (!asn) return false; // sin asignación activa → no aparece

      // Filtro por sector
      if (filtroSector && asn.sector_id !== filtroSector) return false;

      // Filtro por fecha taller
      if (filtroFechaTaller && asn.fecha_taller !== filtroFechaTaller) return false;

      // Filtro por estado
      if (filtroEstado && asn.estado_trabajo !== filtroEstado) return false;

      return true;
    })
    .map(v => {
      const asn    = asnByVehicle.get(v.id);
      const sector = sectors.find(s => s.id === asn.sector_id);
      const estado = ESTADOS[asn.estado_trabajo] ?? ESTADOS.pendiente;
      return { v, asn, sector, estado };
    })
    .sort((a, b) => {
      // Ordenar por sector → fecha taller → interno
      if (a.sector?.orden !== b.sector?.orden)
        return (a.sector?.orden ?? 99) - (b.sector?.orden ?? 99);
      if (a.asn.fecha_taller && b.asn.fecha_taller)
        return a.asn.fecha_taller.localeCompare(b.asn.fecha_taller);
      return (a.v.interno ?? 0) - (b.v.interno ?? 0);
    });

  const tbody = document.getElementById('listado-tbody');
  const count = document.getElementById('listado-count');

  if (!tbody) return;

  if (!filas.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">
          Sin vehículos para los filtros seleccionados
        </td>
      </tr>
    `;
    if (count) count.textContent = '0 vehículos';
    return;
  }

  tbody.innerHTML = filas.map(({ v, asn, sector, estado }) => `
    <tr class="fila-${asn.estado_trabajo}">
      <td><strong>${v.interno ?? '—'}</strong></td>
      <td>${v.modelo}${v.version ? ' ' + v.version : ''}</td>
      <td>${v.color ?? '—'}</td>
      <td class="vin-cell">${v.chasis}</td>
      <td>${v.cliente ?? '—'}</td>
      <td>
        <span class="sector-tag"
          style="background:${sector?.color_hex ?? '#94a3b8'}20;
                 color:${sector?.color_hex ?? '#94a3b8'}">
          ${sector?.nombre ?? '—'}
        </span>
      </td>
      <td class="trabajos-cell">
        ${asn.trabajos?.length
          ? asn.trabajos.map(t =>
              `<span class="trabajo-tag">${t}</span>`
            ).join('')
          : '<span style="color:var(--text-muted)">—</span>'}
      </td>
      <td>
        <span class="estado-tag"
          style="background:${estado.bg};color:${estado.color}">
          ${estado.label}
        </span>
      </td>
      <td>${asn.fecha_taller
        ? new Date(asn.fecha_taller + 'T12:00')
            .toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
        : '—'}</td>
    </tr>
  `).join('');

  if (count) {
    count.textContent = `${filas.length} vehículo${filas.length !== 1 ? 's' : ''}`;
  }
}

function limpiarFiltrosListado() {
  const ids = ['filtro-sector', 'filtro-fecha-taller',
               'filtro-fecha-entrega', 'filtro-estado'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  aplicarFiltrosListado();
}
