import { FtUserBlock } from '../model/user-block.model';
import { getBlockFilter } from './block-filter.util';

/**
 * BLOCK OVERRIDE: Centralized privacy-aware content filter that always applies block exclusions first.
 */
export const getContentFilter = async (
  currentUserId: number,
  privacyLevel: 'public' | 'family',
  userBlockModel: typeof FtUserBlock,
  userIdField: string = 'createdBy',
): Promise<Record<string, any>> => {
  const blockWhere = await getBlockFilter(
    currentUserId,
    userBlockModel,
    userIdField,
  );

  if (privacyLevel === 'family') {
    return {
      ...blockWhere,
      privacy: 'family',
    };
  }

  return {
    ...blockWhere,
    privacy: 'public',
  };
};
