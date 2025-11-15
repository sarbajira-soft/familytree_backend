import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptTermsDto {
  @ApiProperty({
    example: true,
    description: 'Flag indicating that the user accepts the Terms & Conditions',
  })
  @IsBoolean()
  accepted: boolean;

  @ApiProperty({
    example: 'v1.0.0',
    description: 'Version of the Terms & Conditions being accepted',
    required: false,
    default: 'v1.0.0',
  })
  @IsOptional()
  @IsString()
  termsVersion?: string;
}
