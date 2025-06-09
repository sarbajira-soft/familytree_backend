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
  Delete,
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
        cb(null, process.env.FAMILY_PHOTO_UPLOAD_PATH || './uploads/family');
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

  @Get()
  @ApiOperation({ summary: 'Get all families' })
  @ApiResponse({ status: 200, description: 'List of families' })
  getAll() {
    return this.familyService.getAll();
  }

  @Get('code/:familyCode')
  @ApiOperation({ summary: 'Get family by code' })
  @ApiResponse({ status: 200, description: 'Family found' })
  getByCode(@Param('familyCode') familyCode: string) {
    return this.familyService.getByCode(familyCode);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  @UseInterceptors(FileInterceptor('familyPhoto', {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const uploadPath = process.env.FAMILY_PHOTO_UPLOAD_PATH || './uploads/family';
        if (!fs.existsSync(uploadPath)) {
          fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
      },
      filename: (req, file, cb) => {
        cb(null, generateFileName(file.originalname));
      }
    }),
    fileFilter: imageFileFilter,
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update family by ID' })
  async update(
    @Req() req,
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateFamilyDto
  ) {
    const loggedInUser = req.user;
    if (file) {
      body.familyPhoto = file.filename;
    }
    return this.familyService.update(id, body, file?.filename, loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete family by ID' })
  delete(@Param('id') id: number) {
    return this.familyService.delete(id);
  }

}