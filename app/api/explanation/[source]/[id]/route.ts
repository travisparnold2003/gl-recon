export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { parsePositiveInt } from "@/server/lib/validation";
import { getExceptionExplanation, updateExceptionExplanation } from "@/server/services/workspaceService";

export async function GET(request: Request, { params }: { params: { source: string; id: string } }) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const source = params.source === "gl" || params.source === "bank" ? params.source : null;
  const id = parsePositiveInt(params.id);
  if (!source || !id) {
    return NextResponse.json({ error: "Invalid route parameters" }, { status: 400 });
  }

  const payload = await getExceptionExplanation(source, id);
  return NextResponse.json(payload);
}

export async function PUT(request: Request, { params }: { params: { source: string; id: string } }) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const source = params.source === "gl" || params.source === "bank" ? params.source : null;
  const id = parsePositiveInt(params.id);
  if (!source || !id) {
    return NextResponse.json({ error: "Invalid route parameters" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const text = String((body as { text?: unknown }).text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const payload = await updateExceptionExplanation(source, id, text);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 400 }
    );
  }
}
