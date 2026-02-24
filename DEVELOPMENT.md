# Ghostfolio Development Guide

## Development Environment

### Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop)
- [Node.js](https://nodejs.org/en/download) (version `>=22.18.0`)
- Create a local copy of this Git repository (clone)
- Copy the file `.env.dev` to `.env` and populate it with your data (`cp .env.dev .env`)

### Setup

1. Run `npm install`
1. Run `docker compose -f docker/docker-compose.dev.yml up -d` to start [PostgreSQL](https://www.postgresql.org) and [Redis](https://redis.io)
1. Run `npm run database:setup` to initialize the database schema
1. Start the [server](#start-server) and the [client](#start-client)
1. Open https://localhost:4200/en in your browser
1. Create a new user via _Get Started_ (this first user will get the role `ADMIN`)

### Start Server

#### Debug

Run `npm run watch:server` and click _Debug API_ in [Visual Studio Code](https://code.visualstudio.com)

#### Serve

Run `npm run start:server`

### Start Client

#### English (Default)

Run `npm run start:client` and open https://localhost:4200/en in your browser.

**If the page is blank and the browser console shows `SyntaxError: Unexpected identifier 'AgentForge'`:** your project folder name contains a double quote, which breaks embedded paths in the bundle. Either rename the folder (e.g. to `AgentForge` or `Week-2-Project-AgentForge`) or, after the client has built once, run `npm run fix-client-path` in another terminal, then refresh the page.

#### Other Languages

To start the client in a different language, such as German (`de`), adapt the `start:client` script in the `package.json` file by changing `--configuration=development-en` to `--configuration=development-de`. Then, run `npm run start:client` and open https://localhost:4200/de in your browser.

### Start _Storybook_

Run `npm run start:storybook`

### Migrate Database

With the following command you can keep your database schema in sync:

```bash
npm run database:push
```

## Testing

Run `npm test`

## Experimental Features

New functionality can be enabled using a feature flag switch from the user settings.

### Backend

Remove permission in `UserService` using `without()`

### Frontend

Use `@if (user?.settings?.isExperimentalFeatures) {}` in HTML template

## Component Library (_Storybook_)

https://ghostfol.io/development/storybook

## Git

### Rebase

`git rebase -i --autosquash main`

## Dependencies

### Angular

#### Upgrade (minor versions)

1. Run `npx npm-check-updates --upgrade --target "minor" --filter "/@angular.*/"`

### Nx

#### Upgrade

1. Run `npx nx migrate latest`
1. Make sure `package.json` changes make sense and then run `npm install`
1. Run `npx nx migrate --run-migrations`

### Prisma

#### Access database via GUI

Run `npm run database:gui`

https://www.prisma.io/studio

#### Synchronize schema with database for prototyping

Run `npm run database:push`

https://www.prisma.io/docs/concepts/components/prisma-migrate/db-push

#### Create schema migration

Run `npm run prisma migrate dev --name added_job_title`

https://www.prisma.io/docs/concepts/components/prisma-migrate#getting-started-with-prisma-migrate

## Deploying live

Nobody can deploy to **your** production for you without access to your cloud account, registry, and secrets. Use the steps below on your machine or in your CI.

### Option A: Docker Compose (VPS, single server)

1. **Production `.env`**  
   Create a production `.env` (see `.env.dev` / `.env.example`) with real values for:
   - `POSTGRES_*`, `REDIS_PASSWORD`, `DATABASE_URL`
   - `JWT_SECRET`, `JWT_EXPIRATION`
   - `ENABLE_FEATURE_AI_AGENT`, Anthropic API key (if using AI agent)

2. **Build and run with your image**  
   Build the app image and point compose at it:

   ```bash
   docker build -t your-registry/ghostfolio:latest .
   ```

   Edit `docker/docker-compose.yml`: set `image:` to `your-registry/ghostfolio:latest` (or leave as `ghostfolio/ghostfolio:latest` if you use the upstream image). Then:

   ```bash
   docker compose -f docker/docker-compose.yml --env-file .env up -d
   ```

   The API (and served client) will be on port 3333. Put a reverse proxy (e.g. Caddy, Nginx) in front for HTTPS and optional custom domain.

### Option B: GitHub Actions → Docker Hub → your server

The repo already has `.github/workflows/docker-image.yml` that builds and pushes a Docker image on:

- **Push of a version tag** (e.g. `2.243.0`): builds and pushes to Docker Hub (if secrets are set).
- **Pull requests to `main`**: builds only (no push).

To deploy using this pipeline:

1. In GitHub: **Settings → Secrets and variables → Actions** add:
   - `DOCKER_HUB_USERNAME` — your Docker Hub username
   - `DOCKER_HUB_ACCESS_TOKEN` — a Docker Hub access token (or app password)

2. Optionally set **Variables**: `DOCKER_REPOSITORY` (e.g. `youruser/ghostfolio`) if you don’t want to use `ghostfolio/ghostfolio`.

3. Create and push a version tag to trigger build and push:

   ```bash
   git tag 2.243.0
   git push origin 2.243.0
   ```

4. On your server, pull the new image and restart:

   ```bash
   docker compose -f docker/docker-compose.yml pull
   docker compose -f docker/docker-compose.yml up -d
   ```

(If you use your own registry, change the workflow’s login and image name accordingly.)

### Checklist before going live

- [ ] Production `.env` with strong secrets and correct `DATABASE_URL` / Redis
- [ ] Migrations applied (`prisma migrate deploy` runs in the container entrypoint)
- [ ] HTTPS and, if needed, domain configured (reverse proxy)
- [ ] AI Agent: `ENABLE_FEATURE_AI_AGENT` and Anthropic API key set if you use the feature

## SSL

Generate `localhost.cert` and `localhost.pem` files.

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout apps/client/localhost.pem -out apps/client/localhost.cert -days 365 \
  -subj "/C=CH/ST=State/L=City/O=Organization/OU=Unit/CN=localhost"
```
