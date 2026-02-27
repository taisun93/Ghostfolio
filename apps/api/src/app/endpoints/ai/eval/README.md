# AI Chat Eval Dataset

Minimum 50 test cases for the AI chat pipeline:

- **22 happy path** (hp-01–hp-22): allocation, holdings, rebalance, DCA, greeting, accounts, quote, performance, orders, balances, concentration, diversification, bonds, emergency fund, equity, value.
- **11 edge** (ed-01–ed-11): empty portfolio, no accounts, invalid symbol, long message, empty/minimal/whitespace input, boundary dates, repeated question.
- **11 adversarial** (ad-01–ad-11): Nigeria scam, prompt injection, wire urgently, recommend stock, system prompt leak, API key, compliance bypass, debug mode, guaranteed returns, admin override, send money.
- **11 multi-step** (ms-01–ms-11): allocation + rebalance, holdings + performance, accounts + balances, quote + historical, allocation + diversify, holdings + orders, value + performance, bonds/liquidity + suggestions, top holding comparison, summary + recommendations, biggest positions + risk.

## Files

- **eval-cases.json** – Case list. Each case: `id`, `category`, `input`, optional `fixture` (`portfolio`: full|empty, `accountsEmpty`), `expectedRoute`, `expectedToolNames`, `outputMustMatch` / `outputMustNotMatch` (regex), `passCriteria`.
- **eval-cases.schema.json** – JSON schema for validation.

## Runner

A runner should load `eval-cases.json`, apply fixtures (e.g. mock `portfolioService.getDetails` with PORTFOLIO_FIXTURE or EMPTY_PORTFOLIO), call `AiChatGraphService.runWithTrace()` for each case, and evaluate:

- `expectedRoute` matches `trace.route`
- At least one of `expectedToolNames` appears in `trace.toolCalls`
- Tool results do not start with `Error:` where success is expected
- `outputMustMatch` / `outputMustNotMatch` against `trace.content`

Empty `input` is handled by `AiChatService.chat()` before the graph (returns "Please send a message."); the runner can short-circuit for that case. See [ai-chat.service.spec.ts](../ai-chat.service.spec.ts) for patterns (BASE_PARAMS, HumanMessage, runWithTrace, fixtures).
