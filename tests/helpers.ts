/** The error a promise rejects with; fails the test if it resolves. */
export async function rejectionOf<E extends Error = Error>(p: Promise<unknown>): Promise<E> {
  return p.then(
    () => {
      throw new Error("expected the promise to reject, but it resolved");
    },
    (e: unknown) => e as E,
  );
}

/** numRuns for a slow property: the given default, or FC_NUM_RUNS when set (deep runs). */
export const runs = (n: number): number => Number(process.env.FC_NUM_RUNS ?? n);

/**
 * A clock of this process's CPU time, in ms. Speed bounds use it instead of
 * wall time: each test file runs in its own worker process, so other load on
 * the machine does not inflate it (a busy CI box made wall-clock bounds flaky).
 */
export function cpuClock(): () => number {
  const start = process.cpuUsage();
  return () => {
    const d = process.cpuUsage(start);
    return (d.user + d.system) / 1000;
  };
}
