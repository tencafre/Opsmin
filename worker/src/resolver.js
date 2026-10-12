/**
 * Carga el índice completo de vehículos UNA VEZ por ingesta.
 * Una sola query — lookup O(1) sin queries adicionales.
 */
export async function buildVehicleIndex(supabaseUrl, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/vehicles?select=id,chasis,chasis_sufijo8,interno,modelo,estado&estado=eq.activo`,
    {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    }
  );

  if (!res.ok) throw new Error(`Error cargando vehículos: ${res.status}`);

  const data = await res.json();

  const bySufijo  = new Map(
    data
      .filter(v => v.chasis_sufijo8)
      .map(v => [v.chasis_sufijo8.toUpperCase(), v])
  );

  const byInterno = new Map(
    data
      .filter(v => v.interno != null)
      .map(v => [parseInt(v.interno), v])
  );

  console.log(
    `[resolver] Índice: ${data.length} vehículos, ` +
    `${bySufijo.size} por sufijo, ${byInterno.size} por interno`
  );

  return { bySufijo, byInterno };
}

/**
 * Resuelve la identidad de un vehículo. O(1) — sin queries.
 * Prioridad: chasis (fuente fiel) → interno (fallback) → sin_match
 */
export function resolver(sufijo8, interno, { bySufijo, byInterno }) {
  if (sufijo8) {
    const v = bySufijo.get(sufijo8.trim().toUpperCase());
    if (v) return { vehicle: v, metodo: 'chasis' };
  }

  if (interno != null) {
    const v = byInterno.get(parseInt(interno));
    if (v) return { vehicle: v, metodo: 'interno_fallback' };
  }

  return { vehicle: null, metodo: 'sin_match' };
}