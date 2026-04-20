export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { getAuditTrail } from "@/server/services/workspaceService";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") || "80", 10);
  const payload = await getAuditTrail(Number.isSafeInteger(limit) ? limit : 80);
  return NextResponse.json(payload);
}
