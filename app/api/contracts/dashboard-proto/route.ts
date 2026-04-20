export const dynamic = "force-dynamic";

import fs from "node:fs/promises";
import path from "node:path";
import protobuf from "protobufjs";
import { requireApiToken } from "@/server/lib/auth";
import { getDashboardPayload } from "@/server/services/reconciliationService";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const protoPath = path.join(process.cwd(), "proto", "reconciliation.proto");
  const protoRaw = await fs.readFile(protoPath, "utf-8");
  const root = protobuf.parse(protoRaw).root;
  const messageType = root.lookupType("glrecon.v1.DashboardStats");

  const dashboard = await getDashboardPayload();
  const payload = {
    total_gl: dashboard.stats.totalGl,
    total_bank: dashboard.stats.totalBank,
    matched: dashboard.stats.matched,
    proposed: dashboard.stats.proposed,
    gl_exceptions: dashboard.stats.glExceptions,
    bank_exceptions: dashboard.stats.bankExceptions,
    journals: dashboard.stats.journals,
    pending_gl: dashboard.stats.pendingGl,
    pending_bank: dashboard.stats.pendingBank
  };

  const err = messageType.verify(payload);
  if (err) {
    return new Response(`Proto verify failed: ${err}`, { status: 500 });
  }

  const encoded = messageType.encode(payload).finish();
  return new Response(encoded, {
    headers: {
      "Content-Type": "application/x-protobuf"
    }
  });
}

