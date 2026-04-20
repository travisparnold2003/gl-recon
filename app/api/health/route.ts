export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getHealthPayload } from "@/server/services/reconciliationService";

export async function GET() {
  const payload = await getHealthPayload();
  return NextResponse.json(payload);
}

