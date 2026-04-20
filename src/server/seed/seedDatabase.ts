import { prisma } from "@/server/lib/db";
import { loadSampleData } from "@/server/seed/loadSampleData";

async function main() {
  const result = await loadSampleData();
  console.log("Seed complete", result);
}

main()
  .catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
