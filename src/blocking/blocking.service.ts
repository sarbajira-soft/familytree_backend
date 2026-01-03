import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from '../user/model/user.model';
import { BlockType, UserBlock } from './model/user-block.model';

@Injectable()
export class BlockingService {
  constructor(
    @InjectModel(UserBlock)
    private readonly userBlockModel: typeof UserBlock,
    @InjectModel(User)
    private readonly userModel: typeof User,
  ) {}

  async blockUser(
    blockerUserId: number,
    blockedUserId: number,
    blockType: BlockType = BlockType.USER,
  ): Promise<UserBlock> {
    if (!blockerUserId || !blockedUserId) {
      throw new BadRequestException('blockerUserId and blockedUserId are required');
    }

    if (blockerUserId === blockedUserId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const target = await this.userModel.findByPk(blockedUserId);
    if (!target) {
      throw new NotFoundException('User to block not found');
    }

    const active = await this.userBlockModel.findOne({
      where: {
        blockerUserId,
        blockedUserId,
        blockType,
        deletedAt: null,
      },
    });

    if (active) {
      return active;
    }

    const latestDeleted = await this.userBlockModel.findOne({
      where: {
        blockerUserId,
        blockedUserId,
        blockType,
        deletedAt: { [Op.ne]: null },
      },
      order: [['updatedAt', 'DESC']],
    });

    if (latestDeleted) {
      await latestDeleted.update({ deletedAt: null });
      return latestDeleted;
    }

    return this.userBlockModel.create({
      blockerUserId,
      blockedUserId,
      blockType,
      deletedAt: null,
    } as any);
  }

  async unblockUser(blockerUserId: number, blockedUserId: number): Promise<void> {
    if (!blockerUserId || !blockedUserId) {
      throw new BadRequestException('blockerUserId and blockedUserId are required');
    }

    const existing = await this.userBlockModel.findOne({
      where: {
        blockerUserId,
        blockedUserId,
        deletedAt: null,
      },
    });

    if (!existing) {
      return;
    }

    await existing.update({ deletedAt: new Date() });
  }

  async isUserBlockedEitherWay(userA: number, userB: number): Promise<boolean> {
    if (!userA || !userB) {
      return false;
    }

    if (userA === userB) {
      return false;
    }

    const existing = await this.userBlockModel.findOne({
      where: {
        deletedAt: null,
        [Op.or]: [
          { blockerUserId: userA, blockedUserId: userB },
          { blockerUserId: userB, blockedUserId: userA },
        ],
      },
    });

    return !!existing;
  }

  async getBlockedUserIdsForUser(userId: number): Promise<number[]> {
    if (!userId) {
      return [];
    }

    const blocks = await this.userBlockModel.findAll({
      where: {
        deletedAt: null,
        [Op.or]: [{ blockerUserId: userId }, { blockedUserId: userId }],
      },
      attributes: ['blockerUserId', 'blockedUserId'],
    });

    const ids = new Set<number>();
    for (const b of blocks as any[]) {
      const blocker = Number(b.blockerUserId);
      const blocked = Number(b.blockedUserId);
      if (blocker === userId) {
        ids.add(blocked);
      } else if (blocked === userId) {
        ids.add(blocker);
      }
    }

    return Array.from(ids);
  }

  async getBlockedByMe(userId: number): Promise<UserBlock[]> {
    return this.userBlockModel.findAll({
      where: { blockerUserId: userId, deletedAt: null },
      order: [['createdAt', 'DESC']],
    });
  }

  async getBlockedMe(userId: number): Promise<UserBlock[]> {
    return this.userBlockModel.findAll({
      where: { blockedUserId: userId, deletedAt: null },
      order: [['createdAt', 'DESC']],
    });
  }
}
