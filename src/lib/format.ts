export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(amount));
}

export function formatMoneyShort(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `£${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `£${(abs / 1_000).toFixed(1)}k`;
  return `£${abs.toFixed(0)}`;
}

export function formatDate(raw: string | null): string {
  if (!raw) return "Never";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

export function sourceBadgeClass(status: string): string {
  if (status === "connected") return "badge badge-green";
  if (status === "error") return "badge badge-red";
  return "badge badge-zinc";
}
