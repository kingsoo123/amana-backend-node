import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

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
}
