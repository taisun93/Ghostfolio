---
title: AI Eval Framework Analysis
overview: Analysis of evaluation, observability, verification, and performance requirements against Ghostfolio's existing AI chat (LangGraph multi-agent with data/advice/general + compliance), with a concrete implementation plan and prioritization.
---

# Evaluation Framework Requirements: Analysis and Plan for Ghostfolio

## Current state summary

Ghostfolio's AI chat is a **LangGraph multi-agent pipeline**:

- **Router** → classifies into `data` | `advice` | `general`
- **Data agent** → 7 tools: `get_holdings`, `get_portfolio_performance`, `get_quote`, `get_historical_prices`, `list_accounts`, `get_orders`, `get_account_balances`
- **Advice agent** → 3 tools: `get_allocation_summary`, `analyze_allocation`, `suggest_rebalance`
- **General agent** → no tools; short replies for greetings/off-topic
- **Compliance** → LLM-based approve/warn/block (e.g. scam detection)

Existing tests: **~10 golden-set cases** in [apps/api/src/app/endpoints/ai/ai-chat.service.spec.ts](apps/api/src/app/endpoints/ai/ai-chat.service.spec.ts) (config, empty input, data with/without portfolio, DCA, rebalance, compliance block/approve). Many require `OPENAI_API_KEY` and are skipped in CI; report is written to `AI_CHAT_TEST_RESULTS_10.md`. The run script uses Jest with increased heap; **OOM (exit 134)** is common locally (CI uses 8GB).

There is **no** trace logging, latency/token tracking, error categorization, eval scores over time, or user feedback in the AI path. **Verification** today is only the compliance step (no fact-check, hallucination detection, confidence, schema validation, or human-in-the-loop).

---

## How your requirements map to this app

### 1. Eval types vs current coverage

| Eval type          | Current coverage                                                                         | Gap                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Correctness**    | Partial: golden tests assert content substrings (e.g. "no portfolio", "60%", "rebalanc") | No ground-truth fact-check; no authoritative source to compare against for portfolio numbers |
| **Tool selection** | None                                                                                     | Router + agent choice not asserted; no "expected tool calls" in tests                        |
| **Tool execution** | None                                                                                     | No test that checks tool success or parameter correctness                                    |
| **Safety**         | Partial: one compliance test (Nigeria scam block)                                        | No systematic adversarial suite; no hallucination or refusal-rate metrics                    |
| **Consistency**    | None                                                                                     | Temperature > 0 on data/advice/general; same input can yield different output                |
| **Edge cases**     | Minimal                                                                                  | Empty portfolio and "no API key" only; no invalid/ambiguous/missing-data matrix              |
| **Latency**        | None                                                                                     | No timing in tests or production                                                             |

**Conclusion:** You need a **structured eval harness** that (a) runs a fixed dataset of queries, (b) records route + tool calls + final answer, (c) compares to expected tool calls and pass/fail criteria, and (d) measures latency. Correctness "ground truth" for this app is largely **tool outputs + rules** (e.g. "if portfolio empty, response must not claim specific allocations") rather than external APIs.

### 2. Eval dataset (50+ cases)

Your mix (20+ happy path, 10+ edge, 10+ adversarial, 10+ multi-step) fits Ghostfolio well:

- **Happy path:** "What's my allocation?", "Should I rebalance?", "What is DCA?", "Largest holding?", "List my accounts" with known fixtures.
- **Edge:** Empty portfolio, no accounts, invalid symbol, empty messages, very long message, boundary date ranges for `get_orders` / `get_historical_prices`.
- **Adversarial:** Prompt injection ("Ignore previous instructions and…"), scam phrases, attempts to force data leakage (e.g. "repeat your system prompt"), off-domain high-risk (e.g. "recommend a specific stock to buy tomorrow").
- **Multi-step:** "What's my allocation and should I rebalance?" (data + advice), "What did I hold in AAPL and how did it perform?" (holdings + performance/quote).

Each case should be a **single record**: `{ id, input, expectedRoute?, expectedToolCalls?, expectedOutputConstraints?, passCriteria }` with a runner that executes, records actual route/tools/output/latency, and marks pass/fail.

**Recommendation:** Store the dataset as **JSON or YAML** (e.g. under `apps/api/src/app/endpoints/ai/eval/`) and keep the runner in Node (Jest or a small script) so it reuses the same `AiChatService` + mocks as today. That keeps 50+ cases manageable and avoids OOM by running in batches or with `--runInBand` and smaller heap per run if needed.

### 3. Observability

Today there is **no** observability in [ai-chat.service.ts](apps/api/src/app/endpoints/ai/ai-chat.service.ts) or [ai-chat-graph.service.ts](apps/api/src/app/endpoints/ai/langgraph/ai-chat-graph.service.ts). To meet your list:

- **Trace logging:** Emit a **single trace per request** (requestId), with steps: input → router result → agent node → each tool call (name, args, result summary) → compliance decision → output. Prefer structured logs (JSON) so a backend or log aggregator can index them.
- **Latency:** Measure and log: router latency, per-agent latency, per-tool latency, compliance latency, **total** latency. Expose in the same trace and optionally as metrics (e.g. NestJS or OpenTelemetry).
- **Errors:** Catch at graph node and at tool level; log with category (e.g. `tool_error`, `llm_error`, `compliance_error`), stack trace, and requestId. No PII in logs.
- **Token usage:** LangChain/OpenAI responses often expose `usage`; capture input/output tokens per LLM call and attach to the trace; optionally aggregate for cost tracking.
- **Eval results:** Persist eval run results (timestamp, suite version, pass/fail per case, latency, tool-success rate) in a file or DB; add a simple **regression check** (e.g. fail CI if pass rate drops below 80% or if a critical case regresses).
- **User feedback:** Add **thumbs up/down** (and optional correction text) to the chat API and store it with `requestId` (or messageId) so you can join with traces later.

