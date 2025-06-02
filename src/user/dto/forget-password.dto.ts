import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgetPasswordDto {
  @ApiProperty({ description: 'Email or mobile number' })
  @IsString()
  @IsNotEmpty()
  username: string;
}