import * as XLSX from 'xlsx';

// Normalizar headers antes de comparar
// Maneja mayúsculas, espacios, acentos y non-breaking spaces
function normalizeHeader(h) {
  return String(h)
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/n[°º]/g, 'n°');
}

const COLUMN_MAP = {
  chasis:     ['nº chasis', 'n° chasis', 'chasis', 'vin', 'num chasis', 'nro chasis'],
  interno:    ['interno', 'n° interno', 'num interno', 'int', 'nro interno'],
  modelo:     ['modelo/versión', 'modelo/version', 'modelo', 'versión', 'version'],
  color:      ['color'],
  cliente:    ['cliente'],
  vendedor:   ['vendedor'],
  dias_stock: ['días', 'dias', 'días en stock', 'dias en stock', 'dias stock'],
  ubicacion:  ['ubicación', 'ubicacion'],
  version_col:['versión', 'version', 'modelo/versión'],
};

export function parseStock(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  if (!rows.length) throw new Error('El archivo está vacío');

  // Detectar mapping de columnas
  const headers = Object.keys(rows[0]);
  const normalizedHeaders = headers.map(h => ({
    original:   h,
    normalized: normalizeHeader(h),
  }));

  const mapping = {};
  const missing = [];

  for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
    const found = normalizedHeaders.find(h => aliases.includes(h.normalized));
    if (found) {
      mapping[field] = found.original;
    } else if (['chasis', 'modelo'].includes(field)) {
      missing.push(field);
    }
  }

  if (missing.length) {
    throw new Error(
      `Columnas requeridas no encontradas: ${missing.join(', ')}. ` +
      `Columnas disponibles: ${headers.join(', ')}`
    );
  }

  // Normalizar filas
  const vehicles = [];
  const skipped  = [];

  for (const row of rows) {
    const chasis = row[mapping.chasis]?.toString().trim().toUpperCase();

    // Skip filas sin chasis válido
    if (!chasis || chasis.length < 8) {
      skipped.push({ row, motivo: 'chasis inválido o vacío' });
      continue;
    }

    vehicles.push({
      chasis,
      interno:    mapping.interno    ? parseInt(row[mapping.interno])  || null : null,
      modelo:     row[mapping.modelo]?.toString().trim() ?? 'SIN MODELO',
      color:      row[mapping.color]?.toString().trim()  || null,
      cliente:    row[mapping.cliente]?.toString().trim() || null,
      vendedor:   row[mapping.vendedor]?.toString().trim() || null,
      dias_stock: mapping.dias_stock ? parseInt(row[mapping.dias_stock]) || 0 : 0,
      ubicacion:  row[mapping.ubicacion]?.toString().trim() || null,
    });
  }

  return { vehicles, skipped, total: rows.length };
}