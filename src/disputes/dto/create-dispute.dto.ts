import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateDisputeDto {
  @IsEnum([
    'items_not_received',
    'damaged_goods',
    'wrong_items',
    'not_as_described',
    'other',
  ])
  reason:
    | 'items_not_received'
    | 'damaged_goods'
    | 'wrong_items'
    | 'not_as_described'
    | 'other';

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  locationAccuracy?: number;
}
