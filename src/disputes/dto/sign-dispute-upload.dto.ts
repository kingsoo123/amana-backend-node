import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SignDisputeUploadDto {
  @IsOptional()
  @IsIn(['image', 'raw', 'auto'])
  resourceType?: 'image' | 'raw' | 'auto';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}
