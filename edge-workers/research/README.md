# Research worker

This worker does the part of web research that a browser can't do itself because of CORS: it reads a web page as text, and it forwards a search request to the user's own search API key. It is used by **Research: Ask a Question…** and **Research: Verify Citations in This Note**.

Claude's built-in web search doesn't need this worker. When the AI provider is Anthropic, research uses the Messages API `web_search` tool, and only citation checks go through `/extract`.

## Deploy

```sh
cd edge-workers/research
npx wrangler deploy
```

Then:
1. Add a route on the app's domain (see `wrangler.toml`).
2. Set `ALLOWED_ORIGINS`.
3. Build the app with `VITE_RESEARCH_ENDPOINT=https://research.<your-domain>`.

**Production:** also add a Cloudflare rate-limiting rule on the route, for example 120 requests per minute per IP. The worker's own per-isolate limit is only a best-effort backstop.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /extract?url=` | Title and readable text of a public page (`{ url, finalUrl, status, title, text, truncated, fetchedAt }`). Dead links report their HTTP status. |
| `POST /search` `{ provider: "brave" \| "tavily", query, key, count? }` | `{ results: [{ title, url, snippet }] }` |
| `GET /healthz` | Health check |

## Limits

- Only public http(s) URLs are fetched. Private, loopback, link-local and metadata addresses are refused, as are IPv6 literals, internal hostnames and non-default ports. Each redirect target is checked again, up to 5 redirects.
- Requests time out after 10 s. At most 2 MB is read, and only HTML or plain text is accepted. The returned text is capped at 200K characters.
- Cookies and credentials are never forwarded. The search key is used for that one request only, and is never stored or logged.
