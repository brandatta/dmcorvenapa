import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const app = express();

app.use(express.json({ limit: "10mb" }));

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: CORS_ORIGIN }));

const upload = multer({ dest: os.tmpdir() });

// ---------------- Helpers (equivalentes a Streamlit) ----------------
function genColnames(nCols) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const base = alphabet.length;
  const names = [];
  for (let i = 0; i < nCols; i++) {
    let s = "";
    let x = i;
    while (true) {
      s = alphabet[x % base] + s;
      x = Math.floor(x / base) - 1;
      if (x < 0) break;
    }
    names.push(s);
  }
  return names;
}

function toStringTrim(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function uniqueCleanValues(arr) {
  // arr: valores de columna b
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const t = toStringTrim(v);
    if (!t) continue;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  // UI consistente: ordenado
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function parseCsvNoHeader(buffer) {
  // CSV simple: separador coma, comillas dobles
  // Para máxima compatibilidad, hacemos parser “suficiente” para tus CSV de export.
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);

  const rows = [];
  for (const line of lines) {
    const row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        row.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function parseXlsxNoHeader(buffer) {
  const wb = xlsx.read(buffer, { type: "buffer" });
  const firstSheet = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheet];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false }); // sin headers
  return rows.filter((r) => Array.isArray(r) && r.length > 0);
}

function rowsToObjects(rows) {
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cols = genColnames(maxCols);

  const objs = rows.map((r) => {
    const o = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]] = r[i] ?? "";
    return o;
  });

  return { cols, objs };
}

function filterSociedad(objs) {
  const totalOriginal = objs.length;
  const filtered = objs.filter((r) => toStringTrim(r.a) !== "");
  return {
    totalOriginal,
    total: filtered.length,
    removed: totalOriginal - filtered.length,
    rows: filtered,
  };
}

