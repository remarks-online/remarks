import type { BackgroundRequest, BackgroundResponse } from "@/types";

// Loose subset of fetch input/init that fits both the DOM `fetch` and tRPC's
// `FetchEsque`. tRPC passes a `RequestInitEsque` whose `signal` shape differs
// from the DOM `RequestInit` under `exactOptionalPropertyTypes`, so we can't
// type the helper as `typeof fetch` directly.
type ApiFetchInput = string | URL | { url: string };
interface ApiFetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | string | null;
}

// Routes API fetches through the background service worker. The SW runs at
// the extension's origin (`chrome-extension://<id>`), which the API CORS
// allowlist covers; a content-script `fetch` would carry the host page's
// origin and get rejected.
export async function apiFetch(input: ApiFetchInput, init?: ApiFetchInit): Promise<Response> {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  const headers: Record<string, string> = {};
  new Headers((init?.headers ?? {}) as HeadersInit).forEach((value, key) => {
    headers[key] = value;
  });

  const body =
    init?.body == null
      ? null
      : typeof init.body === "string"
        ? init.body
        : await new Response(init.body as BodyInit).text();

  const request: BackgroundRequest = {
    kind: "api-fetch",
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    headers,
    body,
  };

  const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse;
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== "api-fetch") {
    throw new Error(`unexpected response kind: ${response.kind}`);
  }
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
