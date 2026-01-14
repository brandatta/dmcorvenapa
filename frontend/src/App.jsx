import React, { useMemo, useState } from "react";

const API_BASE = "/api"; // Nginx lo proxy a backend

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

export default function App() {
  const [file, setFile] = useState(null);

  const [previewRows, setPreviewRows] = useState([]);
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
      setPreviewRows(data.preview || []);
      setClientesUnicos(data.clientesUnicos || []);
      setSumaO(Number(data.sumaO || 0));

      setClientesExcluir([]);

      if (data.emptyAfterFilter) {
        setMsg({
          kind: "error",
          text:
            "Luego de eliminar filas sin Sociedad, el archivo quedó vacío. Revisá el archivo de origen.",
        });
      } else {
        if (Number(data.removedSociedad || 0) > 0) {
          setMsg({
            kind: "warn",
            text: `Se eliminaron ${data.removedSociedad} filas sin Sociedad en la primera columna (columna 'a').`,
          });
        }
      }
    } catch (e) {
      setMsg({ kind: "error", text: String(e?.message || e) });
      setPreviewRows([]);
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
    return previewRows?.length ? Object.prototype.hasOwnProperty.call(previewRows[0], "o") : true;
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
        <div className="help">Se lee sin headers y se renombran columnas como a, b, c, ...</div>

        {loadingPreview && <Alert kind="warn">Procesando archivo...</Alert>}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        {previewRows?.length > 0 && (
          <>
            <div style={{ marginTop: 12, fontWeight: 700 }}>
              Vista previa del archivo (ya filtrado sin filas sin Sociedad):
            </div>
            <div style={{ marginTop: 10 }}>
              <DataTable rows={previewRows} />
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="label">Clientes a excluir (columna 'b')</div>
              <select
                multiple
                value={clientesExcluir}
                onChange={(e) => {
                  const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
                  setClientesExcluir(opts);
                }}
              >
                {clientesUnicos.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="help">
                Seleccioná uno o más valores únicos de la columna 'b' para excluirlos de la carga.
              </div>

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
