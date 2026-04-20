export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { createBankJournal } from "@/server/services/reconciliationService";
import { parsePositiveInt } from "@/server/lib/validation";

export async function POST(request: Request, { params }: { params: { bankId: string } }) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const bankId = parsePositiveInt(params.bankId);
  if (!bankId) {
    return NextResponse.json({ created: false, error: "Invalid route parameters" }, { status: 400 });
  }

  const result = await createBankJournal(bankId);
  if (!result.ok || !result.journal) {
    return NextResponse.json({ created: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    created: true,
    id: result.journal.id,
    amount: Number(result.journal.amount),
    description: result.journal.description
  });
}
