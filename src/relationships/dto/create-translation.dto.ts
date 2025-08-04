import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTranslationDto {
  @ApiProperty({
    example: 'ta',
    description: 'Language code',
    enum: ['en', 'ta', 'hi', 'ma', 'ka', 'te'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['en', 'ta', 'hi', 'ma', 'ka', 'te'])
  language: string;

  @ApiProperty({ example: 'அப்பா', description: 'Translated label' })
  @IsString()
  @IsNotEmpty()
  label: string;
}
