import { parse } from "csv-parse/sync";
import { MatchStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/db";
import { extractJsonObject, getOpenRouterModel, isOpenRouterEnabled, openRouterChat } from "@/server/lib/openrouter";
import { isoDateToUtcDate, parseMoneyToCents } from "@/server/lib/validation";

type CsvRow = Record<string, string>;

const DEFAULT_SETTINGS: Record<string, string> = {
  openrouter_model: process.env.OPENROUTER_MODEL?.trim() || "nvidia/nemotron-3-super-120b-a12b:free",
  openrouter_api_key: process.env.OPENROUTER_API_KEY?.trim() || "",
  google_sheets_spreadsheet_id: "",
  google_sheets_range: "Sheet1!A1:E",
  google_sheets_api_key: "",
  google_sheets_bank_csv_url: ""
};

const DEFAULT_SOURCES = [
  {
    sourceKey: "erp_system",
    name: "ERP System",
    sourceType: "erp",
    location: "CSV upload",
    mode: "manual"
  },
  {
    sourceKey: "bank_feed",
    name: "Bank Feed",
    sourceType: "bank",
    location: "CSV upload",
    mode: "manual"
  },
  {
    sourceKey: "google_sheets",
    name: "Google Sheets",
    sourceType: "connector",
    location: "Google Sheets",
    mode: "api"
  },
  {
    sourceKey: "netsuite_mock",
    name: "NetSuite Mock",
    sourceType: "connector",
    location: "Sandbox connector",
    mode: "mock"
  }
] as const;

function parseCsvText(content: string): CsvRow[] {
  if (!content.trim()) {
    return [];
  }

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false
  }) as Array<Record<string, unknown>>;

  return records.map((record) => {
    const row: CsvRow = {};
    for (const [key, value] of Object.entries(record)) {
      row[key] = typeof value === "string" ? value : String(value ?? "");
    }
    return row;
  });
}

function assertColumns(rows: CsvRow[], columns: string[], fileLabel: string): void {
  if (!rows.length) {
    throw new Error(`${fileLabel} has no rows`);
  }

  const keys = new Set(Object.keys(rows[0]));
  for (const column of columns) {
    if (!keys.has(column)) {
      throw new Error(`${fileLabel} is missing required column: ${column}`);
    }
  }
}

function glRowsToCreate(rows: CsvRow[]): Prisma.GLTransactionCreateManyInput[] {
  return rows.map((row) => {
    const txId = row.transaction_id?.trim();
    if (!txId) {
      throw new Error("GL row is missing transaction_id");
    }

    const debitCents = parseMoneyToCents(row.debit || "0", `gl debit (${txId})`);
    const creditCents = parseMoneyToCents(row.credit || "0", `gl credit (${txId})`);

    return {
      transactionId: txId,
      date: isoDateToUtcDate(row.date || "", `gl date (${txId})`),
      accountCode: (row.account_code || "1000").trim(),
      accountName: (row.account_name || "Cash - Main").trim(),
      description: (row.description || "").trim(),
      debit: (debitCents / 100).toFixed(2),
      credit: (creditCents / 100).toFixed(2),
      netAmount: ((debitCents - creditCents) / 100).toFixed(2),
      currency: (row.currency || "GBP").trim() || "GBP",
      reference: (row.reference || "").trim(),
      status: MatchStatus.PENDING
    };
  });
}

function bankRowsToCreate(rows: CsvRow[]): Prisma.BankTransactionCreateManyInput[] {
  return rows.map((row) => {
    const bankRef = row.bank_ref?.trim();
    if (!bankRef) {
      throw new Error("Bank row is missing bank_ref");
    }

    const amountCents = parseMoneyToCents(row.amount || "0", `bank amount (${bankRef})`);
    const txType = (row.type || "credit").trim().toLowerCase();
    const signedAmountCents = txType === "credit" ? amountCents : -amountCents;

    return {
      bankRef,
      date: isoDateToUtcDate(row.date || "", `bank date (${bankRef})`),
      description: (row.description || "").trim(),
      amount: (signedAmountCents / 100).toFixed(2),
      transactionType: txType,
      status: MatchStatus.PENDING
    };
  });
}

