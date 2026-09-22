# Production Deployment Runbook

> For the supported Cloudflare Pages + Railway + Neon deployment, use
> [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md). The VPS/Compose procedure
> below remains available for the existing self-hosted deployment.

The following sections describe the legacy single-VPS deployment using Docker Compose,
PostgreSQL, NestJS, and Nginx with HTTPS termination.

## VPS baseline

- Ubuntu 22.04 or newer (or an equivalent Linux distribution)
- 2 vCPUs and 4 GB RAM minimum; use more memory for larger PDF workloads
- At least 40 GB of persistent SSD storage, plus space for PostgreSQL and backups
- A DNS `A`/`AAAA` record pointing the clinic hostname to the VPS
- Docker Engine and the Docker Compose plugin

Install Docker using Docker's official instructions, then verify:

```bash
docker --version
docker compose version
```

## Firewall and DNS

Allow only:

- SSH (preferably restricted to the administrator's source IP)
- TCP 80 for the HTTP-to-HTTPS redirect and ACME HTTP challenges
- TCP 443 for the application

Do not publish PostgreSQL or the API port. The production Compose file exposes
only the web container.

Create the DNS record before requesting a certificate:

```text
clinic.example.com -> <VPS public IP>
```

## Configure the deployment

From the repository checkout on the VPS:

```bash
cp .env.prod.example .env
mkdir -p backups certificates
chmod 700 backups certificates
chmod 600 .env
```

Edit `.env` and replace every placeholder. In particular, set:

- Strong, distinct `POSTGRES_PASSWORD`, `JWT_SECRET`, and `JWT_REFRESH_SECRET`
- `FRONTEND_URL` and `VITE_API_URL` to the same public `https://` origin
- `BACKUP_ENCRYPTION_KEY` to an out-of-band 32-byte base64 or hex key
- `TLS_CERT_DIR` to a host directory containing `fullchain.pem` and `privkey.pem`

The production API rejects missing backup encryption or an insecure frontend
origin. Nginx also refuses to start if the configured certificate files are
missing.

## TLS certificate setup

Use a Certbot installation appropriate for the VPS and obtain a certificate for
the public hostname. Export or copy the resulting certificate and key to the
directory configured by `TLS_CERT_DIR`:

```text
certificates/
  fullchain.pem
  privkey.pem
```

Keep `privkey.pem` readable only by root/administrators. When renewing a
certificate, update both files and recreate the web container:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate web
```

Do not commit certificates or private keys.

## First deployment

Review the rendered configuration before starting:

```bash
docker compose --env-file .env -f docker-compose.prod.yml config
```

Build and start the stack:

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

The API container runs `prisma migrate deploy` before starting NestJS. A failed
migration prevents the API healthcheck from succeeding and therefore prevents
the web container from becoming healthy.

Check status and health:

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
curl -I https://clinic.example.com/
curl https://clinic.example.com/api/health
```

The health response must report `"status":"healthy"` and
`"database":"connected"`.

## Backups and logs

Local encrypted backups are stored in the host `./backups` directory mounted
into the API container. Configure S3-compatible off-server storage in `.env`
for protection against VPS loss.

Inspect backup status and recent logs:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=200 api
docker compose --env-file .env -f docker-compose.prod.yml exec api ls -lh /app/backups
```

Regularly perform a restore rehearsal using an isolated database and verify the
backup artifact before relying on it for disaster recovery.

## Updates and rollback

Before an update, verify that a recent backup exists and record the deployed
image/source revision. Deploy normally with:

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

If the new application fails health checks, inspect logs and stop accepting
traffic only after confirming the failure:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=300 api web
```

For an application-only rollback, check out the last known-good repository
revision and rebuild the images. Do not automatically roll back database
migrations: review migration compatibility first, because schema changes may
not be reversible by an older application image.

If the database is inconsistent or data loss is suspected, stop the application,
preserve the current volumes and logs, and use the documented encrypted backup
restore procedure. Treat restore as a maintenance operation and verify the
restored financial relationships before reopening the site.

```bash
docker compose --env-file .env -f docker-compose.prod.yml stop web api
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=300 api
```

Never delete `postgres_data` or `backups` as a rollback shortcut.
