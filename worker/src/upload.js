import { parseStock }                    from './parser.js';
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
  console.log(`[bajas] Verificando bajas. Vehículos en CSV: ${chassisEnCSV.length}`);

  const res = await fetch(
    `${supabaseUrl}/rest/v1/vehicles?estado=eq.activo&select=id,chasis,interno,modelo`,
    {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    }
  );

  if (!res.ok) {
    console.error('[bajas] Error obteniendo vehículos activos:', await res.text());
    return { archivados: 0, alertas_nuevas: 0, alertas: [] };
  }

  const activos = await res.json();
  console.log(`[bajas] Vehículos activos en DB: ${activos.length}`);

  const setCSV    = new Set(chassisEnCSV);
  const alertas   = [];
  const aArchivar = [];

  for (const v of activos) {
    if (setCSV.has(v.chasis)) continue;

    console.log(`[bajas] Fuera del CSV: INT ${v.interno} — ${v.chasis}`);

    // Buscar si tiene asignación activa con estado entregado
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

    if (!resAsn.ok) {
      console.error(`[bajas] Error obteniendo asignación para ${v.chasis}`);
      continue;
    }

    const asns      = await resAsn.json();
    const entregado = asns.some(a => a.estado_trabajo === 'entregado');

    console.log(`[bajas] INT ${v.interno} — entregado: ${entregado}, asignaciones: ${JSON.stringify(asns)}`);

    if (entregado) {
      aArchivar.push(v.id);
      console.log(`[bajas] → Archivar: INT ${v.interno}`);
    } else {
      alertas.push({
        vehicle_id: v.id,
        tipo:       'baja_sin_confirmar',
        detalle:    `INT ${v.interno} — ${v.modelo} desapareció del CSV sin estar marcado como entregado`,
      });
      console.log(`[bajas] → Alerta baja_sin_confirmar: INT ${v.interno}`);
    }
  }

  // Archivar confirmados
  for (const id of aArchivar) {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/vehicles?id=eq.${id}`,
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
    if (!r.ok) console.error(`[bajas] Error archivando ${id}:`, await r.text());
    else console.log(`[bajas] Archivado: ${id}`);
  }

  // Registrar alertas
  if (alertas.length > 0) {
    const r = await fetch(
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
    if (!r.ok) console.error('[bajas] Error registrando alertas:', await r.text());
  }

  console.log(`[bajas] Resumen — archivados: ${aArchivar.length}, alertas: ${alertas.length}`);
  return {
    archivados:     aArchivar.length,
    alertas_nuevas: alertas.length,
    alertas,
  };
}

async function verificarEntregadosEnCSV(chassisEnCSV, supabaseUrl, serviceKey) {
  console.log('[alertas] Verificando entregados que siguen en CSV...');

  const setCSV = new Set(chassisEnCSV);

  // Obtener vehículos con estado entregado activo
  const res = await fetch(
    `${supabaseUrl}/rest/v1/sector_assignments` +
    `?activo=eq.true&estado_trabajo=eq.entregado` +
    `&select=vehicle_id,entregado_at`,
    {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    }
  );

  if (!res.ok) {
    console.error('[alertas] Error obteniendo entregados:', await res.text());
    return { alertas: [] };
  }

  const entregados = await res.json();
  console.log(`[alertas] Asignaciones con estado entregado: ${entregados.length}`);

  const alertas = [];

  for (const row of entregados) {
    // Obtener datos del vehículo
    const resV = await fetch(
      `${supabaseUrl}/rest/v1/vehicles?id=eq.${row.vehicle_id}&select=id,chasis,interno,modelo`,
      {
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );

    if (!resV.ok) continue;
    const vArr = await resV.json();
    const v    = vArr[0];
    if (!v) continue;

    console.log(`[alertas] Verificando INT ${v.interno} — chasis: ${v.chasis} — en CSV: ${setCSV.has(v.chasis)}`);

    if (setCSV.has(v.chasis)) {
      // Entregado pero sigue en el CSV → remito pendiente
      // Verificar si ya existe alerta activa hoy
      const hoy      = new Date().toISOString().slice(0, 10);
      const resCheck = await fetch(
        `${supabaseUrl}/rest/v1/delivery_alerts` +
        `?vehicle_id=eq.${v.id}` +
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

      const existing = resCheck.ok ? await resCheck.json() : [];

      if (existing.length === 0) {
        const alerta = {
          vehicle_id: v.id,
          tipo:       'remito_pendiente',
          detalle:    `INT ${v.interno} — ${v.modelo} marcado como entregado pero sigue en el stock del DMS. Verificar emisión del remito.`,
        };

        const rPost = await fetch(
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

        if (!rPost.ok) {
          console.error('[alertas] Error registrando alerta remito:', await rPost.text());
        } else {
          alertas.push(alerta);
          console.log(`[alertas] → remito_pendiente registrado: INT ${v.interno}`);
        }
      } else {
        console.log(`[alertas] → remito_pendiente ya existe para INT ${v.interno}`);
      }
    }
  }

  console.log(`[alertas] Alertas remito generadas: ${alertas.length}`);
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
