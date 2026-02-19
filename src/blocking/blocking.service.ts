import { Injectable } from '@nestjs/common';
import { BlockType, FtUserBlock } from './model/user-block.model';
import { BlockReadService } from './services/block/block.read.service';
import { BlockWriteService } from './services/block/block.write.service';

@Injectable()
export class BlockingService {
  constructor(
    private readonly blockReadService: BlockReadService,
    private readonly blockWriteService: BlockWriteService,
  ) {}

  /** BLOCK OVERRIDE: Delegates to new block write service. */
  async blockUser(
    blockerUserId: number,
    blockedUserId: number,
    blockType: BlockType = BlockType.USER,
  ): Promise<FtUserBlock> {
    return this.blockWriteService.blockUser(
      blockerUserId,
      blockedUserId,
      blockType,
    );
  }

  /** BLOCK OVERRIDE: Delegates to new block write service. */
  async unblockUser(blockerUserId: number, blockedUserId: number): Promise<void> {
    await this.blockWriteService.unblockUser(blockerUserId, blockedUserId);
  }

  /** BLOCK OVERRIDE: Preserved compatibility method built from new status contract. */
  async isUserBlockedEitherWay(userA: number, userB: number): Promise<boolean> {
    const status = await this.blockReadService.getBlockStatus(userA, userB);
    return status.isBlockedByMe || status.isBlockedByThem;
  }

  /** BLOCK OVERRIDE: Preserved compatibility method for existing feed filters. */
  async getBlockedUserIdsForUser(userId: number): Promise<number[]> {
    return this.blockReadService.getBlockedUserIdsForUser(userId);
  }

  /** BLOCK OVERRIDE: New API status payload. */
  async getBlockStatus(currentUserId: number, otherUserId: number) {
    return this.blockReadService.getBlockStatus(currentUserId, otherUserId);
  }

  /** BLOCK OVERRIDE: New blocked users list endpoint support. */
  async getBlockedUsers(blockerUserId: number) {
    return this.blockReadService.getBlockedUsers(blockerUserId);
  }

  /** BLOCK OVERRIDE: Legacy support. */
  async getBlockedByMe(userId: number): Promise<FtUserBlock[]> {
    return this.blockReadService.getBlockedByMe(userId);
  }

  /** BLOCK OVERRIDE: Legacy support. */
  async getBlockedMe(userId: number): Promise<FtUserBlock[]> {
    return this.blockReadService.getBlockedMe(userId);
  }

  /** BLOCK OVERRIDE: Utility passthrough for query filters. */
  async getBlockFilter(currentUserId: number, userIdField: string = 'createdBy') {
    return this.blockReadService.getBlockFilter(currentUserId, userIdField);
  }

  /** BLOCK OVERRIDE: Utility passthrough for privacy-aware content filters. */
  async getContentFilter(
    currentUserId: number,
    privacyLevel: 'public' | 'family',
    userIdField: string = 'createdBy',
  ) {
    return this.blockReadService.getContentFilter(
      currentUserId,
      privacyLevel,
      userIdField,
    );
  }
}
