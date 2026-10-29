import { BUILT_INS } from "@/lib/problems/catalog";
import AttackUI, { type UIProblem } from "./attack-ui";

/** Static shell; the client asks /api/problems whether the server runs live or replay. */
export default function Home() {
  const problems: UIProblem[] = BUILT_INS.map((b) => ({
    id: b.problem.id,
    title: b.problem.title,
    statement: b.problem.statement,
    examples: b.problem.examples,
    language: b.demo.language,
    code: b.demo.code,
  }));
  return <AttackUI problems={problems} />;
}
