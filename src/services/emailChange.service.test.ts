import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideEmailChange,
  findConflictingEmailOwner,
  releaseDeactivatedEmailOwner,
  Queryable,
} from "./emailChange.service";
import { REACTIVATION_COOLDOWN_HOURS } from "../utils/deactivationCooldown";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse("2026-01-15T00:00:00.000Z");

test("verified current email, no conflicting owner -> allowed", () => {
  const decision = decideEmailChange({
    currentEmailVerified: true,
    existingOwner: null,
    now: NOW,
  });
  assert.deepEqual(decision, { allowed: true });
});

test("unverified current email -> rejected regardless of the new email's availability", () => {
  const decision = decideEmailChange({
    currentEmailVerified: false,
    existingOwner: null,
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.code, "CURRENT_EMAIL_NOT_VERIFIED");
  }
});

test("new email belongs to another user, verified and active -> rejected as already in use", () => {
  const decision = decideEmailChange({
    currentEmailVerified: true,
    existingOwner: { id: 42, isActive: true, deactivatedAt: null },
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.code, "EMAIL_ALREADY_IN_USE");
  }
});

test("new email belongs to another user, active but unverified -> still rejected as already in use", () => {
  // isActive: true here models an unverified-but-live account (unverified is
  // not the same column as is_active) — either way it's someone else's row.
  const decision = decideEmailChange({
    currentEmailVerified: true,
    existingOwner: { id: 43, isActive: true, deactivatedAt: null },
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.code, "EMAIL_ALREADY_IN_USE");
  }
});

test("new email belonged to a recently deactivated account, still within cooldown -> rejected", () => {
  const deactivatedAt = new Date(NOW - 1 * HOUR_MS).toISOString(); // 1h ago, well within the 24h window
  const decision = decideEmailChange({
    currentEmailVerified: true,
    existingOwner: { id: 44, isActive: false, deactivatedAt },
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.code, "EMAIL_IN_COOLDOWN");
  }
});

test("new email belonged to a deactivated account, right at the cooldown boundary -> still rejected", () => {
  const deactivatedAt = new Date(
    NOW - REACTIVATION_COOLDOWN_HOURS * HOUR_MS + 1000,
  ).toISOString(); // 1s short of the window elapsing
  const decision = decideEmailChange({
    currentEmailVerified: true,
    existingOwner: { id: 45, isActive: false, deactivatedAt },
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.code, "EMAIL_IN_COOLDOWN");
  }
});

test("new email available and past its deactivation cooldown -> allowed, flags the old row for release", () => {
  const deactivatedAt = new Date(
    NOW - (REACTIVATION_COOLDOWN_HOURS + 1) * HOUR_MS,
  ).toISOString(); // 1h past the window
  const decision = decideEmailChange({
    currentEmailVerified: true,
    existingOwner: { id: 46, isActive: false, deactivatedAt },
    now: NOW,
  });
  assert.deepEqual(decision, { allowed: true, releaseFromUserId: 46 });
});

test("current email verified takes priority: even a valid new email is rejected when the current one is unverified", () => {
  const decision = decideEmailChange({
    currentEmailVerified: false,
    existingOwner: { id: 47, isActive: false, deactivatedAt: new Date(0).toISOString() },
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.code, "CURRENT_EMAIL_NOT_VERIFIED");
  }
});

test("user A cannot change their email to user B's email — B's row (found by the lookup) always rejects A's request", () => {
  // Simulates the exact shape findConflictingEmailOwner would return for
  // "SELECT ... WHERE LOWER(email) = B's email AND firebase_uid IS DISTINCT
  // FROM A's uid" — i.e. B's own row, which is definitionally not A's.
  const userBsRow = { id: 99, isActive: true, deactivatedAt: null };
  const decision = decideEmailChange({
    currentEmailVerified: true, // A's own current email is verified
    existingOwner: userBsRow,
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.code, "EMAIL_ALREADY_IN_USE");
  }
});

// --- DB-layer helpers shared by PATCH /account/email, /auth/login, and
// /auth/apple — these are the actual enforcement point once the API is
// called directly (not just something the pure decision function models).

/** Minimal fake satisfying the `Queryable` shape, recording every call made on it. */
function fakeDb(rows: unknown[]) {
  const calls: { text: string; params: unknown[] }[] = [];
  const db = {
    calls,
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return { rows };
    },
  };
  return db as typeof db & { query: Queryable["query"] };
}

test("findConflictingEmailOwner excludes ONLY the row matching the trusted firebase_uid passed in — never an id/email/provider field from a request body", async () => {
  const db = fakeDb([{ id: 7, is_active: true, deactivated_at: null }]);
  const owner = await findConflictingEmailOwner(
    db,
    "Victim@Example.com",
    "trusted-firebase-uid-of-caller",
  );

  assert.deepEqual(owner, { id: 7, isActive: true, deactivatedAt: null });
  assert.equal(db.calls.length, 1);
  // Lowercased before hitting the DB, and the ONLY exclusion parameter is the
  // caller's own trusted uid — there is no code path here that accepts an
  // attacker-supplied id/auth_provider/provider_user_id to broaden or
  // narrow the exclusion.
  assert.deepEqual(db.calls[0].params, [
    "victim@example.com",
    "trusted-firebase-uid-of-caller",
  ]);
  assert.match(db.calls[0].text, /firebase_uid IS DISTINCT FROM \$2/);
});

test("findConflictingEmailOwner returns null when no other row holds the email", async () => {
  const db = fakeDb([]);
  const owner = await findConflictingEmailOwner(db, "free@example.com", "uid-1");
  assert.equal(owner, null);
});

test("releaseDeactivatedEmailOwner renames the old row's email instead of deleting or reassigning it to the new owner", async () => {
  const db = fakeDb([]);
  await releaseDeactivatedEmailOwner(db, 46, "reused@example.com");

  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /UPDATE usdusers SET email = \$1 WHERE id = \$2/);
  assert.deepEqual(db.calls[0].params, [
    "deleted+46+reused@example.com",
    46,
  ]);
});
