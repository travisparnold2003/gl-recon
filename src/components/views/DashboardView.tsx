"use client";

import { formatDate, formatMoneyShort, sourceBadgeClass } from "@/lib/format";
import type { DashboardPayload, DataSource, DataSourcePreview, HealthPayload } from "@/types/dashboard";

type PrimaryAction = {
  label: string;
  run: () => Promise<void>;
  disabled: boolean;
};

type DerivedStats = {
  reconciledPct: number;
  totalExceptions: number;
  exceptionValue: number;
  totalPendingReview: number;
};

type Props = {
  dashboard: DashboardPayload;
  health: HealthPayload | null;
  sourcePreview: DataSourcePreview | null;
  sourcePreviewLoading: boolean;
  selectedSource: DataSource | null;
  sourcePrimaryAction: PrimaryAction;
  donutStyle: React.CSSProperties;
  derived: DerivedStats;
  onViewReconciliation: () => void;
};

export function DashboardView({
  dashboard,
  health,
  sourcePreview,
  sourcePreviewLoading,
  selectedSource,
  sourcePrimaryAction,
  donutStyle,
  derived,
  onViewReconciliation
}: Props) {
  const { stats } = dashboard;
  const { reconciledPct, totalExceptions, exceptionValue, totalPendingReview } = derived;

  return (
    <section className="dashboard-layout">
      <article className="panel panel-progress">
        <div className="donut" style={donutStyle}>
          <div className="donut-inner">
            <strong>{reconciledPct}%</strong>
            <span>Reconciled</span>
          </div>
        </div>
        <div>
          <div className="eyebrow">Period Progress</div>
          <h2>{stats.matched} of {stats.totalGl} lines reconciled</h2>
          <p className="muted">
            {stats.proposed} pending review · {stats.pendingGl} still open · {stats.llmProposed || 0} AI-assisted
          </p>
          <ul className="legend-list">
            <li><span className="legend-dot green" /> Matched <strong>{stats.matched}</strong></li>
            <li><span className="legend-dot indigo" /> Proposed <strong>{stats.proposed}</strong></li>
            <li><span className="legend-dot amber" /> Exceptions <strong>{totalExceptions}</strong></li>
          </ul>
        </div>
      </article>

      <article className="panel panel-card">
        <h3>GL Lines</h3>
        <div className="card-value">{stats.totalGl}</div>
        <p>General Ledger records</p>
      </article>
      <article className="panel panel-card">
        <h3>Bank Lines</h3>
        <div className="card-value">{stats.totalBank}</div>
        <p>Bank feed records</p>
      </article>
      <article className="panel panel-card">
        <h3>Journals</h3>
        <div className="card-value">{stats.journals}</div>
        <p>Posted exception journals</p>
      </article>
      <article className="panel panel-card">
        <h3>Exception Value</h3>
        <div className="card-value">{formatMoneyShort(exceptionValue)}</div>
        <p>{totalExceptions} exception items</p>
      </article>

      <article className="panel panel-source-focus">
        <div className="panel-head">
          <div>
            <h3>{sourcePreview?.name || selectedSource?.name || "Select a data source"}</h3>
            <p className="muted">{sourcePreview?.hint || "Select a source to view status and a live preview."}</p>
          </div>
          <div className="panel-source-actions">
            <span className={sourceBadgeClass(sourcePreview?.status || selectedSource?.connection_status || "disconnected")}>
              {sourcePreview?.status || selectedSource?.connection_status || "disconnected"}
            </span>
            <button
              className="btn"
              disabled={sourcePrimaryAction.disabled}
              onClick={() => { void sourcePrimaryAction.run(); }}
            >
              {sourcePrimaryAction.label}
            </button>
          </div>
        </div>

        <div className="source-stats-row">
          <span>Rows: <strong>{sourcePreview?.row_count ?? selectedSource?.row_count ?? 0}</strong></span>
          <span>Mode: <strong>{sourcePreview?.mode || selectedSource?.mode || "-"}</strong></span>
          <span>Location: <strong>{sourcePreview?.location || selectedSource?.location || "-"}</strong></span>
          <span>Last sync: <strong>{formatDate(sourcePreview?.last_sync_at || selectedSource?.last_sync_at || null)}</strong></span>
        </div>

        {sourcePreviewLoading && <p className="muted">Loading source preview...</p>}

        {sourcePreview && sourcePreview.preview_rows.length > 0 && (
          <div className="preview-wrap">
            <table className="table preview-table">
              <thead>
                <tr>{sourcePreview.columns.map((col) => <th key={col}>{col}</th>)}</tr>
              </thead>
              <tbody>
                {sourcePreview.preview_rows.map((row, i) => (
                  <tr key={`${sourcePreview.source_key}-${i}`}>
                    {sourcePreview.columns.map((col) => (
                      <td key={col}>{String(row[col] ?? "-")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sourcePreview && sourcePreview.preview_rows.length === 0 && !sourcePreviewLoading && (
          <p className="muted">No preview rows yet for this source.</p>
        )}
      </article>

      <article className="panel panel-health">
        <h3>Platform Health</h3>
        <div className="health-row">API status <span className="badge badge-green">{health?.status || "loading"}</span></div>
        <div className="health-row">DB backend <span className="badge badge-indigo">{health?.dbBackend || "unknown"}</span></div>
        <div className="health-row">
          Redis
          {health?.redis.configured ? (
            <span className={health.redis.ok ? "badge badge-green" : "badge badge-red"}>
              {health.redis.ok ? "connected" : "error"}
            </span>
          ) : (
            <span className="badge badge-zinc">not configured</span>
          )}
        </div>
      </article>

      <article className="panel panel-engine">
        <div className="panel-head">
          <h3>Matching Engine</h3>
          <button className="btn btn-outline" onClick={onViewReconciliation}>Review proposed</button>
        </div>
        <p className="muted">
          Three-pass matching: exact, near-match, and optional AI proposals.
          Reconciliation only runs when you press Run Engine.
        </p>
        <div className="engine-grid">
          <div className="engine-rule">
            <span className="rule-tag">Pass 1</span>
            <h4>Exact</h4>
            <p>{stats.matched} reconciled at 100% confidence.</p>
          </div>
          <div className="engine-rule">
            <span className="rule-tag">Pass 2</span>
            <h4>Near Match</h4>
            <p>{stats.proposed - (stats.llmProposed || 0)} proposed within date tolerance.</p>
          </div>
          <div className="engine-rule">
            <span className="rule-tag">Pass 3</span>
            <h4>AI Assist</h4>
            <p>{stats.llmProposed || 0} AI-backed proposals pending analyst review.</p>
          </div>
        </div>
      </article>

      <article className="panel panel-card">
        <h3>Pending Review</h3>
        <div className="card-value">{totalPendingReview}</div>
        <p>Items needing analyst action</p>
      </article>
    </section>
  );
}
