/** The error a promise rejects with; fails the test if it resolves. */
export async function rejectionOf<E extends Error = Error>(p: Promise<unknown>): Promise<E> {
  return p.then(
    () => {
      throw new Error("expected the promise to reject, but it resolved");
    },
    (e: unknown) => e as E,
  );
}
