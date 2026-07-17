import { IsBoolean, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateRiderEngagementDto {
  @IsBoolean()
  isEngaged: boolean;

  /** Required when engaging — seller invoice number (INV-…) or payment reference (PAY-…). */
  @ValidateIf((dto: UpdateRiderEngagementDto) => dto.isEngaged === true)
  @IsString()
  @MaxLength(64)
  invoiceReference?: string;
}
