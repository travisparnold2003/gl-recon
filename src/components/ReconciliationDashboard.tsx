"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import { sourceBadgeClass, formatDate } from "@/lib/format";
import { useToast } from "@/components/hooks/useToast";
import { DashboardView } from "@/components/views/DashboardView";
import { ReconciliationView } from "@/components/views/ReconciliationView";
import { JournalsView } from "@/components/views/JournalsView";
import { AuditView } from "@/components/views/AuditView";
import { SettingsModal } from "@/components/SettingsModal";

import type {
  AuditEvent,
  DashboardPayload,
  DataSource,
  DataSourcePreview,
  ExplanationPayload,
  HealthPayload,
  ReconciliationTab,
  ToastItem,
  WorkspaceView
} from "@/types/dashboard";

const SYNCABLE_SOURCE_KEYS = new Set(["google_sheets", "netsuite_mock"]);

const emptyDashboard: DashboardPayload = {
  stats: {
    totalGl: 0, totalBank: 0, matched: 0, proposed: 0, llmProposed: 0,
    glExceptions: 0, bankExceptions: 0, journals: 0, pendingGl: 0, pendingBank: 0
  },
  proposedPairs: [],
  matchedPairs: [],
  glExceptions: [],
  bankExceptions: [],
  journals: []
};

const defaultSettings: Record<string, string> = {
  openrouter_model: "nvidia/llama-3.1-nemotron-70b-instruct:free",
  openrouter_api_key: "",
  google_sheets_spreadsheet_id: "",
  google_sheets_range: "Sheet1!A1:E",
  google_sheets_api_key: "",
  google_sheets_bank_csv_url: ""
};

