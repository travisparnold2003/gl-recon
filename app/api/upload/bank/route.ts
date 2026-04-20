export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireApiToken } from "@/server/lib/auth";
import { replaceBankFromCsv } from "@/server/services/workspaceService";

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ uploaded: false, error: "Missing file" }, { status: 400 });
  }

  try {
    const content = await file.text();
    const payload = await replaceBankFromCsv(content, "bank_feed", "manual");
    return NextResponse.json({ uploaded: true, ...payload });
  } catch (error) {
    return NextResponse.json(
      { uploaded: false, error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 }
    );
  }
}
