export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { createGlJournal } from "@/server/services/reconciliationService";
import { parsePositiveInt } from "@/server/lib/validation";

export async function POST(request: Request, { params }: { params: { glId: string } }) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const glId = parsePositiveInt(params.glId);
  if (!glId) {
    return NextResponse.json({ created: false, error: "Invalid route parameters" }, { status: 400 });
  }

  const result = await createGlJournal(glId);
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
