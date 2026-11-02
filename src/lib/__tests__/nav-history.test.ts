import { beforeEach, describe, expect, it, vi } from "vitest";

type NavHistory = typeof import("@/lib/nav-history");

// The tracker keeps module state for the life of a page, so each test loads a
// fresh copy, like a fresh page load.
let nav: NavHistory;

beforeEach(async () => {
  vi.resetModules();
  nav = await import("@/lib/nav-history");
});

/** A browser back or forward arriving at `path`, as the popstate listener sees it. */
function traverseTo(path: string) {
  vi.stubGlobal("window", { location: { pathname: path } });
  nav.noteTraversal();
  nav.recordPage(path);
}

describe("nav-history", () => {
  it("has nothing to go back to on the first page", () => {
    nav.recordPage("/menu/tiramisu");
    expect(nav.getNavSnapshot()).toEqual({ current: "/menu/tiramisu", previous: null });
  });

  it("knows the page a link came from", () => {
    nav.recordPage("/");
    nav.recordPage("/menu/tiramisu");
    expect(nav.getNavSnapshot().previous).toBe("/");
  });

  it("follows back and forward through the pages", () => {
    nav.recordPage("/menu");
    nav.recordPage("/menu/tiramisu");
    nav.recordPage("/menu/apple-crumble");
    traverseTo("/menu/tiramisu");
    expect(nav.getNavSnapshot()).toEqual({ current: "/menu/tiramisu", previous: "/menu" });
    traverseTo("/menu/apple-crumble");
    expect(nav.getNavSnapshot().previous).toBe("/menu/tiramisu");
  });

  it("never offers a way back past the first page of the visit", () => {
    // Arrived on a product from another site, opened a second one, came back.
    nav.recordPage("/menu/tiramisu");
    nav.recordPage("/menu/apple-crumble");
    traverseTo("/menu/tiramisu");
    expect(nav.getNavSnapshot().previous).toBeNull();
  });

  it("restores only on a return, not on a fresh visit", () => {
    nav.recordPage("/menu");
    nav.recordPage("/menu/tiramisu");
    traverseTo("/menu");
    expect(nav.isReturningTo("/menu")).toBe(true);
    nav.recordPage("/menu/apple-crumble");
    nav.recordPage("/menu");
    expect(nav.isReturningTo("/menu")).toBe(false);
  });
});
