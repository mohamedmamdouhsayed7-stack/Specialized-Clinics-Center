# Railway API Deployment

This deployment uses the existing NestJS API image with Neon PostgreSQL:

```text
Cloudflare Pages -> Railway API -> Neon PostgreSQL
                              \-> Railway Volume (/app/backups)
```

## Railway service configuration

Create one Railway service from the repository root. The checked-in
[`railway.toml`](../railway.toml) selects
[`apps/api/Dockerfile.prod`](../apps/api/Dockerfile.prod).

The Dockerfile builds the npm workspace monorepo, including `package-lock.json`,
`apps/api`, and `packages/shared`. It generates Prisma Client, builds the
shared package, and builds the NestJS API.

The production image includes Node 20, Chromium, Arabic fonts, OpenSSL, and
PostgreSQL client tools. Its startup command applies Prisma migrations and then
starts the API. Railway supplies the runtime `PORT`; the application reads that
value and listens on it.

Railway health checks must use `/api/health`.

## Required Railway variables

Set these in the Railway API service. Enter secret values through Railway and
never commit them:

```text
NODE_ENV=production
PORT=<Railway-provided PORT, or leave Railway to inject it>
DATABASE_URL=<Neon production PostgreSQL connection string>
JWT_SECRET=<strong unique secret>
JWT_REFRESH_SECRET=<different strong unique secret>
FRONTEND_URL=https://<production-Cloudflare-Pages-origin>
BACKUP_ENCRYPTION_KEY=<32-byte base64 or 64-character hex key>
BACKUP_RETENTION_DAYS=30
BACKUP_DIR=/app/backups
```

`BACKUP_ENCRYPTION_KEY` is required in production. The backup service derives
the host, port, database, username, password, and optional `sslmode` from
`DATABASE_URL`, so Docker-only `POSTGRES_*` and `DB_HOST` variables are not
required for Railway/Neon.

Optional tuning and remote-backup variables:

```text
AUTH_LOGIN_THROTTLE_TTL=60
AUTH_LOGIN_THROTTLE_LIMIT=10
AUTH_LOGIN_THROTTLE_TRUST_PROXY=false
BACKUP_S3_ENDPOINT=
BACKUP_S3_BUCKET=
BACKUP_S3_ACCESS_KEY=
BACKUP_S3_SECRET_KEY=
BACKUP_S3_REGION=us-east-1
```

The password-reset email flow uses SMTP. Configure these variables when that
flow is enabled:

```text
SMTP_HOST=<provider host>
SMTP_PORT=<provider port>
SMTP_USER=<provider username>
SMTP_PASSWORD=<provider password>
SMTP_FROM=<verified sender address>
```

For the initial production administrator, run the one-time seed command with
`PROD_ADMIN_EMAIL` and `PROD_ADMIN_PASSWORD` supplied as protected Railway
variables, then remove or clear those variables:

```bash
npm run seed:prod-admin --workspace @clinic-system/api
```

`VITE_API_URL` belongs to the Cloudflare Pages frontend build environment, not
the Railway API runtime.

## Persistent backup volume

In the Railway service settings, create or attach a **Railway Volume** and set
its mount path exactly to:

```text
/app/backups
```

This dashboard action is required because Railway volume attachment is not
represented in repository configuration. Without the volume, encrypted backups
and the backup manifest are stored on ephemeral service storage.

The daily scheduled backup remains enabled and prunes entries according to
`BACKUP_RETENTION_DAYS`. Configure S3-compatible remote backup variables if
off-service disaster recovery is required; a Railway Volume alone does not
protect against loss of the Railway service or volume.

## Verification

After Railway supplies the variables and the volume is attached:

```bash
curl https://<railway-public-domain>/api/health
```

The response must report a healthy application with a connected database.
After authentication, run an administrative backup and confirm that the backup
status endpoint reports the new artifact. Then verify the scheduled backup log
and perform a restore rehearsal against an isolated database.
