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
  // NO incluir estado en el upsert — no queremos reactivar archivados
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
    // estado NO va aquí
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

  // 1 query — todos los vehículos activos
  const resV = await fetch(
    `${supabaseUrl}/rest/v1/vehicles?estado=eq.activo&select=id,chasis,interno,modelo`,
    { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
  );
  if (!resV.ok) {
    console.error('[bajas] Error obteniendo vehículos:', await resV.text());
    return { archivados: 0, alertas_nuevas: 0, alertas: [] };
  }
  const activos = await resV.json();
  console.log(`[bajas] Vehículos activos en DB: ${activos.length}`);

  // 1 query — todas las asignaciones activas
  const resA = await fetch(
    `${supabaseUrl}/rest/v1/sector_assignments?activo=eq.true&select=vehicle_id,estado_trabajo,entregado_at`,
    { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
  );
  if (!resA.ok) {
    console.error('[bajas] Error obteniendo asignaciones:', await resA.text());
    return { archivados: 0, alertas_nuevas: 0, alertas: [] };
  }
  const asignaciones = await resA.json();

  // Índice en memoria: vehicleId → asignación
  const asnByVehicle = new Map(asignaciones.map(a => [a.vehicle_id, a]));

  const setCSV    = new Set(chassisEnCSV);
  const alertas   = [];
  const aArchivar = [];

  for (const v of activos) {
    if (setCSV.has(v.chasis)) continue;

    console.log(`[bajas] Fuera del CSV: INT ${v.interno} — ${v.chasis}`);

    const asn       = asnByVehicle.get(v.id);
    const entregado = asn?.estado_trabajo === 'entregado';

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

  // Archivar en lotes
  const BATCH = 20;
  for (let i = 0; i < aArchivar.length; i += BATCH) {
    const ids   = aArchivar.slice(i, i + BATCH);
    const inIds = ids.join(',');
    const r = await fetch(
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
    if (!r.ok) console.error('[bajas] Error archivando lote:', await r.text());
  }

  // Registrar alertas en 1 sola request
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
  return { archivados: aArchivar.length, alertas_nuevas: alertas.length, alertas };
}

async function verificarEntregadosEnCSV(chassisEnCSV, supabaseUrl, serviceKey) {
  console.log('[alertas] Verificando entregados que siguen en CSV...');

  const setCSV = new Set(chassisEnCSV);
  const hoy    = new Date().toISOString().slice(0, 10);

  // 1 query — todas las asignaciones entregadas activas con datos del vehículo
  const res = await fetch(
    `${supabaseUrl}/rest/v1/sector_assignments` +
    `?activo=eq.true&estado_trabajo=eq.entregado` +
    `&select=vehicle_id,vehicles(id,chasis,interno,modelo)`,
    { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
  );

  if (!res.ok) {
    console.error('[alertas] Error:', await res.text());
    return { alertas: [] };
  }

  const entregados = await res.json();
  console.log(`[alertas] Asignaciones entregadas activas: ${entregados.length}`);

  // Filtrar los que siguen en el CSV
  const aSinRemito = entregados.filter(row => {
    const v = row.vehicles;
    return v && setCSV.has(v.chasis);
  });

  console.log(`[alertas] Entregados que siguen en CSV: ${aSinRemito.length}`);

  if (!aSinRemito.length) return { alertas: [] };

  // 1 query — alertas remito_pendiente activas de hoy para estos vehículos
  const vehicleIds = aSinRemito.map(r => r.vehicles.id).join(',');
  const resCheck   = await fetch(
    `${supabaseUrl}/rest/v1/delivery_alerts` +
    `?vehicle_id=in.(${vehicleIds})` +
    `&tipo=eq.remito_pendiente` +
    `&estado=eq.activa` +
    `&created_at=gte.${hoy}T00:00:00Z` +
    `&select=vehicle_id`,
    { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
  );

  const existentes   = resCheck.ok ? await resCheck.json() : [];
  const yaExiste     = new Set(existentes.map(a => a.vehicle_id));

  // Solo registrar las que no existen hoy
  const nuevasAlertas = aSinRemito
    .filter(row => !yaExiste.has(row.vehicles.id))
    .map(row => ({
      vehicle_id: row.vehicles.id,
      tipo:       'remito_pendiente',
      detalle:    `INT ${row.vehicles.interno} — ${row.vehicles.modelo} marcado como entregado pero sigue en el stock del DMS. Verificar emisión del remito.`,
    }));

  console.log(`[alertas] Nuevas alertas remito a registrar: ${nuevasAlertas.length}`);

  if (nuevasAlertas.length > 0) {
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
        body: JSON.stringify(nuevasAlertas),
      }
    );
    if (!r.ok) console.error('[alertas] Error registrando:', await r.text());
    else console.log(`[alertas] Registradas: ${nuevasAlertas.length}`);
  }

  return { alertas: nuevasAlertas };
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

    const chassisEnCSV = vehicles.map(v => v.chasis);

    // 1. Detectar bajas ANTES del upsert
    const [bajasRes, alertasEntregaRes] = await Promise.all([
      detectarBajas(chassisEnCSV, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
      verificarEntregadosEnCSV(chassisEnCSV, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
    ]);

    // 2. Upsert de vehículos del CSV (sin tocar estado)
    await upsertVehicles(vehicles, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // 3. Clasificar nuevos vs existentes para el resumen
    const index    = await buildVehicleIndex(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const nuevos   = [];
    const sinMatch = [];

    for (const v of vehicles) {
      const sufijo8             = v.chasis.slice(-8);
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

    return Response.json({
      ok:                true,
      archivo_hash:      fileHash,
      total_filas:       total,
      vehiculos_validos: vehicles.length,
      filas_ignoradas:   skipped.length,
      vehiculos_nuevos:  nuevos.length,
      actualizados:      vehicles.length - nuevos.length,
      archivados:        bajasRes.archivados,
      alertas_baja:      bajasRes.alertas_nuevas,
      alertas_remito:    alertasEntregaRes.alertas.length,
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