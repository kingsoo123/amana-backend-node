import dns from 'node:dns';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

const ipv4Lookup = (
  hostname: string,
  options: dns.LookupOneOptions | LookupCallback,
  callback?: LookupCallback,
): void => {
  if (typeof options === 'function') {
    dns.lookup(hostname, { family: 4 }, options);
    return;
  }

  dns.lookup(hostname, { family: 4, ...options }, callback!);
};

function withNeonPoolerHost(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.hostname.includes('-pooler.')) {
      return databaseUrl;
    }

    parsed.hostname = parsed.hostname.replace(/^([^.]+)(\.)/, '$1-pooler$2');
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

function resolveRemoteDatabaseUrl(
  configService: ConfigService,
  databaseUrl: string,
): string {
  const poolerEnv = configService.get<string>('DATABASE_USE_POOLER');
  const usePooler =
    poolerEnv === 'true' ||
    (poolerEnv !== 'false' && databaseUrl.includes('.neon.tech'));

  return usePooler ? withNeonPoolerHost(databaseUrl) : databaseUrl;
}

export function buildTypeOrmConfig(
  configService: ConfigService,
  entities: TypeOrmModuleOptions['entities'],
): TypeOrmModuleOptions {
  const databaseUrl = configService.get<string>('DATABASE_URL')?.trim();
  const synchronize =
    configService.get<string>('DATABASE_SYNCHRONIZE', 'true') === 'true';

  const shared = {
    type: 'postgres' as const,
    entities,
    synchronize,
    autoLoadEntities: false,
  };

  if (databaseUrl) {
    const url = resolveRemoteDatabaseUrl(configService, databaseUrl);

    return {
      ...shared,
      url,
      ssl: { rejectUnauthorized: false },
      retryAttempts: 10,
      retryDelay: 3000,
      extra: {
        connectionTimeoutMillis: 30_000,
        lookup: ipv4Lookup,
      },
    };
  }

  const port = Number.parseInt(
    configService.get<string>('DATABASE_PORT', '5432'),
    10,
  );

  return {
    ...shared,
    host: configService.get<string>('DATABASE_HOST', 'localhost'),
    port: Number.isFinite(port) ? port : 5432,
    username: configService.get<string>('DATABASE_USER', 'amana'),
    password: configService.get<string>('DATABASE_PASSWORD', 'amana'),
    database: configService.get<string>('DATABASE_NAME', 'amana'),
  };
}

export function logDatabaseTarget(configService: ConfigService): void {
  const databaseUrl = configService.get<string>('DATABASE_URL')?.trim();

  if (!databaseUrl) {
    console.log(
      `[database] Using local Postgres at ${configService.get<string>('DATABASE_HOST', 'localhost')}:${configService.get<string>('DATABASE_PORT', '5432')}`,
    );
    return;
  }

  try {
    const url = resolveRemoteDatabaseUrl(configService, databaseUrl);
    const parsed = new URL(url);
    const pooler = parsed.hostname.includes('-pooler.');
    console.log(
      `[database] Using remote Postgres at ${parsed.hostname}:${parsed.port || '5432'} (IPv4, SSL${pooler ? ', pooler' : ''})`,
    );
  } catch {
    console.log('[database] Using remote Postgres via DATABASE_URL (IPv4, SSL)');
  }
}
