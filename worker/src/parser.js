import * as XLSX from 'xlsx';

/**
 * El CSV de Cerrito Car tiene un formato especial:
 * Cada fila repite los encabezados como texto fijo en las primeras columnas,
 * seguido de los datos reales a partir de la columna 20.
 *
 * Estructura fija por fila (índices 0-based):
 * 0:  "Cerrito Car S.A"
 * 1:  "Subsistema Stock"
 * 2:  "Stock de Unidades Nuevas"
 * 3:  " "
 * 4:  " "
 * 5:  ""
 * 6:  "Interno"        → label
 * 7:  "Modelo / Versión" → label
 * 8:  "Nº Chasis"      → label
 * 9:  "Nº Motor"       → label
 * 10: "Color"          → label
 * 11: "Color"          → label (duplicado)
 * 12: "Cliente"        → label
 * 13: "Vendedor"       → label
 * 14: "Días"           → label
 * 15: "Nº Fábrica"     → label (después hay un 00)
 * 16: "Ubicación"      → label
 * 17: "-1"
 * 18: "-1"
 * 19: [INTERNO]        ← datos reales desde aquí
 * 20: [MODELO]
 * 21: [CHASIS]
 * 22: [MOTOR]
 * 23: [COLOR]
 * 24: [NRO_FABRICA]
 * 25: [?]
 * 26: [?]
 * 27: [DIAS]
 * 28: 00
 * 29: [FABRICA_2]
 * 30: [UBICACION]
 */

const COL = {
  INTERNO:   19,
  MODELO:    20,
  CHASIS:    21,
  MOTOR:     22,
  COLOR:     23,
  FABRICA:   24,
  CLIENTE:   25,  // puede variar — verificar con datos reales
  VENDEDOR:  26,
  DIAS:      27,
  UBICACION: 30,
};

export function parseStock(buffer) {
  const workbook = XLSX.read(buffer, {
    type:     'array',
    codepage: 28591,  // latin1 / ISO-8859-1
  });

  const sheetName = workbook.SheetNames[0];
  const sheet     = workbook.Sheets[sheetName];

  // Leer como array de arrays (sin asumir headers)
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,      // devuelve arrays, no objetos
    defval: null,
  });

  console.log(`[parser] Total filas en CSV: ${rows.length}`);
  if (rows.length > 0) {
    console.log('[parser] Primera fila (primeros 35 valores):',
      JSON.stringify(rows[0]?.slice(0, 35)));
  }

  const vehicles = [];
  const skipped  = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 22) {
      skipped.push({ fila: i + 1, motivo: 'fila muy corta' });
      continue;
    }

    // Verificar que es una fila de datos válida
    // La columna 6 debe decir "Interno" (es el label fijo)
    const label6 = row[6]?.toString().trim();
    if (label6 !== 'Interno') {
      skipped.push({ fila: i + 1, motivo: 'no es fila de vehículo' });
      continue;
    }

    const chasis = row[COL.CHASIS]?.toString().trim().toUpperCase();
    if (!chasis || chasis.length < 8) {
      skipped.push({ fila: i + 1, motivo: 'chasis inválido o vacío' });
      continue;
    }

    const interno    = parseInt(row[COL.INTERNO]) || null;
    const modelo     = row[COL.MODELO]?.toString().trim()    || 'SIN MODELO';
    const color      = row[COL.COLOR]?.toString().trim()     || null;
    const fabrica    = row[COL.FABRICA]?.toString().trim()   || null;
    const diasRaw    = row[COL.DIAS];
    const ubicacion  = row[COL.UBICACION]?.toString().trim() || null;

    // Cliente y vendedor — están después del nro fábrica
    // Pueden ser vacíos si no hay cliente asignado
    const cliente   = row[COL.CLIENTE]?.toString().trim()   || null;
    const vendedor  = row[COL.VENDEDOR]?.toString().trim()  || null;

    // Días en stock — puede venir como número o string
    let dias_stock = 0;
    if (diasRaw != null) {
      const parsed = parseInt(diasRaw);
      if (!isNaN(parsed)) dias_stock = parsed;
    }

    vehicles.push({
      chasis,
      interno,
      modelo,
      version:    null,
      color,
      nro_fabrica: fabrica,
      cliente:    cliente === '' ? null : cliente,
      vendedor:   vendedor === '' ? null : vendedor,
      dias_stock,
      ubicacion,
    });
  }

  console.log(
    `[parser] Resultado: ${vehicles.length} vehículos válidos, ` +
    `${skipped.length} filas ignoradas`
  );

  // Log de los primeros 3 vehículos para verificar
  if (vehicles.length > 0) {
    console.log('[parser] Primeros vehículos:', JSON.stringify(vehicles.slice(0, 3)));
  }

  return { vehicles, skipped, total: rows.length };
}