  // ---- LISTADO DEL DÍA ----

function renderListado() {
  const container = document.getElementById('view-listado');
  const hoy       = new Date().toLocaleDateString('es-AR',
    { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Construir filas — vehículos con asignación activa
  const asnByVehicle = new Map(assignments.map(a => [a.vehicle_id, a]));

  const filas = vehicles
    .filter(v => asnByVehicle.has(v.id))
    .map(v => {
      const asn    = asnByVehicle.get(v.id);
      const sector = sectors.find(s => s.id === asn.sector_id);
      const estado = ESTADOS[asn.estado_trabajo] ?? ESTADOS.pendiente;
      return { v, asn, sector, estado };
    })
    .sort((a, b) => (a.sector?.orden ?? 99) - (b.sector?.orden ?? 99));

  container.innerHTML = `
    <div class="listado-view">
      <div class="listado-header no-print">
        <h2>Listado del día</h2>
        <p class="listado-fecha">${hoy}</p>
        <button class="btn-print" onclick="window.print()">🖨 Imprimir</button>
      </div>

      <!-- Encabezado solo para impresión -->
      <div class="print-header print-only">
        <div class="print-logo">OpsMin — Cerrito Car</div>
        <div class="print-fecha">
          Generado: ${new Date().toLocaleString('es-AR')}
        </div>
      </div>

      <div class="table-wrap">
        <table class="listado-table">
          <thead>
            <tr>
              <th>INT</th>
              <th>Modelo</th>
              <th>Color</th>
              <th>VIN / Chasis</th>
              <th>Cliente</th>
              <th>Sector</th>
              <th>Estado</th>
              <th>F. Taller</th>
            </tr>
          </thead>
          <tbody>
            ${filas.map(({ v, asn, sector, estado }) => `
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
                              <td>
                                <div style="display:flex;flex-direction:column;gap:2px">
                                  <span class="sector-tag"
                                    style="background:${sector?.color_hex ?? '#94a3b8'}20;
                                          color:${sector?.color_hex ?? '#94a3b8'}">
                                    ${sector?.nombre ?? '—'}
                                  </span>
                                  ${asn.trabajos?.length
                                    ? `<span style="font-size:10px;color:var(--text-secondary)">
                                        ${asn.trabajos.slice(0,2).join(' · ')}
                                        ${asn.trabajos.length > 2 ? ` +${asn.trabajos.length - 2}` : ''}
                                      </span>`
                                    : ''}
                                </div>
                              </td>
                  </span>
                </td>
                <td>
                  <span class="estado-tag"
                    style="background:${estado.bg};color:${estado.color}">
                    ${estado.label}
                  </span>
                </td>
                <td>${asn.fecha_taller
                  ? new Date(asn.fecha_taller + 'T12:00')
                      .toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' })
                  : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Pie de página -->
      <div class="listado-footer">
        <span>${filas.length} vehículos en proceso</span>
        <span class="print-only">
          OpsMin · Cerrito Car · ${new Date().toLocaleDateString('es-AR')}
        </span>
      </div>
    </div>
  `;
}