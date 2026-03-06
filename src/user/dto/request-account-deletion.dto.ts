import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RequestAccountDeletionDto {
  @ApiProperty({ example: 'DELETE', description: 'Must be DELETE to confirm account deletion' })
  @IsString()
  @MinLength(6)
  confirmText: string;
}
