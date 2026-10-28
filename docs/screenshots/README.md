# Screenshots (evidence)

Captured with `pnpm screenshots` (`scripts/screenshots.mjs`: Playwright 1.63.0, Chromium, 390 x 844 viewport, full page; the thumbnail at 1200 x 800) against `pnpm dev` in replay mode on 2026-10-28.

| File | Shows |
| --- | --- |
| `390-1-form.png` | The form on a phone: built-in problems, the buggy binary search, and the **Research the web (Tavily)** toggle ticked. |
| `390-2-report.png` | After the attack: live trace, minimal counterexample `solve([0], 0)`, cited research facts, the verified fix shown as a diff against the submitted code, the share link, and the "Why Ultra here, Super there" panel. |
| `devpost-thumbnail-1200x800.png` | A 1200 x 800 desktop view (3:2, the Devpost thumbnail): the verdict, the minimal counterexample, the fix as a diff and the live trace. |
| `390-3-shared-link.png` | The same report opened from its share link in a fresh page, decoded in the browser ("Nothing was sent to the server"). |

The script run reported: request body `research: "force"`, share link about 2,600 characters (2,598 in the last run; it varies a little with timing in the report), no horizontal overflow on either page, no page errors.
