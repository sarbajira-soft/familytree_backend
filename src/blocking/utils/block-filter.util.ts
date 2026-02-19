import { Op } from 'sequelize';
import { FtUserBlock } from '../model/user-block.model';

/**
 * BLOCK OVERRIDE: Replaced legacy blocked-user filtering with reusable bidirectional filter utility.
 */
export const getBlockFilter = async (
  currentUserId: number,
  userBlockModel: typeof FtUserBlock,
  userIdField: string = 'createdBy',
): Promise<Record<string, any>> => {
  if (!currentUserId) {
    return {};
  }

  const rows = await userBlockModel.findAll({
    where: {
      deletedAt: null,
      [Op.or]: [
        { blockerUserId: currentUserId },
        { blockedUserId: currentUserId },
      ],
    },
    attributes: ['blockerUserId', 'blockedUserId'],
  });

  const blockedIds = new Set<number>();
  rows.forEach((row: FtUserBlock) => {
    if (Number(row.blockerUserId) === Number(currentUserId)) {
      blockedIds.add(Number(row.blockedUserId));
      return;
    }
    blockedIds.add(Number(row.blockerUserId));
  });

  if (blockedIds.size === 0) {
    return {};
  }

  return {
    [userIdField]: {
      [Op.notIn]: Array.from(blockedIds),
    },
  };
};
