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
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FamilyMemberService } from './family-member.service';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { CreateUserAndJoinFamilyDto } from './dto/create-user-and-join-family.dto';
import { BlockingService } from '../blocking/blocking.service';

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
@ApiBearerAuth()
export class FamilyMemberController {
  constructor(
    private readonly familyMemberService: FamilyMemberService,
    private readonly blockingService: BlockingService,
  ) {}

  @Post('register-and-join-family')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Request to join family' })
  @ApiResponse({ status: 201, description: 'Family join request submitted' })
  @ApiResponse({ status: 400, description: 'Invalid family code or user already exists' })
  async requestToJoinFamily(@Body() body: CreateFamilyMemberDto, @Req() req) {
    const loggedInUserId = req.user?.userId;
    return this.familyMemberService.requestToJoinFamily(body, loggedInUserId);
  }

  // Approve member (admin action)
  @Put('approve/:memberId/:familyCode')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Approve family member request' })
  @ApiResponse({ status: 200, description: 'Member approved successfully' })
  async approveMember(
    @Param('memberId') memberId: number,
    @Param('familyCode') familyCode: string,
    @Req() req,
  ) {
    const approverId = req.user?.userId;
    return this.familyMemberService.approveFamilyMember(memberId, familyCode, approverId);
  }

  // Reject member (admin action)
  @Put('reject/:memberId/:familyCode')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove member from family' })
  @ApiResponse({ status: 200, description: 'Family member removed successfully' })
  async deleteMember(
    @Param('memberId') memberId: number,
    @Param('familyCode') familyCode: string,
    @Req() req,
  ) {
    const actingUserId = req.user?.userId;
    return this.familyMemberService.deleteFamilyMember(memberId, familyCode, actingUserId);
  }

  // BLOCK OVERRIDE: Removed legacy family-member block/unblock endpoints; user-level block uses /block routes.

  // Get all approved family members by family code
  @Get(':familyCode')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get all approved family members by family code' })
  @ApiResponse({ status: 200, description: 'List of family members returned' })
  async getFamilyMembers(@Param('familyCode') familyCode: string, @Req() req) {
    const requestingUserId = req.user?.userId;
    const response = await this.familyMemberService.getAllFamilyMembers(
      familyCode,
      requestingUserId,
    );

    // BLOCK OVERRIDE: Injected new blockStatus contract into members payload.
    const data = await Promise.all(
      (response?.data || []).map(async (member: any) => {
        const otherUserId = Number(member?.user?.id || member?.memberId);
        if (!otherUserId || Number(otherUserId) === Number(requestingUserId)) {
          return {
            ...member,
            blockStatus: { isBlockedByMe: false, isBlockedByThem: false },
          };
        }

        const blockStatus = await this.blockingService.getBlockStatus(
          Number(requestingUserId),
          Number(otherUserId),
        );
        return { ...member, blockStatus };
      }),
    );

    return { ...response, data };
  }

  // Get all pending family member requests for logged-in user
  @Get('requests/pending')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get all pending family member requests' })
  @ApiResponse({ status: 200, description: 'List of pending family member requests returned' })
  async getPendingRequests(@Req() req) {
    const userId = req.user.userId; // Extract logged-in user ID from token
    return this.familyMemberService.getPendingRequestsByUser(userId);
  }

  // Get member relationship details by memberId
  @Get('member/:memberId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get family member details by memberId' })
  @ApiResponse({ status: 200, description: 'Family member details returned' })
  async getMemberRelation(@Param('memberId') memberId: number) {
    return this.familyMemberService.getMemberById(memberId);
  }

  @Get('suggest-family/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Suggest existing families based on profile details' })
  async suggestFamily(@Param('userId') userId: number) {
    return this.familyMemberService.suggestFamilyByProfile(userId);
  }

  @Get(':familyCode/stats')
  @UseGuards(JwtAuthGuard)
  async getStats(@Param('familyCode') familyCode: string) {
    const stats = await this.familyMemberService.getFamilyStatsByCode(familyCode);
    return { message: 'Family stats fetched successfully', data: stats };
  }

// Public endpoints for link validation (no authentication required)
  @Get('public/:familyCode/member/:memberId/exists')
  @ApiOperation({ summary: 'Check if member exists and link is valid (public endpoint)' })
  @ApiResponse({ status: 200, description: 'Member validation result' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async checkMemberExistsPublic(
    @Param('familyCode') familyCode: string,
    @Param('memberId', ParseIntPipe) memberId: number
  ) {
    return this.familyMemberService.checkMemberExists(familyCode, memberId);
  }

  @Post('public/:familyCode/member/:memberId/mark-used')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark invitation link as used (public endpoint)' })
  @ApiResponse({ status: 200, description: 'Link marked as used successfully' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  @ApiResponse({ status: 400, description: 'Link already used' })
  async markLinkAsUsedPublic(
    @Param('familyCode') familyCode: string,
    @Param('memberId', ParseIntPipe) memberId: number
  ) {
    return this.familyMemberService.markLinkAsUsed(familyCode, memberId);
  }

  @Post('add-user-to-family')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add existing user to family by userId and familyCode' })
  @ApiResponse({ status: 200, description: 'User added to family successfully' })
  @ApiResponse({ status: 400, description: 'Invalid data or user already in family' })
  @ApiResponse({ status: 404, description: 'User or family not found' })
  async addUserToFamily(
    @Body() body: { userId: number; familyCode: string },
    @Req() req
  ) {
    const addedBy = req.user?.userId;
    return this.familyMemberService.addUserToFamily(body.userId, body.familyCode, addedBy);
  }

}
