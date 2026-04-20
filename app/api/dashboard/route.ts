export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { getDashboardPayload } from "@/server/services/reconciliationService";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = await getDashboardPayload();
  return NextResponse.json(payload);
}

