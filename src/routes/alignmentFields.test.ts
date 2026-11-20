/**
 * Academic-alignment response fields (DB mocked, no network):
 *  - GET/PATCH-shared profile builder: preferredDegreeLevels /
 *    preferredFieldCipFamilies / preferredStateCodes
 *  - GET /compare/matrix/details: cipCode / degreeLevel / stateCode per entry,
 *    one item per matrix entry (two programs at one college -> two items)
 *  - GET /compare/selected without ?program= -> cipCode/degreeLevel null
 */
process.env.JWT_SECRET ??= "test-secret";
import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import pool from "../db/client";
import { startApp } from "../testUtils/harness";

const UID = "test-firebase-uid";
// profile.ts imports the Firebase admin config, which refuses to load without
// real credentials; the profile GET path never touches it, so stub it.
const firebasePath = require.resolve("../config/firebase");
require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: { firebaseAuth: {} },
} as unknown as NodeJS.Module;

let profileRow: Record<string, unknown> = {};
let matrixRows: Record<string, unknown>[] = [];
let selectedRows: Record<string, unknown>[] = [];

(pool as any).query = async (sql: string) => {
  if (/SELECT is_active FROM usdusers/.test(sql)) return { rows: [{ is_active: true }], rowCount: 1 };
  if (/SELECT id FROM usdusers WHERE firebase_uid/.test(sql)) return { rows: [{ id: "1" }], rowCount: 1 };
  if (/FROM usdusers u/.test(sql)) return { rows: [profileRow], rowCount: 1 };
  if (/FROM compare_matrix_entries/.test(sql) && /selProg/.test(sql)) return { rows: matrixRows, rowCount: matrixRows.length };
  if (/FROM user_compare_history/.test(sql) && /selProg/.test(sql)) return { rows: selectedRows, rowCount: selectedRows.length };
  return { rows: [], rowCount: 0 };
};

async function get(mount: string, router: any, path: string): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JWT_SECRET } = require("../config/jwt");
  const token = jwt.sign({ sub: UID }, JWT_SECRET, { algorithm: "HS256" });
  const { url, server } = await startApp([[mount, router]]);
  try {
    const r = await fetch(`${url}${mount}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    return await r.json();
  } finally {
    server.close();
  }
}

const baseRow = {
  name: "Test University",
  city: "Austin",
  state: "TX",
  sel_program_title: null,
  sel_program_cip: null,
  sel_program_credential_level: null,
  sel_program_credential_title: null,
  sel_program_degree_level: null,
};

test("GET /profile adds normalized alignment fields; unknown -> []", async () => {
  profileRow = {
    id: "1",
    password_hash: "x",
    preferred_degree_level: "Bachelor’s Degree".replace("’", "'"),
    preferred_states: ["tx", "AL", "state"],
    preferred_programs: ["computer science", "Data Science", "Not A Major"],
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const body = await get("/profile", require("./profile").default, "/");
  assert.deepEqual(body.preferredDegreeLevels, ["bachelor"]);
  assert.deepEqual(body.preferredFieldCipFamilies, ["11", "30"]);
  assert.deepEqual(body.preferredStateCodes, ["AL", "TX"]);
  assert.ok(!("password_hash" in body));
  assert.deepEqual(body.preferred_programs, ["computer science", "Data Science", "Not A Major"]);
});

test("GET /profile with nothing saved -> empty arrays", async () => {
  profileRow = { id: "1", preferred_degree_level: null, preferred_states: [], preferred_programs: [] };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const body = await get("/profile", require("./profile").default, "/");
  assert.deepEqual(body.preferredDegreeLevels, []);
  assert.deepEqual(body.preferredFieldCipFamilies, []);
  assert.deepEqual(body.preferredStateCodes, []);
});

test("GET /compare/matrix/details: one item per entry, fields per selected program", async () => {
  matrixRows = [
    { ...baseRow, unitid: "100654", sel_program_title: "Computer Science.", sel_program_cip: "1107", sel_program_credential_level: 3, sel_program_credential_title: "Bachelor's Degree" },
    { ...baseRow, unitid: "100654", sel_program_title: "Agricultural Business.", sel_program_cip: "0101", sel_program_credential_level: 6, sel_program_credential_title: "Doctoral Degree" },
    { ...baseRow, unitid: "100663", state: "state" }, // bare entry, junk state
  ];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const items = await get("/compare", require("./compare").default, "/matrix/details");
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i: any) => [i.unitid, i.cipCode, i.degreeLevel, i.stateCode]),
    [
      [100654, "11.07", "bachelor", "TX"],
      [100654, "01.01", "doctorate", "TX"],
      [100663, null, null, null],
    ],
  );
});

test("GET /compare/selected without ?program= -> cipCode/degreeLevel null", async () => {
  selectedRows = [{ ...baseRow, unitid: "100654", added_at: new Date() }];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const items = await get("/compare", require("./compare").default, "/selected");
  assert.equal(items.length, 1);
  assert.equal(items[0].cipCode, null);
  assert.equal(items[0].degreeLevel, null);
  assert.equal(items[0].stateCode, "TX");
});
