// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CafePhotos } from "@/components/CafePhotos";
import { stubIntersectionObserver } from "../helpers/intersection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const photos = [
  { ref: "r1", attribution: { name: "Anna K", uri: "https://maps.google.com/contrib/1" } },
  { ref: "r2", attribution: { name: "", uri: "" } },
];
const imgs = () => [...document.querySelectorAll("img")];

describe("CafePhotos", () => {
  test("shows the website image directly, lazily, without a referrer", () => {
    stubIntersectionObserver();
    render(<CafePhotos imageUrl="https://cafe.example/room.jpg" photos={photos} name="Post Room" />);
    expect(imgs()).toHaveLength(1);
    const img = imgs()[0];
    expect(img.getAttribute("src")).toBe("https://cafe.example/room.jpg");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  test("falls back to Google photos when the website image fails, but only once visible", () => {
    const io = stubIntersectionObserver();
    render(<CafePhotos imageUrl="https://cafe.example/gone.jpg" photos={photos} name="Post Room" />);
    fireEvent.error(imgs()[0]);
    expect(imgs()).toHaveLength(0);
    act(() => io.showAll());
    expect(imgs().map((i) => i.getAttribute("src"))).toEqual(["/api/photo?t=r1&w=400", "/api/photo?t=r2&w=400"]);
  });

  test("Google photos wait until the card is visible", () => {
    const io = stubIntersectionObserver();
    render(<CafePhotos imageUrl={null} photos={photos} name="Post Room" />);
    expect(imgs()).toHaveLength(0);
    act(() => io.showAll());
    expect(imgs()).toHaveLength(2);
  });

  test("shows the author's attribution", () => {
    const io = stubIntersectionObserver();
    render(<CafePhotos imageUrl={null} photos={photos} name="Post Room" />);
    act(() => io.showAll());
    const link = screen.getByRole("link", { name: "Anna K" });
    expect(link.getAttribute("href")).toBe("https://maps.google.com/contrib/1");
  });

  test("refused or expired Google photos disappear, leaving no photo row", () => {
    const io = stubIntersectionObserver();
    const { container } = render(<CafePhotos imageUrl={null} photos={photos} name="Post Room" />);
    act(() => io.showAll());
    for (const img of imgs()) fireEvent.error(img);
    expect(imgs()).toHaveLength(0);
    expect(container.innerHTML).toBe("");
  });

  test("tapping a photo opens it large; tapping again closes it", () => {
    stubIntersectionObserver();
    render(<CafePhotos imageUrl="https://cafe.example/room.jpg" photos={[]} name="Post Room" />);
    fireEvent.click(screen.getByRole("button", { name: /Post Room/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("https://cafe.example/room.jpg");
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("nothing to show renders nothing", () => {
    stubIntersectionObserver();
    const { container } = render(<CafePhotos imageUrl={null} photos={[]} name="Post Room" />);
    expect(container.innerHTML).toBe("");
  });

  test("no Google photos while the menu is still being read", () => {
    const io = stubIntersectionObserver();
    const { rerender } = render(<CafePhotos imageUrl={null} photos={photos} name="Post Room" pending />);
    act(() => io.showAll());
    expect(imgs()).toHaveLength(0);
    rerender(<CafePhotos imageUrl="https://cafe.example/room.jpg" photos={photos} name="Post Room" />);
    expect(imgs().map((i) => i.getAttribute("src"))).toEqual(["https://cafe.example/room.jpg"]);
  });

  test("opening a Google photo reuses the loaded image and keeps its attribution", () => {
    const io = stubIntersectionObserver();
    render(<CafePhotos imageUrl={null} photos={photos} name="Post Room" />);
    act(() => io.showAll());
    fireEvent.click(screen.getAllByRole("button", { name: /Post Room/ })[0]);
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/api/photo?t=r1&w=400");
    expect(within(dialog).getByText("Anna K")).toBeTruthy();
  });

  test("an image that fails in the large view closes it instead of showing a broken image", () => {
    stubIntersectionObserver();
    render(<CafePhotos imageUrl="https://cafe.example/room.jpg" photos={[]} name="Post Room" />);
    fireEvent.click(screen.getByRole("button", { name: /Post Room/ }));
    fireEvent.error(screen.getByRole("dialog").querySelector("img")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
