import { MatchStatus } from "@prisma/client";
import { prisma } from "@/server/lib/db";
import { getRedisClient, redisHealth } from "@/server/lib/redis";
import { runReconciliationEngine } from "@/server/domain/reconcileEngine";
import { loadSampleData } from "@/server/seed/loadSampleData";
import { ensureWorkspaceState, getSettingsPayload } from "@/server/services/workspaceService";

const STALE_STATE_ERROR = "PAIR_STATE_CHANGED";
const DASHBOARD_CACHE_KEY = "gl-recon:dashboard:v1";
const DASHBOARD_CACHE_TTL = 5;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function absNumber(value: number): number {
  return Math.abs(Number(value));
}

async function logEvent(eventType: string, message: string, details: unknown) {
  await prisma.auditEvent.create({
    data: {
      eventType,
      actor: "system",
      message,
      detailsJson: JSON.stringify(details ?? {})
    }
  });
}

async function invalidateDashboardCache(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    if (redis.status === "wait") await redis.connect();
    await redis.del(DASHBOARD_CACHE_KEY);
  } catch {
    // non-fatal
  }
}

export async function ensureSeeded() {
  await ensureWorkspaceState();
  const count = await prisma.gLTransaction.count();
  if (count === 0) {
    const seeded = await loadSampleData();
    await logEvent("startup", "Loaded sample data", seeded);
  }

  const [glCount, bankCount] = await Promise.all([
    prisma.gLTransaction.count(),
    prisma.bankTransaction.count()
  ]);

  if (glCount > 0) {
    await prisma.dataSource.updateMany({
      where: { sourceKey: { in: ["erp_system", "netsuite_mock"] } },
      data: { connectionStatus: "connected", rowCount: glCount, lastSyncAt: new Date() }
    });
  }
  if (bankCount > 0) {
    await prisma.dataSource.updateMany({
      where: { sourceKey: "bank_feed" },
      data: { connectionStatus: "connected", rowCount: bankCount, lastSyncAt: new Date() }
    });
  }
}

export async function getHealthPayload() {
  await ensureSeeded();
  const [glCount, bankCount, redis] = await Promise.all([
    prisma.gLTransaction.count(),
    prisma.bankTransaction.count(),
    redisHealth()
  ]);

  return {
    status: "ok",
    dbBackend: "postgres",
    redis,
    glCount,
    bankCount
  };
}

export async function resetData() {
  const result = await loadSampleData();
  await logEvent("reset", "Reset and loaded sample data", result);
  return { reset: true, ...result };
}

export async function reconcileNow() {
  await ensureSeeded();
  const settings = await getSettingsPayload();
  const result = await runReconciliationEngine(prisma, {
    openRouterApiKey: settings.openrouter_api_key,
    openRouterModel: settings.openrouter_model
  });
  await Promise.all([
    logEvent("reconcile", "Ran reconciliation engine", result),
    invalidateDashboardCache()
  ]);
  return result;
}

