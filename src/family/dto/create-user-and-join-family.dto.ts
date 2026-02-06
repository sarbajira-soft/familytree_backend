
import { IsString, IsEmail, IsOptional, IsNotEmpty, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateUserAndJoinFamilyDto {
  // --- USER fields ---
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsNotEmpty()
  password: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  role?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  status?: number;

  // --- USER PROFILE fields ---
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  profile?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  dob?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  age?: number;

  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @IsOptional()
  marriageDate?: Date;

  @IsOptional()
  @IsString()
  spouseName?: string;

  @IsOptional()
  @IsString()
  childrenNames?: string;

  @IsOptional()
  @IsString()
  fatherName?: string;

  @IsOptional()
  @IsString()
  motherName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  religionId?: number;

  @IsOptional()
  @IsString()
  otherReligion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  languageId?: number;

  @IsOptional()
  @IsString()
  otherLanguage?: string;

  @IsOptional()
  @IsString()
  caste?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  gothramId?: number;

  @IsOptional()
  @IsString()
  otherGothram?: string;

  @IsOptional()
  @IsString()
  kuladevata?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  hobbies?: string;

  @IsOptional()
  @IsString()
  likes?: string;

  @IsOptional()
  @IsString()
  dislikes?: string;

  @IsOptional()
  @IsString()
  favoriteFoods?: string;

  @IsOptional()
  @IsString()
  contactNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  countryId?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  // --- FAMILY JOIN ---
  @IsNotEmpty()
  @IsString()
  familyCode: string;
}
