export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { approvePair } from "@/server/services/reconciliationService";
import { parsePositiveInt } from "@/server/lib/validation";

export async function POST(request: Request, { params }: { params: { glId: string; bankId: string } }) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const glId = parsePositiveInt(params.glId);
  const bankId = parsePositiveInt(params.bankId);
  if (!glId || !bankId) {
    return NextResponse.json({ approved: false, error: "Invalid route parameters" }, { status: 400 });
  }

  const result = await approvePair(glId, bankId);
  if (!result.ok) {
    return NextResponse.json({ approved: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ approved: true });
}
