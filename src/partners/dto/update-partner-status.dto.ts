import { IsIn } from 'class-validator';
import type { PartnerStatus } from '../partner.entity';

export class UpdatePartnerStatusDto {
  @IsIn(['active', 'disabled'])
  status: PartnerStatus;
}
