import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PartnersService } from '../partners.service';
import { Partner } from '../partner.entity';

export type PartnerRequest = {
  partner: Partner;
  headers: Record<string, string | string[] | undefined>;
};

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly partnersService: PartnersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PartnerRequest>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;

    if (!value?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API key');
    }

    const apiKey = value.slice('Bearer '.length).trim();
    if (!apiKey) {
      throw new UnauthorizedException('Missing API key');
    }

    const partner = await this.partnersService.authenticateApiKey(apiKey);
    if (!partner) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (partner.status !== 'active') {
      throw new UnauthorizedException('Partner is disabled');
    }

    request.partner = partner;
    return true;
  }
}
