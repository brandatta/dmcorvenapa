import React, { useMemo, useState, useRef, useEffect } from "react";

const API_BASE = "/api"; // Nginx lo proxy a backend
const PREVIEW_LIMIT = 20;

function Alert({ kind = "warn", children }) {
  return <div className={`alert ${kind}`}>{children}</div>;
}

function toFixed2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

function DataTable({ rows }) {
  const cols = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx}>
              {cols.map((c) => (
                <td key={c}>{String(r[c] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * MultiSelect estilo Streamlit: dropdown + buscador + checklist (sin Ctrl).
 */
function MultiSelectDropdown({
  label,
  options,
  value,
  onChange,
  placeholder = "Seleccioná uno o más...",
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef(null);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options;
    return options.filter((o) => String(o).toLowerCase().includes(qq));
  }, [q, options]);

  const selectedSet = useMemo(() => new Set(value || []), [value]);

  function toggle(v) {
    const s = new Set(selectedSet);
    if (s.has(v)) s.delete(v);
    else s.add(v);
    onChange(Array.from(s));
  }

  function selectAllFiltered() {
    const s = new Set(selectedSet);
    for (const o of filtered) s.add(o);
    onChange(Array.from(s));
  }

  function clearAll() {
    onChange([]);
  }

  // Cierra al click afuera
  useEffect(() => {
    function onDoc(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="ms-wrap" ref={wrapRef}>
      <div className="label">{label}</div>

      <button
        type="button"
        className="ms-trigger"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
      >
        <span className={value?.length ? "" : "ms-placeholder"}>
          {value?.length ? `${value.length} seleccionado(s)` : placeholder}
        </span>
        <span className="ms-caret">▾</span>
      </button>

      {open && (
        <div className="ms-popover">
          <div className="ms-search">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar..."
            />
          </div>

          <div className="ms-actions">
            <button type="button" className="ms-mini" onClick={selectAllFiltered}>
              Seleccionar visibles
            </button>
            <button type="button" className="ms-mini danger" onClick={clearAll}>
              Limpiar
            </button>
          </div>

          <div className="ms-list">
            {filtered.length === 0 ? (
              <div className="ms-empty">Sin resultados</div>
            ) : (
              filtered.map((opt) => {
                const checked = selectedSet.has(opt);
                return (
                  <label key={opt} className="ms-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(opt)}
                    />
                    <span>{opt}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="help">
        Seleccioná uno o más valores únicos de la columna 'b' para excluirlos de la carga.
      </div>
    </div>
  );
}

export default function App() {
  const [file, setFile] = useState(null);

  const [previewRows, setPreviewRows] = useState([]);
  const [previewTotal, setPreviewTotal] = useState(0);

  const [clientesUnicos, setClientesUnicos] = useState([]);
  const [clientesExcluir, setClientesExcluir] = useState([]);

  const [removedSociedad, setRemovedSociedad] = useState(0);
  const [totalFilas, setTotalFilas] = useState(0);
  const [sumaO, setSumaO] = useState(0);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingLoad, setLoadingLoad] = useState(false);

  const [msg, setMsg] = useState(null); // {kind, text}
  const [filasInconsistentes, setFilasInconsistentes] = useState(null);

  const filasExcluir = useMemo(() => {
    if (!clientesExcluir?.length || !previewRows?.length) return 0;
    // cuenta ocurrencias en preview (aprox); la cuenta real la hace backend sobre todo el archivo
    const set = new Set(clientesExcluir);
    let c = 0;
    for (const r of previewRows) {
      const b = String(r.b ?? "").trim();
      if (b && set.has(b)) c++;
    }
    return c;
  }, [clientesExcluir, previewRows]);

  async function doPreview(f) {
    setLoadingPreview(true);
    setMsg(null);
    setFilasInconsistentes(null);

    try {
      const form = new FormData();
      form.append("file", f);

      const res = await fetch(`${API_BASE}/preview`, {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error en preview");

      setRemovedSociedad(Number(data.removedSociedad || 0));
      setTotalFilas(Number(data.totalFilas || 0));

      const fullPreview = data.preview || [];
      setPreviewTotal(fullPreview.length);
      setPreviewRows(fullPreview.slice(0, PREVIEW_LIMIT));

      setClientesUnicos(data.clientesUnicos || []);
      setSumaO(Number(data.sumaO || 0));
      setClientesExcluir([]);

      if (data.emptyAfterFilter) {
        setMsg({
          kind: "error",
          text:
            "Luego de eliminar filas sin Sociedad, el archivo quedó vacío. Revisá el archivo de origen.",
        });
      } else if (Number(data.removedSociedad || 0) > 0) {
        setMsg({
          kind: "warn",
          text: `Se eliminaron ${data.removedSociedad} filas sin Sociedad en la primera columna (columna 'a').`,
        });
      }
    } catch (e) {
      setMsg({ kind: "error", text: String(e?.message || e) });
      setPreviewRows([]);
      setPreviewTotal(0);
      setClientesUnicos([]);
      setTotalFilas(0);
      setSumaO(0);
      setRemovedSociedad(0);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doLoad() {
    if (!file) return;
    setLoadingLoad(true);
    setMsg(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("clientesExcluir", JSON.stringify(clientesExcluir || []));

      const res = await fetch(`${API_BASE}/load`, {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error durante la carga");

      setFilasInconsistentes(Number(data.filasInconsistentes || 0));
      setMsg({
        kind: "success",
        text: `Carga completada. Filas actuales en \`corven\`.\`crudo_ap\`: ${data.totalFinal}.`,
      });
    } catch (e) {
      setMsg({ kind: "error", text: String(e?.message || e) });
    } finally {
      setLoadingLoad(false);
    }
  }

  const hasColO = useMemo(() => {
    // Si el preview trae objeto con key 'o', asumimos que existe
    return previewRows?.length
      ? Object.prototype.hasOwnProperty.call(previewRows[0], "o")
      : true;
  }, [previewRows]);

  return (
    <div className="container">
      <div className="header-container">
        <div className="header-title">Input FBL1N</div>
        <div className="header-logo">
          <img src="/logorelleno.png" alt="logo" />
        </div>
      </div>

      <div className="card">
        <div className="label">Subí tu archivo CSV o XLSX (sin encabezados)</div>
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setFile(f);
            if (f) doPreview(f);
          }}
        />
        <div className="help">Se lee sin encabezados y se renombran columnas como "a", "b, "c", ...</div>

        {loadingPreview && <Alert kind="warn">Procesando archivo...</Alert>}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        {previewRows?.length > 0 && (
          <>
            <div style={{ marginTop: 12, fontWeight: 700 }}>
              Vista previa del archivo (ya filtrado sin filas "sin Sociedad"):
            </div>

            <div className="help" style={{ marginTop: 6 }}>
              Mostrando <b>{previewRows.length}</b> filas.
            </div>

            <div style={{ marginTop: 10 }}>
              <DataTable rows={previewRows} />
            </div>

            <div style={{ marginTop: 14 }}>
              <MultiSelectDropdown
                label={"Clientes a Excluir (columna 'b')"}
                options={clientesUnicos}
                value={clientesExcluir}
                onChange={setClientesExcluir}
              />

              {clientesExcluir?.length > 0 && (
                <Alert kind="warn">
                  Se excluirán {clientesExcluir.length} cliente(s) (sin repetidos en la lista). Filas a excluir (en
                  preview): {filasExcluir}
                </Alert>
              )}
            </div>

            {!hasColO ? (
              <Alert kind="error">
                No se encontró la columna <b>o</b> en el archivo. Revisá que el archivo tenga al menos 15 columnas (… n,
                <b> o</b>, …).
              </Alert>
            ) : (
              <div className="kpi">
                Filas a cargar (con Sociedad y sin excluidos): <b>{totalFilas}</b> &nbsp;|&nbsp; Suma de <b>o</b>:{" "}
                <b>{toFixed2(sumaO)}</b>
              </div>
            )}

            <button className="btn-primary" onClick={doLoad} disabled={loadingLoad}>
              {loadingLoad ? "Cargando..." : "Subir y Actualizar Repositorio"}
            </button>

            {filasInconsistentes !== null && (
              <div>
                <button className="btn-red-info" disabled>
                  Filas retenidas por información inconsistente: {filasInconsistentes}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
