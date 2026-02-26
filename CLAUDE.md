# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ghostfolio — open-source wealth management software. Nx monorepo with a NestJS API backend, Angular frontend, PostgreSQL via Prisma, and Redis for caching/job queues.

## Common Commands

### Development

```bash
npm run start:server              # Start API server (watch mode, port 3333)
npm run start:client              # Start Angular dev server (port 4200, English)
npm run start:storybook           # Component library dev server
```

### Testing

```bash
npm test                          # All tests (parallel, 4 workers, uses .env.example)
npm run test:api                  # API tests only
npm run test:common               # Common lib tests
npm run test:ui                   # UI lib tests
npx dotenv-cli -e .env.example -- nx test api --testPathPattern="ai-agent"  # Single test pattern
```

Tests use Jest. API tests run in Node environment; client/UI tests run in jsdom. All test commands load `.env.example` via `dotenv-cli`.

### Database

```bash
npm run database:setup            # Push schema + seed (initial setup)
npm run database:push             # Sync Prisma schema to DB (prototyping)
npm run prisma migrate dev --name <description>  # Create migration
npm run database:gui              # Open Prisma Studio
```

### Code Quality

```bash
npm run lint                      # Lint all projects
npm run format:write              # Auto-format with Prettier
npm run format:check              # Check formatting
```

### Build

```bash
npm run build:production          # Full production build (API + Client + Storybook)
```

## Architecture

### Monorepo Layout

- **`apps/api`** — NestJS backend. Entry: `src/main.ts`, root module: `src/app/app.module.ts`
- **`apps/client`** — Angular SPA. Entry: `src/main.ts`, routes: `src/app/app.routes.ts`
- **`libs/common`** — Shared TypeScript interfaces, enums, DTOs, config, helpers
- **`libs/ui`** — Reusable Angular component library (Storybook-documented)

### Path Aliases (tsconfig.base.json)

```
@ghostfolio/api/*      → apps/api/src/*
@ghostfolio/client/*   → apps/client/src/app/*
@ghostfolio/common/*   → libs/common/src/lib/*
@ghostfolio/ui/*       → libs/ui/src/lib/*
```

### API Structure

Controllers live in `apps/api/src/app/endpoints/` (ai-agent, assets, benchmarks, platforms, watchlist, etc.) and in feature directories under `apps/api/src/app/` (account, order, portfolio, user, admin, auth, etc.).

Key patterns:
- **Auth**: JWT via Passport + `@HasPermission()` decorator for RBAC
- **Validation**: Global ValidationPipe with whitelist + class-validator DTOs
- **Data providers**: Abstract interface with multiple implementations (CoinGecko, Yahoo Finance, etc.)
- **Job queues**: Bull (Redis-backed) for async data processing
- **Database**: Prisma ORM, schema at `prisma/schema.prisma`

### Frontend Structure

- Lazy-loaded route pages in `apps/client/src/app/pages/`
- Standalone Angular components (no NgModules)
- Angular Material + Bootstrap utility classes
- Observable Store for state management
- 13 languages (XLIFF i18n files in `apps/client/src/locales/`)

### AI Agent Feature

Located at `apps/api/src/app/endpoints/ai-agent/`. Uses Claude Haiku 3.5 via `@ai-sdk/anthropic`. Has 6 tools (portfolio_summary, transaction_analyzer, market_context, tax_estimator, compliance_checker, allocation_optimizer), a verification layer (hallucination detection, contextual disclaimers per tool, multi-signal confidence scoring), telemetry/eval persistence, and rate limiting. Streaming sends `__META__:` payload with full tool call data, confidence, and disclaimers. Feature-flagged via `ENABLE_FEATURE_AI_AGENT`.

## Code Conventions

### Formatting (Prettier)

- Single quotes, no trailing commas, 2-space indent, 80 char width
- Import order: `@ghostfolio/*` → third-party → relative (auto-sorted by plugin)
- Angular HTML attributes sorted: structural directives → defaults → inputs → two-way → outputs

### Experimental Features

- Backend: remove permission in `UserService` using `without()`
- Frontend: gate with `@if (user?.settings?.isExperimentalFeatures) {}`

## Dev Environment Setup

1. `cp .env.dev .env` and fill in passwords/secrets
2. `npm install`
3. `docker compose -f docker/docker-compose.dev.yml up -d` (PostgreSQL + Redis)
4. `npm run database:setup`
5. Start server and client, open `https://localhost:4200/en`
6. First registered user gets ADMIN role
