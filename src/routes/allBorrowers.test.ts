/**
 * Item 3: repayment.all_borrowers_3yr is 100 in all 5,761 rows (an ingest
 * artifact — see the column comment). It is suppressed at the source: no
 * route selects it, and /campus never returns it even when the row holds it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pool from "../db/client";
import { startApp } from "../testUtils/harness";

(pool as any).query = async () => ({
  rows: [{ size: 1000, graduates_3yr: 40, all_borrowers_3yr: 100 }],
  rowCount: 1,
});

test("GET /campus/:unitid never returns all_borrowers_3yr", async () => {
  process.env.JWT_SECRET ??= "test-secret";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const router = require("./campus").default;
  const { url, server } = await startApp([["/campus", router]]);
  try {
    const res = await fetch(`${url}/campus/100654`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.repayment.graduates_3yr, 40);
    assert.ok(!("all_borrowers_3yr" in body.repayment));
    assert.ok(!JSON.stringify(body).includes("all_borrowers"));
  } finally {
    server.close();
  }
});

test("no API source file selects or returns all_borrowers_3yr", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        const code = fs.readFileSync(p, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/--.*$/gm, "");
        if (/all_borrowers_3yr/.test(code)) offenders.push(path.relative(dir, p));
      }
    }
  };
  walk(path.join(__dirname, ".."));
  assert.deepEqual(offenders, []);
});
