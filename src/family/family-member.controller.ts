import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FamilyMemberService } from './family-member.service';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { CreateUserAndJoinFamilyDto } from './dto/create-user-and-join-family.dto';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiConsumes,
  ApiBody, 
  ApiSecurity
} from '@nestjs/swagger';

@ApiTags('Family Member')
@Controller('family/member')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FamilyMemberController {
  constructor(private readonly familyMemberService: FamilyMemberService) {}

  @Post('register-and-join-family')
  @UseInterceptors(
    FileInterceptor('profile', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          cb(null, process.env.PROFILE_UPLOAD_PATH || './uploads/profile');
        },
        filename: (req, file, cb) => {
          const filename = generateFileName(file.originalname);
          cb(null, filename);
        },
      }),
      fileFilter: imageFileFilter,
    }),
  )
  @ApiOperation({ summary: 'Register new user and request to join family' })
  @ApiResponse({ status: 201, description: 'User created and family join request submitted' })
  @ApiConsumes('multipart/form-data')
  async registerAndJoinFamily(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateUserAndJoinFamilyDto,
    @Req() req
  ) {
    // Save uploaded filename to DTO before passing it
    if (file) {
      dto.profile = file.filename;
    }
    const creatorId = req.user?.userId;
    return this.familyMemberService.createUserAndJoinFamily(dto, creatorId);
  }

  // User requests to join a family (creates membership with pending)
  @Post('request-join')
  @ApiOperation({ summary: 'Request to join family' })
  @ApiResponse({ status: 201, description: 'Family join request submitted' })
  async requestToJoinFamily(@Body() body: CreateFamilyMemberDto, @Req() req) {
    const loggedInUserId = req.user?.userId;
    return this.familyMemberService.requestToJoinFamily(body, loggedInUserId);
  }

  // Approve member (admin action)
  @Put('approve/:memberId/:familyCode')
  @ApiOperation({ summary: 'Approve family member request' })
  @ApiResponse({ status: 200, description: 'Member approved successfully' })
  async approveMember(
    @Param('memberId') memberId: number,
    @Param('familyCode') familyCode: string,
  ) {
    return this.familyMemberService.approveFamilyMember(memberId, familyCode);
  }

  // Reject member (admin action)
  @Put('reject/:memberId/:familyCode')
  @ApiOperation({ summary: 'Reject family member request' })
  @ApiResponse({ status: 200, description: 'Member rejected successfully' })
  async rejectMember(
    @Param('memberId') memberId: number,
    @Param('familyCode') familyCode: string,
    @Req() req
  ) {
    const rejectorId = req.user?.userId;
    return this.familyMemberService.rejectFamilyMember(memberId, rejectorId, familyCode);
  }

  // Delete member from family (remove membership)
  @Delete('delete/:memberId/:familyCode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove member from family' })
  @ApiResponse({ status: 200, description: 'Family member removed successfully' })
  async deleteMember(
    @Param('memberId') memberId: number,
    @Param('familyCode') familyCode: string,
  ) {
    return this.familyMemberService.deleteFamilyMember(memberId, familyCode);
  }

  // Get all approved family members by family code
  @Get(':familyCode')
  @ApiOperation({ summary: 'Get all approved family members by family code' })
  @ApiResponse({ status: 200, description: 'List of family members returned' })
  async getFamilyMembers(@Param('familyCode') familyCode: string) {
    return this.familyMemberService.getAllFamilyMembers(familyCode);
  }

  // Get all pending family member requests for logged-in user
  @Get('requests/pending')
  @ApiOperation({ summary: 'Get all pending family member requests' })
  @ApiResponse({ status: 200, description: 'List of pending family member requests returned' })
  async getPendingRequests(@Req() req) {
    const userId = req.user.userId; // Extract logged-in user ID from token
    return this.familyMemberService.getPendingRequestsByUser(userId);
  }

  // Get member relationship details by memberId
  @Get('member/:memberId')
  @ApiOperation({ summary: 'Get family member details by memberId' })
  @ApiResponse({ status: 200, description: 'Family member details returned' })
  async getMemberRelation(@Param('memberId') memberId: number) {
    return this.familyMemberService.getMemberById(memberId);
  }

  @Get(':familyCode/stats')
  async getStats(@Param('familyCode') familyCode: string) {
    const stats = await this.familyMemberService.getFamilyStatsByCode(familyCode);
    return { message: 'Family stats fetched successfully', data: stats };
  }

}
