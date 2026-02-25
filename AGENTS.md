# AGENTS.md

## Cursor Cloud specific instructions

### Services overview

Ghostfolio is an Nx monorepo with two runnable apps:

| Service | Port | Start command |
|---|---|---|
| NestJS API | 3333 | `npm run start:server` |
| Angular client | 4200 | `npm run start:client` |

Both require **PostgreSQL** (port 5432) and **Redis** (port 6379) running via Docker. See `CLAUDE.md` and `DEVELOPMENT.md` for standard commands.

### Docker in Cloud Agent VMs

Docker must be installed and configured for nested containers before starting services. After Docker is available, start database containers with:

```bash
sudo docker compose -f docker/docker-compose.dev.yml up -d
```

Wait for containers to be healthy before running `npm run database:setup`.

### Environment file

Copy `.env.dev` to `.env` and replace all `<INSERT_...>` placeholders with real values before starting any services. Required secrets: `REDIS_PASSWORD`, `POSTGRES_PASSWORD`, `ACCESS_TOKEN_SALT`, `JWT_SECRET_KEY`.

### SSL certificates

The Angular dev server serves over HTTPS. Generate certs before first client start:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout apps/client/localhost.pem -out apps/client/localhost.cert \
  -days 365 -subj "/C=CH/ST=State/L=City/O=Org/OU=Unit/CN=localhost"
```

### Testing caveats

- `npm test` runs all tests; they use `.env.example` via `dotenv-cli` and do **not** require running database/Redis containers.
- `npm run lint` exits with code 1 due to pre-existing warnings. The pre-commit hook uses `--quiet` to suppress warnings. There are 2 pre-existing lint errors in the API project (non-blocking).
- The first registered user receives the ADMIN role automatically.
