// ---- UPLOAD DE EXCEL ----

function renderUpload() {
  document.getElementById('view-upload').innerHTML = `
    <div class="upload-view">
      <div class="upload-box" id="upload-box"
        ondragover="uploadDragOver(event)"
        ondragleave="uploadDragLeave(event)"
        ondrop="uploadDrop(event)"
      >
        <div class="upload-icon">📂</div>
        <p class="upload-title">Arrastrá el Excel de stock aquí</p>
        <p class="upload-sub">o hacé click para seleccionar el archivo</p>
        <input type="file" id="file-input" accept=".xlsx,.xls,.csv"
          style="display:none" onchange="handleFileSelect(this)" />
        <button class="btn-select-file"
          onclick="document.getElementById('file-input').click()">
          Seleccionar archivo
        </button>
      </div>
      <div id="upload-result" class="upload-result hidden"></div>
    </div>
  `;
}

function uploadDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-box').classList.add('drag-over');
}

function uploadDragLeave(e) {
  document.getElementById('upload-box').classList.remove('drag-over');
}

function uploadDrop(e) {
  e.preventDefault();
  document.getElementById('upload-box').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (file) uploadFile(file);
}

async function uploadFile(file) {
  const box    = document.getElementById('upload-box');
  const result = document.getElementById('upload-result');

  // Mostrar progreso
  box.innerHTML = `
    <div class="upload-icon">⏳</div>
    <p class="upload-title">Procesando <strong>${file.name}</strong>...</p>
    <p class="upload-sub">${(file.size / 1024).toFixed(0)} KB</p>
  `;
  result.classList.add('hidden');

  try {
    const formData = new FormData();
    formData.append('file', file);

    const session = await db.auth.getSession();
    const token   = session.data.session?.access_token;

    const res = await fetch(`${CONFIG.WORKER_URL}/upload`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    formData,
    });

    const data = await res.json();

    if (!data.ok) throw new Error(data.error ?? 'Error desconocido');

    // Mostrar resultado
    result.innerHTML = `
      <div class="result-ok">
        <div class="result-title">✓ Ingesta completada</div>
        <div class="result-grid">
          <div class="result-item">
            <span class="ri-val">${data.vehiculos_validos}</span>
            <span class="ri-label">procesados</span>
          </div>
          <div class="result-item">
            <span class="ri-val">${data.vehiculos_nuevos}</span>
            <span class="ri-label">nuevos</span>
          </div>
          <div class="result-item">
            <span class="ri-val">${data.actualizados}</span>
            <span class="ri-label">actualizados</span>
          </div>
          <div class="result-item">
            <span class="ri-val">${data.filas_ignoradas}</span>
            <span class="ri-label">ignorados</span>
          </div>
        </div>
        ${data.advertencias?.length ? `
          <div class="result-warnings">
            <p><strong>⚠️ Advertencias (${data.advertencias.length}):</strong></p>
            ${data.advertencias.map(w => `
              <div class="warning-row">
                Chasis ${w.chasis_archivo} — ${w.motivo}
              </div>
            `).join('')}
          </div>
        ` : ''}
        <button class="btn-go-board" onclick="showView('board');loadBoard()">
          Ver tablero →
        </button>
      </div>
    `;
    result.classList.remove('hidden');

    // Restaurar zona de upload
    renderUpload();
    await loadBoard();

  } catch (err) {
    box.innerHTML = `
      <div class="upload-icon">❌</div>
      <p class="upload-title">Error al procesar el archivo</p>
      <p class="upload-sub">${err.message}</p>
      <button class="btn-select-file" onclick="renderUpload()">Intentar de nuevo</button>
    `;
    result.classList.add('hidden');
  }
}