import {
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateInvoiceDto {
  @IsEmail()
  buyerEmail: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  buyerName?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /** Optional nearby online rider to assign for delivery. */
  @IsOptional()
  @IsUUID()
  riderId?: string;
}
