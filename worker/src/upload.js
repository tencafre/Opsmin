import { parseStock } from './parser.js';
import { buildVehicleIndex, resolver } from './resolver.js';
import { corsHeaders } from './cors.js';
import { requireAuth } from './auth.js';

// Hash SHA-256 del archivo para idempotency
async function hashBuffer(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function upsertVehicles(vehicles, supabaseUrl, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/vehicles`,
    {
      method:  'POST',
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(vehicles),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Error en upsert: ${err}`);
  }
}

export async function handleUpload(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const headers = corsHeaders(origin);

  // Validar auth
  const { user, error: authError } = await requireAuth(request, env);
  if (authError) return authError;

  // Validar content-type
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return Response.json(
      { ok: false, error: 'Se esperaba multipart/form-data' },
      { status: 415, headers }
    );
  }

  const formData = await request.formData();
  const file = formData.get('file');

  if (!file) {
    return Response.json(
      { ok: false, error: 'No se recibió ningún archivo' },
      { status: 400, headers }
    );
  }

  // Validar tipo de archivo
  const ALLOWED_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
  ];

  if (!ALLOWED_TYPES.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
    return Response.json(
      { ok: false, error: 'Solo se aceptan archivos Excel o CSV' },
      { status: 415, headers }
    );
  }

  // Validar tamaño (10 MB máximo)
  if (file.size > 10 * 1024 * 1024) {
    return Response.json(
      { ok: false, error: 'El archivo supera el límite de 10 MB' },
      { status: 413, headers }
    );
  }

  try {
    const buffer     = await file.arrayBuffer();
    const fileHash   = await hashBuffer(buffer);

    // Parsear Excel
    const { vehicles, skipped, total } = parseStock(new Uint8Array(buffer));

    if (!vehicles.length) {
      return Response.json(
        { ok: false, error: 'No se encontraron vehículos válidos en el archivo' },
        { status: 422, headers }
      );
    }

    // Cargar índice de vehículos existentes (1 query total)
    const index = await buildVehicleIndex(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Clasificar: nuevos vs existentes
    const nuevos    = [];
    const existentes = [];
    const sinMatch  = [];

    for (const v of vehicles) {
      const sufijo8 = v.chasis.slice(-8);
      const { vehicle, metodo } = resolver(sufijo8, v.interno, index);

      if (metodo === 'sin_match' || !vehicle) {
        nuevos.push(v);
      } else if (metodo === 'interno_fallback') {
        existentes.push(v);
        sinMatch.push({
          chasis_archivo: v.chasis,
          interno:        v.interno,
          motivo:         'chasis no coincide con stock — actualizado por interno',
        });
      } else {
        existentes.push(v);
      }
    }

    // Upsert por chasis (merge-duplicates)
    await upsertVehicles(vehicles, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    return Response.json({
      ok:                true,
      archivo_hash:      fileHash,
      total_filas:       total,
      vehiculos_validos: vehicles.length,
      filas_ignoradas:   skipped.length,
      vehiculos_nuevos:  nuevos.length,
      actualizados:      existentes.length,
      advertencias:      sinMatch,
    }, { headers });

  } catch (err) {
    console.error('[upload] Error:', err.message);
    return Response.json(
      { ok: false, error: err.message },
      { status: 500, headers }
    );
  }
}