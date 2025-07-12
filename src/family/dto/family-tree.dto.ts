import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class FamilyTreeMemberDto {
  @IsNumber()
  id: number;

  @IsString()
  name: string;

  @IsString()
  gender: string;

  @IsOptional()
  @IsString()
  age?: string | number;

  @IsOptional()
  @IsString()
  img?: string;

  @IsOptional()
  @IsNumber()
  generation?: number;

  @IsArray()
  @IsNumber({}, { each: true })
  parents: number[];

  @IsArray()
  @IsNumber({}, { each: true })
  children: number[];

  @IsArray()
  @IsNumber({}, { each: true })
  spouses: number[];

  @IsArray()
  @IsNumber({}, { each: true })
  siblings: number[];

  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsOptional()
  @IsNumber()
  memberId?: number; // For existing users
}

export class CreateFamilyTreeDto {
  @IsString()
  familyCode: string;

  @ValidateNested({ each: true })
  @Type(() => FamilyTreeMemberDto)
  @IsArray()
  members: FamilyTreeMemberDto[];
} 