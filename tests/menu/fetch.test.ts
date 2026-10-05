import { describe, expect, test, vi } from "vitest";
import { createFetcher, createSafeLookup, fetchHome, isPrivateAddress, isSkippedHost, USER_AGENT } from "@/lib/menu/fetch";
import type { Fetched, MenuFetcher } from "@/lib/types";

const publicLookup = async () => ["93.184.216.34"];

function response(body: string | Uint8Array<ArrayBuffer>, init: ResponseInit = {}) {
  return new Response(body, init);
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

describe("isPrivateAddress", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  test.each(["8.8.8.8", "172.32.0.1", "2a00:1450::1"])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("createFetcher", () => {
  test("refuses hosts that resolve to a private address without fetching", async () => {
    const fetchImpl = vi.fn();
    const fetcher = createFetcher({ fetchImpl, lookup: async () => ["10.0.0.5"] });
    await expect(fetcher("https://cafe.example/", 1000)).rejects.toThrow(/private address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each(["ftp://x.com/menu", "file:///etc/passwd"])("refuses %s", async (url) => {
    const fetcher = createFetcher({ fetchImpl: vi.fn(), lookup: publicLookup });
    await expect(fetcher(url, 1000)).rejects.toThrow(/unsupported protocol/);
  });

  test("enforces the byte cap", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    const fetcher = createFetcher({ fetchImpl: async () => response(big), lookup: publicLookup });
    await expect(fetcher("https://cafe.example/", 2 * 1024 * 1024)).rejects.toThrow(/over 2097152 bytes/);
  });

  test("refuses a redirect to a skipped host", async () => {
    const fetcher = createFetcher({
      fetchImpl: async () => redirect("https://www.instagram.com/x"),
      lookup: publicLookup,
    });
    await expect(fetcher("https://cafe.example/", 1000)).rejects.toThrow(/skipped host/);
  });

  test("re-checks every redirect hop for private addresses", async () => {
    const fetchImpl = vi.fn(async () => redirect("http://internal.test/"));
    const fetcher = createFetcher({
      fetchImpl,
      lookup: async (host) => (host === "internal.test" ? ["192.168.0.2"] : ["93.184.216.34"]),
    });
    await expect(fetcher("https://cafe.example/", 1000)).rejects.toThrow(/private address/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("gives up after 5 redirects", async () => {
    let n = 0;
    const fetcher = createFetcher({
      fetchImpl: async () => redirect(`https://cafe.example/${++n}`),
      lookup: publicLookup,
    });
    await expect(fetcher("https://cafe.example/", 1000)).rejects.toThrow(/too many redirects/);
  });

  test("follows a redirect and reports the final URL", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url) === "http://cafe.example/" ? redirect("https://www.cafe.example/") : response("<p>hi</p>", { headers: { "content-type": "text/html" } }),
    );
    const fetcher = createFetcher({ fetchImpl: fetchImpl as typeof fetch, lookup: publicLookup });
    const f = await fetcher("http://cafe.example/", 1000);
    expect(f.url).toBe("https://www.cafe.example/");
    expect(f.contentType).toBe("text/html");
    expect(f.body.toString()).toBe("<p>hi</p>");
  });

  test("sends the Eggless User-Agent", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response("ok"));
    const fetcher = createFetcher({ fetchImpl: fetchImpl as typeof fetch, lookup: publicLookup });
    await fetcher("https://cafe.example/", 1000);
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.get("user-agent")).toBe(USER_AGENT);
    expect(USER_AGENT).toBe("EgglessBot/0.1 (personal project; one fetch per cafe)");
  });

  test("rejects non-2xx with the status in the message", async () => {
    const fetcher = createFetcher({ fetchImpl: async () => response("no", { status: 404 }), lookup: publicLookup });
    await expect(fetcher("https://cafe.example/", 1000)).rejects.toThrow(/HTTP 404/);
  });
});

describe("fetchHome", () => {
  const ok: Fetched = { url: "https://caffenero.com/uk/", contentType: "text/html", body: Buffer.from("home") };

  test("falls back to the locale section, then the root, on 4xx", async () => {
    const calls: string[] = [];
    const fetcher: MenuFetcher = async (url) => {
      calls.push(url);
      if (url === "https://caffenero.com/") return { ...ok, url };
      throw new Error("HTTP 404");
    };
    const f = await fetchHome(fetcher, "https://caffenero.com/uk/store/chiswick-park-71/?utm=x");
    expect(calls).toEqual([
      "https://caffenero.com/uk/store/chiswick-park-71/?utm=x",
      "https://caffenero.com/uk/",
      "https://caffenero.com/",
    ]);
    expect(f.url).toBe("https://caffenero.com/");
  });

  test("returns the first successful fallback", async () => {
    const calls: string[] = [];
    const fetcher: MenuFetcher = async (url) => {
      calls.push(url);
      if (url === "https://caffenero.com/uk/") return ok;
      throw new Error("HTTP 404");
    };
    await fetchHome(fetcher, "https://caffenero.com/uk/store/x/");
    expect(calls).toEqual(["https://caffenero.com/uk/store/x/", "https://caffenero.com/uk/"]);
  });

  test("does not retry a 500", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("HTTP 500");
    });
    await expect(fetchHome(fetcher, "https://cafe.example/menu")).rejects.toThrow(/HTTP 500/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("uses the 2 MB HTML cap", async () => {
    const fetcher = vi.fn(async (url: string) => ({ ...ok, url }));
    await fetchHome(fetcher, "https://cafe.example/");
    expect(fetcher).toHaveBeenCalledWith("https://cafe.example/", 2 * 1024 * 1024);
  });
});

describe("review fixes: address safety", () => {
  test.each([
    "::ffff:7f00:1",
    "::7f00:1",
    "::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "fec0::1",
    "2002:7f00:1::",
    "ff02::1",
    "192.0.0.1",
    "198.18.0.1",
    "100.64.0.1",
  ])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  test.each([
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::127.0.0.1]/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://[fec0::1]/",
    "http://[2002:7f00:1::]/",
    "http://2130706433/",
    "http://0x7f.1/",
  ])("refuses the URL literal %s without fetching", async (url) => {
    const fetchImpl = vi.fn();
    const fetcher = createFetcher({ fetchImpl, lookup: publicLookup });
    await expect(fetcher(url, 1000)).rejects.toThrow(/private address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("connect-time lookup refuses a host that now resolves to a private address", async () => {
    const lookup = createSafeLookup(async () => [{ address: "127.0.0.1", family: 4 }]);
    const err = await new Promise<Error | null>((resolve) => lookup("rebind.example", {}, (e) => resolve(e)));
    expect(err?.message).toMatch(/private address/);
  });

  test("connect-time lookup passes a public address to the socket", async () => {
    const lookup = createSafeLookup(async () => [{ address: "93.184.216.34", family: 4 }]);
    const got = await new Promise<unknown[]>((resolve) => lookup("cafe.example", {}, (...args) => resolve(args)));
    expect(got).toEqual([null, "93.184.216.34", 4]);
  });

  test("connect-time lookup answers the all:true form", async () => {
    const lookup = createSafeLookup(async () => [{ address: "93.184.216.34", family: 4 }]);
    const got = await new Promise<unknown[]>((resolve) => lookup("cafe.example", { all: true }, (...args) => resolve(args)));
    expect(got).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
  });
});

describe("review fixes: skipped hosts", () => {
  test.each(["www.instagram.com", "deliveroo.co.uk", "x.com", "www.opentable.co.uk", "www.google.com", "exploretock.com", "resy.com"])(
    "%s is skipped",
    (h) => expect(isSkippedHost(h)).toBe(true),
  );
  test.each(["fox.com", "bistrox.com", "lux.community", "mytockcafe.com", "resyard.co.uk", "googlecafe.co.uk"])(
    "%s is not skipped",
    (h) => expect(isSkippedHost(h)).toBe(false),
  );
});
