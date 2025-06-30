import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FamilyMemberService } from './family-member.service';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Family Member')
@Controller('family/member')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FamilyMemberController {
  constructor(private readonly familyMemberService: FamilyMemberService) {}

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
