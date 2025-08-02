import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InviteService } from './invite.service';

class CreateInviteDto {
  phone: string;
  inviterId: number;
  spouseMemberId?: number;
}

@ApiTags('Invites')
@Controller('invites')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  @Post()
  @ApiOperation({ summary: 'Create an invite token for mobile-flow' })
  @ApiResponse({ status: 201, description: 'Invite created' })
  async create(@Body() dto: CreateInviteDto) {
    const invite = await this.inviteService.createInvite(
      dto.phone,
      dto.inviterId,
      dto.spouseMemberId,
    );
    return {
      token: invite.token,
      expiresAt: invite.expiresAt,
    };
  }
}
