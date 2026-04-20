import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";

export async function parseCsv(filePath: string): Promise<Record<string, string>[]> {
  const raw = await fs.readFile(filePath, "utf-8");
  if (!raw.trim()) {
    return [];
  }

  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false
  }) as Array<Record<string, string>>;

  return records.map((record) => {
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      row[key] = typeof value === "string" ? value : String(value ?? "");
    }
    return row;
  });
}