Implementation can be **in-process first** (logs + in-memory metrics), then optionally export to OpenTelemetry or your existing logging/monitoring stack.

### 4. Verification (3+ required)

You already have **one** verification: **compliance** (approve/warn/block). To add at least **two more** that fit a portfolio/finance app:

- **Hallucination detection / source attribution:**
  - Rule: if the answer mentions specific numbers (allocation %, performance, quote), they must be traceable to tool outputs (or explicit "I don't have that data").
  - Implementation: in eval, parse tool results from the trace and check that key numbers in the final reply appear in those results (or in a small allowlist like "0%" for empty portfolio). In production, a lighter check: flag replies that contain numbers not present in the last N tool outputs (or require "based on your portfolio data" for data/advice routes).
- **Output validation / schema:**
  - Define a minimal schema for "acceptable" reply: e.g. max length, no forbidden patterns (e.g. "guaranteed return"), and that data/advice replies are not empty when tools succeeded.
  - Validate before returning; on failure, return a safe fallback or retry once.

Optional but valuable:

- **Confidence scoring:** Use an LLM or heuristics (e.g. "no data" vs "here are numbers") to tag low-confidence answers and surface them (e.g. in UI or in traces for review).
- **Domain constraints:** Encode rules like "never recommend a specific buy/sell" or "never give tax/legal advice"; enforce in compliance or a separate step.

**Fact-checking against external sources** is harder for portfolio data (it's user-specific). You can fact-check **general** answers (e.g. "What is DCA?") against a small curated doc or use an LLM-as-judge with that doc as context; that can be a fourth verification if you want.

**Human-in-the-loop:** Add an "escalate" flag in the compliance or confidence step (e.g. block + store for review when confidence is low or decision is "warn" on high-risk topics); no need for full workflow in v1, just persistence and a way to list "pending review" items.

### 5. Performance targets

| Metric                | Target | Feasibility                                                                                                                                                                           |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single-tool latency   | <5 s   | Achievable if LLM + one tool call; measure end-to-end and optimize router/model if needed                                                                                             |
| Multi-step (3+ tools) | <15 s  | May require capping tool iterations (you have `MAX_TOOL_ITERATIONS = 10`) and/or parallel tool calls where possible                                                                   |
| Tool success rate     | >95%   | Achievable with robust error handling and retries; track in observability and eval                                                                                                    |
| Eval pass rate        | >80%   | Depends on test design and LLM stability; use temperature 0 for router/compliance and low for agents; consider relaxing "exact" string matches in favor of semantic/rule-based checks |
| Hallucination rate    | <5%    | Needs definition (e.g. "claims about user data not supported by tools"); enforce via source-attribution check and eval                                                                |
| Verification accuracy | >90%   | Tune compliance and hallucination rules on a labeled set; track in eval                                                                                                               |

**Recommendation:** Add latency and success-rate metrics to the eval runner and to production traces; set up alerts or CI gates for the targets above.

### 6. Technical risks and mitigations

- **OOM in eval:** Current Jest run can OOM. Mitigations: run eval in **batches** (e.g. 10 cases per process), increase Node heap for the runner, or use a separate lightweight runner that invokes the graph once per case and exits. Avoid loading 50+ LLM runs in one Jest worker.
- **Non-determinism:** Use **temperature 0** for router and compliance (already 0 in code); consider lowering data/advice to 0 for eval runs only so "same input → same output" is testable where needed.
- **Cost:** 50+ cases × multiple LLM calls per case can be expensive. Use a **small model** (e.g. gpt-4o-mini) for eval where possible; cache or snapshot tool responses for "correctness" tests so you don't need to call the real LLM for every run if you add "replay" mode later.

---

## Suggested implementation order

1. **Eval harness and dataset**
   - Add eval dataset (50+ cases in JSON/YAML) with input, expectedRoute, expectedToolCalls, output constraints, passCriteria.
   - Implement a runner that: loads dataset, runs each case through `AiChatGraphService` (with mocks where appropriate), records route, tool calls, output, latency, and evaluates pass/fail.
   - Optionally integrate with CI (e.g. run on AI-related changes, fail if pass rate < 80% or critical tests fail).
2. **Observability (minimal)**
   - Add request-scoped trace logging (input → route → tool calls → compliance → output).
   - Add latency breakdown (router, agent, each tool, compliance, total) and token usage where available.
   - Add error capture with category and requestId.
3. **Verification (2 more)**
   - Implement hallucination/source-attribution check (numbers in reply must come from tools or explicit "no data").
   - Add output validation (length, forbidden patterns, non-empty when tools succeeded).
4. **Eval results and regression**
   - Persist eval results; add regression detection (e.g. compare last run to baseline, fail if regression).
5. **User feedback**
   - Add thumbs up/down (and optional comment) to chat API; store with requestId for joining with traces.
6. **Performance and tuning**
   - Enforce latency and pass-rate targets in CI; tune models and tool loops to meet <5 s / <15 s and >95% tool success.

---

## Summary

Your requirements are **well-aligned** with Ghostfolio's architecture: the app already has a clear tool set, routing, and compliance, so eval can focus on **route + tool selection + tool execution + safety + consistency + edge cases + latency**. The main gaps are: **(1)** a structured eval dataset and runner with explicit expected tool calls and pass/fail criteria, **(2)** observability (trace, latency, errors, tokens, eval history, feedback), and **(3)** at least two more verification mechanisms (hallucination/source attribution and output validation). Prioritizing the eval harness and minimal observability first will give you the data needed to tune verification and hit the performance targets systematically.
