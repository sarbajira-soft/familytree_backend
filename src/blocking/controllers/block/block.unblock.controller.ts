import { Controller, Delete, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { BlockingService } from '../../blocking.service';

@ApiTags('Block')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('block')
export class BlockUnblockController {
  constructor(private readonly blockingService: BlockingService) {}

  @Delete(':userId')
  @ApiOperation({ summary: 'Unblock user' })
  @ApiResponse({ status: 200, description: 'User unblocked successfully' })
  async unblockUser(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: any,
  ) {
    const blockerUserId = Number(req.user?.id || req.user?.userId);
    await this.blockingService.unblockUser(blockerUserId, userId);

    return {
      success: true,
      message: 'User unblocked successfully',
    };
  }
}
