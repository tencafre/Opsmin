// ---- APP PRINCIPAL ----

let currentSession = null;

async function initApp(session) {
  currentSession = session;
  await Promise.all([
    loadBoard(),
    loadTaskCatalog(),
    initRealtime(),
    checkAlertas(),
  ]);
  showView('board');
  monitorConnection();
}

async function checkAlertas() {
  const { data: alertas } = await db
    .from('delivery_alerts')
    .select('*')
    .eq('estado', 'activa')
    .order('created_at', { ascending: false });

  if (!alertas?.length) return;

  // Mostrar badge en topbar
  const badge = document.getElementById('alertas-badge');
  if (badge) {
    badge.textContent = alertas.length;
    badge.classList.remove('hidden');
  }

  // Agrupar por tipo
  const remitos  = alertas.filter(a => a.tipo === 'remito_pendiente');
  const sinConf  = alertas.filter(a => a.tipo === 'baja_sin_confirmar');

  let msg = '';
  if (remitos.length)
    msg += `⚠️ ${remitos.length} vehículo${remitos.length > 1 ? 's' : ''} entregado${remitos.length > 1 ? 's' : ''} sin remito en DMS. `;
  if (sinConf.length)
    msg += `⚠️ ${sinConf.length} baja${sinConf.length > 1 ? 's' : ''} en CSV sin confirmar en tablero.`;

  if (msg) showToast(msg, 'warning');
}

function showScreen(name) {
  document.getElementById('screen-login').classList.toggle('hidden', name !== 'login');
  document.getElementById('screen-app').classList.toggle('hidden',   name !== 'app');
}

function showView(name) {
  ['board', 'upload', 'listado', 'alertas'].forEach(v => {
    document.getElementById(`view-${v}`)?.classList.toggle('hidden', v !== name);
  });

  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const tabMap = { board: 0, listado: 1 };
  if (tabMap[name] !== undefined) {
    document.querySelectorAll('.nav-tab')[tabMap[name]]?.classList.add('active');
  }

  if (name === 'listado') renderListado();
  if (name === 'upload')  renderUpload();
  if (name === 'alertas') renderAlertas();
}

// ---- PANEL LATERAL ----
let currentVehicleId   = null;
let currentAssignmentId = null;

function openPanel(vehicleId, assignmentId) {
  currentVehicleId    = vehicleId;
  currentAssignmentId = assignmentId;
  document.getElementById('side-panel').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
  switchPanelTab('trabajo', document.querySelector('.ptab'));
}

function closePanel() {
  document.getElementById('side-panel').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
  currentVehicleId    = null;
  currentAssignmentId = null;
}

function switchPanelTab(tab, btn) {
  document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'trabajo')      renderPanelTrabajo();
  if (tab === 'datos')        renderPanelDatos();
  if (tab === 'comentarios')  renderPanelComentarios();
}

// ---- TOAST ----
let toastTimer = null;
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = 'toast hidden', 3000);
}

// ---- CONEXIÓN ----
function monitorConnection() {
  const badge = document.getElementById('connection-badge');
  window.addEventListener('online',  () => {
    badge.textContent = '● En línea';
    badge.className   = 'conn-badge conn-ok';
    initRealtime();
  });
  window.addEventListener('offline', () => {
    badge.textContent = '● Sin conexión';
    badge.className   = 'conn-badge conn-off';
  });
}

// ---- REALTIME ----
let realtimeChannel = null;

function initRealtime() {
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
  }

  realtimeChannel = db
    .channel('opsmin-board')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'sector_assignments' },
      () => loadBoard()
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'vehicles' },
      () => loadBoard()
    )
    .subscribe();
}