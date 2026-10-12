// Valida el JWT de Supabase en cada request
export async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: new Response('Unauthorized', { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verificar el JWT contra Supabase
    const res = await fetch(
      `${env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': env.SUPABASE_ANON_KEY,
        },
      }
    );

    if (!res.ok) {
      return { error: new Response('Invalid token', { status: 403 }) };
    }

    const user = await res.json();
    return { user };

  } catch {
    return { error: new Response('Auth error', { status: 500 }) };
  }
}