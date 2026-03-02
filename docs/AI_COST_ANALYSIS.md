# AI Cost Analysis — AgentForge Financial Agent

## Model Selection

| Property | Value |
|----------|-------|
| Model | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) |
| Provider | Anthropic via Vercel AI SDK (`@ai-sdk/anthropic`) |
| Input pricing | $0.80 / 1M tokens |
| Output pricing | $4.00 / 1M tokens |
| Context window | 200K tokens |
| Daily cost cap (hard limit) | $5.00 / day |

Haiku 4.5 was chosen over Sonnet/Opus for cost efficiency. At 5-10x cheaper than Sonnet, it handles structured tool-calling tasks well while keeping per-query costs under $0.01 for most requests.

---

## Development & Testing Costs

### LLM API Costs

| Phase | Description | Estimated API Calls | Estimated Cost |
|-------|-------------|--------------------:|---------------:|
| Phase 1-2 | Initial agent + 6 tools | ~200 | $1.50 |
| Phase 3-4 | Multi-step reasoning + streaming | ~150 | $1.00 |
| Phase 5 | Eval framework (82 cases, multiple iterations) | ~500 | $3.50 |
| Phase 6-7 | Hallucination detector tuning | ~300 | $2.00 |
| Phase 8-10 | Telemetry, Langfuse, cost tracking | ~100 | $0.75 |
| Phase 11-13 | Conversation persistence, feedback, prompt redesign | ~200 | $1.50 |
| Phase 14-17 | Intent classification, crypto, false-positive fixes | ~250 | $1.75 |
| Manual testing & debugging | Ad-hoc queries during development | ~300 | $2.00 |
| **Total development** | | **~2,000 calls** | **~$14.00** |

### Token Consumption (Development)

| Metric | Estimated Total |
|--------|----------------:|
| Input tokens (system prompt + context + tool defs) | ~4,000,000 |
| Output tokens (responses + tool calls) | ~1,500,000 |
| Total tokens consumed during development | ~5,500,000 |
| Effective blended rate | ~$0.007 per query |

### Observability Costs

| Tool | Tier | Monthly Cost |
|------|------|-------------:|
| Langfuse (cloud) | Free/Hobby tier | $0 |
| PostgreSQL (Railway) | Dev plan | Included in hosting |
| Redis (Railway) | Dev plan | Included in hosting |
| **Total observability** | | **$0/month** |

### Total Development Cost

| Category | Cost |
|----------|-----:|
| LLM API (Anthropic) | ~$14.00 |
| Observability tooling | $0 |
| Infrastructure (Railway dev) | ~$5.00/month |
| **Total one-time dev cost** | **~$19.00** |

---

## Per-Query Cost Breakdown

### Token Budget Per Query

A typical single-tool query consumes:

| Component | Input Tokens | Output Tokens |
|-----------|-------------:|--------------:|
| System prompt (~2,800 chars) | ~800 | — |
| 6 tool definitions (schemas + descriptions) | ~1,200 | — |
| User message | ~50 | — |
| Conversation context (avg 5 prior messages) | ~500 | — |
| Tool call decision | — | ~100 |
| Tool result (structured JSON) | ~300 | — |
| Final response | — | ~400 |
| **Single-tool total** | **~2,850** | **~500** |

A multi-tool query (3 tools, up to `maxSteps: 3`):

| Component | Input Tokens | Output Tokens |
|-----------|-------------:|--------------:|
| Base (prompt + tools + context) | ~2,550 | — |
| 3 tool call decisions | — | ~300 |
| 3 tool results | ~900 | — |
| Intermediate reasoning | — | ~200 |
| Final response | — | ~600 |
| **Multi-tool total** | **~3,450** | **~1,100** |

### Cost Per Query

| Query Type | Input Cost | Output Cost | Total Cost |
|------------|----------:|------------:|-----------:|
| Single-tool query | $0.00228 | $0.00200 | **$0.0043** |
| Multi-tool query | $0.00276 | $0.00440 | **$0.0072** |
| Weighted average (70% single / 30% multi) | — | — | **$0.0052** |

### Verification Overhead

The verification layer (hallucination detection, confidence scoring, numerical accuracy) runs in-process with no additional LLM calls. It adds ~5-10ms of CPU time but zero token cost. Regeneration (triggered when hallucination score >5%) adds one full retry — estimated to occur in <3% of queries, adding ~$0.00015 amortized per query.

