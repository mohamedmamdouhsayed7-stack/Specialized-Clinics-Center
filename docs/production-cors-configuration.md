# Production CORS Configuration

## Required Railway Environment Variable

For the Cloudflare frontend to successfully authenticate with the Railway backend, the following environment variable must be set on Railway:

```
FRONTEND_URL=https://your-cloudflare-app.pages.dev
```

## Multiple Origins

If using multiple frontend domains (e.g., staging and production), use comma-separated values:

```
FRONTEND_URL=https://staging-app.pages.dev,https://production-app.pages.dev
```

## Validation Rules

The application enforces the following validation in production:

1. **FRONTEND_URL is required** in production mode
2. **Must use HTTPS** - the URL must start with `https://`
3. **Must be public** - cannot use `localhost` or `127.0.0.1` in production
4. **No wildcard origins** - specific origins must be listed explicitly
5. **Credentials enabled** - required for refresh token cookies

## How to Configure on Railway

1. Go to Railway project settings
2. Navigate to Variables tab
3. Add `FRONTEND_URL` environment variable
4. Set value to your actual Cloudflare Pages domain
5. Redeploy the Railway application

## Example Values

**Staging:**
```
FRONTEND_URL=https://clinic-staging.pages.dev
```

**Production:**
```
FRONTEND_URL=https://clinic-production.pages.dev
```

**Both:**
```
FRONTEND_URL=https://clinic-staging.pages.dev,https://clinic-production.pages.dev
```

## Security Model

- No wildcard origins (`*`) with credentials
- Explicit origin validation
- HTTPS-only in production
- Credentials enabled for refresh token cookies
- Origin is validated against the allowed list before allowing requests

## Current Implementation

The CORS configuration is in `apps/api/src/main.ts`:

```typescript
const configuredOrigins = process.env.FRONTEND_URL
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins?.length
  ? configuredOrigins
  : process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:3000'];

app.enableCors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true,
});
```

The validation is in `apps/api/src/app.module.ts`:

```typescript
if (config.NODE_ENV === 'production') {
  requiredEnvVars.push('FRONTEND_URL', 'BACKUP_ENCRYPTION_KEY');
}

if (
  config.NODE_ENV === 'production' &&
  (!config.FRONTEND_URL.startsWith('https://') ||
    /localhost|127\.0\.0\.1/i.test(config.FRONTEND_URL))
) {
  throw new Error('FRONTEND_URL must be a public HTTPS origin in production');
}
```
