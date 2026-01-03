import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BlockingService } from './blocking.service';
import { BlockUserDto } from './dto/user-block.dto';

@ApiTags('Blocking')
@Controller('blocking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class BlockingController {
  constructor(private readonly blockingService: BlockingService) {}

  @Post('block')
  @ApiOperation({ summary: 'Block a user (user-to-user)' })
  @ApiResponse({ status: 201, description: 'User blocked' })
  async block(@Body() dto: BlockUserDto, @Req() req: any) {
    const blockerUserId = Number(req.user?.userId);
    const record = await this.blockingService.blockUser(
      blockerUserId,
      Number(dto.blockedUserId),
      dto.blockType,
    );
    return { message: 'User blocked', data: record };
  }

  @Delete('unblock/:blockedUserId')
  @ApiOperation({ summary: 'Unblock a user (user-to-user)' })
  @ApiResponse({ status: 200, description: 'User unblocked' })
  async unblock(
    @Param('blockedUserId', ParseIntPipe) blockedUserId: number,
    @Req() req: any,
  ) {
    const blockerUserId = Number(req.user?.userId);
    await this.blockingService.unblockUser(blockerUserId, blockedUserId);
    return { message: 'User unblocked' };
  }

  @Get('blocked-by-me')
  @ApiOperation({ summary: 'Get users I have blocked' })
  async blockedByMe(@Req() req: any) {
    const userId = Number(req.user?.userId);
    const rows = await this.blockingService.getBlockedByMe(userId);
    return { message: 'Blocked by me', data: rows };
  }

  @Get('blocked-me')
  @ApiOperation({ summary: 'Get users who blocked me' })
  async blockedMe(@Req() req: any) {
    const userId = Number(req.user?.userId);
    const rows = await this.blockingService.getBlockedMe(userId);
    return { message: 'Blocked me', data: rows };
  }

  @Get('check/:userId')
  @ApiOperation({ summary: 'Check if I am blocked by/blocked with a given user' })
  async check(@Param('userId', ParseIntPipe) otherUserId: number, @Req() req: any) {
    const userId = Number(req.user?.userId);
    const blocked = await this.blockingService.isUserBlockedEitherWay(
      userId,
      otherUserId,
    );
    return { blocked };
  }
}
