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
import { FileInterceptor, FilesInterceptor, FileFieldsInterceptor, AnyFilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { generateFileName } from '../utils/upload.utils';
import { FamilyService } from './family.service';
import { CreateFamilyDto } from './dto/create-family.dto';
import { CreateFamilyTreeDto } from './dto/family-tree.dto';
import { UploadService } from '../uploads/upload.service';
import { ApiConsumes, ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { imageFileFilter } from '../utils/upload.utils';

@ApiTags('Family')
@Controller('family')
export class FamilyController {
  constructor(private readonly familyService: FamilyService, private readonly uploadService: UploadService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @UseInterceptors(FileInterceptor('familyPhoto', {
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
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
      // Upload to S3 and get the file path
      body.familyPhoto = await this.uploadService.uploadFile(file, 'family');
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
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
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
    let fileName: string | undefined;
    
    if (file) {
      // Upload to S3 and get the file path
      fileName = await this.uploadService.uploadFile(file, 'family');
      body.familyPhoto = fileName;
    }
    
    return this.familyService.update(id, body, fileName, loggedInUser.userId);
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
    storage: memoryStorage(),
    fileFilter: imageFileFilter,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit
    },
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

  @Get('user/:userId/families')
  @ApiOperation({ summary: 'Get all family codes a user is associated with' })
  @ApiResponse({ status: 200, description: 'User family codes retrieved successfully' })
  async getUserFamilyCodes(@Param('userId') userId: number) {
    return this.familyService.getUserFamilyCodes(userId);
  }

  @Get('user/:userId/relationships')
  @ApiOperation({ summary: 'Get all relationships for a user' })
  @ApiResponse({ status: 200, description: 'User relationships retrieved successfully' })
  async getUserRelationships(@Param('userId') userId: number) {
    return this.familyService.getUserRelationships(userId);
  }

  @Get('associated/:familyCode')
  @ApiOperation({ summary: 'Get associated family tree by family code (legacy - redirects to userId-based method)' })
  @ApiResponse({ status: 200, description: 'Associated family tree retrieved successfully' })
  async getAssociatedFamilyTree(@Param('familyCode') familyCode: string) {
    return this.familyService.getAssociatedFamilyTree(familyCode);
  }

  @Get('associated-by-user/:userId')
  @ApiOperation({ summary: 'Get associated family tree by userId - traverses all connected family codes' })
  @ApiResponse({ status: 200, description: 'Associated family tree retrieved successfully' })
  async getAssociatedFamilyTreeByUserId(@Param('userId', ParseIntPipe) userId: number) {
    return this.familyService.getAssociatedFamilyTreeByUserId(userId);
  }

  @Post('sync-person/:userId')
  @ApiOperation({ summary: 'Sync person data across all family trees they appear in' })
  @ApiResponse({ status: 200, description: 'Person data synced successfully' })
  async syncPersonAcrossAllTrees(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() updates: any
  ) {
    return this.familyService.syncPersonAcrossAllTrees(userId, updates);
  }

  @Post('create-manual-tree/:userId')
  @ApiOperation({ summary: 'Create manual associated tree for a user' })
  @ApiResponse({ status: 201, description: 'Manual associated tree created successfully' })
  async createManualAssociatedTree(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() data: { familyCode: string; basicInfo: any }
  ) {
    return this.familyService.createManualAssociatedTree(userId, data.familyCode, data.basicInfo);
  }

  @Post('replace-manual-tree')
  @ApiOperation({ summary: 'Replace manual tree with auto-generated complete tree' })
  @ApiResponse({ status: 200, description: 'Manual tree replaced successfully' })
  async replaceManualTreeWithComplete(
    @Body() data: { oldFamilyCode: string; newCompleteTreeData: any }
  ) {
    return this.familyService.replaceManualTreeWithComplete(data.oldFamilyCode, data.newCompleteTreeData);
  }

  @Post('user/:userId/add-spouse')
  @ApiOperation({ summary: 'Add spouse relationship and update associated family codes' })
  @ApiResponse({ status: 201, description: 'Spouse relationship created and associated codes updated' })
  async addSpouseRelationship(
    @Param('userId') userId: number,
    @Body('spouseUserId') spouseUserId: number
  ) {
    return this.familyService.addSpouseRelationship(userId, spouseUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('cleanup-userid-data')
  @ApiOperation({ summary: 'Clean up invalid userId data in database' })
  @ApiResponse({ status: 200, description: 'Data cleanup completed' })
  async cleanupUserIdData() {
    const cleanedCount = await this.familyService.cleanupInvalidUserIdData();
    return {
      message: 'Data cleanup completed successfully',
      cleanedRecords: cleanedCount
    };
  }


}