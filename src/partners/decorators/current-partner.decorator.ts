import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Partner } from '../partner.entity';

export const CurrentPartner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Partner => {
    const request = context.switchToHttp().getRequest<{ partner: Partner }>();
    return request.partner;
  },
);
