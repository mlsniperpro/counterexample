import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnvFiles } from "../../scripts/load-env";

const keys = ["CX_TEST_FROM_LOCAL", "CX_TEST_FROM_BOTH", "CX_TEST_FROM_SHELL"];
afterEach(() => {
  for (const k of keys) delete process.env[k];
});

describe("loadEnvFiles (the CLI scripts read the README's .env.local)", () => {
  it("loads .env.local, then .env, without overriding what the shell set", () => {
    const dir = mkdtempSync(join(tmpdir(), "cx-env-"));
    try {
      writeFileSync(join(dir, ".env.local"), "CX_TEST_FROM_LOCAL=local\nCX_TEST_FROM_BOTH=local\nCX_TEST_FROM_SHELL=local\n");
      writeFileSync(join(dir, ".env"), "CX_TEST_FROM_BOTH=env\n");
      process.env.CX_TEST_FROM_SHELL = "shell";
      expect(loadEnvFiles(dir).map((f) => f.slice(dir.length + 1))).toEqual([".env.local", ".env"]);
      expect([process.env.CX_TEST_FROM_LOCAL, process.env.CX_TEST_FROM_BOTH, process.env.CX_TEST_FROM_SHELL]).toEqual(["local", "local", "shell"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads nothing when there is no env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cx-env-"));
    try {
      expect(loadEnvFiles(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
