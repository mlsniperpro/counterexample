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
