export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { getDataSourcePreview } from "@/server/services/workspaceService";

export async function GET(request: Request, { params }: { params: { key: string } }) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const payload = await getDataSourcePreview(params.key);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preview failed" },
      { status: 400 }
    );
  }
}
