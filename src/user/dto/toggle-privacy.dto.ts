import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TogglePrivacyDto {
  @ApiProperty({ description: 'Set to true to make account private' })
  @IsBoolean()
  isPrivate: boolean;
}
