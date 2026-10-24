import { connection } from "next/server";
import { resolveMode } from "@/lib/agent/setup";
import { BUILT_INS } from "@/lib/problems/catalog";

/** Built-in problems with their buggy demo solutions, and which mode the server runs in. */
export async function GET() {
  // Read env at request time, not at build time.
  await connection();
  return Response.json({
    mode: resolveMode(),
    problems: BUILT_INS.map((b) => ({ ...b.problem, demo: { language: b.demo.language, code: b.demo.code, entry: b.demo.entry } })),
  });
}
