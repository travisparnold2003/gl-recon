export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { syncDataSource } from "@/server/services/workspaceService";

export async function POST(request: Request, { params }: { params: { key: string } }) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const payload = await syncDataSource(params.key);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { synced: false, error: error instanceof Error ? error.message : "Sync failed" },
      { status: 400 }
    );
  }
}
