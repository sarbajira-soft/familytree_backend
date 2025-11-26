import { 
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FamilyMergeService } from './family-merge.service';

@ApiTags('Family Merge')
@Controller('family-merge')
export class FamilyMergeController {
  constructor(private readonly familyMergeService: FamilyMergeService) {}

  @UseGuards(JwtAuthGuard)
  @Get('search')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search families by family code or admin phone for merge' })
  @ApiResponse({ status: 200, description: 'Families found for merge' })
  async searchFamilies(
    @Query('familyCode') familyCode?: string,
    @Query('adminPhone') adminPhone?: string,
  ) {
    return this.familyMergeService.searchFamilies({ familyCode, adminPhone });
  }

  @UseGuards(JwtAuthGuard)
  @Post('request')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a family merge request (primary ↔ secondary)' })
  @ApiResponse({ status: 201, description: 'Merge request created successfully' })
  async createMergeRequest(
    @Req() req,
    @Body() body: { primaryFamilyCode: string; secondaryFamilyCode: string; anchorConfig?: any },
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.createMergeRequest(
      body.primaryFamilyCode,
      body.secondaryFamilyCode,
      userId,
      body.anchorConfig,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('preview/:familyCode')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get lightweight family preview for anchor selection' })
  async getFamilyPreviewForAnchor(
    @Req() req,
    @Param('familyCode') familyCode: string,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.getFamilyPreviewForAnchor(familyCode, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('requests')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get merge requests for which the user is primary family admin' })
  async getMergeRequests(
    @Req() req,
    @Query('status') status?: string,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.getRequestsForAdmin(userId, status);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/family-a')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get primary family (Family A) preview for a merge request' })
  async getFamilyAPreview(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.getFamilyAPreview(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/family-b')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get secondary family (Family B) preview for a merge request' })
  async getFamilyBPreview(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.getFamilyBPreview(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/analysis')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Run merge analysis (matches, conflicts, new persons, generation mapping)' })
  async getMergeAnalysis(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.getMergeAnalysis(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/state')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get merge selection/cache state for a merge request' })
  async getMergeState(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.getMergeState(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/state')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save merge selection/cache state for a merge request' })
  async saveMergeState(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.saveMergeState(id, userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/execute')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Execute final family tree merge based on cached selection state' })
  async executeMerge(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.executeMerge(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/accept')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept a family merge request (primary family admin only)' })
  async acceptMergeRequest(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.acceptRequest(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/reject')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a family merge request (primary family admin only)' })
  async rejectMergeRequest(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.rejectRequest(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/secondary-tracking')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get secondary family tracking information' })
  async getSecondaryFamilyTracking(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.getSecondaryFamilyTracking(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/adjust-generation')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Adjust generation offset for no-match merge' })
  async adjustGenerationOffset(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { offset: number; reason?: string },
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.adjustGenerationOffset(id, userId, dto.offset, dto.reason);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/state/edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edit cached merge state' })
  async editMergeState(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() edits: any,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.editMergeState(id, userId, edits);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/state/history')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get merge state edit history' })
  async getMergeStateHistory(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.getMergeStateHistory(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/state/revert')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revert merge state to previous version' })
  async revertMergeState(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { targetVersion: number; reason?: string },
  ) {
    const userId: number = req.user?.userId;
    return this.familyMergeService.revertMergeState(id, userId, dto.targetVersion);
  }
}
