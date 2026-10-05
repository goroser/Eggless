import { describe, expect, test } from "vitest";
import { gate } from "@/lib/access";

const KEY = "k".repeat(40);
const u = (path: string) => new URL(`https://eggless.example${path}`);

describe("gate", () => {
  test("no cookie on a page", () => expect(gate(u("/"), undefined, KEY)).toEqual({ action: "deny", api: false }));
  test("no cookie on the API", () => expect(gate(u("/api/search"), undefined, KEY)).toEqual({ action: "deny", api: true }));
  test("wrong cookie", () => expect(gate(u("/"), "nope", KEY)).toEqual({ action: "deny", api: false }));
  test("right cookie", () => expect(gate(u("/api/menu"), KEY, KEY)).toEqual({ action: "pass" }));
  test("?k= sets the cookie and redirects to /", () =>
    expect(gate(u(`/?k=${KEY}`), undefined, KEY)).toEqual({ action: "set-cookie-redirect", location: "/" }));
  test("other query params survive the redirect", () =>
    expect(gate(u(`/?k=${KEY}&x=1`), undefined, KEY)).toEqual({ action: "set-cookie-redirect", location: "/?x=1" }));
  test("wrong ?k= is denied", () => expect(gate(u("/?k=wrong"), undefined, KEY)).toEqual({ action: "deny", api: false }));
  test("an empty access key denies everything", () => {
    expect(gate(u("/"), "", "")).toEqual({ action: "deny", api: false });
    expect(gate(u("/?k="), undefined, "")).toEqual({ action: "deny", api: false });
  });
});
