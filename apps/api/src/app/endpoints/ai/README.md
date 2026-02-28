# AI Chat (Production)

Production-ready AI chat: LangGraph multi-agent pipeline with portfolio tools, compliance, timeouts, and CI-safe tests.

## Reliability

- **Timeouts**: Full graph run is limited to 55s (`GRAPH_TIMEOUT_MS`). Edge route `api/v1/ai/chat.ts` uses a 30s request timeout. Prevents runaway or hanging requests.
- **Tool errors**: Every tool call is wrapped; failures return a string like `Error: <message>` so the agent can respond instead of crashing.
- **Compliance**: High-risk phrases (e.g. wire fraud, scam keywords) are blocked before any LLM call via `shouldBlockByInput()`. LLM-based compliance then approves/warns/blocks the draft reply.
- **Config**: Missing API key returns a clear message; empty messages return "Please send a message." without calling the graph.

## Tool wiring

| Route | Backend | Tools |
|-------|---------|--------|
| **Nest** `POST /api/v1/ai/chat` | Full pipeline | Data (7), Advice (3), compliance, router |
| **Edge** `api/v1/ai/chat.ts` | Fallback when Nest is not deployed | None (plain completion only) |

For production with portfolio tools and compliance, use the Nest backend. The edge route is documented in-code as a fallback without tools.

## Dummy data

When `AI_CHAT_DUMMY_DATA` is not set or is any value other than `false`/`0`, all tools return stub data (sample holdings, accounts, performance, quotes, allocation, rebalance suggestions). Agents still call the same tools; no real portfolio or market services are used. Set `AI_CHAT_DUMMY_DATA=false` to use real backend data.

## Tests

- **CI-safe (no `OPENAI_API_KEY`)**: Config (no key, empty key), empty messages, compliance input block (`shouldBlockByInput`), tool error handling (data/advisor tools return `Error:` when services throw), and service failure (graph throws → chat throws with clear message). See `ai-chat.service.spec.ts` → "Broken flows / reliability (CI-safe, no API key)".
- **With API key**: Golden set (data/advice/general routes, tool selection/execution, compliance block/approve, edge cases, safety). Run with `OPENAI_API_KEY` or `API_KEY_OPENAI` set; skipped in CI when missing.

Run quick CI-safe subset:  
`npx jest src/app/endpoints/ai/ai-chat.service.spec.ts --testNamePattern="Config|Input|Broken flows"`  
Full suite (with key):  
`npm run test:ai-chat:report` (see `scripts/run-ai-chat-tests-and-report.mjs`).
