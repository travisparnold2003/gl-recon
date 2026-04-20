import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/server/lib/csv";

describe("parseCsv", () => {
  it("parses a basic csv file", async () => {
    const tempPath = path.join(process.cwd(), "tmp-test.csv");
    try {
      await fs.writeFile(tempPath, "colA,colB\nfoo,bar\n", "utf-8");

      const rows = await parseCsv(tempPath);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ colA: "foo", colB: "bar" });
    } finally {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  });

  it("supports quoted values that include commas", async () => {
    const tempPath = path.join(process.cwd(), "tmp-test-quoted.csv");
    try {
      await fs.writeFile(tempPath, "name,description\ninvoice,\"Spotify, March\"\n", "utf-8");

      const rows = await parseCsv(tempPath);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ name: "invoice", description: "Spotify, March" });
    } finally {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  });

  it("throws on inconsistent column counts", async () => {
    const tempPath = path.join(process.cwd(), "tmp-test-invalid.csv");
    try {
      await fs.writeFile(tempPath, "colA,colB\nfoo\n", "utf-8");
      await expect(parseCsv(tempPath)).rejects.toThrow();
    } finally {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  });
});
