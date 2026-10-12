// ---- BUSCADOR ----

let searchTimer = null;

function onSearch(query) {
  clearTimeout(searchTimer);
  const results = document.getElementById('search-results');

  if (!query || query.length < 2) {
    results.classList.add('hidden');
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

  if (!matches.length) {
    results.innerHTML = `<div class="sr-empty">Sin resultados para "${query}"</div>`;
    results.classList.remove('hidden');
    return;
  }

  results.innerHTML = matches.map(v => {
    const asn    = assignments.find(a => a.vehicle_id === v.id);
    const sector = sectors.find(s => s.id === asn?.sector_id);
    return `
      <div class="sr-item" onclick="selectSearchResult('${v.id}','${asn?.id ?? ''}')">
        <div class="sr-main">
          <span class="sr-title">INT ${v.interno ?? '—'} — ${v.modelo}</span>
          <span class="sr-sub">${v.cliente ?? 'Sin cliente'} · ${v.color ?? '—'}</span>
          <span class="sr-vin">${v.chasis}</span>
        </div>
        <span class="sr-sector" style="background:${sector?.color_hex ?? '#94a3b8'}20;
          color:${sector?.color_hex ?? '#94a3b8'}">
          ${sector?.nombre ?? 'Sin asignar'}
        </span>
      </div>
    `;
  }).join('');

  results.classList.remove('hidden');
}

function selectSearchResult(vehicleId, assignmentId) {
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('search-input').value = '';

  // Scroll hasta la ficha en el tablero
  const card = document.querySelector(`[data-vehicle-id="${vehicleId}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('highlight');
    setTimeout(() => card.classList.remove('highlight'), 2000);
  }

  // Abrir panel si hay assignment
  openPanel(vehicleId, assignmentId);
}

// Cerrar resultados al hacer click afuera
document.addEventListener('click', e => {
  if (!e.target.closest('#search-bar')) {
    document.getElementById('search-results')?.classList.add('hidden');
  }
});