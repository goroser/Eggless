import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, gate } from "@/lib/access";
import { ru } from "@/lib/i18n/ru";

const DENIED_PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eggless</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;color:#1c1917;background:#fafaf9"><p>${ru.privatePage}</p></body></html>`;

export function proxy(req: NextRequest) {
  const decision = gate(req.nextUrl, req.cookies.get(COOKIE)?.value, process.env.ACCESS_KEY ?? "");
  if (decision.action === "pass") return NextResponse.next();
  if (decision.action === "set-cookie-redirect") {
    const res = NextResponse.redirect(new URL(decision.location, req.url));
    res.cookies.set(COOKIE, process.env.ACCESS_KEY!, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 31_536_000,
      path: "/",
    });
    return res;
  }
  if (decision.api) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return new NextResponse(DENIED_PAGE, { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
