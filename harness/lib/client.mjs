// One HTTP request from a case step.

const TIMEOUT_MS = 30_000;

export function buildRequest(baseUrl, request) {
  const url = new URL(baseUrl + request.path);
  for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, String(value));
  const init = { method: request.method, headers: {}, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (request.ndjson) {
    // The Bulk API requires newline-delimited JSON with a final newline.
    init.headers['content-type'] = 'application/x-ndjson';
    init.body = request.ndjson.map(line => JSON.stringify(line)).join('\n') + '\n';
  } else if ('body' in request) {
    init.headers['content-type'] = 'application/json';
    init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
  }
  return { url, init };
}

/** Send a request; returns { status, body, text }. `body` is null when not JSON. */
export async function send(baseUrl, request) {
  const { url, init } = buildRequest(baseUrl, request);
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body, text };
}
