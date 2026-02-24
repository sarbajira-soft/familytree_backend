import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({ example: 'newadmin@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'StrongPassword@123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'Admin Name' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiPropertyOptional({ enum: ['admin', 'superadmin'], default: 'admin' })
  @IsOptional()
  @IsIn(['admin', 'superadmin'])
  role?: 'admin' | 'superadmin';

  @ApiPropertyOptional({ example: 1, description: '1=active, other=inactive' })
  @IsOptional()
  status?: number;
}
