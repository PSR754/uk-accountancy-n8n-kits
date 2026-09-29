import { readFileSync } from 'node:fs';

/** Minimal CSV reader: quoted fields, embedded commas, doubled quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** Load a fixture CSV as sheet rows, with row_number as Google Sheets reports it. */
export function loadFixture(path) {
  const rows = parseCSV(readFileSync(path, 'utf8'));
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells, i) => {
    const row = { row_number: i + 2 };
    headers.forEach((h, j) => { row[h] = (cells[j] ?? '').trim(); });
    return row;
  });
}
