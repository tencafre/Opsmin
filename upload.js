// ---- UPLOAD DE EXCEL ----

function renderUpload() {
  document.getElementById('view-upload').innerHTML = `
    <div class="upload-view">
      <div class="upload-box" id="upload-box"
        ondragover="uploadDragOver(event)"
        ondragleave="uploadDragLeave(event)"
        ondrop="uploadDrop(event)"
        onclick="triggerFileInput()"
      >
        <div class="upload-icon">📂</div>
        <p class="upload-title">Arrastrá el Excel de stock aquí</p>
        <p class="upload-sub">o hacé click para seleccionar el archivo</p>
        <p class="upload-sub" style="font-size:11px;color:var(--text-muted);margin-top:4px">
          Formatos aceptados: .xlsx · .xls · .csv — máximo 10 MB
        </p>
      </div>
      <input
        type="file"
        id="file-input"
        accept=".xlsx,.xls,.csv"
        style="display:none"
        onchange="handleFileSelect(this)"
      />
      <div id="upload-result" class="upload-result hidden"></div>
    </div>
  `;
}

function triggerFileInput() {
  const input = document.getElementById('file-input');
  if (input) input.click();
}

function uploadDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('upload-box')?.classList.add('drag-over');
}

function uploadDragLeave(e) {
  e.preventDefault();
  document.getElementById('upload-box')?.classList.remove('drag-over');
}

function uploadDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('upload-box')?.classList.remove('drag-over');

  const file = e.dataTransfer.files[0];
  if (!file) {
    showToast('No se detectó ningún archivo', 'error');
    return;
  }

  if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
    showToast('Solo se aceptan archivos Excel o CSV', 'error');
    return;
  }

  uploadFile(file);
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (file) uploadFile(file);
  // Resetear el input para permitir subir el mismo archivo de nuevo
  input.value = '';
}

async function uploadFile(file) {
  const box    = document.getElementById('upload-box');
  const result = document.getElementById('upload-result');

  if (!box) return;

  // Mostrar progreso
  box.onclick   = null;
  box.innerHTML = `
    <div class="upload-icon">⏳</div>
    <p class="upload-title">Procesando <strong>${file.name}</strong>...</p>
    <p class="upload-sub">${(file.size / 1024).toFixed(0)} KB</p>
  `;
  result?.classList.add('hidden');

  try {
    const formData = new FormData();
    formData.append('file', file);

    const { data: { session } } = await db.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      showToast('Sesión expirada — volvé a iniciar sesión', 'error');
      renderUpload();
      return;
    }

    const res = await fetch(`${CONFIG.WORKER_URL}/upload`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    formData,
    });

    const data = await res.json();

    if (!data.ok) throw new Error(data.error ?? 'Error desconocido');

    // Mostrar resultado
    const tieneAlertas = (data.alertas_baja ?? 0) + (data.alertas_remito ?? 0);

    if (result) {
      result.innerHTML = `
        <div class="result-ok">
          <div class="result-title">✓ Ingesta completada — ${file.name}</div>
          <div class="result-grid">
            <div class="result-item">
              <span class="ri-val">${data.vehiculos_validos ?? 0}</span>
              <span class="ri-label">procesados</span>
            </div>
            <div class="result-item">
              <span class="ri-val">${data.vehiculos_nuevos ?? 0}</span>
              <span class="ri-label">nuevos</span>
            </div>
            <div class="result-item">
              <span class="ri-val">${data.actualizados ?? 0}</span>
              <span class="ri-label">actualizados</span>
            </div>
            <div class="result-item">
              <span class="ri-val">${data.archivados ?? 0}</span>
              <span class="ri-label">archivados</span>
            </div>
          </div>

          ${tieneAlertas ? `
            <div class="result-warnings">
              <p><strong>⚠️ Alertas de entrega (${tieneAlertas}):</strong></p>
              ${data.alertas_remito
                ? `<div class="warning-row">
                     ${data.alertas_remito} vehículo${data.alertas_remito > 1 ? 's' : ''}
                     entregado${data.alertas_remito > 1 ? 's' : ''} sin remito en DMS
                   </div>`
                : ''}
              ${data.alertas_baja
                ? `<div class="warning-row">
                     ${data.alertas_baja} baja${data.alertas_baja > 1 ? 's' : ''}
                     en CSV sin confirmar en tablero
                   </div>`
                : ''}
              <button class="btn-go-board"
                style="background:#92400e;margin-top:8px"
                onclick="showView('alertas')">
                Ver alertas →
              </button>
            </div>
          ` : ''}

          ${data.advertencias?.length ? `
            <div class="result-warnings">
              <p><strong>⚠️ Advertencias de chasis (${data.advertencias.length}):</strong></p>
              ${data.advertencias.map(w =>
                `<div class="warning-row">${w.motivo} — INT ${w.interno}</div>`
              ).join('')}
            </div>
          ` : ''}

          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn-go-board" onclick="showView('board');loadBoard()">
              Ver tablero →
            </button>
            <button class="btn-go-board"
              style="background:var(--surface-2);color:var(--text);border:1px solid var(--border)"
              onclick="renderUpload()">
              Subir otro archivo
            </button>
          </div>
        </div>
      `;
      result.classList.remove('hidden');
    }

    // Recargar alertas en el topbar
    await checkAlertas();
    await loadBoard();

  } catch (err) {
    if (box) {
      box.innerHTML = `
        <div class="upload-icon">❌</div>
        <p class="upload-title">Error al procesar el archivo</p>
        <p class="upload-sub">${err.message}</p>
      `;
      box.onclick = () => renderUpload();
    }
  }
}
