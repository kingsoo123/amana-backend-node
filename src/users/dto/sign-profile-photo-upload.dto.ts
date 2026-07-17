import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SignProfilePhotoUploadDto {
  @IsOptional()
  @IsIn(['image'])
  resourceType?: 'image';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}