function computeSumaO(rows) {
  // columna o (15th) => key 'o'
  let sum = 0;
  for (const r of rows) {
    const v = toStringTrim(r.o);
    if (!v) continue;
    const n = Number(String(v).replace(",", ".")); // por si viene con coma decimal
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

async function openDb() {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;

  return mysql.createConnection({
    host,
    user,
    password,
    database,
    charset: "utf8mb4",
    multipleStatements: false,
    // Habilita LOCAL INFILE:
    localInfile: true,
  });
}

// ---------------- API ----------------

// 1) Preview: subís archivo, y backend devuelve preview + clientes únicos b + métricas base
app.post("/api/preview", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const ext = (req.file.originalname || "").toLowerCase();
    const buffer = fs.readFileSync(req.file.path);

    let rows;
    if (ext.endsWith(".csv")) rows = parseCsvNoHeader(buffer);
    else if (ext.endsWith(".xlsx")) rows = parseXlsxNoHeader(buffer);
    else return res.status(400).json({ error: "Formato no soportado" });

    const { objs } = rowsToObjects(rows);
    const sociedad = filterSociedad(objs);

    if (sociedad.total === 0) {
      return res.json({
        emptyAfterFilter: true,
        removedSociedad: sociedad.removed,
        preview: [],
        clientesUnicos: [],
        sumaO: 0,
        totalFilas: 0,
      });
    }

    const clientesUnicos = uniqueCleanValues(sociedad.rows.map((r) => r.b));
    const sumaO = computeSumaO(sociedad.rows);

    // Preview (primeras 100 filas)
    const preview = sociedad.rows.slice(0, 100);

    // Limpieza del archivo temporal
    try {
      fs.unlinkSync(req.file.path);
    } catch (_) {}

    return res.json({
      emptyAfterFilter: false,
      removedSociedad: sociedad.removed,
      totalFilas: sociedad.total,
      preview,
      clientesUnicos,
      sumaO,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// 2) Upload + Load: subís archivo + lista de clientes a excluir => hace truncate/load/cleanup
app.post("/api/load", upload.single("file"), async (req, res) => {
  let conn;
  try {
    const clientesExcluir = JSON.parse(req.body?.clientesExcluir || "[]");
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const ext = (req.file.originalname || "").toLowerCase();
    const buffer = fs.readFileSync(req.file.path);

    let rows;
    if (ext.endsWith(".csv")) rows = parseCsvNoHeader(buffer);
    else if (ext.endsWith(".xlsx")) rows = parseXlsxNoHeader(buffer);
    else return res.status(400).json({ error: "Formato no soportado" });

    const { objs, cols } = rowsToObjects(rows);

    // Filtrar sin sociedad
    const sociedad = filterSociedad(objs);

    if (sociedad.total === 0) {
      return res.status(400).json({
        error:
          "Luego de eliminar filas sin Sociedad, el archivo quedó vacío. Revisá el archivo de origen.",
      });
    }

    // Excluir clientes (columna b)
    const excluirSet = new Set((clientesExcluir || []).map((x) => toStringTrim(x)));
    const rowsToLoad = sociedad.rows.filter((r) => {
      const b = toStringTrim(r.b);
      return !(b && excluirSet.has(b));
    });

    if (rowsToLoad.length === 0) {
      return res.status(400).json({
        error: "No hay filas válidas para cargar (quedó vacío luego de filtros/exclusiones).",
      });
    }

    // Generar CSV temporal SIN encabezados en el backend (para LOAD DATA LOCAL INFILE)
    const tmpCsv = path.join(os.tmpdir(), `fbl1n_${Date.now()}.csv`);
    const out = rowsToLoad
      .map((r) =>
        cols
          .map((c) => {
            const v = r[c] ?? "";
            const s = String(v);
            // CSV con comillas dobles + escape de comillas dobles
            const esc = s.replace(/"/g, '""');
            return `"${esc}"`;
          })
          .join(",")
      )
      .join("\n");

    fs.writeFileSync(tmpCsv, out, "utf8");

    // DB ops
    const dbName = process.env.DB_NAME || "corven";
    const table = process.env.DB_TABLE || "crudo_ap";

    conn = await openDb();
    const cur = await conn.createStatement?.() || conn;

    // 1) TRUNCATE
    await conn.execute(`TRUNCATE TABLE \`${dbName}\`.\`${table}\`;`);

    // 2) LOAD DATA LOCAL INFILE
    // mysql2 soporta LOCAL INFILE si localInfile=true y el server lo permite.
    // Nota: el path es del filesystem del contenedor backend.
    const loadSql = `
      LOAD DATA LOCAL INFILE '${tmpCsv.replace(/\\/g, "\\\\")}'
      INTO TABLE \`${dbName}\`.\`${table}\`
      CHARACTER SET utf8mb4
      FIELDS TERMINATED BY ',' ENCLOSED BY '"' ESCAPED BY '"'
      LINES TERMINATED BY '\\n'
    `;
    await conn.query(loadSql);

    // 3) Contar retenidas
    const [retRows] = await conn.query(
      `SELECT COUNT(*) AS c FROM \`${dbName}\`.\`${table}\` WHERE \`FechaDoc\` = '0000-00-00';`
    );
    const retenidas = Number(retRows?.[0]?.c || 0);

    // 4) Delete inconsistentes
    await conn.query(
      `DELETE FROM \`${dbName}\`.\`${table}\` WHERE \`FechaDoc\` = '0000-00-00';`
    );

    // Total final
    const [totRows] = await conn.query(
      `SELECT COUNT(*) AS c FROM \`${dbName}\`.\`${table}\`;`
    );
    const totalFinal = Number(totRows?.[0]?.c || 0);

    // Limpieza temp files
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    try { fs.unlinkSync(tmpCsv); } catch (_) {}

    return res.json({
      ok: true,
      removedSociedad: sociedad.removed,
      totalFinal,
      filasInconsistentes: retenidas,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  } finally {
    try {
      if (conn) await conn.end();
    } catch (_) {}
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(4000, () => {
  console.log("Backend listening on :4000");
});