export function ReconciliationDashboard() {
  const [dashboard, setDashboard] = useState<DashboardPayload>(emptyDashboard);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [sourcePreview, setSourcePreview] = useState<DataSourcePreview | null>(null);
  const [sourcePreviewLoading, setSourcePreviewLoading] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>(defaultSettings);

  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<WorkspaceView>("dashboard");
  const [reconTab, setReconTab] = useState<ReconciliationTab>("proposed");
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");

  const [apiTokenInput, setApiTokenInput] = useState("");
  const [selectedSourceKey, setSelectedSourceKey] = useState("google_sheets");
  const [showSettings, setShowSettings] = useState(false);

  const [reasoningByPair, setReasoningByPair] = useState<Record<string, string>>({});
  const [explanations, setExplanations] = useState<Record<string, ExplanationPayload>>({});
  const [explanationDrafts, setExplanationDrafts] = useState<Record<string, string>>({});
  const [expandedExplanationKey, setExpandedExplanationKey] = useState<string | null>(null);

  const glUploadRef = useRef<HTMLInputElement>(null);
  const bankUploadRef = useRef<HTMLInputElement>(null);

  const { toasts, pushToast } = useToast();
  const apiToken = useMemo(() => apiTokenInput.trim(), [apiTokenInput]);

  const apiFetch = useCallback((input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? {});
    if (apiToken) headers.set("Authorization", `Bearer ${apiToken}`);
    return fetch(input, { ...init, headers });
  }, [apiToken]);

  const loadSourcePreview = useCallback(async (sourceKey: string) => {
    setSourcePreviewLoading(true);
    try {
      const res = await apiFetch(`/api/data-sources/${sourceKey}/preview`);
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error((p as { error?: string }).error || `Preview failed (${res.status})`);
      }
      setSourcePreview(await res.json() as DataSourcePreview);
    } catch (error) {
      setSourcePreview(null);
      pushToast("error", String((error as Error).message || error));
    } finally {
      setSourcePreviewLoading(false);
    }
  }, [apiFetch, pushToast]);

  const loadAll = useCallback(async () => {
    setWorkspaceError("");
    setLoadingWorkspace(true);
    try {
      const [dashRes, healthRes, sourcesRes, auditRes, settingsRes] = await Promise.all([
        apiFetch("/api/dashboard"),
        apiFetch("/api/health"),
        apiFetch("/api/data-sources"),
        apiFetch("/api/audit-trail?limit=80"),
        apiFetch("/api/settings")
      ]);

      if (!dashRes.ok) {
        const p = await dashRes.json().catch(() => ({}));
        throw new Error((p as { error?: string }).error || `Dashboard failed (${dashRes.status})`);
      }

      setDashboard(await dashRes.json() as DashboardPayload);
      if (healthRes.ok) setHealth(await healthRes.json() as HealthPayload);

      if (sourcesRes.ok) {
        const p = await sourcesRes.json() as { sources?: DataSource[] };
        const list = p.sources ?? [];
        setSources(list);
        if (list.length && !list.some((s) => s.source_key === selectedSourceKey)) {
          setSelectedSourceKey(list[0].source_key);
        }
      }
      if (auditRes.ok) {
        const p = await auditRes.json() as { events?: AuditEvent[] };
        setAuditEvents(p.events ?? []);
      }
      if (settingsRes.ok) {
        const p = await settingsRes.json() as Record<string, string>;
        setSettings((prev) => ({ ...prev, ...p }));
      }
    } catch (error) {
      setWorkspaceError(String((error as Error).message || error));
    } finally {
      setLoadingWorkspace(false);
    }
  }, [apiFetch, selectedSourceKey]);

  useEffect(() => {
    const saved = window.localStorage.getItem("gl_recon_api_token");
    if (saved) setApiTokenInput(saved);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    if (selectedSourceKey) void loadSourcePreview(selectedSourceKey);
  }, [loadSourcePreview, selectedSourceKey]);

  const onApiTokenChange = useCallback((value: string) => {
    setApiTokenInput(value);
    const trimmed = value.trim();
    if (trimmed) window.localStorage.setItem("gl_recon_api_token", trimmed);
    else window.localStorage.removeItem("gl_recon_api_token");
  }, []);

  const runAction = useCallback(async (
    label: string,
    action: () => Promise<Response>,
    onSuccess?: () => Promise<void>
  ) => {
    setBusy(true);
    try {
      const res = await action();
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error((p as { error?: string }).error || `${label} failed (${res.status})`);
      }
      if (onSuccess) {
        await onSuccess();
      } else {
        await loadAll();
        if (selectedSourceKey) await loadSourcePreview(selectedSourceKey);
      }
      pushToast("success", `${label} completed`);
    } catch (error) {
      pushToast("error", String((error as Error).message || error));
    } finally {
      setBusy(false);
    }
  }, [loadAll, loadSourcePreview, pushToast, selectedSourceKey]);

  const uploadFile = useCallback(async (kind: "gl" | "bank", file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    await runAction(
      kind === "gl" ? "GL upload" : "Bank upload",
      () => apiFetch(kind === "gl" ? "/api/upload/gl" : "/api/upload/bank", { method: "POST", body: fd })
    );
  }, [apiFetch, runAction]);

  const syncSource = useCallback(async () => {
    const source = sources.find((s) => s.source_key === selectedSourceKey);
    if (!source) return;
    await runAction(`Sync ${source.name}`, () => apiFetch(`/api/data-sources/${source.source_key}/sync`, { method: "POST" }));
  }, [apiFetch, runAction, selectedSourceKey, sources]);

  const saveSettings = useCallback(async () => {
    await runAction("Connector settings", () =>
      apiFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      })
    );
  }, [apiFetch, runAction, settings]);

  const fetchMatchReasoning = useCallback(async (glId: number, bankId: number) => {
    const key = `${glId}:${bankId}`;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/match-reasoning/${glId}/${bankId}`);
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error((p as { error?: string }).error || `Reasoning failed (${res.status})`);
      }
      const p = await res.json() as { found?: boolean; reasoning?: string };
      setReasoningByPair((prev) => ({
        ...prev,
        [key]: p.found ? (p.reasoning || "No reasoning available") : "No reasoning stored for this pair"
      }));
      pushToast("info", "Match reasoning loaded");
    } catch (error) {
      pushToast("error", String((error as Error).message || error));
    } finally {
      setBusy(false);
    }
  }, [apiFetch, pushToast]);

  const openExplanationEditor = useCallback(async (sourceType: "gl" | "bank", id: number, withAI: boolean) => {
    const key = `${sourceType}-${id}`;
    setExpandedExplanationKey(key);
    setBusy(true);
    try {
      if (withAI) {
        const gen = await apiFetch(`/api/explain/exception/${sourceType}/${id}`, { method: "POST" });
        if (!gen.ok) {
          const p = await gen.json().catch(() => ({}));
          throw new Error((p as { error?: string }).error || `AI explain failed (${gen.status})`);
        }
      }
      const res = await apiFetch(`/api/explanation/${sourceType}/${id}`);
      if (!res.ok) throw new Error(`Load explanation failed (${res.status})`);
      const p = await res.json() as {
        found?: boolean; source_type?: "gl" | "bank"; item_id?: number;
        provider?: string; model?: string; formatted?: string; structured?: Record<string, unknown>;
      };
      if (p.found) {
        const entry: ExplanationPayload = {
          source_type: p.source_type || sourceType,
          item_id: p.item_id || id,
          provider: p.provider || "manual",
          model: p.model || "",
          formatted: p.formatted || "",
          structured: p.structured || {}
        };
        setExplanations((prev) => ({ ...prev, [key]: entry }));
        setExplanationDrafts((prev) => ({ ...prev, [key]: entry.formatted }));
      } else {
        setExplanations((prev) => ({
          ...prev,
          [key]: { source_type: sourceType, item_id: id, provider: "manual", model: "", formatted: "", structured: {} }
        }));
        setExplanationDrafts((prev) => ({ ...prev, [key]: prev[key] || "" }));
      }
      pushToast("success", withAI ? "AI explanation generated" : "Explanation panel opened");
      await loadAll();
    } catch (error) {
      pushToast("error", String((error as Error).message || error));
    } finally {
      setBusy(false);
    }
  }, [apiFetch, loadAll, pushToast]);

  const saveExplanation = useCallback(async (sourceType: "gl" | "bank", id: number) => {
    const key = `${sourceType}-${id}`;
    const text = (explanationDrafts[key] || "").trim();
    if (!text) { pushToast("error", "Explanation text is empty"); return; }
    await runAction("Explanation note", () =>
      apiFetch(`/api/explanation/${sourceType}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      })
    );
  }, [apiFetch, explanationDrafts, pushToast, runAction]);

  const approveAllProposed = useCallback(async () => {
    if (!dashboard.proposedPairs.length) return;
    setBusy(true);
    try {
      const settled = await Promise.allSettled(
        dashboard.proposedPairs.map((pair) =>
          apiFetch(`/api/approve/${pair.glId}/${pair.bankId}`, { method: "POST" })
        )
      );
      let approved = 0;
      let failed = 0;
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value.ok) approved += 1;
        else failed += 1;
      }
      await loadAll();
      if (selectedSourceKey) await loadSourcePreview(selectedSourceKey);
      if (failed > 0) pushToast("error", `Approved ${approved}, failed ${failed}`);
      else pushToast("success", `Approved ${approved} proposed matches`);
    } catch (error) {
      pushToast("error", String((error as Error).message || error));
    } finally {
      setBusy(false);
    }
  }, [apiFetch, dashboard.proposedPairs, loadAll, loadSourcePreview, pushToast, selectedSourceKey]);

  const exportCsv = useCallback(async () => {
    setBusy(true);
    try {
      const res = await apiFetch("/api/export/journals");
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error((p as { error?: string }).error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "journal_entries.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      pushToast("success", "Journal CSV exported");
    } catch (error) {
      pushToast("error", String((error as Error).message || error));
    } finally {
      setBusy(false);
    }
  }, [apiFetch, pushToast]);

  const handleSourceSelect = useCallback((sourceKey: string) => {
    setSelectedSourceKey(sourceKey);
    setView("dashboard");
  }, []);

  const selectedSource = sources.find((s) => s.source_key === selectedSourceKey) ?? null;
  const selectedSourceSyncable = selectedSource ? SYNCABLE_SOURCE_KEYS.has(selectedSource.source_key) : false;

  const totalExceptions = dashboard.stats.glExceptions + dashboard.stats.bankExceptions;
  const totalPendingReview = dashboard.stats.proposed + totalExceptions;
  const reconciledPct = dashboard.stats.totalGl > 0
    ? Math.round((dashboard.stats.matched / dashboard.stats.totalGl) * 100) : 0;

  const matchedPct = dashboard.stats.totalGl > 0 ? (dashboard.stats.matched / dashboard.stats.totalGl) * 100 : 0;
  const proposedPct = dashboard.stats.totalGl > 0 ? (dashboard.stats.proposed / dashboard.stats.totalGl) * 100 : 0;
  const exceptionPct = dashboard.stats.totalGl > 0 ? (totalExceptions / dashboard.stats.totalGl) * 100 : 0;

  const donutStyle = {
    background: `conic-gradient(
      var(--green-500) 0deg ${(matchedPct * 3.6).toFixed(2)}deg,
      var(--indigo-500) ${(matchedPct * 3.6).toFixed(2)}deg ${((matchedPct + proposedPct) * 3.6).toFixed(2)}deg,
      var(--amber-500) ${((matchedPct + proposedPct) * 3.6).toFixed(2)}deg ${((matchedPct + proposedPct + exceptionPct) * 3.6).toFixed(2)}deg,
      var(--surface-3) ${((matchedPct + proposedPct + exceptionPct) * 3.6).toFixed(2)}deg 360deg
    )`
  } as const;

  const exceptionValue = useMemo(
    () =>
      dashboard.glExceptions.reduce((sum, item) => sum + Math.abs(item.amount), 0) +
      dashboard.bankExceptions.reduce((sum, item) => sum + Math.abs(item.amount), 0),
    [dashboard.bankExceptions, dashboard.glExceptions]
  );

  const sourcePrimaryAction = useMemo(() => {
    if (!selectedSource) return { label: "No source selected", run: () => Promise.resolve(), disabled: true };
    if (selectedSource.source_key === "erp_system") {
      return { label: "Upload GL CSV", run: () => Promise.resolve(glUploadRef.current?.click()), disabled: busy };
    }
    if (selectedSource.source_key === "bank_feed") {
      return { label: "Upload Bank CSV", run: () => Promise.resolve(bankUploadRef.current?.click()), disabled: busy };
    }
    return {
      label: selectedSourceSyncable ? "Connect & Sync" : "Not syncable",
      run: () => syncSource(),
      disabled: busy || !selectedSourceSyncable
    };
  }, [busy, selectedSource, selectedSourceSyncable, syncSource]);

  const viewTitle = view === "dashboard" ? "Dashboard"
    : view === "reconciliation" ? "Reconciliation"
    : view === "journals" ? "Journals"
    : "Audit Trail";

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="brand">
          <Image src="/logo-mark.svg" alt="GL Recon" className="brand-logo-img" width={40} height={40} />
          <div>
            <div className="brand-title">GL Recon</div>
            <div className="brand-subtitle">Reconciliation Workspace</div>
          </div>
        </div>

        <div className="sidebar-section-title">Workspace</div>
        <button className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => setView("dashboard")}>Dashboard</button>
        <button className={`nav-item ${view === "reconciliation" ? "active" : ""}`} onClick={() => setView("reconciliation")}>
          Reconciliation <span className="nav-badge">{totalPendingReview}</span>
        </button>
        <button className={`nav-item ${view === "journals" ? "active" : ""}`} onClick={() => setView("journals")}>
          Journals <span className="nav-badge">{dashboard.stats.journals}</span>
        </button>
        <button className={`nav-item ${view === "audit" ? "active" : ""}`} onClick={() => setView("audit")}>
          Audit Trail <span className="nav-badge">{auditEvents.length}</span>
        </button>

        <div className="sidebar-section-title">Data Sources</div>
        <button className="btn btn-sidebar-primary" disabled={busy} onClick={() => setShowSettings(true)}>
          Connector Settings
        </button>
        <div className="source-list">
          {sources.map((source) => (
            <button
              key={source.source_key}
              className={`source-item ${selectedSourceKey === source.source_key ? "active" : ""}`}
              onClick={() => handleSourceSelect(source.source_key)}
            >
              <div className="source-headline">
                <span className="source-name">{source.name}</span>
                <span className={sourceBadgeClass(source.connection_status)}>{source.connection_status}</span>
              </div>
              <div className="source-meta-row">
                <span>{source.mode || "manual"}</span>
                <span>{source.last_sync_at ? formatDate(source.last_sync_at) : "Never synced"}</span>
              </div>
            </button>
          ))}
        </div>

        <input ref={glUploadRef} type="file" accept=".csv,text/csv" className="hidden-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { void uploadFile("gl", f); e.currentTarget.value = ""; } }} />
        <input ref={bankUploadRef} type="file" accept=".csv,text/csv" className="hidden-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { void uploadFile("bank", f); e.currentTarget.value = ""; } }} />
      </aside>

      <main className="workspace-main">
        <header className="main-header">
          <div>
            <div className="eyebrow">Workspace</div>
            <h1>{viewTitle}</h1>
          </div>
          <div className="header-controls">
            <div className="month-pill">{new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
            <button className="btn btn-outline" disabled={busy} onClick={() => setShowSettings(true)}>Connector Settings</button>
            <button className="btn" disabled={busy} onClick={() => void runAction("Reset", () => apiFetch("/api/reset", { method: "POST" }))}>Reset</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void runAction("Run engine", () => apiFetch("/api/reconcile", { method: "POST" }))}>Run Engine</button>
          </div>
        </header>

        {workspaceError && <div className="inline-alert">{workspaceError}</div>}
        {loadingWorkspace && <div className="inline-note">Loading workspace data...</div>}

        {view === "dashboard" && (
          <DashboardView
            dashboard={dashboard}
            health={health}
            sourcePreview={sourcePreview}
            sourcePreviewLoading={sourcePreviewLoading}
            selectedSource={selectedSource}
            sourcePrimaryAction={sourcePrimaryAction}
            donutStyle={donutStyle}
            derived={{ reconciledPct, totalExceptions, exceptionValue, totalPendingReview }}
            onViewReconciliation={() => setView("reconciliation")}
          />
        )}

        {view === "reconciliation" && (
          <ReconciliationView
            dashboard={dashboard}
            busy={busy}
            reconTab={reconTab}
            setReconTab={setReconTab}
            reasoningByPair={reasoningByPair}
            explanations={explanations}
            explanationDrafts={explanationDrafts}
            setExplanationDrafts={setExplanationDrafts}
            expandedExplanationKey={expandedExplanationKey}
            actions={{
              onApprove: (glId, bankId) => runAction("Approve", () => apiFetch(`/api/approve/${glId}/${bankId}`, { method: "POST" })),
              onReject: (glId, bankId) => runAction("Reject", () => apiFetch(`/api/reject/${glId}/${bankId}`, { method: "POST" })),
              onApproveAll: approveAllProposed,
              onPostGlJournal: (id) => runAction("Post journal", () => apiFetch(`/api/journal/gl/${id}`, { method: "POST" })),
              onPostBankJournal: (id) => runAction("Post journal", () => apiFetch(`/api/journal/bank/${id}`, { method: "POST" })),
              onFetchReasoning: fetchMatchReasoning,
              onOpenExplanation: openExplanationEditor,
              onSaveExplanation: saveExplanation
            }}
          />
        )}

        {view === "journals" && (
          <JournalsView
            journals={dashboard.journals}
            busy={busy}
            onExport={exportCsv}
          />
        )}

        {view === "audit" && (
          <AuditView auditEvents={auditEvents} />
        )}
      </main>

      {showSettings && (
        <SettingsModal
          settings={settings}
          setSettings={setSettings}
          apiTokenInput={apiTokenInput}
          onApiTokenChange={onApiTokenChange}
          busy={busy}
          selectedSourceSyncable={selectedSourceSyncable}
          onSave={() => void saveSettings()}
          onSync={() => void syncSource()}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast: ToastItem) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>{toast.message}</div>
        ))}
      </div>
    </div>
  );
}
