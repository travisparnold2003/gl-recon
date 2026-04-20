export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { resetData } from "@/server/services/reconciliationService";

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = await resetData();
  return NextResponse.json(payload);
}

