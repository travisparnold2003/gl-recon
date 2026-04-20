import path from "node:path";
import { prisma } from "@/server/lib/db";
import { parseCsv } from "@/server/lib/csv";
import { isoDateToUtcDate, parseMoneyToCents } from "@/server/lib/validation";

function toDecimalStringFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function assertRequiredColumns(rows: Array<Record<string, string>>, requiredColumns: string[], fileLabel: string): void {
  if (rows.length === 0) {
    throw new Error(`${fileLabel} has no data rows`);
  }

  const available = new Set(Object.keys(rows[0]));
  for (const column of requiredColumns) {
    if (!available.has(column)) {
      throw new Error(`${fileLabel} is missing required column: ${column}`);
    }
  }
}

export async function loadSampleData(): Promise<{ glLoaded: number; bankLoaded: number }> {
  const glPath = path.join(process.cwd(), "data", "gl_transactions.csv");
  const bankPath = path.join(process.cwd(), "data", "bank_statement.csv");

  const [glRows, bankRows] = await Promise.all([parseCsv(glPath), parseCsv(bankPath)]);

  assertRequiredColumns(
    glRows,
    ["transaction_id", "date", "account_code", "account_name", "description", "debit", "credit"],
    "gl_transactions.csv"
  );
  assertRequiredColumns(bankRows, ["bank_ref", "date", "description", "amount", "type"], "bank_statement.csv");

  await prisma.$transaction([
    prisma.matchInsight.deleteMany(),
    prisma.journalEntry.deleteMany(),
    prisma.exceptionExplanation.deleteMany(),
    prisma.gLTransaction.deleteMany(),
    prisma.bankTransaction.deleteMany()
  ]);

  if (glRows.length > 0) {
    await prisma.gLTransaction.createMany({
      data: glRows.map((row) => {
        const debitCents = parseMoneyToCents(row.debit || "0", `gl debit (${row.transaction_id || "unknown"})`);
        const creditCents = parseMoneyToCents(row.credit || "0", `gl credit (${row.transaction_id || "unknown"})`);
        return {
          transactionId: row.transaction_id,
          date: isoDateToUtcDate(row.date, `gl date (${row.transaction_id || "unknown"})`),
          accountCode: row.account_code,
          accountName: row.account_name,
          description: row.description,
          debit: toDecimalStringFromCents(debitCents),
          credit: toDecimalStringFromCents(creditCents),
          netAmount: toDecimalStringFromCents(debitCents - creditCents),
          currency: row.currency || "GBP",
          reference: row.reference || "",
          status: "PENDING"
        };
      })
    });
  }

  if (bankRows.length > 0) {
    await prisma.bankTransaction.createMany({
      data: bankRows.map((row) => {
        const amountCents = parseMoneyToCents(row.amount || "0", `bank amount (${row.bank_ref || "unknown"})`);
        const txType = (row.type || "credit").toLowerCase();
        const signedAmountCents = txType === "credit" ? amountCents : -amountCents;
        return {
          bankRef: row.bank_ref,
          date: isoDateToUtcDate(row.date, `bank date (${row.bank_ref || "unknown"})`),
          description: row.description,
          amount: toDecimalStringFromCents(signedAmountCents),
          transactionType: txType,
          status: "PENDING"
        };
      })
    });
  }

  return {
    glLoaded: glRows.length,
    bankLoaded: bankRows.length
  };
}
