export function parsePositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export function parseMoneyToCents(raw: string, fieldName: string): number {
  const value = raw.trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error(`Invalid money value for ${fieldName}: ${raw}`);
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${fieldName}: ${raw}`);
  }

  return Math.round(parsed * 100);
}

export function isoDateToUtcDate(value: string, fieldName: string): Date {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`Invalid date format for ${fieldName}: ${value}`);
  }

  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value for ${fieldName}: ${value}`);
  }
  return date;
}