---

## Production Cost Projections

### Assumptions

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Queries per user per day | 3 | Casual portfolio check-in usage pattern |
| Query mix | 70% single-tool, 30% multi-tool | Most queries are simple lookups |
| Average cost per query | $0.0052 | Weighted average from above |
| Regeneration overhead | +3% | Hallucination-triggered retries |
| Effective cost per query | $0.00536 | $0.0052 x 1.03 |
| Rate limit | 10 requests/min/user | Hard cap in controller |
| Daily cost cap | $5.00/day | Hard cap in service |
| Days per month | 30 | |

### Monthly LLM Cost by Scale

| Scale | Queries/Month | LLM Cost/Month | Daily Cap Hit? |
|------:|:-------------:|---------------:|:--------------:|
| **100 users** | 9,000 | **$48** | No ($1.60/day) |
| **1,000 users** | 90,000 | **$482** | No ($16/day) — cap would throttle at ~930 queries/day |
| **10,000 users** | 900,000 | **$4,824** | Yes — $5/day cap limits to ~930 queries/day without cap increase |
| **100,000 users** | 9,000,000 | **$48,240** | Yes — requires removing or raising daily cap |

### Infrastructure Cost by Scale

| Scale | Railway/Hosting | PostgreSQL | Redis | Langfuse | Total Infra |
|------:|----------------:|-----------:|------:|---------:|------------:|
| 100 | $5/mo | $5/mo | $5/mo | Free | $15/mo |
| 1,000 | $20/mo | $20/mo | $10/mo | Free | $50/mo |
| 10,000 | $50/mo | $50/mo | $25/mo | $59/mo (Pro) | $184/mo |
| 100,000 | $200/mo | $200/mo | $100/mo | $59/mo (Pro) | $559/mo |

### Total Monthly Cost

| Scale | LLM Cost | Infra Cost | **Total/Month** | **Per User/Month** |
|------:|---------:|-----------:|----------------:|-------------------:|
| **100 users** | $48 | $15 | **$63** | **$0.63** |
| **1,000 users** | $482 | $50 | **$532** | **$0.53** |
| **10,000 users** | $4,824 | $184 | **$5,008** | **$0.50** |
| **100,000 users** | $48,240 | $559 | **$48,799** | **$0.49** |

---

## Cost Control Mechanisms

| Mechanism | Implementation | Effect |
|-----------|---------------|--------|
| Daily cost cap | `DAILY_COST_CAP = 5.0` in service | Hard stop at $5/day across all users |
| Rate limiting | `@Throttle({ ttl: 60_000, limit: 10 })` | Max 10 requests/min per user |
| Model selection | Haiku 4.5 (cheapest Claude model) | 5-10x cheaper than Sonnet |
| Token efficiency | 20-message context window cap | Prevents unbounded context growth |
| maxSteps limit | `maxSteps: 3` | Caps tool-call chains per request |

### Scaling Recommendations

| Scale | Recommendation |
|------:|---------------|
| 100 | Current architecture works as-is. $5/day cap is sufficient. |
| 1,000 | Raise daily cap to $20. Consider per-user quotas (e.g., 20 queries/day for free tier). |
| 10,000 | Implement tiered access (free: 5 queries/day, premium: 50). Add response caching for common queries (portfolio summary). Raise or remove global cap; enforce per-user caps instead. |
| 100,000 | Add Redis-based response caching (cache portfolio summary for 5 min, market data for 1 min). Consider Haiku batch API for non-streaming requests (50% discount). Implement queue-based rate limiting. Budget ~$50K/month for LLM costs. |

---

## Cost Optimization Opportunities

| Optimization | Estimated Savings | Complexity |
|-------------|------------------:|:----------:|
| Response caching (5-min TTL for portfolio/compliance) | 30-40% | Low |
| Prompt compression (shorter tool descriptions) | 10-15% | Low |
| Batch API for non-streaming requests | 50% on batch | Medium |
| Context window pruning (summarize old messages) | 15-20% | Medium |
| Fine-tuned smaller model (distillation) | 60-70% | High |
| Prompt caching (Anthropic beta) | 50-90% on cached prefixes | Low |

The most impactful near-term optimization is **Anthropic prompt caching**: the system prompt + tool definitions (~2,000 tokens) are identical across all requests and could be cached at 90% discount, reducing input costs by ~$0.0014 per query (~27% of total per-query cost).
