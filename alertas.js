// ---- VISTA DE ALERTAS ----

async function renderAlertas() {
  const container = document.getElementById('view-alertas');
  if (!container) return;

  const { data: alertas, error } = await db
    .from('delivery_alerts')
    .select(`
      *,
      vehicles (interno, modelo, chasis, color)
    `)
    .eq('estado', 'activa')
    .order('created_at', { ascending: false });

  if (error) {
    container.innerHTML = `<div class="alertas-empty">Error cargando alertas</div>`;
    return;
  }

  if (!alertas?.length) {
    container.innerHTML = `
      <div class="alertas-view">
        <div class="alertas-header">
          <h2>Alertas de entrega</h2>
        </div>
        <div class="alertas-empty">
          <p>✓ Sin alertas activas</p>
        </div>
      </div>`;
    return;
  }

  const remitos = alertas.filter(a => a.tipo === 'remito_pendiente');
  const sinConf = alertas.filter(a => a.tipo === 'baja_sin_confirmar');

  container.innerHTML = `
    <div class="alertas-view">
      <div class="alertas-header no-print">
        <h2>Alertas de entrega</h2>
        <span class="alertas-count">${alertas.length} activa${alertas.length > 1 ? 's' : ''}</span>
      </div>

      ${remitos.length ? `
        <div class="alertas-section">
          <div class="alertas-section-title alerta-remito">
            ⚠️ Remito pendiente de emisión en DMS
            <span class="alertas-section-count">${remitos.length}</span>
          </div>
          <p class="alertas-section-desc">
            Estos vehículos están marcados como Entregados en el tablero
            pero siguen apareciendo en el stock del DMS.
            Verificar que el remito fue emitido correctamente.
          </p>
          ${remitos.map(a => renderAlertaRow(a)).join('')}
        </div>
      ` : ''}

      ${sinConf.length ? `
        <div class="alertas-section">
          <div class="alertas-section-title alerta-baja">
            ⚠️ Baja en DMS sin confirmar en tablero
            <span class="alertas-section-count">${sinConf.length}</span>
          </div>
          <p class="alertas-section-desc">
            Estos vehículos desaparecieron del CSV pero no están marcados
            como Entregados en el tablero. Verificar si la baja es correcta
            o si hubo un error en el DMS.
          </p>
          ${sinConf.map(a => renderAlertaRow(a)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderAlertaRow(alerta) {
  const v = alerta.vehicles;
  return `
    <div class="alerta-row">
      <div class="alerta-veh">
        <span class="alerta-interno">INT ${v?.interno ?? '—'}</span>
        <span class="alerta-modelo">${v?.modelo ?? '—'}</span>
        <span class="alerta-color">${v?.color ?? '—'}</span>
        <span class="alerta-vin">${v?.chasis ?? '—'}</span>
      </div>
      <div class="alerta-detalle">${alerta.detalle ?? ''}</div>
      <div class="alerta-actions">
        <span class="alerta-fecha">
          ${new Date(alerta.created_at).toLocaleDateString('es-AR')}
        </span>
        <button class="btn-resolver-alerta"
          onclick="resolverAlerta('${alerta.id}')">
          Marcar resuelta
        </button>
      </div>
    </div>
  `;
}

async function resolverAlerta(alertaId) {
  const { error } = await db
    .from('delivery_alerts')
    .update({
      estado:      'resuelta',
      resuelta_at: new Date().toISOString(),
    })
    .eq('id', alertaId);

  if (error) {
    showToast('Error al resolver la alerta', 'error');
    return;
  }

  showToast('Alerta resuelta', 'ok');
  await renderAlertas();
  await checkAlertas();
}