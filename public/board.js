// ---- TABLERO KANBAN ----

let sectors  = [];
let vehicles = [];
let assignments = [];

async function loadBoard() {
  try {
    const [secRes, vehRes, asnRes] = await Promise.all([
      db.from('sectors').select('*').order('orden'),
      db.from('vehicles').select('*').eq('estado', 'activo').order('interno'),
      db.from('sector_assignments').select('*').eq('activo', true),
    ]);

    if (secRes.error) throw secRes.error;
    if (vehRes.error) throw vehRes.error;
    if (asnRes.error) throw asnRes.error;

    sectors     = secRes.data;
    vehicles    = vehRes.data;
    assignments = asnRes.data;

    renderBoard();
  } catch (err) {
    console.error('[board] Error cargando datos:', err);
    showToast('Error cargando el tablero', 'error');
  }
}

function renderBoard() {
  const container = document.getElementById('view-board');

  // Mapa vehicleId → assignment activo
  const asnByVehicle = new Map(assignments.map(a => [a.vehicle_id, a]));

  // Mapa sectorId → vehículos
  const bySector = new Map(sectors.map(s => [s.id, []]));

  // Sin sector asignado
  const sinSector = [];

  for (const v of vehicles) {
    const asn = asnByVehicle.get(v.id);
    if (asn && bySector.has(asn.sector_id)) {
      bySector.get(asn.sector_id).push({ v, asn });
    } else {
      sinSector.push({ v, asn: null });
    }
  }

  container.innerHTML = `
    <div class="board">
      ${sectors.map(s => renderColumn(s, bySector.get(s.id) ?? [])).join('')}
      ${sinSector.length ? renderColumnSinSector(sinSector) : ''}
    </div>
  `;

  bindDragEvents();
}

function renderColumn(sector, items) {
  return `
    <div class="col"
      data-sector-id="${sector.id}"
      data-sector-slug="${sector.slug}"
      ondragover="onDragOver(event)"
      ondragleave="onDragLeave(event)"
      ondrop="onDrop(event)"
    >
      <div class="col-stripe" style="background:${sector.color_hex}"></div>
      <div class="col-header">
        <span class="col-title">${sector.nombre}</span>
        <span class="col-count">${items.length}</span>
      </div>
      <div class="col-cards" data-sector-id="${sector.id}">
        ${items.length
          ? items.map(({ v, asn }) => renderCard(v, asn, sector)).join('')
          : '<div class="col-empty">Arrastrá una ficha aquí</div>'
        }
      </div>
    </div>
  `;
}

function renderColumnSinSector(items) {
  return `
    <div class="col"
      data-sector-id="none"
      ondragover="onDragOver(event)"
      ondragleave="onDragLeave(event)"
      ondrop="onDrop(event)"
    >
      <div class="col-stripe" style="background:#94a3b8"></div>
      <div class="col-header">
        <span class="col-title">Sin asignar</span>
        <span class="col-count">${items.length}</span>
      </div>
      <div class="col-cards" data-sector-id="none">
        ${items.map(({ v }) => renderCard(v, null, null)).join('')}
      </div>
    </div>
  `;
}

function renderCard(v, asn, sector) {
  const estado  = asn?.estado_trabajo ?? 'pendiente';
  const estadoInfo = ESTADOS[estado] ?? ESTADOS.pendiente;
  const hayFecha = asn?.fecha_taller
    ? `<span class="card-fecha">Taller: ${formatDate(asn.fecha_taller)}</span>`
    : '';

  return `
    <div class="card"
      draggable="true"
      data-vehicle-id="${v.id}"
      data-version="${asn?.version ?? 0}"
      data-assignment-id="${asn?.id ?? ''}"
      onclick="openPanel('${v.id}', '${asn?.id ?? ''}')"
      ondragstart="onDragStart(event)"
      ondragend="onDragEnd(event)"
      style="content-visibility:auto;contain-intrinsic-size:0 148px"
    >
      <div class="card-stripe" style="background:${sector?.color_hex ?? '#94a3b8'}"></div>
      <div class="card-body">
        <div class="card-top">
          <span class="card-interno">INT ${v.interno ?? '—'}</span>
          <span class="estado-pill" style="background:${estadoInfo.bg};color:${estadoInfo.color}">
            ${estadoInfo.label}
          </span>
        </div>
        <div class="card-modelo">${v.modelo}${v.version ? ' ' + v.version : ''}</div>
        <div class="card-cliente">${v.cliente ?? '<em>Sin cliente</em>'}</div>
        ${hayFecha}
        <div class="card-vin">
          <span class="vin-label">VIN</span>
          <span class="vin-value">${v.chasis}</span>
          <button class="vin-copy" onclick="event.stopPropagation();copyVin('${v.chasis}')"
            title="Copiar VIN">⎘</button>
        </div>
      </div>
    </div>
  `;
}

