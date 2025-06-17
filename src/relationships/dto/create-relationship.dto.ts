import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRelationshipDto {
  @ApiProperty({ example: 'father', description: 'Unique relationship key' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({
    example: 'Biological father',
    description: 'Relationship description',
  })
  @IsString()
  @IsNotEmpty()
  description: string;
}
