import { IsString, IsNumber, IsOptional, IsArray, IsObject } from 'class-validator';

export class SearchFamiliesDto {
  @IsOptional()
  @IsString()
  familyCode?: string;

  @IsOptional()
  @IsString()
  adminPhone?: string;
}

export class CreateMergeRequestDto {
  @IsString()
  primaryFamilyCode: string;

  @IsString()
  secondaryFamilyCode: string;
}

export class SaveMergeStateDto {
  @IsObject()
  finalTree: any;

  @IsObject()
  decisions: any;

  @IsArray()
  @IsOptional()
  editHistory?: any[];
}

export class EditMergeStateDto {
  @IsObject()
  changes: any;

  @IsString()
  @IsOptional()
  description?: string;
}

export class RevertMergeStateDto {
  @IsNumber()
  targetVersion: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class AdjustGenerationOffsetDto {
  @IsNumber()
  offset: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class DuplicatePersonDto {
  @IsNumber()
  primaryPersonId: number;

  @IsNumber()
  secondaryPersonId: number;

  @IsString()
  primaryName: string;

  @IsString()
  secondaryName: string;

  @IsOptional()
  @IsNumber()
  primaryUserId?: number;

  @IsOptional()
  @IsNumber()
  secondaryUserId?: number;

  @IsOptional()
  primaryIsAppUser?: boolean;

  @IsOptional()
  secondaryIsAppUser?: boolean;

  @IsString()
  scenario: string;

  @IsNumber()
  confidence: number;

  @IsString()
  level: string;

  @IsArray()
  matchingFields: string[];

  @IsArray()
  differingFields: string[];
}

export class ConflictDto {
  @IsString()
  type: string;

  @IsNumber()
  primaryPersonId: number;

  @IsNumber()
  secondaryPersonId: number;

  @IsString()
  description: string;
}

export class FamilyMemberPreviewDto {
  @IsNumber()
  personId: number;

  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsString()
  name: string;

  @IsOptional()
  @IsNumber()
  age?: number;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsNumber()
  generation?: number;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsArray()
  associatedFamilyCodes: string[];

  @IsOptional()
  isAppUser?: boolean;

  @IsOptional()
  isBlocked?: boolean;

  @IsOptional()
  isAdmin?: boolean;

  @IsString()
  familyCode: string;

  @IsArray()
  parents: number[];

  @IsArray()
  children: number[];

  @IsArray()
  spouses: number[];

  @IsArray()
  siblings: number[];
}