async function logAudit(eventType: string, message: string, details: unknown): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      eventType,
      actor: "system",
      message,
      detailsJson: JSON.stringify(details ?? {})
    }
  });
}

async function updateSourceSync(
  sourceKey: string,
  rowCount: number,
  connectionStatus: "connected" | "disconnected" | "error",
  location?: string,
  mode?: string,
  details?: Record<string, unknown>
): Promise<void> {
  await prisma.dataSource.upsert({
    where: { sourceKey },
    create: {
      sourceKey,
      name: sourceKey,
      sourceType: "connector",
      rowCount,
      connectionStatus,
      lastSyncAt: new Date(),
      location: location || "",
      mode: mode || "",
      detailsJson: JSON.stringify(details ?? {})
    },
    update: {
      rowCount,
      connectionStatus,
      lastSyncAt: new Date(),
      location: location ?? undefined,
      mode: mode ?? undefined,
      detailsJson: JSON.stringify(details ?? {})
    }
  });
}

export async function ensureWorkspaceState(): Promise<void> {
  for (const [settingKey, settingValue] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.appSetting.upsert({
      where: { settingKey },
      create: { settingKey, settingValue },
      update: {}
    });
  }

  for (const source of DEFAULT_SOURCES) {
    await prisma.dataSource.upsert({
      where: { sourceKey: source.sourceKey },
      create: {
        sourceKey: source.sourceKey,
        name: source.name,
        sourceType: source.sourceType,
        location: source.location,
        mode: source.mode,
        connectionStatus: "disconnected"
      },
      update: {
        name: source.name,
        sourceType: source.sourceType,
        location: source.location,
        mode: source.mode
      }
    });
  }
}

export async function getSettingsPayload(): Promise<Record<string, string>> {
  await ensureWorkspaceState();
  const rows = await prisma.appSetting.findMany();
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.settingKey] = row.settingValue;
  }
  settings.openrouter_model = settings.openrouter_model || getOpenRouterModel();
  return settings;
}

export async function updateSettingsPayload(input: Record<string, unknown>): Promise<Record<string, string>> {
  await ensureWorkspaceState();
  const allowedKeys = new Set(Object.keys(DEFAULT_SETTINGS));

  for (const [key, value] of Object.entries(input || {})) {
    if (!allowedKeys.has(key)) {
      continue;
    }

    const settingValue = String(value ?? "").trim();
    await prisma.appSetting.upsert({
      where: { settingKey: key },
      create: { settingKey: key, settingValue },
      update: { settingValue }
    });
  }

  const settings = await getSettingsPayload();
  await logAudit("settings_updated", "Connector settings updated", { keys: Object.keys(input || {}) });
  return settings;
}

export async function getDataSourcesPayload(): Promise<{ sources: Array<Record<string, unknown>> }> {
  await ensureWorkspaceState();
  const rows = await prisma.dataSource.findMany({ orderBy: { id: "asc" } });
  return {
    sources: rows.map((row) => ({
      source_key: row.sourceKey,
      name: row.name,
      source_type: row.sourceType,
      connection_status: row.connectionStatus,
      last_sync_at: row.lastSyncAt?.toISOString() ?? null,
      row_count: row.rowCount,
      location: row.location,
      mode: row.mode,
      details: row.detailsJson ? extractJsonObject(row.detailsJson) : {}
    }))
  };
}

