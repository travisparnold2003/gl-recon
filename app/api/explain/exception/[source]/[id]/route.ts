export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { parsePositiveInt } from "@/server/lib/validation";
import { explainException } from "@/server/services/workspaceService";

export async function POST(request: Request, { params }: { params: { source: string; id: string } }) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const source = params.source === "gl" || params.source === "bank" ? params.source : null;
  const id = parsePositiveInt(params.id);
  if (!source || !id) {
    return NextResponse.json({ error: "Invalid route parameters" }, { status: 400 });
  }

  try {
    const payload = await explainException(source, id);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Explain failed" },
      { status: 400 }
    );
  }
}
