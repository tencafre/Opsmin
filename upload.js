/import { parseStock }                    from './parser.js';
import { buildVehicleIndex, resolver }   from './resolver.js';
import { corsHeaders }                   from './cors.js';
import { requireAuth }                   from './auth.js';

async function hashBuffer(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function upsertVehicles(vehicles, supabaseUrl, serviceKey) {
  const clean = vehicles.map(v => ({
    chasis:      v.chasis,
    interno:     v.interno     ?? null,
    modelo:      v.modelo,
    version:     v.version     ?? null,
    color:       v.color       ?? null,
    nro_fabrica: v.nro_fabrica ?? null,
    cliente:     v.cliente     ?? null,
    vendedor:    v.vendedor    ?? null,
    dias_stock:  v.dias_stock  ?? 0,
    ubicacion:   v.ubicacion   ?? null,
    estado:      'activo',
  }));

  const BATCH = 20;
  for (let i = 0; i < clean.length; i += BATCH) {
    const lote = clean.slice(i, i + BATCH);
    const res  = await fetch(
      `${supabaseUrl}/rest/v1/vehicles?on_conflict=chasis`,
      {
        method:  'POST',
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type':  'application/json',
          'Prefer':        'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(lote),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Error en upsert lote ${i}-${i+BATCH}: ${err}`);
    }
    console.log(`[upsert] Lote ${i+1}-${Math.min(i+BATCH, clean.length)} OK`);
  }
}

async function detectarBajas(chassisEnCSV, supabaseUrl, serviceKey) {
  // Obtener todos los vehículos activos en la DB
  const res = await fetch(
    `${supabaseUrl}/rest/v1/vehicles?estado=eq.activo&select=id,chasis,interno,modelo`,
    {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    }
  );
  if (!res.ok) return { archivados: 0, alertas: [] };

  const activos      = await res.json();
  const setCSV       = new Set(chassisEnCSV);
  const alertas      = [];
  const aArchivar    = [];

  for (const v of activos) {
    if (setCSV.has(v.chasis)) continue; // sigue en el CSV — ok

    // Desapareció del CSV — verificar si tiene estado entregado
    const resAsn = await fetch(
      `${supabaseUrl}/rest/v1/sector_assignments` +
      `?vehicle_id=eq.${v.id}&activo=eq.true&select=estado_trabajo,entregado_at`,
      {
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );

    const asns        = resAsn.ok ? await resAsn.json() : [];
    const entregado   = asns.some(a => a.estado_trabajo === 'entregado');

    if (entregado) {
      // Baja confirmada — archivar
      aArchivar.push(v.id);
      console.log(`[bajas] Archivando ${v.chasis} (INT ${v.interno}) — entregado + baja CSV`);
    } else {
      // Baja sin confirmar en tablero — generar alerta
      alertas.push({
        vehicle_id: v.id,
        tipo:       'baja_sin_confirmar',
        detalle:    `INT ${v.interno} — ${v.modelo} desapareció del CSV sin estar marcado como entregado`,
      });
      console.log(`[bajas] Alerta baja_sin_confirmar: ${v.chasis} (INT ${v.interno})`);
    }
  }

  // Archivar los confirmados
  if (aArchivar.length > 0) {
    const BATCH = 20;
    for (let i = 0; i < aArchivar.length; i += BATCH) {
      const ids  = aArchivar.slice(i, i + BATCH);
      const inIds = ids.map(id => `"${id}"`).join(',');
      await fetch(
        `${supabaseUrl}/rest/v1/vehicles?id=in.(${inIds})`,
        {
          method:  'PATCH',
          headers: {
            'apikey':        serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ estado: 'archivado' }),
        }
      );
    }
  }

  // Registrar alertas en DB
  if (alertas.length > 0) {
    await fetch(
      `${supabaseUrl}/rest/v1/delivery_alerts`,
      {
        method:  'POST',
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify(alertas),
      }
    );
  }

  return {
    archivados:   aArchivar.length,
    alertas_nuevas: alertas.length,
    alertas,
  };
}

async function verificarEntregadosEnCSV(chassisEnCSV, supabaseUrl, serviceKey) {
  // Buscar vehículos marcados como entregados que SIGUEN en el CSV
  // → alerta "remito_pendiente"
  const res = await fetch(
    `${supabaseUrl}/rest/v1/sector_assignments` +
    `?activo=eq.true&estado_trabajo=eq.entregado&select=vehicle_id,vehicles(id,chasis,interno,modelo)`,
    {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    }
  );

  if (!res.ok) return { alertas: [] };

  const entregados = await res.json();
  const setCSV     = new Set(chassisEnCSV);
  const alertas    = [];

  for (const row of entregados) {
    const v = row.vehicles;
    if (!v) continue;

    if (setCSV.has(v.chasis)) {
      // Marcado entregado pero sigue en el CSV → remito pendiente
      alertas.push({
        vehicle_id: v.id,
        tipo:       'remito_pendiente',
        detalle:    `INT ${v.interno} — ${v.modelo} marcado como entregado pero sigue en el stock del DMS. Verificar emisión del remito.`,
      });
      console.log(`[alertas] remito_pendiente: INT ${v.interno} — ${v.chasis}`);
    }
  }

  // Registrar alertas nuevas (evitar duplicados del mismo día)
  for (const alerta of alertas) {
    const hoy = new Date().toISOString().slice(0, 10);

    // Verificar si ya existe alerta activa del mismo tipo para este vehículo hoy
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/delivery_alerts` +
      `?vehicle_id=eq.${alerta.vehicle_id}` +
      `&tipo=eq.remito_pendiente` +
      `&estado=eq.activa` +
      `&created_at=gte.${hoy}T00:00:00Z` +
      `&select=id`,
      {
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );
    const existing = checkRes.ok ? await checkRes.json() : [];
    if (existing.length === 0) {
      await fetch(
        `${supabaseUrl}/rest/v1/delivery_alerts`,
        {
          method:  'POST',
          headers: {
            'apikey':        serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type':  'application/json',
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify(alerta),
        }
      );
    }
  }

  return { alertas };
}

export async function handleUpload(request, env) {
  const origin  = request.headers.get('Origin') ?? '';
  const headers = corsHeaders(origin);

  const { user, error: authError } = await requireAuth(request, env);
  if (authError) return authError;

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return Response.json(
      { ok: false, error: 'Se esperaba multipart/form-data' },
      { status: 415, headers }
    );
  }

  const formData = await request.formData();
  const file     = formData.get('file');

  if (!file) {
    return Response.json(
      { ok: false, error: 'No se recibió ningún archivo' },
      { status: 400, headers }
    );
  }

  if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
    return Response.json(
      { ok: false, error: 'Solo se aceptan archivos Excel o CSV' },
      { status: 415, headers }
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    return Response.json(
      { ok: false, error: 'El archivo supera el límite de 10 MB' },
      { status: 413, headers }
    );
  }

  try {
    const buffer   = await file.arrayBuffer();
    const fileHash = await hashBuffer(buffer);

    const { vehicles, skipped, total } = parseStock(new Uint8Array(buffer));

    if (!vehicles.length) {
      return Response.json(
        { ok: false, error: 'No se encontraron vehículos válidos' },
        { status: 422, headers }
      );
    }

    // Cargar índice
    const index = await buildVehicleIndex(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Clasificar nuevos vs existentes
    const nuevos    = [];
    const sinMatch  = [];

    for (const v of vehicles) {
      const sufijo8          = v.chasis.slice(-8);
      const { vehicle, metodo } = resolver(sufijo8, v.interno, index);
      if (!vehicle || metodo === 'sin_match') {
        nuevos.push(v);
      } else if (metodo === 'interno_fallback') {
        sinMatch.push({
          chasis_archivo: v.chasis,
          interno:        v.interno,
          motivo:         'chasis no coincide con stock',
        });
      }
    }

    // Upsert de todos los vehículos del CSV
    await upsertVehicles(vehicles, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Detectar bajas — vehículos que desaparecieron del CSV
    const chassisEnCSV = vehicles.map(v => v.chasis);
    const [bajasRes, alertasEntregaRes] = await Promise.all([
      detectarBajas(chassisEnCSV, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
      verificarEntregadosEnCSV(chassisEnCSV, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
    ]);

    return Response.json({
      ok:                  true,
      archivo_hash:        fileHash,
      total_filas:         total,
      vehiculos_validos:   vehicles.length,
      filas_ignoradas:     skipped.length,
      vehiculos_nuevos:    nuevos.length,
      actualizados:        vehicles.length - nuevos.length,
      archivados:          bajasRes.archivados,
      alertas_baja:        bajasRes.alertas_nuevas,
      alertas_remito:      alertasEntregaRes.alertas.length,
      advertencias:        sinMatch,
    }, { headers });

  } catch (err) {
    console.error('[upload] Error:', err.message);
    return Response.json(
      { ok: false, error: err.message },
      { status: 500, headers }
    );
  }
}