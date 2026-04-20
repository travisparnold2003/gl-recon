import { MatchStatus, PrismaClient } from "@prisma/client";
import { extractJsonObject, isOpenRouterEnabled, openRouterChat } from "@/server/lib/openrouter";
import type { ReconcileResult } from "@/types/reconciliation";

type EngineOptions = {
  openRouterApiKey?: string;
  openRouterModel?: string;
};

interface WorkingGL {
  id: number;
  transactionId: string;
  date: Date;
  description: string;
  netAmount: number;
  status: MatchStatus;
  matchedBankRef: string | null;
}

interface WorkingBank {
  id: number;
  bankRef: string;
  date: Date;
  description: string;
  amount: number;
  status: MatchStatus;
  matchedGlRef: string | null;
}

function amountKey(amount: number): string {
  return Math.abs(amount).toFixed(2);
}

function descriptionOverlapScore(a: string, b: string): number {
  const left = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  const right = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  if (!left.size || !right.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(left.size, right.size);
}

function candidateScore(gl: WorkingGL, bank: WorkingBank): number {
  const amountDelta = Math.abs(Math.abs(gl.netAmount) - Math.abs(bank.amount));
  const amountScore = Math.max(0, 1 - amountDelta / Math.max(Math.abs(gl.netAmount), 1));
  const dateGap = Math.abs((bank.date.getTime() - gl.date.getTime()) / 86_400_000);
  const dateScore = Math.max(0, 1 - dateGap / 7);
  const descriptionScore = descriptionOverlapScore(gl.description, bank.description);
  return amountScore * 0.55 + dateScore * 0.25 + descriptionScore * 0.2;
}

export async function runReconciliationEngine(prisma: PrismaClient, options?: EngineOptions): Promise<ReconcileResult> {
  await prisma.$transaction([
    prisma.matchInsight.deleteMany(),
    prisma.gLTransaction.updateMany({
      data: {
        status: MatchStatus.PENDING,
        matchedBankRef: null
      }
    }),
    prisma.bankTransaction.updateMany({
      data: {
        status: MatchStatus.PENDING,
        matchedGlRef: null
      }
    })
  ]);

  const [glRows, bankRows] = await Promise.all([
    prisma.gLTransaction.findMany({ orderBy: { id: "asc" } }),
    prisma.bankTransaction.findMany({ orderBy: { id: "asc" } })
  ]);

  const gl: WorkingGL[] = glRows.map((row) => ({
    id: row.id,
    transactionId: row.transactionId,
    date: row.date,
    description: row.description,
    netAmount: Number(row.netAmount),
    status: MatchStatus.PENDING,
    matchedBankRef: null
  }));

  const bank: WorkingBank[] = bankRows.map((row) => ({
    id: row.id,
    bankRef: row.bankRef,
    date: row.date,
    description: row.description,
    amount: Number(row.amount),
    status: MatchStatus.PENDING,
    matchedGlRef: null
  }));

  const bankByAmount = new Map<string, WorkingBank[]>();
  for (const btx of bank) {
    const key = amountKey(btx.amount);
    const list = bankByAmount.get(key) ?? [];
    list.push(btx);
    bankByAmount.set(key, list);
  }

  const insights: Array<{ glId: number; bankId: number; passType: string; confidence: number; reasoning: string }> = [];

  let matched = 0;
  let proposed = 0;
  let llmProposed = 0;

  for (const gtx of gl) {
    if (gtx.status !== MatchStatus.PENDING) {
      continue;
    }

    const key = amountKey(gtx.netAmount);
    const candidates = bankByAmount.get(key) ?? [];

    for (const btx of candidates) {
      if (btx.status !== MatchStatus.PENDING) {
        continue;
      }
      if (gtx.date.getTime() !== btx.date.getTime()) {
        continue;
      }

      gtx.status = MatchStatus.MATCHED;
      btx.status = MatchStatus.MATCHED;
      gtx.matchedBankRef = btx.bankRef;
      btx.matchedGlRef = gtx.transactionId;
      matched += 1;

      insights.push({
        glId: gtx.id,
        bankId: btx.id,
        passType: "exact",
        confidence: 100,
        reasoning: `Exact match on amount and date (${gtx.date.toISOString().slice(0, 10)}).`
      });
      break;
    }
  }

  for (const gtx of gl) {
    if (gtx.status !== MatchStatus.PENDING) {
      continue;
    }

    const key = amountKey(gtx.netAmount);
    const candidates = bankByAmount.get(key) ?? [];

    for (const btx of candidates) {
      if (btx.status !== MatchStatus.PENDING) {
        continue;
      }

      const dateGap = Math.abs((btx.date.getTime() - gtx.date.getTime()) / 86_400_000);
      if (dateGap > 3) {
        continue;
      }

      const confidenceByGap: Record<number, number> = { 0: 95, 1: 90, 2: 75, 3: 60 };
      const confidence = confidenceByGap[Math.floor(dateGap)] ?? 55;

      gtx.status = MatchStatus.PROPOSED;
      btx.status = MatchStatus.PROPOSED;
      gtx.matchedBankRef = btx.bankRef;
      btx.matchedGlRef = gtx.transactionId;
      proposed += 1;

      insights.push({
        glId: gtx.id,
        bankId: btx.id,
        passType: "near",
        confidence,
        reasoning: `Near match on amount with ${Math.floor(dateGap)} day(s) date gap.`
      });

      break;
    }
  }

  for (const gtx of gl) {
    if (gtx.status === MatchStatus.PENDING) {
      gtx.status = MatchStatus.EXCEPTION;
    }
  }

  for (const btx of bank) {
    if (btx.status === MatchStatus.PENDING) {
      btx.status = MatchStatus.EXCEPTION;
    }
  }

  const openRouterConfig = {
    apiKey: options?.openRouterApiKey,
    model: options?.openRouterModel
  };

  if (isOpenRouterEnabled(openRouterConfig)) {
    let llmCalls = 0;
    const maxLlmCalls = 6;

    for (const gtx of gl) {
      if (gtx.status !== MatchStatus.EXCEPTION || llmCalls >= maxLlmCalls) {
        continue;
      }

      const candidates = bank
        .filter((btx) => btx.status === MatchStatus.EXCEPTION)
        .map((btx) => ({
          bankId: btx.id,
          bankRef: btx.bankRef,
          date: btx.date.toISOString().slice(0, 10),
          description: btx.description,
          amount: Math.abs(btx.amount),
          score: Number(candidateScore(gtx, btx).toFixed(4))
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (!candidates.length || candidates[0].score < 0.42) {
        continue;
      }

      llmCalls += 1;
      const content = await openRouterChat([
        {
          role: "system",
          content:
            "You are a reconciliation copilot. Return strict JSON only with keys bank_id (integer or null), confidence (0-100), reasoning (short string)."
        },
        {
          role: "user",
          content: JSON.stringify({
            gl_transaction: {
              id: gtx.id,
              transaction_id: gtx.transactionId,
              date: gtx.date.toISOString().slice(0, 10),
              description: gtx.description,
              amount: Math.abs(gtx.netAmount)
            },
            candidates
          })
        }
      ], 320, openRouterConfig);

      if (!content) {
        continue;
      }

      const parsed = extractJsonObject(content);
      const suggestedBankId = Number.parseInt(String(parsed.bank_id ?? ""), 10);
      const confidence = Number.parseInt(String(parsed.confidence ?? "0"), 10);
      const reasoning = String(parsed.reasoning ?? "").trim();

      if (!Number.isSafeInteger(suggestedBankId) || confidence < 55 || confidence > 100) {
        continue;
      }

      const candidate = bank.find((item) => item.id === suggestedBankId && item.status === MatchStatus.EXCEPTION);
      if (!candidate) {
        continue;
      }

      gtx.status = MatchStatus.PROPOSED;
      candidate.status = MatchStatus.PROPOSED;
      gtx.matchedBankRef = candidate.bankRef;
      candidate.matchedGlRef = gtx.transactionId;
      proposed += 1;
      llmProposed += 1;

      insights.push({
        glId: gtx.id,
        bankId: candidate.id,
        passType: "llm",
        confidence,
        reasoning: reasoning || "AI-assisted proposed match for manual review."
      });
    }
  }

  await prisma.$transaction([
    ...gl.map((row) =>
      prisma.gLTransaction.update({
        where: { id: row.id },
        data: {
          status: row.status,
          matchedBankRef: row.matchedBankRef
        }
      })
    ),
    ...bank.map((row) =>
      prisma.bankTransaction.update({
        where: { id: row.id },
        data: {
          status: row.status,
          matchedGlRef: row.matchedGlRef
        }
      })
    ),
    ...insights.map((insight) =>
      prisma.matchInsight.create({
        data: {
          glId: insight.glId,
          bankId: insight.bankId,
          passType: insight.passType,
          confidence: insight.confidence,
          reasoning: insight.reasoning
        }
      })
    )
  ]);

  return {
    matched,
    proposed,
    llmProposed
  };
}
