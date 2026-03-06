import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RequestAccountRecoveryDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email or mobile used for account recovery request' })
  @IsString()
  @MinLength(3)
  identifier: string;
}
