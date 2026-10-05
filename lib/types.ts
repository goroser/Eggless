export type Fetched = { url: string; contentType: string; body: Buffer };

// Fetches a URL with a byte cap. Rejects on non-2xx, oversize bodies and unsafe targets.
export type MenuFetcher = (url: string, maxBytes: number) => Promise<Fetched>;
