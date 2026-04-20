export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { parsePositiveInt } from "@/server/lib/validation";
import { getMatchReasoning } from "@/server/services/workspaceService";

export async function GET(request: Request, { params }: { params: { glId: string; bankId: string } }) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const glId = parsePositiveInt(params.glId);
  const bankId = parsePositiveInt(params.bankId);
  if (!glId || !bankId) {
    return NextResponse.json({ error: "Invalid route parameters" }, { status: 400 });
  }

  const payload = await getMatchReasoning(glId, bankId);
  return NextResponse.json(payload);
}
