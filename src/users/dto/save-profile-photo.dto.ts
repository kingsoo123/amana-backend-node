import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveProfilePhotoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  publicId?: string;
}
