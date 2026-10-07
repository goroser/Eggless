import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import RootLayout from "@/app/layout";
import { ru } from "@/lib/i18n/ru";

describe("RootLayout", () => {
  test("is Russian and carries the footer", () => {
    const html = renderToStaticMarkup(<RootLayout>x</RootLayout>);
    expect(html).toContain('<html lang="ru"');
    expect(html).toContain(ru.footer);
  });
});
