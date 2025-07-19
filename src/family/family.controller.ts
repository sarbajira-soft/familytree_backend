import {
  Controller,
  Post,
  Param,
  Query,
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
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { FamilyService } from './family.service';
import { CreateFamilyDto } from './dto/create-family.dto';
import { CreateFamilyTreeDto } from './dto/family-tree.dto';

import { ApiConsumes, ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';
import { AnyFilesInterceptor } from '@nestjs/platform-express';


@ApiTags('Family')
@Controller('family')
export class FamilyController {
  constructor(private readonly familyService: FamilyService) {}

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
  @ApiOperation({ summary: 'Delete family by ID (admin only)' })
  async delete(@Param('id') id: number, @Req() req) {
    const userId = req.user.userId;
    return this.familyService.delete(id, userId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search families by code or name (autocomplete)' })
  async searchFamilies(@Query('query') query: string) {
    if (!query || query.length < 4) {
      return [];
    }
    return this.familyService.searchFamilies(query);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tree/create')
  @UseInterceptors(AnyFilesInterceptor({
    storage: diskStorage({
      destination: (req, file, cb) => {
        const uploadPath = process.env.PROFILE_PHOTO_UPLOAD_PATH || './uploads/profile';
        if (!fs.existsSync(uploadPath)) {
          fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
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
  @ApiOperation({ summary: 'Create or update family tree (removes existing data and creates new)' })
  @ApiResponse({ status: 201, description: 'Family tree created/updated successfully' })
  @HttpCode(HttpStatus.CREATED)
  async createFamilyTree(
    @Req() req,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Body() body: any // all form fields
  ) {
    // Parse person_count
    const personCount = parseInt(body.person_count, 10);
    if (isNaN(personCount) || personCount < 1) {
      throw new BadRequestException('Invalid or missing person_count');
    }
    //console.log(body);return;
    
    // Map files by fieldname (e.g., person_1_img)
    const fileMap = {};
    for (const file of files) {
      fileMap[file.fieldname] = file;
    }

    // Build people array
    const people = [];
    for (let i = 0; i < personCount; i++) {
      const prefix = `person_${i}_`;
      const person: any = {};
      // List of possible fields
      const fields = [
        'id', 'name', 'gender', 'age', 'generation', 'birthOrder', 'memberId',
        'parents', 'children', 'spouses', 'siblings', 'img'
      ];
      for (const field of fields) {
        const key = prefix + field;
        if (field === 'img') {
          // Handle file or URL
          if (fileMap[key]) {
            // Store only the filename, not the full path
            person.img = fileMap[key].filename;
          } else if (body[key]) {
            person.img = body[key];
          } else {
            person.img = null;
          }
        } else {
          person[field] = body[key] !== undefined ? body[key] : null;
        }
      }
      // Add relationshipCode from payload
      person.relationshipCode = body[`${prefix}relationshipCode`] || '';
      // Optionally, split comma-separated fields into arrays
      ['parents', 'children', 'spouses', 'siblings'].forEach(rel => {
        if (typeof person[rel] === 'string' && person[rel]) {
          person[rel] = person[rel].split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0);
        } else {
          person[rel] = [];
        }
      });
      // Convert numeric fields
      ['id', 'age', 'generation', 'birthOrder', 'memberId'].forEach(numField => {
        if (person[numField] !== null && person[numField] !== undefined && person[numField] !== '') {
          person[numField] = isNaN(Number(person[numField])) ? person[numField] : Number(person[numField]);
        } else {
          person[numField] = null;
        }
      });
      people.push(person);
    }

    // Attach updated people to dto/body
    body.members = people;
    // Optionally, remove all person_* fields from body
    Object.keys(body).forEach(key => {
      if (/^person_\d+_/.test(key) || key === 'person_count') {
        delete body[key];
      }
    });
    // familyCode should be present in body
    return this.familyService.createFamilyTree(body);
  }

  @Get('tree/:familyCode')
  @ApiOperation({ summary: 'Get family tree by family code' })
  @ApiResponse({ status: 200, description: 'Family tree retrieved successfully' })
  async getFamilyTree(@Param('familyCode') familyCode: string) {
    return this.familyService.getFamilyTree(familyCode);
  }


}