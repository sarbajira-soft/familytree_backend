import { Controller, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { BlockingService } from '../../blocking.service';

@ApiTags('Block')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('block')
export class BlockBlockController {
  constructor(private readonly blockingService: BlockingService) {}

  @Post(':userId')
  @ApiOperation({ summary: 'Block user' })
  @ApiResponse({ status: 201, description: 'User blocked successfully' })
  async blockUser(@Param('userId', ParseIntPipe) userId: number, @Req() req: any) {
    const blockerUserId = Number(req.user?.id || req.user?.userId);
    const data = await this.blockingService.blockUser(blockerUserId, userId);

    return {
      success: true,
      message: 'User blocked successfully',
      data,
    };
  }
}
