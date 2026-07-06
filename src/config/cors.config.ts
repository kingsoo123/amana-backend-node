import { ConfigService } from '@nestjs/config';

function parseOriginList(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createCorsOriginChecker(configService: ConfigService) {
  const allowedOrigins = new Set(
    parseOriginList(
      configService.get<string>('ALLOWED_ORIGINS') ??
        configService.get<string>('FRONTEND_URL'),
    ),
  );

  const allowNetlifyPreviews =
    configService.get<string>('ALLOW_NETLIFY_PREVIEWS', 'true') === 'true';

  return (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    if (allowNetlifyPreviews) {
      try {
        const { hostname } = new URL(origin);
        if (hostname.endsWith('.netlify.app')) {
          callback(null, true);
          return;
        }
      } catch {
        // ignore invalid origin
      }
    }

    callback(null, false);
  };
}
