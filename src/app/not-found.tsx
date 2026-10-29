import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "404: page not found · Counterexample" };

/** The 404 page: a landmark, a heading and a way back, in the app's own style (Next's default has no main landmark). */
export default function NotFound() {
  return (
    <main className="wrap">
      <section className="card">
        <h1 className="verdict">Page not found</h1>
        <p className="muted">There is nothing at this address. A report link starts with the site&apos;s home page and a <code>#r=</code> fragment.</p>
        <Link href="/">Go to Counterexample</Link>
      </section>
    </main>
  );
}
