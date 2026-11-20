import pool from "../../db/client";

export interface ApiError {
  error: string;
  details?: string;
}

export function toPositiveInt(value: unknown, fallback: number): number {
  const number = typeof value === "string" ? parseInt(value, 10) : Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** Express 5 types route params as `string | string[]`; one `:x` segment is a string at runtime. */
export function toParamString(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export async function resolveUserId(firebaseUid: string): Promise<number | null> {
  const result = await pool.query<{ id: number }>(
    "SELECT id FROM usdusers WHERE firebase_uid = $1",
    [firebaseUid],
  );
  return result.rows[0]?.id ?? null;
}

export async function getUserEmail(userId: number): Promise<string | null> {
  const result = await pool.query<{ email: string }>(
    "SELECT email FROM usdusers WHERE id = $1",
    [userId],
  );
  return result.rows[0]?.email ?? null;
}
