import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;
}

export class UpdatePartnerWebhookDto {
  @IsUrl({ require_tld: false })
  webhookUrl: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  webhookSecret?: string;
}