export async function getDataSourcePreview(sourceKey: string): Promise<Record<string, unknown>> {
  await ensureWorkspaceState();

  const source = await prisma.dataSource.findUnique({ where: { sourceKey } });
  if (!source) {
    throw new Error(`Unknown source: ${sourceKey}`);
  }

  let rows: Array<Record<string, unknown>> = [];
  let columns: string[] = [];
  let hint = "";

  if (sourceKey === "erp_system" || sourceKey === "netsuite_mock") {
    const glRows = await prisma.gLTransaction.findMany({ orderBy: { id: "desc" }, take: 6 });
    rows = glRows.map((row) => ({
      ref: row.transactionId,
      date: row.date.toISOString().slice(0, 10),
      description: row.description,
      amount: Number(row.netAmount),
      status: row.status
    }));
    columns = ["ref", "date", "description", "amount", "status"];
    hint = sourceKey === "netsuite_mock"
      ? "NetSuite mock mirrors ERP transactions for connector testing."
      : "Upload a GL CSV to refresh this source.";
  } else {
    const bankRows = await prisma.bankTransaction.findMany({ orderBy: { id: "desc" }, take: 6 });
    rows = bankRows.map((row) => ({
      ref: row.bankRef,
      date: row.date.toISOString().slice(0, 10),
      description: row.description,
      amount: Number(row.amount),
      status: row.status
    }));
    columns = ["ref", "date", "description", "amount", "status"];
    hint = sourceKey === "google_sheets"
      ? "Connect by setting spreadsheet ID and API key in connector settings."
      : "Upload a Bank CSV to refresh this source.";
  }

  return {
    source_key: source.sourceKey,
    name: source.name,
    status: source.connectionStatus,
    mode: source.mode,
    location: source.location,
    row_count: source.rowCount,
    last_sync_at: source.lastSyncAt?.toISOString() ?? null,
    hint,
    columns,
    preview_rows: rows
  };
}

export async function replaceGlFromCsv(content: string, sourceKey = "erp_system"): Promise<{ loaded: number }> {
  const rows = parseCsvText(content);
  assertColumns(rows, ["transaction_id", "date", "account_code", "account_name", "description", "debit", "credit"], "GL CSV");

  const createRows = glRowsToCreate(rows);

  await prisma.$transaction(async (tx) => {
    await tx.matchInsight.deleteMany();
    await tx.journalEntry.deleteMany();
    await tx.exceptionExplanation.deleteMany({ where: { sourceType: "gl" } });
    await tx.gLTransaction.deleteMany();
    await tx.bankTransaction.updateMany({ data: { status: MatchStatus.PENDING, matchedGlRef: null } });
    await tx.gLTransaction.createMany({ data: createRows });
  });

  await updateSourceSync(sourceKey, createRows.length, "connected", "CSV upload", "manual", { uploaded: true });
  await logAudit("upload_gl", "Uploaded GL CSV", { rows: createRows.length, sourceKey });
  return { loaded: createRows.length };
}

export async function replaceBankFromCsv(content: string, sourceKey = "bank_feed", mode = "manual"): Promise<{ loaded: number }> {
  const rows = parseCsvText(content);
  assertColumns(rows, ["bank_ref", "date", "description", "amount", "type"], "Bank CSV");

  const createRows = bankRowsToCreate(rows);

  await prisma.$transaction(async (tx) => {
    await tx.matchInsight.deleteMany();
    await tx.journalEntry.deleteMany();
    await tx.exceptionExplanation.deleteMany({ where: { sourceType: "bank" } });
    await tx.bankTransaction.deleteMany();
    await tx.gLTransaction.updateMany({ data: { status: MatchStatus.PENDING, matchedBankRef: null } });
    await tx.bankTransaction.createMany({ data: createRows });
  });

  await updateSourceSync(sourceKey, createRows.length, "connected", sourceKey === "google_sheets" ? "Google Sheets" : "CSV upload", mode, { uploaded: true });
  await logAudit("upload_bank", "Loaded bank feed", { rows: createRows.length, sourceKey, mode });
  return { loaded: createRows.length };
}

