export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { getSettingsPayload, updateSettingsPayload } from "@/server/services/workspaceService";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = await getSettingsPayload();
  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => ({}));
  const payload = await updateSettingsPayload(body as Record<string, unknown>);
  return NextResponse.json(payload);
}
