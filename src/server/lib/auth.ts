import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const BEARER_PREFIX = "Bearer ";

function safeTokenEquals(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function getBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export function requireApiToken(request: Request): NextResponse | null {
  const expectedToken = process.env.API_AUTH_TOKEN?.trim() ?? "";
  if (!expectedToken) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Server misconfiguration: API_AUTH_TOKEN is required" }, { status: 500 });
    }
    return null;
  }

  const providedToken =
    getBearerToken(request.headers.get("authorization")) ?? request.headers.get("x-api-token")?.trim() ?? null;

  if (!providedToken || !safeTokenEquals(expectedToken, providedToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}