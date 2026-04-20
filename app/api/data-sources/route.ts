export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { getDataSourcesPayload } from "@/server/services/workspaceService";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = await getDataSourcesPayload();
  return NextResponse.json(payload);
}