export async function approvePair(glId: number, bankId: number) {
  const [gl, bank] = await Promise.all([
    prisma.gLTransaction.findUnique({ where: { id: glId } }),
    prisma.bankTransaction.findUnique({ where: { id: bankId } })
  ]);

  if (!gl || !bank) {
    return { ok: false, status: 404, error: "Transaction pair not found" };
  }

  if (gl.status !== MatchStatus.PROPOSED || bank.status !== MatchStatus.PROPOSED) {
    return { ok: false, status: 400, error: "Pair is not in proposed state" };
  }

  if (gl.matchedBankRef !== bank.bankRef || bank.matchedGlRef !== gl.transactionId) {
    return { ok: false, status: 400, error: "Transactions are not linked as proposed pair" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const [glUpdate, bankUpdate] = await Promise.all([
        tx.gLTransaction.updateMany({
          where: {
            id: glId,
            status: MatchStatus.PROPOSED,
            matchedBankRef: bank.bankRef
          },
          data: { status: MatchStatus.MATCHED }
        }),
        tx.bankTransaction.updateMany({
          where: {
            id: bankId,
            status: MatchStatus.PROPOSED,
            matchedGlRef: gl.transactionId
          },
          data: { status: MatchStatus.MATCHED }
        })
      ]);

      if (glUpdate.count !== 1 || bankUpdate.count !== 1) {
        throw new Error(STALE_STATE_ERROR);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === STALE_STATE_ERROR) {
      return { ok: false, status: 409, error: "Pair state changed; refresh and try again" };
    }
    throw error;
  }

  await Promise.all([
    logEvent("approve", "Approved proposed pair", { glId, bankId }),
    invalidateDashboardCache()
  ]);
  return { ok: true };
}

export async function rejectPair(glId: number, bankId: number) {
  const [gl, bank] = await Promise.all([
    prisma.gLTransaction.findUnique({ where: { id: glId } }),
    prisma.bankTransaction.findUnique({ where: { id: bankId } })
  ]);

  if (!gl || !bank) {
    return { ok: false, status: 404, error: "Transaction pair not found" };
  }

  if (gl.status !== MatchStatus.PROPOSED || bank.status !== MatchStatus.PROPOSED) {
    return { ok: false, status: 400, error: "Pair is not in proposed state" };
  }

  if (gl.matchedBankRef !== bank.bankRef || bank.matchedGlRef !== gl.transactionId) {
    return { ok: false, status: 400, error: "Transactions are not linked as proposed pair" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const [glUpdate, bankUpdate] = await Promise.all([
        tx.gLTransaction.updateMany({
          where: {
            id: glId,
            status: MatchStatus.PROPOSED,
            matchedBankRef: bank.bankRef
          },
          data: { status: MatchStatus.EXCEPTION, matchedBankRef: null }
        }),
        tx.bankTransaction.updateMany({
          where: {
            id: bankId,
            status: MatchStatus.PROPOSED,
            matchedGlRef: gl.transactionId
          },
          data: { status: MatchStatus.EXCEPTION, matchedGlRef: null }
        })
      ]);

      if (glUpdate.count !== 1 || bankUpdate.count !== 1) {
        throw new Error(STALE_STATE_ERROR);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === STALE_STATE_ERROR) {
      return { ok: false, status: 409, error: "Pair state changed; refresh and try again" };
    }
    throw error;
  }

  await Promise.all([
    logEvent("reject", "Rejected proposed pair", { glId, bankId }),
    invalidateDashboardCache()
  ]);
  return { ok: true };
}

export async function createGlJournal(glId: number) {
  const gl = await prisma.gLTransaction.findUnique({ where: { id: glId } });
  if (!gl || gl.status !== MatchStatus.EXCEPTION) {
    return { ok: false, status: 400, error: "GL transaction not found or not an exception" };
  }

  const explanation = await prisma.exceptionExplanation.findUnique({
    where: {
      sourceType_itemId: {
        sourceType: "gl",
        itemId: glId
      }
    }
  });

  const note = explanation?.editedText?.trim() || "";
  const noteSummary = note ? note.split("\n").map((line) => line.trim()).filter(Boolean)[0] : "";
  const description = noteSummary
    ? `Outstanding GL: ${gl.description} | Note: ${noteSummary}`
    : `Outstanding GL: ${gl.description}`;

  let createdJournalId = 0;
  const journal = await prisma.$transaction(async (tx) => {
    const statusUpdate = await tx.gLTransaction.updateMany({
      where: { id: gl.id, status: MatchStatus.EXCEPTION },
      data: { status: MatchStatus.MATCHED }
    });

    if (statusUpdate.count !== 1) {
      throw new Error(STALE_STATE_ERROR);
    }

    const created = await tx.journalEntry.create({
      data: {
        date: gl.date,
        description,
        debitAccount: "Accounts Receivable",
        creditAccount: "Suspense",
        amount: gl.netAmount,
        reference: gl.transactionId
      }
    });
    createdJournalId = created.id;
    return created;
  }).catch((error) => {
    if (error instanceof Error && error.message === STALE_STATE_ERROR) {
      return null;
    }
    throw error;
  });

  if (!journal) {
    return { ok: false, status: 409, error: "GL transaction state changed; refresh and try again" };
  }

  await Promise.all([
    logEvent("journal_posted", "Posted GL journal", { glId, journalId: createdJournalId }),
    invalidateDashboardCache()
  ]);
  return { ok: true, journal };
}

export async function createBankJournal(bankId: number) {
  const bank = await prisma.bankTransaction.findUnique({ where: { id: bankId } });
  if (!bank || bank.status !== MatchStatus.EXCEPTION) {
    return { ok: false, status: 400, error: "Bank transaction not found or not an exception" };
  }

  const explanation = await prisma.exceptionExplanation.findUnique({
    where: {
      sourceType_itemId: {
        sourceType: "bank",
        itemId: bankId
      }
    }
  });

  const note = explanation?.editedText?.trim() || "";
  const noteSummary = note ? note.split("\n").map((line) => line.trim()).filter(Boolean)[0] : "";
  const description = noteSummary
    ? `Unmatched bank: ${bank.description} | Note: ${noteSummary}`
    : `Unmatched bank: ${bank.description}`;

  let createdJournalId = 0;
  const journal = await prisma.$transaction(async (tx) => {
    const statusUpdate = await tx.bankTransaction.updateMany({
      where: { id: bank.id, status: MatchStatus.EXCEPTION },
      data: { status: MatchStatus.MATCHED }
    });

    if (statusUpdate.count !== 1) {
      throw new Error(STALE_STATE_ERROR);
    }

    const created = await tx.journalEntry.create({
      data: {
        date: bank.date,
        description,
        debitAccount: "Suspense",
        creditAccount: "Cash",
        amount: bank.amount,
        reference: bank.bankRef
      }
    });

    createdJournalId = created.id;
    return created;
  }).catch((error) => {
    if (error instanceof Error && error.message === STALE_STATE_ERROR) {
      return null;
    }
    throw error;
  });

  if (!journal) {
    return { ok: false, status: 409, error: "Bank transaction state changed; refresh and try again" };
  }

  await Promise.all([
    logEvent("journal_posted", "Posted bank journal", { bankId, journalId: createdJournalId }),
    invalidateDashboardCache()
  ]);
  return { ok: true, journal };
}

export async function getDashboardPayload() {
  await ensureSeeded();

  const redis = getRedisClient();
  if (redis) {
    try {
      if (redis.status === "wait") await redis.connect();
      const cached = await redis.get(DASHBOARD_CACHE_KEY);
      if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof buildDashboardPayload>>;
    } catch {
      // Redis unavailable — fall through to database
    }
  }

  const payload = await buildDashboardPayload();

  if (redis) {
    try {
      await redis.set(DASHBOARD_CACHE_KEY, JSON.stringify(payload), "EX", DASHBOARD_CACHE_TTL);
    } catch {
      // non-fatal
    }
  }

  return payload;
}

async function buildDashboardPayload() {
  const [glRows, bankRows, journals, insights] = await Promise.all([
    prisma.gLTransaction.findMany({ orderBy: { id: "asc" } }),
    prisma.bankTransaction.findMany({ orderBy: { id: "asc" } }),
    prisma.journalEntry.findMany({ orderBy: { id: "desc" } }),
    prisma.matchInsight.findMany({ orderBy: { id: "desc" } })
  ]);

  const insightByPair = new Map<string, { confidence: number; passType: string; reasoning: string }>();
  for (const insight of insights) {
    if (insight.glId && insight.bankId) {
      insightByPair.set(`${insight.glId}:${insight.bankId}`, {
        confidence: insight.confidence,
        passType: insight.passType,
        reasoning: insight.reasoning
      });
    }
  }

  const matchedGl = glRows.filter((row) => row.status === MatchStatus.MATCHED);
  const proposedGl = glRows.filter((row) => row.status === MatchStatus.PROPOSED);
  const glExceptions = glRows.filter((row) => row.status === MatchStatus.EXCEPTION);
  const bankExceptions = bankRows.filter((row) => row.status === MatchStatus.EXCEPTION);
  const pendingGl = glRows.filter((row) => row.status === MatchStatus.PENDING);
  const pendingBank = bankRows.filter((row) => row.status === MatchStatus.PENDING);
  const llmProposed = insights.filter((row) => row.passType === "llm").length;

  const proposedBankByGlRef = new Map(
    bankRows.filter((row) => row.status === MatchStatus.PROPOSED && row.matchedGlRef).map((row) => [row.matchedGlRef as string, row])
  );

  const proposedPairs = proposedGl
    .map((gl) => {
      const bank = proposedBankByGlRef.get(gl.transactionId);
      if (!bank) {
        return null;
      }
      const dateDiff = Math.abs((bank.date.getTime() - gl.date.getTime()) / 86_400_000);
      const insight = insightByPair.get(`${gl.id}:${bank.id}`);
      return {
        glId: gl.id,
        bankId: bank.id,
        glRef: gl.transactionId,
        bankRef: bank.bankRef,
        glDate: toIsoDate(gl.date),
        bankDate: toIsoDate(bank.date),
        glDesc: gl.description,
        bankDesc: bank.description,
        amount: absNumber(Number(gl.netAmount)),
        dateDiff,
        confidence: insight?.confidence ?? 60,
        passType: insight?.passType ?? "near",
        reasoning: insight?.reasoning ?? "Near match proposed for review"
      };
    })
    .filter((pair): pair is NonNullable<typeof pair> => Boolean(pair));

  const matchedBankByRef = new Map(bankRows.filter((row) => row.status === MatchStatus.MATCHED).map((row) => [row.bankRef, row]));

  const matchedPairs = matchedGl
    .map((gl) => {
      if (!gl.matchedBankRef) {
        return null;
      }
      const bank = matchedBankByRef.get(gl.matchedBankRef);
      if (!bank) {
        return null;
      }
      return {
        glRef: gl.transactionId,
        bankRef: bank.bankRef,
        glDate: toIsoDate(gl.date),
        bankDate: toIsoDate(bank.date),
        glDesc: gl.description,
        bankDesc: bank.description,
        amount: absNumber(Number(gl.netAmount))
      };
    })
    .filter((pair): pair is NonNullable<typeof pair> => Boolean(pair));

  return {
    stats: {
      totalGl: glRows.length,
      totalBank: bankRows.length,
      matched: matchedGl.length,
      proposed: proposedPairs.length,
      llmProposed,
      glExceptions: glExceptions.length,
      bankExceptions: bankExceptions.length,
      journals: journals.length,
      pendingGl: pendingGl.length,
      pendingBank: pendingBank.length
    },
    proposedPairs,
    matchedPairs,
    glExceptions: glExceptions.map((row) => ({
      id: row.id,
      ref: row.transactionId,
      date: toIsoDate(row.date),
      description: row.description,
      amount: absNumber(Number(row.netAmount)),
      account: row.accountName,
      reference: row.reference
    })),
    bankExceptions: bankExceptions.map((row) => ({
      id: row.id,
      ref: row.bankRef,
      date: toIsoDate(row.date),
      description: row.description,
      amount: absNumber(Number(row.amount))
    })),
    journals: journals.map((row) => ({
      id: row.id,
      date: toIsoDate(row.date),
      description: row.description,
      debitAccount: row.debitAccount,
      creditAccount: row.creditAccount,
      amount: absNumber(Number(row.amount)),
      reference: row.reference
    }))
  };
}

export async function exportJournalsCsv() {
  const rows = await prisma.journalEntry.findMany({ orderBy: { id: "asc" } });
  const header = ["id", "date", "description", "debit_account", "credit_account", "amount", "reference"];
  const lines = [header.join(",")];

  const toCsvCell = (value: unknown) => `"${String(value).replaceAll('"', '""').replace(/[\r\n]+/g, " ")}"`;

  for (const row of rows) {
    const values = [
      row.id,
      toIsoDate(row.date),
      row.description,
      row.debitAccount,
      row.creditAccount,
      Number(row.amount).toFixed(2),
      row.reference
    ].map((value) => toCsvCell(value));

    lines.push(values.join(","));
  }

  return lines.join("\n");
}
