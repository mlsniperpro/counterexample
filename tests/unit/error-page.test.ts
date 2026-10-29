import { createElement, isValidElement, useEffect, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ErrorPage only adds a logging effect; with it stubbed, calling the component returns its tree, so its props can be read.
vi.mock("react", async (actual) => ({ ...(await actual<typeof import("react")>()), useEffect: vi.fn() }));
import ErrorPage, { ErrorView } from "@/app/error";

/** Every element in a tree of plain host elements (ErrorView has no hooks, so calling it returns its tree). */
function elements(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void }>[] {
  if (!isValidElement<{ children?: ReactNode }>(node)) return Array.isArray(node) ? node.flatMap(elements) : [];
  const kids = node.props.children;
  return [node, ...(Array.isArray(kids) ? kids.flatMap(elements) : elements(kids))];
}

describe("the error boundary", () => {
  it("shows an alert with a way to try again", () => {
    const html = renderToStaticMarkup(createElement(ErrorPage, { error: new Error("boom"), retry: () => {} }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong");
    expect(html).toContain(">Try again</button>");
    // The error itself is logged, never shown to the reader.
    expect(html).not.toContain("boom");
  });

  it("wires the button to retry", () => {
    const retry = vi.fn();
    const button = elements(ErrorView({ onRetry: retry })).find((e) => e.type === "button");
    button?.props.onClick?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("passes the boundary's retry to the button, and logs the error", () => {
    const retry = vi.fn();
    const tree = ErrorPage({ error: new Error("boom"), retry });
    expect(isValidElement(tree) && tree.type).toBe(ErrorView);
    expect((tree as ReactElement<{ onRetry: () => void }>).props.onRetry).toBe(retry);
    const effect = vi.mocked(useEffect).mock.calls.at(-1)?.[0];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    effect?.();
    expect(log).toHaveBeenCalledWith(new Error("boom"));
    log.mockRestore();
  });
});
