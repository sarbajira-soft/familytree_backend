import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InviteService } from './invite.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class CreateInviteDto {
  phone: string;
  inviterId?: number;
  spouseMemberId?: number;
}

@ApiTags('Invites')
@Controller('invites')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an invite token for mobile-flow' })
  @ApiResponse({ status: 201, description: 'Invite created' })
  async create(@Req() req, @Body() dto: CreateInviteDto) {
    const invite = await this.inviteService.createInvite(
      dto.phone,
      Number(req.user?.userId || 0),
      dto.spouseMemberId,
    );
    return {
      token: invite.token,
      expiresAt: invite.expiresAt,
    };
  }
}
