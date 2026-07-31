import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;
}
