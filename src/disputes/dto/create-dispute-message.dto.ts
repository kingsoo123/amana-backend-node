import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDisputeMessageDto {
  @IsString()
  @MinLength(1, { message: 'Message cannot be empty' })
  @MaxLength(4000, { message: 'Message is too long' })
  body: string;
}
