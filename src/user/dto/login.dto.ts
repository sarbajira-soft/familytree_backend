import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'user@example.com or 9876543210',
    description: 'Email address or mobile number with country code',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  username: string;

  @ApiProperty({
    example: 'yourpassword',
    description: 'User password',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  password: string;
}