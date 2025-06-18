import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Req,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FamilyMemberService } from './family-member.service ';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Family Member')
@Controller('family/member')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiConsumes('multipart/form-data')
export class FamilyMemberController {
  constructor(private readonly familyMemberService: FamilyMemberService) {}

  @Post('create')
  @UseInterceptors(FileInterceptor('profile', {
    storage: diskStorage({
      destination: process.env.PROFILE_UPLOAD_PATH || './uploads/profile',
      filename: (req, file, cb) => {
        const filename = generateFileName(file.originalname);
        cb(null, filename);
      },
    }),
    fileFilter: imageFileFilter,
  }))
  @ApiOperation({ summary: 'Create family member' })
  @ApiResponse({ status: 201, description: 'Family member created successfully' })
  async createMember(
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
    @Body() body: CreateFamilyMemberDto
  ) {
    if (file) {
      body.profile = file.filename;
    }
    const loggedInUser = req.user;
    
    return this.familyMemberService.createFamilyMember(body, loggedInUser.userId);
  }

  @Put('update/:id')
  @UseInterceptors(FileInterceptor('profile', {
    storage: diskStorage({
      destination: process.env.PROFILE_UPLOAD_PATH || './uploads/profile',
      filename: (req, file, cb) => {
        const filename = generateFileName(file.originalname);
        cb(null, filename);
      },
    }),
    fileFilter: imageFileFilter,
  }))
  @ApiOperation({ summary: 'Update family member' })
  @ApiResponse({ status: 200, description: 'Family member updated successfully' })
  async updateMember(
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
    @Body() body: CreateFamilyMemberDto
  ) {
    if (file) {
      body.profile = file.filename;
    }

    return this.familyMemberService.updateFamilyMember(id, body);
  }

  @Delete('delete/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete family member' })
  @ApiResponse({ status: 200, description: 'Family member deleted successfully' })
  async deleteMember(@Param('id') id: number, @Req() req) {
    return this.familyMemberService.deleteFamilyMember(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('family-member/:familyCode')
  @ApiOperation({ summary: 'Get all family members by family code' })
  @ApiResponse({ status: 200, description: 'List of family members' })
  @ApiBearerAuth()
  async getAllFamilyMembers(@Param('familyCode') familyCode: string) {
    return this.familyMemberService.getAllFamilyMembers(familyCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('members/:id')
  @ApiOperation({ summary: 'Get all family members by family code' })
  @ApiResponse({ status: 200, description: 'List of family members' })
  @ApiBearerAuth()
  async getMemberById(@Param('id') id: number) {
    return this.familyMemberService.getMemberById(id);
  }


}
