export type MatchStatus = "PENDING" | "MATCHED" | "PROPOSED" | "EXCEPTION";

export interface ReconcileResult {
  matched: number;
  proposed: number;
  llmProposed: number;
}

export interface DashboardStats {
  totalGl: number;
  totalBank: number;
  matched: number;
  proposed: number;
  glExceptions: number;
  bankExceptions: number;
  journals: number;
  pendingGl: number;
  pendingBank: number;
}

export interface ProposedPair {
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
}
