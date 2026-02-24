# AgentForge: AI Agent for Ghostfolio — TODO

## Phase 1: Foundation — Single Tool End-to-End
- [x] Install `@ai-sdk/anthropic` dependency
- [x] Add `ENABLE_FEATURE_AI_AGENT` feature flag (environment interface + configuration service)
- [x] Add `accessAiAgent` permission (permissions.ts + ADMIN/USER role arrays)
- [x] Add `PROPERTY_API_KEY_ANTHROPIC` config key (config.ts)
- [x] Create shared interfaces (`AiAgentResponse`, `AiAgentMessage`)
- [x] Export from interfaces barrel (`libs/common/src/lib/interfaces/index.ts`)
- [x] Create `AiAgentModule` (module, controller, service, DTO)
- [x] Create `portfolio-summary.tool.ts` (first tool)
- [x] Create `verification.service.ts` (V1 — disclaimer enforcement)
- [x] Register `AiAgentModule` in `AppModule`
- [x] Verify TypeScript compiles

## Phase 2: Tool Expansion
- [x] `transaction_analyzer` tool (OrderService.getOrders)
- [x] `market_context` tool (DataProviderService.getQuotes)
- [x] `tax_estimator` tool (FIFO lot logic)
- [x] `compliance_checker` tool (PortfolioService.getDetails)
- [x] `allocation_optimizer` tool (target allocation drift)

## Phase 3: Multi-step Reasoning
- [x] Enhanced system prompt with reasoning instructions
- [x] Multi-tool query chaining verified via `maxSteps: 5`

## Phase 4: Observability
- [x] Structured logging in `ai-agent.service.ts`
- [x] Telemetry service (traceId, duration, tools, tokens)

## Phase 5: Eval Framework
- [x] Test fixtures (69 eval cases)
- [x] Unit tests per tool (60 tests across 4 suites)
- [x] Integration tests (25 eval spec tests)
- [x] Adversarial tests (12 adversarial cases + validation tests)

## Phase 6: Verification Layer Enhancement
- [x] Numerical accuracy verifier
- [x] Hallucination detector
- [x] Confidence scoring

## Phase 7: Frontend — Angular Chat Component
- [x] Backend API method in `data.service.ts`
- [x] Chat component (standalone Angular)
- [x] Page + routing (`/ai-agent`)

## Phase 8: Open Source Prep
- [x] Architecture documentation (`docs/ai-agent.md`)
- [x] CHANGELOG entry

## Phase 9: Langfuse Observability Integration
- [x] Add Langfuse SDK dependencies (`langfuse`, `langfuse-langchain`)
- [x] Create `TelemetryService` with Langfuse client initialization
- [x] Create `EvalPersistenceService` for eval result storage
- [x] Add OpenTelemetry instrumentation (`instrumentation.ts`)
- [x] Wire `experimental_telemetry` into AI SDK `streamText` calls
- [x] Add `onFinish` callback with `langfuse.flush()` for streaming traces
- [x] Add `AiAgentFeedback` model to Prisma schema
- [x] Create database migration (`20260224032126_add_ai_agent_observability`)
- [x] Add feedback DTO and endpoint
- [x] Configure Langfuse API keys on Railway (fix 401 Unauthorized)
- [x] Verify traces appear in Langfuse dashboard

## Phase 10: Deployment & Dev Experience
- [x] Add deployment guide to `DEVELOPMENT.md` (Docker Compose + Railway)
- [x] Add `fix-client-path` script for quoted folder name workaround
- [x] Add `CLAUDE.md` project instructions
- [x] Add Langfuse env placeholders to `.env.dev`
