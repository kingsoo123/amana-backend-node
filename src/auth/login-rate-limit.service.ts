import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Bucket = {
  count: number;
  resetAt: number;
};

@Injectable()
export class LoginRateLimitService {
  private readonly ipBuckets = new Map<string, Bucket>();
  private readonly emailBuckets = new Map<string, Bucket>();

  constructor(private readonly configService: ConfigService) {}

  private get limits() {
    return {
      ipMax: Number(this.configService.get('LOGIN_RATE_LIMIT_IP_MAX') ?? 5),
      ipWindowMs:
        Number(this.configService.get('LOGIN_RATE_LIMIT_IP_WINDOW_SECONDS') ?? 60) *
        1000,
      emailMax: Number(this.configService.get('LOGIN_RATE_LIMIT_EMAIL_MAX') ?? 5),
      emailWindowMs:
        Number(
          this.configService.get('LOGIN_RATE_LIMIT_EMAIL_WINDOW_SECONDS') ?? 900,
        ) * 1000,
    };
  }

  consumeIpAttempt(ip: string): void {
    this.consume(this.ipBuckets, ip, this.limits.ipMax, this.limits.ipWindowMs);
  }

  assertEmailAllowed(email: string): void {
    const normalized = email.trim().toLowerCase();
    const bucket = this.emailBuckets.get(normalized);
    if (!bucket) {
      return;
    }

    this.pruneIfExpired(this.emailBuckets, normalized, bucket);

    if (bucket.count >= this.limits.emailMax) {
      this.throwTooManyRequests(bucket.resetAt);
    }
  }

  recordFailedLogin(email: string): void {
    const normalized = email.trim().toLowerCase();
    this.consume(
      this.emailBuckets,
      normalized,
      this.limits.emailMax,
      this.limits.emailWindowMs,
    );
  }

  clearEmailAttempts(email: string): void {
    this.emailBuckets.delete(email.trim().toLowerCase());
  }

  private consume(
    store: Map<string, Bucket>,
    key: string,
    max: number,
    windowMs: number,
  ): void {
    const now = Date.now();
    const existing = store.get(key);

    if (!existing || existing.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    if (existing.count >= max) {
      this.throwTooManyRequests(existing.resetAt);
    }

    existing.count += 1;
  }

  private pruneIfExpired(
    store: Map<string, Bucket>,
    key: string,
    bucket: Bucket,
  ): void {
    if (bucket.resetAt <= Date.now()) {
      store.delete(key);
    }
  }

  private throwTooManyRequests(resetAt: number): never {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((resetAt - Date.now()) / 1000),
    );

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many sign-in attempts. Please try again later.',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
