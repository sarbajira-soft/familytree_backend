import { Controller, Get, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { BlockingService } from '../../blocking.service';

@ApiTags('Block')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('block')
export class BlockListController {
  constructor(private readonly blockingService: BlockingService) {}

  @Get()
  @ApiOperation({ summary: 'Get blocked users' })
  @ApiResponse({ status: 200, description: 'Blocked users fetched' })
  async getBlockedUsers(@Req() req: any) {
    const blockerUserId = Number(req.user?.id || req.user?.userId);
    console.log('[BlockListController] Getting blocked users for blockerUserId:', blockerUserId);
    console.log('[BlockListController] User from token:', req.user);
    
    const data = await this.blockingService.getBlockedUsers(blockerUserId);
    console.log('[BlockListController] Service returned data count:', data?.length || 0);
    console.log('[BlockListController] Service returned data:', JSON.stringify(data, null, 2));

    return {
      success: true,
      data,
    };
  }

  @Get('status/:userId')
  @ApiOperation({ summary: 'Get block status between logged-in user and target user' })
  @ApiResponse({ status: 200, description: 'Block status fetched' })
  async getBlockStatus(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: any,
  ) {
    const currentUserId = Number(req.user?.id || req.user?.userId);
    const data = await this.blockingService.getBlockStatus(currentUserId, userId);

    return {
      success: true,
      data,
    };
  }
}
