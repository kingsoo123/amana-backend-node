import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewPartnerAccessRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNotes?: string;
}