// Estados de trabajo
const ESTADOS = {
  pendiente:           { label: 'Pendiente',        bg: '#FEF3C7', color: '#92400E' },
  esperando_repuestos: { label: 'Esp. repuestos',   bg: '#FEE2E2', color: '#7F1D1D' },
  programado:          { label: 'Programado',        bg: '#DBEAFE', color: '#1E3A8A' },
  finalizado:          { label: 'Finalizado',        bg: '#D1FAE5', color: '#064E3B' },
  cancelado:           { label: 'Cancelado',         bg: '#F3F4F6', color: '#374151' },
};

// ---- DRAG & DROP ----
let dragVehicleId  = null;
let dragVersion    = null;
let dragSourceCol  = null;
let dragCardEl     = null;

function bindDragEvents() {} // los eventos están inline en el HTML

function onDragStart(e) {
  dragVehicleId = e.currentTarget.dataset.vehicleId;
  dragVersion   = parseInt(e.currentTarget.dataset.version);
  dragSourceCol = e.currentTarget.closest('[data-sector-id]')?.dataset.sectorId;
  dragCardEl    = e.currentTarget;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('is-dragging');
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('is-dragging');
  document.querySelectorAll('.col.drag-over').forEach(c =>
    c.classList.remove('drag-over')
  );
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget().classList.add('drag-over');
}

function onDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
  }
}

async function onDrop(e) {
  e.preventDefault();
  const col = e.currentTarget;
  col.classList.remove('drag-over');

  const targetSectorId = col.dataset.sectorId;
  if (!dragVehicleId || targetSectorId === dragSourceCol) return;
  if (targetSectorId === 'none') return;

  // Mover visualmente (optimistic UI)
  const card = document.querySelector(`[data-vehicle-id="${dragVehicleId}"]`);
  const cardsContainer = col.querySelector('.col-cards');
  if (card && cardsContainer) {
    const empty = cardsContainer.querySelector('.col-empty');
    if (empty) empty.remove();
    cardsContainer.appendChild(card);
    card.dataset.version = '1';
  }

  // Llamar RPC con optimistic locking
  const { data: result, error } = await db.rpc('move_vehicle_to_sector', {
    p_vehicle_id:   dragVehicleId,
    p_sector_id:    targetSectorId,
    p_expected_ver: dragVersion,
    p_usuario_id:   currentSession?.user?.id ?? null,
  });

  if (error || result === 'conflict') {
    showToast(
      result === 'conflict'
        ? 'Ya fue movido por otro operario — tablero actualizado'
        : 'Error al mover el vehículo',
      result === 'conflict' ? 'warning' : 'error'
    );
    await loadBoard(); // re-sincronizar
    return;
  }

  showToast('Vehículo movido', 'ok');
}

