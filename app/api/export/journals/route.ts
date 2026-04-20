export const dynamic = "force-dynamic";

import { requireApiToken } from "@/server/lib/auth";
import { exportJournalsCsv } from "@/server/services/reconciliationService";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const csv = await exportJournalsCsv();
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=journal_entries.csv"
    }
  });
}

