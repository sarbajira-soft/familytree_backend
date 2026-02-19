import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../../../user/model/user.model';
import { BlockType, FtUserBlock } from '../../model/user-block.model';

@Injectable()
export class BlockWriteService {
  constructor(
    @InjectModel(FtUserBlock)
    private readonly userBlockModel: typeof FtUserBlock,
    @InjectModel(User)
    private readonly userModel: typeof User,
  ) { }

  /** BLOCK OVERRIDE: New block write flow using append-only + manual soft-delete records. */
  async blockUser(
    blockerUserId: number,
    blockedUserId: number,
    blockType: BlockType = BlockType.USER,
  ): Promise<FtUserBlock> {
    if (!blockerUserId || !blockedUserId) {
      throw new BadRequestException('User ids are required');
    }

    if (Number(blockerUserId) === Number(blockedUserId)) {
      throw new BadRequestException('You cannot block yourself');
    }

    const targetUser = await this.userModel.findByPk(blockedUserId);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.userBlockModel.findOne({
      where: {
        blockerUserId,
        blockedUserId,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new ConflictException('User already blocked');
    }

    const record = await this.userBlockModel.create({
      blockerUserId,
      blockedUserId,
      blockType,
      deletedAt: null,
    } as FtUserBlock);

    // Serialize to plain object to avoid circular Sequelize internals in JSON response.
    if (typeof (record as any)?.toJSON === 'function') {
      return (record as any).toJSON() as FtUserBlock;
    }
    return record as FtUserBlock;
  }

  /** BLOCK OVERRIDE: Unblock now soft-deletes only active record and preserves audit trail. */
  async unblockUser(blockerUserId: number, blockedUserId: number): Promise<void> {
    if (!blockerUserId || !blockedUserId) {
      throw new BadRequestException('User ids are required');
    }

    const targetUser = await this.userModel.findByPk(blockedUserId);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const activeBlock = await this.userBlockModel.findOne({
      where: {
        blockerUserId,
        blockedUserId,
        deletedAt: null,
      },
      order: [['id', 'DESC']],
    });

    if (activeBlock) {
      await activeBlock.update({ deletedAt: new Date() });
      return;
    }

    const priorRecord = await this.userBlockModel.findOne({
      where: {
        blockerUserId,
        blockedUserId,
      },
      order: [['id', 'DESC']],
    });

    if (!priorRecord) {
      throw new NotFoundException('Block record not found');
    }

    throw new ConflictException('User already unblocked');
  }
}
