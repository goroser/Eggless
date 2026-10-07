import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { proxy } from "@/proxy";
import { ru } from "@/lib/i18n/ru";

afterEach(() => vi.unstubAllEnvs());

describe("proxy", () => {
  test("the private page is Russian", async () => {
    vi.stubEnv("ACCESS_KEY", "k".repeat(40));
    const res = proxy(new NextRequest("https://eggless.example/"));
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain(ru.privatePage);
    expect(body).toContain('lang="ru"');
  });
});
