# Clinic Production Client Handoff

## Production access

- Frontend: https://clinic-production.pages.dev
- API: https://specialized-clinics-center-production.up.railway.app
- Health check: https://specialized-clinics-center-production.up.railway.app/api/health

## Architecture

The production system uses Cloudflare Pages for the frontend, Railway for the
NestJS API, Neon PostgreSQL for the database, and a Railway Volume mounted at
`/app/backups` for persistent encrypted backups. The staging environment is
separate and remains available for testing.

## Administration

An administrator account is created through the protected production seed
procedure. Administrators manage users, backups, invoice operations, and
system settings. Receptionists can perform day-to-day clinic operations but
cannot perform administrator-only actions.

Password reset requires the Resend HTTPS API settings to be configured in
Railway. Users receive a six-digit verification code that expires after 10
minutes.

## Backups

The PostgreSQL backup is the technical restore backup. It is encrypted,
retained according to the configured policy, and stored under `/app/backups`.
The Railway Volume must remain attached at that exact path.

## Basic health check

Open the health URL above. A successful response reports a healthy API and a
connected database. Do not use destructive operations as a health check.

## Updates and administration locations

Application deployments are made from the GitHub `main` branch through the
Railway API service. Cloudflare Pages hosts the frontend deployment. Neon hosts
the production database. Railway service variables, Resend settings, and the
backup Volume are administered in Railway; database administration is handled
through Neon.

Never place passwords, database URLs, JWT secrets, encryption keys, or provider
API tokens in this document or in source control.
