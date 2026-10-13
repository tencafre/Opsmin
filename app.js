// ---- APP PRINCIPAL ----

let currentSession = null;

async function initApp(session) {
  currentSession = session;
  await Promise.all([
    loadBoard(),
    initRealtime(),
  ]);
  showView('board');
  monitorConnection();
}

function showScreen(name) {
  document.getElementById('screen-login').classList.toggle('hidden', name !== 'login');
  document.getElementById('screen-app').classList.toggle('hidden',   name !== 'app');
}

function showView(name) {
  ['board', 'upload', 'listado'].forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('hidden', v !== name);
  });

  // Actualizar tabs activos
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const tabMap = { board: 0, listado: 1 };
  if (tabMap[name] !== undefined) {
    document.querySelectorAll('.nav-tab')[tabMap[name]]?.classList.add('active');
  }

  if (name === 'listado') renderListado();
  if (name === 'upload')  renderUpload();
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