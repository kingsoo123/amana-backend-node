import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class DisputeMessageAttachmentDto {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] })
  url: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  publicId: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  resourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  bytes?: number;
}

export class CreateDisputeMessageDto {
  @ValidateIf((dto: CreateDisputeMessageDto) => !dto.attachment)
  @IsString()
  @MinLength(1, { message: 'Message cannot be empty' })
  @MaxLength(4000, { message: 'Message is too long' })
  body?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DisputeMessageAttachmentDto)
  attachment?: DisputeMessageAttachmentDto;
}
