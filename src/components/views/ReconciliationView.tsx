"use client";

import { formatDate, formatMoney } from "@/lib/format";
import type {
  DashboardPayload,
  ExplanationPayload,
  ReconciliationTab
} from "@/types/dashboard";

type Actions = {
  onApprove: (glId: number, bankId: number) => Promise<void>;
  onReject: (glId: number, bankId: number) => Promise<void>;
  onApproveAll: () => Promise<void>;
  onPostGlJournal: (id: number) => Promise<void>;
  onPostBankJournal: (id: number) => Promise<void>;
  onFetchReasoning: (glId: number, bankId: number) => Promise<void>;
  onOpenExplanation: (sourceType: "gl" | "bank", id: number, withAI: boolean) => Promise<void>;
  onSaveExplanation: (sourceType: "gl" | "bank", id: number) => Promise<void>;
};

type Props = {
  dashboard: DashboardPayload;
  busy: boolean;
  reconTab: ReconciliationTab;
  setReconTab: (tab: ReconciliationTab) => void;
  reasoningByPair: Record<string, string>;
  explanations: Record<string, ExplanationPayload>;
  explanationDrafts: Record<string, string>;
  setExplanationDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  expandedExplanationKey: string | null;
  actions: Actions;
};

export function ReconciliationView({
  dashboard,
  busy,
  reconTab,
  setReconTab,
  reasoningByPair,
  explanations,
  explanationDrafts,
  setExplanationDrafts,
  expandedExplanationKey,
  actions
}: Props) {
  const { proposedPairs, glExceptions, bankExceptions, matchedPairs } = dashboard;

  function providerLabel(provider: string | undefined, model: string | undefined): string {
    if (!provider || provider === "manual") return "Manual note";
    if (provider === "rule-fallback") return "Rules-based (no OpenRouter key set)";
    if (provider === "openrouter") return `AI via OpenRouter${model ? ` · ${model}` : ""}`;
    return provider;
  }

  return (
    <section className="panel">
      <div className="tabs">
        <button className={`tab ${reconTab === "proposed" ? "active" : ""}`} onClick={() => setReconTab("proposed")}>
          Proposed ({proposedPairs.length})
        </button>
        <button className={`tab ${reconTab === "gl" ? "active" : ""}`} onClick={() => setReconTab("gl")}>
          GL Exceptions ({glExceptions.length})
        </button>
        <button className={`tab ${reconTab === "bank" ? "active" : ""}`} onClick={() => setReconTab("bank")}>
          Bank Exceptions ({bankExceptions.length})
        </button>
        <button className={`tab ${reconTab === "matched" ? "active" : ""}`} onClick={() => setReconTab("matched")}>
          Matched ({matchedPairs.length})
        </button>
      </div>

      <div className="recon-actions">
        <div className="month-pill">{new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
        {reconTab === "proposed" && (
          <button className="btn" disabled={busy || proposedPairs.length === 0} onClick={() => void actions.onApproveAll()}>
            Approve All
          </button>
        )}
      </div>

      {reconTab === "proposed" && (
        <div className="proposed-list">
          {proposedPairs.map((pair) => {
            const key = `${pair.glId}:${pair.bankId}`;
            return (
              <article className="proposed-card" key={key}>
                <div className="proposed-head">
                  <div className="proposed-score">
                    <span className="badge badge-zinc">Proposed</span>
                    <div className="confidence-track">
                      <span style={{ width: `${Math.max(8, Math.min(100, pair.confidence))}%` }} />
                    </div>
                    <strong>{pair.confidence}% confidence</strong>
                    <span className="muted">{pair.dateDiff}d date gap</span>
                  </div>
                  <div className="table-actions">
                    <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void actions.onFetchReasoning(pair.glId, pair.bankId)}>
                      Why this match?
                    </button>
                    <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void actions.onReject(pair.glId, pair.bankId)}>
                      Reject
                    </button>
                    <button className="btn btn-sm" disabled={busy} onClick={() => void actions.onApprove(pair.glId, pair.bankId)}>
                      Approve
                    </button>
                  </div>
                </div>
                <div className="proposed-grid">
                  <article className="txn-card">
                    <div className="txn-label">GL Transaction</div>
                    <h4>{pair.glDesc}</h4>
                    <p>{pair.glRef} · {formatDate(pair.glDate)}</p>
                    <strong>{formatMoney(pair.amount)}</strong>
                  </article>
                  <div className="pair-link" aria-hidden="true">⇄</div>
                  <article className="txn-card">
                    <div className="txn-label">Bank Statement</div>
                    <h4>{pair.bankDesc}</h4>
                    <p>{pair.bankRef} · {formatDate(pair.bankDate)}</p>
                    <strong>{formatMoney(pair.amount)}</strong>
                  </article>
                </div>
                {reasoningByPair[key] && <p className="reasoning">{reasoningByPair[key]}</p>}
              </article>
            );
          })}
          {proposedPairs.length === 0 && <p className="muted">No proposed matches.</p>}
        </div>
      )}

      {reconTab === "gl" && (
        <table className="table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Description</th>
              <th>Account</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {glExceptions.map((item) => {
              const key = `gl-${item.id}`;
              const explanation = explanations[key];
              const expanded = expandedExplanationKey === key;
              return (
                <tr key={item.id}>
                  <td>{item.ref}</td>
                  <td>
                    <strong>{item.description}</strong>
                    <div className="muted">{item.reference || "No reference"}</div>
                  </td>
                  <td>{item.account || "-"}</td>
                  <td>{formatDate(item.date)}</td>
                  <td>{formatMoney(item.amount)}</td>
                  <td><span className="badge badge-amber">Exception</span></td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void actions.onOpenExplanation("gl", item.id, false)}>Notes</button>
                      <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void actions.onOpenExplanation("gl", item.id, true)}>Use AI</button>
                      <button className="btn btn-sm" disabled={busy} onClick={() => void actions.onPostGlJournal(item.id)}>Post Journal</button>
                    </div>
                    {expanded && (
                      <div className="explanation-box compact">
                        <div className="explanation-meta">
                          {providerLabel(explanation?.provider, explanation?.model)}
                        </div>
                        <textarea
                          value={explanationDrafts[key] || ""}
                          onChange={(e) => setExplanationDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                          rows={6}
                        />
                        <div className="table-actions">
                          <button className="btn btn-sm" disabled={busy} onClick={() => void actions.onSaveExplanation("gl", item.id)}>Save Note</button>
                          <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void actions.onOpenExplanation("gl", item.id, true)}>Regenerate AI</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {glExceptions.length === 0 && <tr><td colSpan={7}>No GL exceptions.</td></tr>}
          </tbody>
        </table>
      )}

      {reconTab === "bank" && (
        <table className="table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Description</th>
              <th>Source</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {bankExceptions.map((item) => {
              const key = `bank-${item.id}`;
              const explanation = explanations[key];
              const expanded = expandedExplanationKey === key;
              return (
                <tr key={item.id}>
                  <td>{item.ref}</td>
                  <td><strong>{item.description}</strong></td>
                  <td>Bank feed</td>
                  <td>{formatDate(item.date)}</td>
                  <td>{formatMoney(item.amount)}</td>
                  <td><span className="badge badge-amber">Exception</span></td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void actions.onOpenExplanation("bank", item.id, false)}>Notes</button>
                      <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void actions.onOpenExplanation("bank", item.id, true)}>Use AI</button>
                      <button className="btn btn-sm" disabled={busy} onClick={() => void actions.onPostBankJournal(item.id)}>Post Journal</button>
                    </div>
                    {expanded && (
                      <div className="explanation-box compact">
                        <div className="explanation-meta">
                          {providerLabel(explanation?.provider, explanation?.model)}
                        </div>
                        <textarea
                          value={explanationDrafts[key] || ""}
                          onChange={(e) => setExplanationDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                          rows={6}
                        />
                        <div className="table-actions">
                          <button className="btn btn-sm" disabled={busy} onClick={() => void actions.onSaveExplanation("bank", item.id)}>Save Note</button>
                          <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void actions.onOpenExplanation("bank", item.id, true)}>Regenerate AI</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {bankExceptions.length === 0 && <tr><td colSpan={7}>No bank exceptions.</td></tr>}
          </tbody>
        </table>
      )}

      {reconTab === "matched" && (
        <table className="table">
          <thead>
            <tr>
              <th>GL Ref</th>
              <th>Bank Ref</th>
              <th>GL Date</th>
              <th>Bank Date</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {matchedPairs.map((pair, i) => (
              <tr key={`${pair.glRef}-${pair.bankRef}-${i}`}>
                <td>{pair.glRef}</td>
                <td>{pair.bankRef}</td>
                <td>{formatDate(pair.glDate)}</td>
                <td>{formatDate(pair.bankDate)}</td>
                <td>{formatMoney(pair.amount)}</td>
                <td><span className="badge badge-green">Reconciled</span></td>
              </tr>
            ))}
            {matchedPairs.length === 0 && <tr><td colSpan={6}>No matched transactions yet.</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}
