import {
  Controller,
  Post,
  Param,
  Get,
  Put,
  Patch,
  Req,
  UploadedFile,
  ForbiddenException,
  Body,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
  UseGuards,
  UseInterceptors,
  
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { FamilyService } from './family.service';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { CreateFamilyDto } from './dto/create-family.dto';

import { ApiConsumes, ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';


@ApiTags('Family Module')
@Controller('family')
export class FamilyController {
  constructor(private readonly familyService: FamilyService) {}

  @UseGuards(JwtAuthGuard)
  @Post('member/create')
  @UseInterceptors(FileInterceptor('profile', {
    storage: diskStorage({
      destination: (req, file, cb) => {
        cb(null, process.env.UPLOAD_FOLDER_PATH || './uploads/profile');
      },
      filename: (req, file, cb) => {
        const filename = generateFileName(file.originalname);
        cb(null, filename);
      },
    }),
    fileFilter: imageFileFilter,
  }))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create family member' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Family member created and welcome email sent' })
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  async createFamilyMember(
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateFamilyMemberDto,
  ) {
    if (file) {
      body.profile = file.filename;
    }
    const loggedInUser = req.user;
    
    // Only allow role 2 (admin) and role 3 (superadmin)
    if (![2, 3].includes(loggedInUser.role)) {
      throw new BadRequestException('Access denied: Only admins or superadmins can create family members');
    }
    const created = await this.familyService.createFamilyMember(body, loggedInUser.userId);

    return {
      message: 'Family member created successfully and welcome email sent',
      data: created,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @UseInterceptors(FileInterceptor('familyPhoto', {
    storage: diskStorage({
      destination: (req, file, cb) => {
        cb(null, process.env.UPLOAD_FOLDER_PATH || './uploads/family');
      },
      filename: (req, file, cb) => {
        const filename = generateFileName(file.originalname);
        cb(null, filename);
      },
    }),
    fileFilter: imageFileFilter,
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new family' })
  @ApiResponse({ status: 201, description: 'Family created successfully' })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateFamilyDto,
  ) {
    const loggedInUser = req.user;
    if (file) {
      body.familyPhoto = file.filename;
    }

    return this.familyService.createFamily(body, loggedInUser.userId);
  }


}