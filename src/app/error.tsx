"use client";

import { useEffect } from "react";

/**
 * The route's error boundary (an error file must be a Client Component). An
 * unexpected render failure shows this instead of a blank page; the attack's
 * own failures are shown inline by AttackUI and never reach it. Next 16
 * passes `retry` (re-fetch and re-render the segment), not the older `reset`.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="wrap">
      <section className="card" role="alert">
        <h1 className="verdict">Something went wrong</h1>
        <p className="muted">The page hit an unexpected error and could not show its content. Try again, or reload the page.</p>
        <button className="go" onClick={() => retry()}>
          Try again
        </button>
      </section>
    </main>
  );
}
