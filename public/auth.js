// ---- AUTH ----

async function sendMagicLink() {
  const email = document.getElementById('login-email').value.trim();
  const msg   = document.getElementById('login-msg');
  const btn   = document.getElementById('login-btn');

  if (!email) {
    showLoginMsg('Ingresá tu email', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Enviando...';

  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: 'https://tencafre.github.io/Opsmin/',
    },
  });

  btn.disabled    = false;
  btn.textContent = 'Enviar acceso';

  if (error) {
    showLoginMsg('Error: ' + error.message, 'error');
  } else {
    showLoginMsg(
      '✓ Revisá tu email — el link de acceso ya está en camino',
      'ok'
    );
  }
}

function showLoginMsg(text, type) {
  const msg = document.getElementById('login-msg');
  msg.textContent = text;
  msg.className   = 'login-msg ' + type;
  msg.classList.remove('hidden');
}

async function logout() {
  await db.auth.signOut();
  showScreen('login');
}

// Escuchar cambios de sesión
db.auth.onAuthStateChange((event, session) => {
  if (session) {
    showScreen('app');
    initApp(session);
  } else {
    showScreen('login');
  }
});