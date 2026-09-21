# CORS Configuration

## Current Implementation

The CORS configuration in `apps/api/src/main.ts` uses `process.env.FRONTEND_URL`:

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

## Production Validation

The `app.module.ts` validates that `FRONTEND_URL` is required in production and must be HTTPS:

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

## Required Configuration

For Railway deployment, set `FRONTEND_URL` to the actual Cloudflare frontend domain:
```
FRONTEND_URL=https://your-cloudflare-app.pages.dev
```

Multiple origins can be comma-separated:
```
FRONTEND_URL=https://your-cloudflare-app.pages.dev,https://custom-domain.com
```

## Security Model

- No wildcard origins (`*`) with credentials
- Explicit origin validation
- HTTPS-only in production
- Credentials enabled for refresh token cookies

## Files Changed

No CORS code changes were made. The configuration is documented in `docs/production-cors-configuration.md`.
