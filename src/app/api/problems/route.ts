import { connection } from "next/server";
import { problemsPayload } from "@/lib/agent/api";
import { resolveMode } from "@/lib/agent/setup";

/** The server's mode (live or replay) and the built-in problems. */
export async function GET() {
  // Read env at request time, not at build time.
  await connection();
  return Response.json(problemsPayload(resolveMode()));
}
