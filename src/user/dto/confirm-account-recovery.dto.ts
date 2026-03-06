import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ConfirmAccountRecoveryDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email or mobile used for account recovery request' })
  @IsString()
  @MinLength(3)
  identifier: string;

  @ApiProperty({ example: '123456', description: 'One-time recovery token' })
  @IsString()
  @MinLength(4)
  token: string;
}
