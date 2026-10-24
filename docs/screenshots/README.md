# 390 px screenshots (evidence)

Captured with `pnpm screenshots` (`scripts/screenshots.mjs`: Playwright 1.63.0, Chromium, 390 x 844 viewport, full page) against `pnpm dev` in replay mode on 2026-10-24.

| File | Shows |
| --- | --- |
| `390-1-form.png` | The form on a phone: built-in problems, the buggy binary search, and the **Research the web (Tavily)** toggle ticked. |
| `390-2-report.png` | After the attack: live trace, minimal counterexample `solve([0], 0)`, cited research facts, the verified fix, the share link, and the "Why Ultra here, Super there" panel. |
| `390-3-shared-link.png` | The same report opened from its share link in a fresh page, decoded in the browser ("Nothing was sent to the server"). |

The script run reported: request body `research: "force"`, share link 2,475 characters, no horizontal overflow on either page, no page errors.