async function fetchGoogleSheetRows(settings: Record<string, string>): Promise<CsvRow[]> {
  const csvUrl = settings.google_sheets_bank_csv_url?.trim();
  if (csvUrl) {
    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error(`Google Sheets CSV URL failed (${response.status})`);
    }
    return parseCsvText(await response.text());
  }

  const spreadsheetId = settings.google_sheets_spreadsheet_id?.trim();
  const apiKey = settings.google_sheets_api_key?.trim();
  const range = settings.google_sheets_range?.trim() || "BankFeed!A:E";
  if (!spreadsheetId || !apiKey) {
    throw new Error("Configure Google Sheets API settings or published CSV URL first");
  }

  const encodedRange = encodeURIComponent(range).replace(/%21/g, "!");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Sheets API failed (${response.status})`);
  }

  const payload = await response.json() as { values?: string[][] };
  const values = payload.values ?? [];
  if (values.length < 2) {
    throw new Error("Google Sheets returned no rows");
  }

  const header = values[0].map((cell) => cell.trim());
  const rows: CsvRow[] = [];

  for (const row of values.slice(1)) {
    const record: CsvRow = {};
    header.forEach((key, index) => {
      record[key] = row[index] ?? "";
    });
    rows.push(record);
  }

  return rows;
}

export async function syncDataSource(sourceKey: string): Promise<{ synced: boolean; rowCount: number }> {
  await ensureWorkspaceState();
  if (sourceKey === "netsuite_mock") {
    const rowCount = await prisma.gLTransaction.count();
    await updateSourceSync("netsuite_mock", rowCount, "connected", "Sandbox connector", "mock", {
      ping: "ok"
    });
    await logAudit("source_sync", "Synced NetSuite mock connector", { rowCount });
    return { synced: true, rowCount };
  }

  if (sourceKey !== "google_sheets") {
    throw new Error(`Sync is only supported for Google Sheets or NetSuite mock`);
  }

  const settings = await getSettingsPayload();
  const rows = await fetchGoogleSheetRows(settings);
  const csvHeader = "bank_ref,date,description,amount,type\n";
  const content = csvHeader + rows
    .map((row) => [row.bank_ref, row.date, row.description, row.amount, row.type || "credit"].map((v) => String(v ?? "").replaceAll('"', '""')).map((v) => `"${v}"`).join(","))
    .join("\n");

  const result = await replaceBankFromCsv(content, "google_sheets", "api");
  await logAudit("source_sync", "Synced Google Sheets bank feed", { rowCount: result.loaded });
  return { synced: true, rowCount: result.loaded };
}

export async function getAuditTrail(limit = 80): Promise<{ events: Array<Record<string, unknown>> }> {
  const rows = await prisma.auditEvent.findMany({
    orderBy: { id: "desc" },
    take: Math.max(1, Math.min(limit, 300))
  });

  return {
    events: rows.map((row) => ({
      id: row.id,
      event_type: row.eventType,
      actor: row.actor,
      message: row.message,
      details: extractJsonObject(row.detailsJson),
      created_at: row.createdAt.toISOString()
    }))
  };
}

function normalizeExplanation(raw: Record<string, unknown>, fallbackRef: string): Record<string, unknown> {
  const toStringList = (value: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const normalized = value.map((entry) => String(entry || "").trim()).filter(Boolean);
    return normalized.length ? normalized.slice(0, 6) : fallback;
  };

  const riskLevel = String(raw.risk_level || "medium").toLowerCase();
  const allowedRisk = new Set(["low", "medium", "high"]);

  const confidence = Number.parseInt(String(raw.confidence ?? "55"), 10);
  const boundedConfidence = Number.isFinite(confidence) ? Math.max(1, Math.min(99, confidence)) : 55;

  return {
    summary: String(raw.summary || `Exception requires review for ${fallbackRef}.`).trim(),
    likely_causes: toStringList(raw.likely_causes, ["Timing differences", "Missing source references"]),
    recommended_actions: toStringList(raw.recommended_actions, ["Verify supporting evidence", "Post journal if appropriate"]),
    risk_level: allowedRisk.has(riskLevel) ? riskLevel : "medium",
    confidence: boundedConfidence,
    journal_note: String(raw.journal_note || `Review unmatched item ${fallbackRef} before posting journal.`).trim().slice(0, 220)
  };
}

function explanationToText(structured: Record<string, unknown>): string {
  const causes = (structured.likely_causes as string[]).map((item) => `- ${item}`).join("\n");
  const actions = (structured.recommended_actions as string[]).map((item) => `- ${item}`).join("\n");
  return [
    `Summary: ${structured.summary as string}`,
    "",
    "Likely causes:",
    causes,
    "",
    "Recommended actions:",
    actions,
    "",
    `Risk: ${String(structured.risk_level).toUpperCase()} (${structured.confidence}%)`,
    `Journal note: ${structured.journal_note as string}`
  ].join("\n");
}

function sanitizeUnstructuredAiText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\b(return|output)\s+strict\s+json[^.]*\.?/gi, " ")
    .replace(/\bwe\s+need\s+to\s+(produce|output)[^.]*\.?/gi, " ")
    .replace(/\bkeys?\s*:[^.]*\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function explainException(sourceType: "gl" | "bank", itemId: number): Promise<Record<string, unknown>> {
  const settings = await getSettingsPayload();
  const openRouterApiKey = settings.openrouter_api_key?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
  const openRouterModel = settings.openrouter_model?.trim() || getOpenRouterModel();

  let txRef = "";
  let txAmount = 0;
  let transaction: unknown;
  let opposite: unknown[] = [];

  if (sourceType === "gl") {
    const tx = await prisma.gLTransaction.findUnique({ where: { id: itemId } });
    if (!tx) {
      throw new Error("Exception item not found");
    }

    txRef = tx.transactionId;
    txAmount = Number(tx.netAmount);
    transaction = tx;
    opposite = await prisma.bankTransaction.findMany({ orderBy: { id: "desc" }, take: 8 });
  } else {
    const tx = await prisma.bankTransaction.findUnique({ where: { id: itemId } });
    if (!tx) {
      throw new Error("Exception item not found");
    }

    txRef = tx.bankRef;
    txAmount = Number(tx.amount);
    transaction = tx;
    opposite = await prisma.gLTransaction.findMany({ orderBy: { id: "desc" }, take: 8 });
  }

  function rulesFallback(reason: "no-key" | "no-response" | "invalid-json"): Record<string, unknown> {
    const reasonSummary =
      reason === "no-key"
        ? `No AI key configured; generated rules-based explanation for ${txRef}.`
        : reason === "no-response"
          ? `OpenRouter did not return a response; generated rules-based explanation for ${txRef}.`
          : `OpenRouter response could not be parsed; generated rules-based explanation for ${txRef}.`;

    return normalizeExplanation({
      summary: reasonSummary,
      likely_causes: ["Timing differences across systems", "Missing or inconsistent transaction references"],
      recommended_actions: ["Check supporting documents", "Confirm amount/date mapping before posting journal"],
      risk_level: "medium",
      confidence: 45,
      journal_note: `Rules fallback review for ${txRef} (${Math.abs(txAmount).toFixed(2)}).`
    }, txRef);
  }

  const fallbackStructured = rulesFallback("no-key");

  let provider = "rule-fallback";
  let model = "";
  let structured = fallbackStructured;

  if (isOpenRouterEnabled({ apiKey: openRouterApiKey })) {
    const content = await openRouterChat([
      {
        role: "system",
        content:
          "You are an accounting reconciliation assistant. Return strict JSON only with keys summary, likely_causes[], recommended_actions[], risk_level(low|medium|high), confidence(0-100), journal_note(max 220 chars)."
      },
      {
        role: "user",
        content: JSON.stringify({
          source_type: sourceType,
          transaction,
          candidate_rows: opposite
        })
      }
    ], 520, {
      apiKey: openRouterApiKey,
      model: openRouterModel
    });

    if (content) {
      const parsed = extractJsonObject(content);
      const hasExpectedKeys = ["summary", "likely_causes", "recommended_actions", "risk_level", "confidence", "journal_note"]
        .some((key) => parsed[key] !== undefined);

      if (hasExpectedKeys) {
        provider = "openrouter";
        model = openRouterModel;
        structured = normalizeExplanation(parsed, txRef);
      } else {
        const condensed = sanitizeUnstructuredAiText(content).slice(0, 420);
        provider = "openrouter";
        model = openRouterModel;
        structured = normalizeExplanation({
          summary: `AI returned an unstructured response; summarized for ${txRef}.`,
          likely_causes: [
            "Model did not return strict JSON for this request",
            condensed
              ? "AI response arrived in free-form text and could not be fully structured"
              : "AI response did not contain extractable structured fields"
          ],
          recommended_actions: [
            "Review AI note and supporting source documents",
            "Confirm amount/date/reference consistency before journal posting"
          ],
          risk_level: "medium",
          confidence: 60,
          journal_note: `AI returned a free-form explanation for ${txRef}; review source evidence before posting journal.`
        }, txRef);
      }
    } else {
      structured = rulesFallback("no-response");
    }
  }

  const formatted = explanationToText(structured);

  await prisma.exceptionExplanation.upsert({
    where: {
      sourceType_itemId: {
        sourceType,
        itemId
      }
    },
    create: {
      sourceType,
      itemId,
      provider,
      model,
      structuredJson: JSON.stringify(structured),
      editedText: formatted,
      updatedBy: "system"
    },
    update: {
      provider,
      model,
      structuredJson: JSON.stringify(structured),
      editedText: formatted,
      updatedBy: "system"
    }
  });

  await logAudit("explain_exception", "Generated exception explanation", { sourceType, itemId, provider, model });

  return {
    source_type: sourceType,
    item_id: itemId,
    provider,
    model,
    structured,
    formatted
  };
}

export async function getExceptionExplanation(sourceType: "gl" | "bank", itemId: number): Promise<Record<string, unknown>> {
  const row = await prisma.exceptionExplanation.findUnique({
    where: {
      sourceType_itemId: {
        sourceType,
        itemId
      }
    }
  });

  if (!row) {
    return {
      found: false,
      source_type: sourceType,
      item_id: itemId
    };
  }

  return {
    found: true,
    source_type: sourceType,
    item_id: itemId,
    provider: row.provider,
    model: row.model,
    structured: extractJsonObject(row.structuredJson),
    formatted: row.editedText,
    updated_at: row.updatedAt.toISOString()
  };
}

export async function updateExceptionExplanation(sourceType: "gl" | "bank", itemId: number, text: string): Promise<Record<string, unknown>> {
  const existing = await prisma.exceptionExplanation.findUnique({
    where: {
      sourceType_itemId: {
        sourceType,
        itemId
      }
    }
  });

  const updated = existing
    ? await prisma.exceptionExplanation.update({
      where: {
        sourceType_itemId: {
          sourceType,
          itemId
        }
      },
      data: {
        editedText: text.trim(),
        updatedBy: "system",
        provider: existing.provider || "manual"
      }
    })
    : await prisma.exceptionExplanation.create({
      data: {
        sourceType,
        itemId,
        provider: "manual",
        model: "",
        structuredJson: JSON.stringify({
          summary: "Manual explanation",
          likely_causes: [],
          recommended_actions: [],
          risk_level: "medium",
          confidence: 50,
          journal_note: text.trim().slice(0, 220)
        }),
        editedText: text.trim(),
        updatedBy: "system"
      }
    });

  await logAudit("edit_explanation", "Edited exception explanation", { sourceType, itemId });

  return {
    source_type: sourceType,
    item_id: itemId,
    formatted: updated.editedText,
    updated_at: updated.updatedAt.toISOString()
  };
}

export async function getMatchReasoning(glId: number, bankId: number): Promise<Record<string, unknown>> {
  const row = await prisma.matchInsight.findFirst({
    where: { glId, bankId },
    orderBy: { id: "desc" }
  });

  if (!row) {
    return { found: false, gl_id: glId, bank_id: bankId };
  }

  return {
    found: true,
    gl_id: glId,
    bank_id: bankId,
    pass_type: row.passType,
    confidence: row.confidence,
    reasoning: row.reasoning,
    created_at: row.createdAt.toISOString()
  };
}
