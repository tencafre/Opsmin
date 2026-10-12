import { handleUpload }  from './upload.js';
import { handleOptions, corsHeaders } from './cors.js';

export default {
  // Requests HTTP
  async fetch(request, env) {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Health check — sin auth
    if (url.pathname === '/health') {
      return Response.json(
        { ok: true, service: 'opsmin-upload', ts: Date.now() },
        { headers: corsHeaders(origin) }
      );
    }

    // Upload de Excel
    if (url.pathname === '/upload' && request.method === 'POST') {
      return handleUpload(request, env);
    }

    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: corsHeaders(origin) }
    );
  },

  // Cron — keepalive anti-pausa Supabase Free
  async scheduled(event, env) {
    if (event.cron === '0 12 */3 * *') {
      try {
        const res = await fetch(
          `${env.SUPABASE_URL}/rest/v1/sectors?select=id&limit=1`,
          {
            headers: {
              'apikey':        env.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
            },
          }
        );
        console.log(`[keepalive] ${new Date().toISOString()} — status: ${res.status}`);
      } catch (err) {
        console.error('[keepalive] Error:', err.message);
      }
    }
  },
};