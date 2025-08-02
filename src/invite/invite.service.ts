import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Invite } from './invite.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class InviteService {
  constructor(@InjectModel(Invite) private readonly inviteModel: typeof Invite) {}

  async createInvite(phone: string, inviterId: number, spouseMemberId?: number) {
    // 1. daily limit check (5 per inviter)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const count = await this.inviteModel.count({
      where: {
        inviterId,
        createdAt: { [Op.gte]: today },
      },
    });
    if (count >= 5) {
      throw new BadRequestException('Daily invite limit reached');
    }

    // 2. generate token & expiry
    const token = uuidv4().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const invite = await this.inviteModel.create({
      phone,
      token,
      inviterId,
      spouseMemberId,
      expiresAt,
    });
    return invite;
  }

  async validateToken(token: string) {
    const invite = await this.inviteModel.findOne({ where: { token } });
    if (!invite || invite.status !== 'pending' || invite.expiresAt < new Date()) {
      throw new BadRequestException('Invite token invalid or expired');
    }
    return invite;
  }

  async markAccepted(inviteId: string) {
    await this.inviteModel.update({ status: 'accepted' }, { where: { id: inviteId } });
  }
}
