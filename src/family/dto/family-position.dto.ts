// family-position.dto.ts
import { IsArray, ValidateNested, IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class FamilyPositionDto {
  @IsString()
  familyCode: string;

  @IsNumber()
  userId: number;

  @IsString()
  position: string;

  @IsString()
  gender: string;

  @IsOptional()
  @IsNumber()
  parentId: number | null;
}

export class BulkInsertFamilyPositionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FamilyPositionDto)
  positions: FamilyPositionDto[];
}
