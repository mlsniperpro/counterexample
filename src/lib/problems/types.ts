import type { CompareMode } from "../core/compare";
import type { Param } from "../core/spec";
import type { Language } from "../exec/types";

export type Example = { args: unknown[]; output: unknown };

export type Solution = { language: Language; code: string; entry: string };

export type Problem = {
  id: string;
  title: string;
  statement: string;
  /** Parameters, typed with the input DSL. Generated and shrunk inputs must conform. */
  params: Param[];
  returns: string;
  examples: Example[];
  compare: CompareMode;
  timeLimitMs: number;
  memoryLimitMb: number;
  /** External facts the statement depends on; triggers the Tavily research stage. */
  references?: string[];
};

export type BuiltIn = {
  problem: Problem;
  /** A subtly buggy solution for the demo. */
  demo: Solution & { bug: string };
};