// ---- PANEL — TAB TRABAJO ----
async function renderPanelTrabajo() {
  if (!currentVehicleId) return;

  const v   = vehicles.find(x => x.id === currentVehicleId);
  const asn = assignments.find(x => x.id === currentAssignmentId);

  const body = document.getElementById('panel-body');
  document.getElementById('panel-title').textContent =
    `${v?.modelo ?? ''} — INT ${v?.interno ?? '—'}`;
  document.getElementById('panel-sub').textContent =
    `${v?.color ?? ''} · ${v?.cliente ?? 'Sin cliente'}`;

  body.innerHTML = `
    <div class="panel-section">
      <label class="panel-label">Estado del trabajo</label>
      <div class="estado-grid">
        ${Object.entries(ESTADOS).map(([slug, info]) => `
          <button class="estado-btn ${asn?.estado_trabajo === slug ? 'selected' : ''}"
            style="${asn?.estado_trabajo === slug
              ? `background:${info.bg};border-color:${info.color};color:${info.color}`
              : ''}"
            onclick="selectEstado('${slug}',this)">
            ${info.label}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="panel-section" id="motivo-section"
      style="${['esperando_repuestos','cancelado'].includes(asn?.estado_trabajo) ? '' : 'display:none'}">
      <label class="panel-label">Motivo</label>
      <div class="motivo-list">
        ${[
          ['no_llegaron_accesorios', 'No llegaron accesorios'],
          ['prospecto_72hs',         'Prospecto dentro de 72 hs'],
          ['siniestros',             'Siniestros'],
          ['faltantes',              'Faltantes'],
          ['otros',                  'Otros'],
        ].map(([slug, label]) => `
          <button class="motivo-btn ${asn?.motivo === slug ? 'selected' : ''}"
            onclick="selectMotivo('${slug}',this)">
            ${label}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="panel-section">
      <label class="panel-label">Fecha de taller</label>
      <input type="date" id="panel-fecha-taller"
        value="${asn?.fecha_taller ?? ''}"
        class="panel-input" />
    </div>

    <div class="panel-section">
      <button class="btn-save" onclick="saveTrabajo()">Guardar</button>
    </div>
  `;
}

let selectedEstado = null;
let selectedMotivo = null;

function selectEstado(slug, btn) {
  selectedEstado = slug;
  document.querySelectorAll('.estado-btn').forEach(b => {
    b.classList.remove('selected');
    b.removeAttribute('style');
  });
  const info = ESTADOS[slug];
  btn.classList.add('selected');
  btn.style.cssText = `background:${info.bg};border-color:${info.color};color:${info.color}`;

  const motivoSection = document.getElementById('motivo-section');
  if (motivoSection) {
    motivoSection.style.display =
      ['esperando_repuestos', 'cancelado'].includes(slug) ? '' : 'none';
  }
}

function selectMotivo(slug, btn) {
  selectedMotivo = slug;
  document.querySelectorAll('.motivo-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

async function saveTrabajo() {
  if (!currentAssignmentId) return;

  const estado      = selectedEstado;
  const motivo      = selectedMotivo;
  const fechaTaller = document.getElementById('panel-fecha-taller')?.value || null;

  const update = {};
  if (estado)      update.estado_trabajo = estado;
  if (motivo)      update.motivo         = motivo;
  if (fechaTaller !== null) update.fecha_taller = fechaTaller || null;

  if (!Object.keys(update).length) {
    showToast('Sin cambios para guardar', 'info');
    return;
  }

  const { error } = await db
    .from('sector_assignments')
    .update(update)
    .eq('id', currentAssignmentId);

  if (error) {
    showToast('Error al guardar', 'error');
    return;
  }

  showToast('Guardado', 'ok');
  await loadBoard();
  closePanel();
}

// ---- PANEL — TAB DATOS ----
function renderPanelDatos() {
  const v = vehicles.find(x => x.id === currentVehicleId);
  if (!v) return;

  document.getElementById('panel-body').innerHTML = `
    <div class="panel-section">
      <div class="datos-row"><span class="datos-label">Interno</span>
        <span class="datos-val">${v.interno ?? '—'}</span></div>
      <div class="datos-row"><span class="datos-label">Modelo</span>
        <span class="datos-val">${v.modelo} ${v.version ?? ''}</span></div>
      <div class="datos-row"><span class="datos-label">Color</span>
        <span class="datos-val">${v.color ?? '—'}</span></div>
      <div class="datos-row"><span class="datos-label">Cliente</span>
        <span class="datos-val">${v.cliente ?? '—'}</span></div>
      <div class="datos-row"><span class="datos-label">Vendedor</span>
        <span class="datos-val">${v.vendedor ?? '—'}</span></div>
      <div class="datos-row"><span class="datos-label">Días en stock</span>
        <span class="datos-val">${v.dias_stock ?? 0}</span></div>
      <div class="datos-row"><span class="datos-label">Ubicación</span>
        <span class="datos-val">${v.ubicacion ?? '—'}</span></div>
      <div class="datos-row">
        <span class="datos-label">VIN completo</span>
        <span class="datos-val vin-full">${v.chasis}</span>
      </div>
    </div>
  `;
}

// ---- PANEL — TAB COMENTARIOS ----
async function renderPanelComentarios() {
  if (!currentAssignmentId) return;

  const { data: comments, error } = await db
    .from('assignment_comments')
    .select('*')
    .eq('assignment_id', currentAssignmentId)
    .order('created_at', { ascending: true });

  if (error) {
    showToast('Error cargando comentarios', 'error');
    return;
  }

  document.getElementById('panel-body').innerHTML = `
    <div class="panel-section">
      <div class="comments-list">
        ${comments.length
          ? comments.map(c => `
              <div class="comment">
                <div class="comment-header">
                  <span class="comment-user">${c.usuario_nombre ?? 'Usuario'}</span>
                  <span class="comment-ts">${formatDateTime(c.created_at)}</span>
                </div>
                <div class="comment-text">${escapeHtml(c.texto)}</div>
              </div>
            `).join('')
          : '<p class="no-comments">Sin observaciones aún</p>'
        }
      </div>
      <div class="comment-input-wrap">
        <textarea id="new-comment" placeholder="Agregar observación..."
          rows="3"></textarea>
        <button class="btn-comment" onclick="addComment()">Agregar</button>
      </div>
    </div>
  `;
}

async function addComment() {
  const texto = document.getElementById('new-comment')?.value.trim();
  if (!texto) return;

  const userName = currentSession?.user?.email?.split('@')[0] ?? 'Usuario';

  const { error } = await db.from('assignment_comments').insert({
    assignment_id:  currentAssignmentId,
    vehicle_id:     currentVehicleId,
    texto,
    usuario_nombre: userName,
  });

  if (error) {
    showToast('Error al agregar comentario', 'error');
    return;
  }

  showToast('Comentario agregado', 'ok');
  renderPanelComentarios();
}

// ---- UTILS ----
function copyVin(vin) {
  navigator.clipboard?.writeText(vin).catch(() => {});
  showToast('VIN copiado', 'ok');
}

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR') + ' ' +
         d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}