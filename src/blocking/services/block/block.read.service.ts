import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from '../../../user/model/user.model';
import { UserProfile } from '../../../user/model/user-profile.model';
import { FtUserBlock } from '../../model/user-block.model';
import { getBlockFilter } from '../../utils/block-filter.util';
import { getContentFilter } from '../../utils/content-filter.util';

// Profile photo base URL - adjust this to match your deployment
const PROFILE_BASE_URL = process.env.PROFILE_BASE_URL || 'http://localhost:3000/uploads/profile';

@Injectable()
export class BlockReadService {
  constructor(
    @InjectModel(FtUserBlock)
    private readonly userBlockModel: typeof FtUserBlock,
    @InjectModel(User)
    private readonly userModel: typeof User,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
  ) {}

  /** BLOCK OVERRIDE: New bidirectional block status contract. */
  async getBlockStatus(currentUserId: number, otherUserId: number) {
    if (!currentUserId || !otherUserId || currentUserId === otherUserId) {
      return { isBlockedByMe: false, isBlockedByThem: false };
    }

    const rows = await this.userBlockModel.findAll({
      where: {
        deletedAt: null,
        [Op.or]: [
          { blockerUserId: currentUserId, blockedUserId: otherUserId },
          { blockerUserId: otherUserId, blockedUserId: currentUserId },
        ],
      },
      attributes: ['blockerUserId', 'blockedUserId'],
    });

    const isBlockedByMe = rows.some(
      (row) =>
        Number(row.blockerUserId) === Number(currentUserId) &&
        Number(row.blockedUserId) === Number(otherUserId),
    );

    const isBlockedByThem = rows.some(
      (row) =>
        Number(row.blockerUserId) === Number(otherUserId) &&
        Number(row.blockedUserId) === Number(currentUserId),
    );

    return { isBlockedByMe, isBlockedByThem };
  }

  /** BLOCK OVERRIDE: Shared blocked-id list for existing feed queries. */
  async getBlockedUserIdsForUser(userId: number): Promise<number[]> {
    if (!userId) {
      return [];
    }

    const rows = await this.userBlockModel.findAll({
      where: {
        deletedAt: null,
        [Op.or]: [{ blockerUserId: userId }, { blockedUserId: userId }],
      },
      attributes: ['blockerUserId', 'blockedUserId'],
    });

    const blockedIds = new Set<number>();
    rows.forEach((row) => {
      if (Number(row.blockerUserId) === Number(userId)) {
        blockedIds.add(Number(row.blockedUserId));
        return;
      }
      blockedIds.add(Number(row.blockerUserId));
    });

    return Array.from(blockedIds);
  }

  /** BLOCK OVERRIDE: Active blocks list with profile summary. */
  async getBlockedUsers(blockerUserId: number) {
    console.log('[BlockRead] Getting blocked users for blockerUserId:', blockerUserId);
    
    // First try raw SQL to see what's actually in the database
    const rawQuery = `
      SELECT id, "blockerUserId", "blockedUserId", "deletedAt", "createdAt"
      FROM ft_user_block 
      WHERE "blockerUserId" = :blockerUserId AND "deletedAt" IS NULL
    `;
    const rawResults = await this.userBlockModel.sequelize?.query(rawQuery, {
      replacements: { blockerUserId },
      type: 'SELECT',
    });
    console.log('[BlockRead] RAW SQL results:', rawResults);
    
    // Also check ALL records in the table to see if any exist
    const allRecordsQuery = `SELECT * FROM ft_user_block LIMIT 10`;
    const allRecords = await this.userBlockModel.sequelize?.query(allRecordsQuery, {
      type: 'SELECT',
    });
    console.log('[BlockRead] ALL ft_user_block records:', allRecords);

    // Now try the ORM query
    const rows = await this.userBlockModel.findAll({
      where: { blockerUserId, deletedAt: null },
      order: [['createdAt', 'DESC']],
    });
    
    console.log('[BlockRead] Found raw block rows:', rows.length, rows.map(r => ({ id: r.id, blockedUserId: r.blockedUserId })));

    if (rows.length === 0) {
      console.log('[BlockRead] No block rows found, returning empty array');
      return [];
    }

    const blockedUserIds = rows.map((row) => Number(row.blockedUserId));
    console.log('[BlockRead] Blocked user IDs to lookup:', blockedUserIds);
    
    const users = await this.userModel.findAll({
      where: { id: { [Op.in]: blockedUserIds } },
      attributes: ['id', 'email', 'mobile'],
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          attributes: ['firstName', 'lastName', 'profile', 'familyCode'],
          required: false,
        },
      ],
    });
    
    console.log('[BlockRead] Found users:', users.length, users.map(u => ({ id: u.id, email: u.email, isAppUser: u.isAppUser })));

    const usersById = new Map<number, any>(
      users.map((user: any) => [Number(user.id), user]),
    );
    
    console.log('[BlockRead] Users by ID map:', Array.from(usersById.keys()));

    const result = rows.map((row) => {
      const user = usersById.get(Number(row.blockedUserId));
      const profile = user?.userProfile;
      const profilePhotoUrl = profile?.profile 
        ? `${PROFILE_BASE_URL}/${profile.profile}` 
        : null;

      return {
        id: row.id,
        blockerUserId: row.blockerUserId,
        blockedUserId: row.blockedUserId,
        createdAt: row.createdAt,
        user: user
          ? {
              id: user.id,
              email: user.email,
              mobile: user.mobile,
              name: `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || user.email || 'Unknown User',
              profilePhoto: profilePhotoUrl,
              familyCode: profile?.familyCode || null,
            }
          : {
              // Return blocked user info even if user record not found
              id: row.blockedUserId,
              email: null,
              mobile: null,
              name: 'Unknown User (ID: ' + row.blockedUserId + ')',
              profilePhoto: null,
              familyCode: null,
            },
      };
    });
    
    console.log('[BlockRead] Final result count:', result.length);
    return result;
  }

  /** BLOCK OVERRIDE: Backward compatibility for internal consumers. */
  async getBlockedByMe(userId: number): Promise<FtUserBlock[]> {
    return this.userBlockModel.findAll({
      where: { blockerUserId: userId, deletedAt: null },
      order: [['createdAt', 'DESC']],
    });
  }

  /** BLOCK OVERRIDE: Backward compatibility for internal consumers. */
  async getBlockedMe(userId: number): Promise<FtUserBlock[]> {
    return this.userBlockModel.findAll({
      where: { blockedUserId: userId, deletedAt: null },
      order: [['createdAt', 'DESC']],
    });
  }

  /** BLOCK OVERRIDE: New reusable where filter utility. */
  async getBlockFilter(currentUserId: number, userIdField: string = 'createdBy') {
    return getBlockFilter(currentUserId, this.userBlockModel, userIdField);
  }

  /** BLOCK OVERRIDE: New content filter utility with privacy support. */
  async getContentFilter(
    currentUserId: number,
    privacyLevel: 'public' | 'family',
    userIdField: string = 'createdBy',
  ) {
    return getContentFilter(
      currentUserId,
      privacyLevel,
      this.userBlockModel,
      userIdField,
    );
  }
}
