import {
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePartnerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  /** Seller (merchant) user who receives released funds */
  @IsUUID()
  sellerId: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string;
}
