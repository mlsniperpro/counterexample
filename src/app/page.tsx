import AttackUI from "./attack-ui";
import { uiProblems } from "./ui-problems";

/** Static shell; the client asks /api/problems whether the server runs live or replay. */
export default function Home() {
  return <AttackUI problems={uiProblems()} />;
}
