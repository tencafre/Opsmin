// ---- TABLERO KANBAN ----

let sectors  = [];
let vehicles = [];
let assignments = [];

// Mapa vehicleId → días desde lavado
let diasLavado = new Map();



async function loadBoard() {
  try {
    // Primero obtener el ID del sector lavado
    const { data: sectorLavado } = await db
      .from('sectors')
      .select('id')
      .eq('slug', 'lavado')
      .single();

    const lavadoId = sectorLavado?.id ?? null;

    // Queries paralelas
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

    // Calcular días desde último lavado
    diasLavado = new Map();

    if (lavadoId) {
      const { data: lavados, error: lavErr } = await db
        .from('sector_assignments')
        .select('vehicle_id, salida_at')
        .eq('sector_id', lavadoId)
        .eq('activo', false)
        .not('salida_at', 'is', null)
        .order('salida_at', { ascending: false });

      if (!lavErr && lavados) {
        const visto = new Set();
        const hoy   = new Date();
        hoy.setHours(0, 0, 0, 0);

        for (const row of lavados) {
          if (visto.has(row.vehicle_id)) continue;
          visto.add(row.vehicle_id);
          const salida = new Date(row.salida_at);
          salida.setHours(0, 0, 0, 0);
          const dias = Math.floor((hoy - salida) / (1000 * 60 * 60 * 24));
          diasLavado.set(row.vehicle_id, dias);
        }
      }
    }

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
  const finalizados = items.filter(({asn}) =>
    asn?.estado_trabajo === 'finalizado'
  ).length;
  const activos = items.length - finalizados;

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
        <div class="col-counts">
          <span class="col-count">${activos}</span>
          ${finalizados > 0
            ? `<span class="col-count-done" title="${finalizados} finalizados">
                ✓${finalizados}
               </span>`
            : ''}
        </div>
      </div>
      <div class="col-cards" data-sector-id="${sector.id}">
        ${items.length
          ? items.map(({ v, asn }) => renderCard(v, asn, sector)).join('')
          : `<div class="col-empty">Arrastrá una ficha aquí</div>`
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
  const estado     = asn?.estado_trabajo ?? 'pendiente';
  const estadoInfo = ESTADOS[estado] ?? ESTADOS.pendiente;
  const finalizado = estado === 'finalizado';
  const trabajos   = asn?.trabajos ?? [];

  // Ficha colapsada para finalizados
  if (finalizado) {
    return `
      <div class="card card-collapsed"
        draggable="true"
        data-vehicle-id="${v.id}"
        data-version="${asn?.version ?? 0}"
        data-assignment-id="${asn?.id ?? ''}"
        onclick="expandCard(this,'${v.id}','${asn?.id ?? ''}')"
        ondragstart="onDragStart(event)"
        ondragend="onDragEnd(event)"
      >
        <div class="card-collapsed-stripe"
          style="background:${sector?.color_hex ?? '#94a3b8'}"></div>
        <div class="card-collapsed-body">
          <span class="card-collapsed-interno">INT ${v.interno ?? '—'}</span>
          <span class="card-collapsed-modelo">${v.modelo}</span>
          <span class="card-collapsed-estado"
            style="background:${estadoInfo.bg};color:${estadoInfo.color}">
            ✓ ${estadoInfo.label}
          </span>
        </div>
      </div>
    `;
  }

  // Trabajos en la ficha
  const hayTrabajos = trabajos.length > 0
    ? `<div class="card-trabajos">
        ${trabajos.slice(0, 2).map(t =>
          `<span class="card-trabajo-tag">${t}</span>`
        ).join('')}
        ${trabajos.length > 2
          ? `<span class="card-trabajo-more">+${trabajos.length - 2}</span>`
          : ''}
       </div>`
    : '';

  // Fecha de taller
  const hayFecha = asn?.fecha_taller
    ? `<span class="card-fecha">🗓 ${formatDate(asn.fecha_taller)}</span>`
    : '';

  // Días desde lavado
  const diasSinLavar = diasLavado.get(v.id);
  let lavadoIndicador = '';
  if (diasSinLavar !== undefined) {
    const color = diasSinLavar <= 7
      ? '#10B981'
      : diasSinLavar <= 14
        ? '#F59E0B'
        : '#EF4444';
    const label = diasSinLavar === 0
      ? 'Lavado hoy'
      : `${diasSinLavar}d sin lavar`;
    lavadoIndicador = `
      <div class="card-lavado" style="color:${color}">
        <span class="lavado-dot" style="background:${color}"></span>
        ${label}
      </div>
    `;
  } else {
    lavadoIndicador = `
      <div class="card-lavado card-lavado-none">
        <span class="lavado-dot"></span>
        Sin lavado
      </div>
    `;
  }

  return `
    <div class="card"
      draggable="true"
      data-vehicle-id="${v.id}"
      data-version="${asn?.version ?? 0}"
      data-assignment-id="${asn?.id ?? ''}"
      onclick="openPanel('${v.id}','${asn?.id ?? ''}')"
      ondragstart="onDragStart(event)"
      ondragend="onDragEnd(event)"
      style="content-visibility:auto;contain-intrinsic-size:0 160px"
    >
      <div class="card-stripe"
        style="background:${sector?.color_hex ?? '#94a3b8'}"></div>
      <div class="card-body">
        <div class="card-top">
          <span class="card-interno">INT ${v.interno ?? '—'}</span>
          <span class="estado-pill"
            style="background:${estadoInfo.bg};color:${estadoInfo.color}">
            ${estadoInfo.label}
          </span>
        </div>
        <div class="card-modelo">${v.modelo}${v.version ? ' '+v.version : ''}</div>
        <div class="card-cliente">${v.cliente ?? '<em>Sin cliente</em>'}</div>
        ${hayFecha}
        ${hayTrabajos}
        ${lavadoIndicador}
        <div class="card-vin">
          <span class="vin-label">VIN</span>
          <span class="vin-value">${v.chasis}</span>
          <button class="vin-copy"
            onclick="event.stopPropagation();copyVin('${v.chasis}')"
            title="Copiar VIN">⎘</button>
        </div>
      </div>
    </div>
  `;
}

// Expandir ficha colapsada — abre el panel
function expandCard(el, vehicleId, assignmentId) {
  openPanel(vehicleId, assignmentId);
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

// ---- CATÁLOGO DE TRABAJOS (cacheado al cargar) ----
let taskCatalog = [];

async function loadTaskCatalog() {
  const { data, error } = await db
    .from('sector_task_catalog')
    .select('*')
    .eq('activo', true)
    .order('orden');
  if (!error) taskCatalog = data ?? [];
}

// Llamar en initApp — agregar a app.js:
// await loadTaskCatalog();

// ---- PANEL — TAB TRABAJO (reemplazar función existente) ----
async function renderPanelTrabajo() {
  if (!currentVehicleId) return;

  const v   = vehicles.find(x => x.id === currentVehicleId);
  const asn = assignments.find(x => x.id === currentAssignmentId);

  // Sector actual
  const sector = sectors.find(s => s.id === asn?.sector_id);
  const sectorSlug = sector?.slug ?? '';

  // Trabajos ya guardados
  const trabajosGuardados = asn?.trabajos ?? [];

  // Catálogo del sector actual
  const catalogoSector = taskCatalog.filter(t => t.sector_slug === sectorSlug);

  // Agrupar por categoría
  const porCategoria = {};
  for (const t of catalogoSector) {
    if (!porCategoria[t.categoria]) porCategoria[t.categoria] = [];
    porCategoria[t.categoria].push(t);
  }

  document.getElementById('panel-title').textContent =
    `${v?.modelo ?? ''} — INT ${v?.interno ?? '—'}`;
  document.getElementById('panel-sub').textContent =
    `${v?.color ?? ''} · ${v?.cliente ?? 'Sin cliente'}`;

  const body = document.getElementById('panel-body');
  body.innerHTML = `

    ${sector ? `
    <div class="panel-section">
      <label class="panel-label">Trabajos — ${sector.nombre}</label>

      ${Object.keys(porCategoria).length > 0 ? `
        <div class="task-catalog">
          ${Object.entries(porCategoria).map(([cat, items]) => `
            <div class="task-category">
              <div class="task-cat-label">${cat}</div>
              <div class="task-chips">
                ${items.map(item => `
                  <button
                    class="task-chip ${trabajosGuardados.includes(item.nombre) ? 'selected' : ''}"
                    data-task="${escapeHtml(item.nombre)}"
                    onclick="toggleTask(this)">
                    ${item.nombre}
                  </button>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="task-free-wrap">
        <input
          type="text"
          id="task-free-input"
          class="panel-input"
          placeholder="Agregar trabajo libre..."
        />
        <button class="btn-task-add" onclick="addFreeTask()">+ Agregar</button>
      </div>

      <div id="free-tasks-list">
        ${trabajosGuardados
          .filter(t => !catalogoSector.some(c => c.nombre === t))
          .map(t => `
            <div class="free-task-item">
              <span>${escapeHtml(t)}</span>
              <button onclick="removeFreeTask('${escapeHtml(t)}')" class="btn-remove-task">✕</button>
            </div>
          `).join('')}
      </div>
    </div>
    ` : ''}

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
      style="${['esperando_repuestos','cancelado'].includes(asn?.estado_trabajo)
        ? '' : 'display:none'}">
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

// ---- GESTIÓN DE TRABAJOS ----
function toggleTask(btn) {
  btn.classList.toggle('selected');
}

function addFreeTask() {
  const input = document.getElementById('task-free-input');
  const texto = input?.value.trim();
  if (!texto) return;

  const lista = document.getElementById('free-tasks-list');
  const item  = document.createElement('div');
  item.className = 'free-task-item';
  item.innerHTML = `
    <span>${escapeHtml(texto)}</span>
    <button onclick="removeFreeTask('${escapeHtml(texto)}')"
      class="btn-remove-task">✕</button>
  `;
  lista.appendChild(item);
  input.value = '';
}

function removeFreeTask(texto) {
  document.querySelectorAll('.free-task-item').forEach(item => {
    if (item.querySelector('span')?.textContent === texto) {
      item.remove();
    }
  });
}

function getSelectedTasks() {
  const selected = [];

  // Chips del catálogo seleccionados
  document.querySelectorAll('.task-chip.selected').forEach(chip => {
    selected.push(chip.dataset.task);
  });

  // Tareas libres
  document.querySelectorAll('.free-task-item span').forEach(span => {
    const t = span.textContent.trim();
    if (t) selected.push(t);
  });

  return selected;
}

// ---- GUARDAR TRABAJO (reemplazar saveTrabajo existente) ----
async function saveTrabajo() {
  if (!currentAssignmentId) return;

  const estado      = selectedEstado;
  const motivo      = selectedMotivo;
  const fechaTaller = document.getElementById('panel-fecha-taller')?.value || null;
  const trabajos    = getSelectedTasks();

  const update = {};
  if (estado)               update.estado_trabajo = estado;
  if (motivo)               update.motivo         = motivo;
  if (fechaTaller !== null) update.fecha_taller   = fechaTaller || null;
  if (trabajos.length >= 0) update.trabajos       = trabajos;

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
  const trabajos    = getSelectedTasks();

  const update = {};
  if (estado)               update.estado_trabajo = estado;
  if (motivo)               update.motivo         = motivo;
  if (fechaTaller !== null) update.fecha_taller   = fechaTaller || null;
  if (trabajos.length >= 0) update.trabajos       = trabajos;

  const { error } = await db
    .from('sector_assignments')
    .update(update)
    .eq('id', currentAssignmentId);

  if (error) {
    showToast('Error al guardar', 'error');
    return;
  }

  // Auto-move a "En espera" si se marcó como Finalizado
  if (estado === 'finalizado') {
    const sectorEnEspera = sectors.find(s => s.slug === 'en_espera');
    if (sectorEnEspera) {
      const asn         = assignments.find(a => a.id === currentAssignmentId);
      const expectedVer = asn?.version ?? 1;

      const { data: result } = await db.rpc('move_vehicle_to_sector', {
        p_vehicle_id:   currentVehicleId,
        p_sector_id:    sectorEnEspera.id,
        p_expected_ver: expectedVer,
        p_estado_trabajo: 'pendiente',
        p_usuario_id:   currentSession?.user?.id ?? null,
      });

      if (result === 'ok') {
        showToast('✓ Finalizado — movido a En espera', 'ok');
      } else {
        showToast('Guardado', 'ok');
      }
    }
  } else {
    showToast('Guardado', 'ok');
  }

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