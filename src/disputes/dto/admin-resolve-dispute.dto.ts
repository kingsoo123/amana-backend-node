import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminResolveDisputeDto {
  @IsEnum(['under_review', 'resolved_buyer', 'resolved_seller', 'closed'])
  status: 'under_review' | 'resolved_buyer' | 'resolved_seller' | 'closed';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNotes?: string;
}
