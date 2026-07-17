import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { LoginRateLimitService } from '../login-rate-limit.service';

function getClientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }

  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(',')[0]?.trim() || 'unknown';
  }

  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly loginRateLimitService: LoginRateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.loginRateLimitService.consumeIpAttempt(getClientIp(request));
    return true;
  }
}
