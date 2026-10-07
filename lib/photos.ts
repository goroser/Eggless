const PHOTO_NAME = /^places\/[^/]+\/photos\/[^/]+$/;

// Asks Google for a short-lived photo URL; the API key stays on the server.
export function createPhotoLookup(apiKey: string, fetchImpl: typeof fetch = fetch) {
  return async (name: string, width: number): Promise<string> => {
    if (!PHOTO_NAME.test(name)) throw new Error("invalid photo name");
    const url = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${width}&skipHttpRedirect=true`;
    const res = await fetchImpl(url, { headers: { "X-Goog-Api-Key": apiKey }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`photo lookup failed: HTTP ${res.status}`);
    const json = (await res.json()) as { photoUri?: string };
    if (!json.photoUri) throw new Error("photo lookup returned no URI");
    return json.photoUri;
  };
}
