export type DashboardStats = {
  totalGl: number;
  totalBank: number;
  matched: number;
  proposed: number;
  llmProposed?: number;
  glExceptions: number;
  bankExceptions: number;
  journals: number;
  pendingGl: number;
  pendingBank: number;
};

export type ProposedPair = {
  glId: number;
  bankId: number;
  glRef: string;
  bankRef: string;
  glDate: string;
  bankDate: string;
  glDesc: string;
  bankDesc: string;
  amount: number;
  dateDiff: number;
  confidence: number;
  passType: string;
  reasoning: string;
};

export type MatchedPair = {
  glRef: string;
  bankRef: string;
  glDate: string;
  bankDate: string;
  glDesc: string;
  bankDesc: string;
  amount: number;
};

export type GlException = {
  id: number;
  ref: string;
  date: string;
  description: string;
  amount: number;
  account?: string;
  reference?: string;
};

export type BankException = {
  id: number;
  ref: string;
  date: string;
  description: string;
  amount: number;
};

export type Journal = {
  id: number;
  date: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  reference: string;
};

export type DashboardPayload = {
  stats: DashboardStats;
  proposedPairs: ProposedPair[];
  matchedPairs: MatchedPair[];
  glExceptions: GlException[];
  bankExceptions: BankException[];
  journals: Journal[];
};

export type HealthPayload = {
  status: string;
  dbBackend: string;
  redis: {
    configured: boolean;
    ok: boolean;
    error?: string;
  };
  glCount: number;
  bankCount: number;
};

export type DataSource = {
  source_key: string;
  name: string;
  source_type: string;
  connection_status: string;
  last_sync_at: string | null;
  row_count: number;
  location: string;
  mode: string;
};

export type DataSourcePreview = {
  source_key: string;
  name: string;
  status: string;
  mode: string;
  location: string;
  row_count: number;
  last_sync_at: string | null;
  hint: string;
  columns: string[];
  preview_rows: Array<Record<string, unknown>>;
};

export type AuditEvent = {
  id: number;
  event_type: string;
  actor: string;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type ExplanationPayload = {
  source_type: "gl" | "bank";
  item_id: number;
  provider: string;
  model: string;
  formatted: string;
  structured: Record<string, unknown>;
};

export type ToastItem = {
  id: number;
  type: "success" | "error" | "info";
  message: string;
};

export type WorkspaceView = "dashboard" | "reconciliation" | "journals" | "audit";
export type ReconciliationTab = "proposed" | "gl" | "bank" | "matched";
