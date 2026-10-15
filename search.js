// ---- BUSCADOR CON ASIGNACIÓN DIRECTA ----

let searchTimer  = null;
let boardFiltered = false;

function onSearch(query) {
  clearTimeout(searchTimer);
  const results = document.getElementById('search-results');

  if (!query || query.length < 2) {
    results.classList.add('hidden');
    clearBoardFilter();
    return;
  }

  searchTimer = setTimeout(() => doSearch(query), 200);
}

function doSearch(query) {
  const q       = query.toLowerCase().trim();
  const results = document.getElementById('search-results');

  const matches = vehicles.filter(v =>
    v.interno?.toString().includes(q) ||
    v.chasis?.toLowerCase().includes(q) ||
    v.cliente?.toLowerCase().includes(q) ||
    v.modelo?.toLowerCase().includes(q)
  ).slice(0, 8);

  // Filtrar tablero en tiempo real (Opción B)
  applyBoardFilter(matches.map(v => v.id));

  if (!matches.length) {
    results.innerHTML = `
      <div class="sr-empty">Sin resultados para "${query}"</div>
    `;
    results.classList.remove('hidden');
    return;
  }

  results.innerHTML = matches.map(v => {
    const asn    = assignments.find(a => a.vehicle_id === v.id);
    const sector = sectors.find(s => s.id === asn?.sector_id);
    return `
      <div class="sr-item">
        <div class="sr-main" onclick="selectSearchResult('${v.id}','${asn?.id ?? ''}')">
          <span class="sr-title">INT ${v.interno ?? '—'} — ${v.modelo}</span>
          <span class="sr-sub">${v.cliente ?? 'Sin cliente'} · ${v.color ?? '—'}</span>
          <span class="sr-vin">${v.chasis}</span>
        </div>
        <div class="sr-actions">
          <span class="sr-sector-tag"
            style="background:${sector?.color_hex ?? '#94a3b8'}20;
                   color:${sector?.color_hex ?? '#94a3b8'}">
            ${sector?.nombre ?? 'Sin asignar'}
          </span>
          <button class="sr-assign-btn"
            onclick="openAssignMenu('${v.id}', this)"
            title="Asignar a sector">
            Asignar →
          </button>
        </div>
      </div>
    `;
  }).join('');

  results.classList.remove('hidden');
}

// ---- MENÚ DE ASIGNACIÓN DIRECTA ----
function openAssignMenu(vehicleId, btn) {
  // Cerrar cualquier menú abierto
  document.querySelectorAll('.assign-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'assign-menu';
  menu.innerHTML = `
    <div class="assign-menu-title">Asignar a sector</div>
    ${sectors.map(s => `
      <button class="assign-menu-item"
        style="border-left: 3px solid ${s.color_hex}"
        onclick="assignDirect('${vehicleId}', '${s.id}', this)">
        ${s.nombre}
      </button>
    `).join('')}
    <button class="assign-menu-cancel" onclick="this.closest('.assign-menu').remove()">
      Cancelar
    </button>
  `;

  // Posicionar debajo del botón
  const rect = btn.getBoundingClientRect();
  menu.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    right: ${window.innerWidth - rect.right}px;
    z-index: 500;
  `;

  document.body.appendChild(menu);

  // Cerrar al hacer click afuera
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 0);
}

async function assignDirect(vehicleId, sectorId, btn) {
  // Cerrar menú
  btn.closest('.assign-menu').remove();

  // Obtener versión actual
  const asn = assignments.find(a => a.vehicle_id === vehicleId);
  const expectedVersion = asn?.version ?? 0;

  const { data: result, error } = await db.rpc('move_vehicle_to_sector', {
    p_vehicle_id:   vehicleId,
    p_sector_id:    sectorId,
    p_expected_ver: expectedVersion,
    p_usuario_id:   currentSession?.user?.id ?? null,
  });

  if (error || result === 'conflict') {
    showToast(
      result === 'conflict'
        ? 'Ya fue movido por otro operario'
        : 'Error al asignar',
      'error'
    );
    return;
  }

  const sector = sectors.find(s => s.id === sectorId);
  showToast(`Asignado a ${sector?.nombre}`, 'ok');

  // Limpiar buscador y recargar
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').classList.add('hidden');
  clearBoardFilter();
  await loadBoard();
}

// ---- FILTRO DEL TABLERO (Opción B) ----
function applyBoardFilter(vehicleIds) {
  boardFiltered = true;
  const idSet = new Set(vehicleIds);

  document.querySelectorAll('.card').forEach(card => {
    const vid = card.dataset.vehicleId;
    if (idSet.has(vid)) {
      card.style.opacity = '1';
      card.style.transform = 'scale(1)';
      card.classList.add('search-match');
    } else {
      card.style.opacity = '0.15';
      card.style.transform = 'scale(0.97)';
      card.classList.remove('search-match');
    }
  });
}

function clearBoardFilter() {
  if (!boardFiltered) return;
  boardFiltered = false;
  document.querySelectorAll('.card').forEach(card => {
    card.style.opacity = '';
    card.style.transform = '';
    card.classList.remove('search-match');
  });
}

function selectSearchResult(vehicleId, assignmentId) {
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('search-input').value = '';
  clearBoardFilter();

  const card = document.querySelector(`[data-vehicle-id="${vehicleId}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('highlight');
    setTimeout(() => card.classList.remove('highlight'), 2500);
  }

  openPanel(vehicleId, assignmentId);
}

// Cerrar resultados al hacer click afuera
document.addEventListener('click', e => {
  if (!e.target.closest('#search-bar')) {
    document.getElementById('search-results')?.classList.add('hidden');
    clearBoardFilter();
  }
});
