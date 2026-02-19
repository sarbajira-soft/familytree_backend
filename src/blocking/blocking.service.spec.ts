/**
 * BLOCK OVERRIDE – unit tests for BlockingService (facade)
 * Verifies that the facade correctly delegates to read/write sub-services.
 */
import { BlockingService } from './blocking.service';
import { BlockType } from './model/user-block.model';

const makeReadService = () => ({
    getBlockStatus: jest.fn(),
    getBlockedUsers: jest.fn(),
    getBlockedByMe: jest.fn(),
    getBlockedMe: jest.fn(),
    getBlockedUserIdsForUser: jest.fn(),
    getBlockFilter: jest.fn(),
    getContentFilter: jest.fn(),
});

const makeWriteService = () => ({
    blockUser: jest.fn(),
    unblockUser: jest.fn(),
});

describe('BlockingService (facade)', () => {
    let service: BlockingService;
    let readService: ReturnType<typeof makeReadService>;
    let writeService: ReturnType<typeof makeWriteService>;

    beforeEach(() => {
        readService = makeReadService();
        writeService = makeWriteService();
        service = new BlockingService(readService as any, writeService as any);
    });

    it('blockUser delegates to BlockWriteService.blockUser', async () => {
        const expected = { id: 1, blockerUserId: 1, blockedUserId: 2 };
        writeService.blockUser.mockResolvedValue(expected);

        const result = await service.blockUser(1, 2);

        expect(writeService.blockUser).toHaveBeenCalledWith(1, 2, BlockType.USER);
        expect(result).toBe(expected);
    });

    it('unblockUser delegates to BlockWriteService.unblockUser', async () => {
        writeService.unblockUser.mockResolvedValue(undefined);

        await service.unblockUser(1, 2);

        expect(writeService.unblockUser).toHaveBeenCalledWith(1, 2);
    });

    it('getBlockStatus delegates to BlockReadService.getBlockStatus', async () => {
        const expected = { isBlockedByMe: true, isBlockedByThem: false };
        readService.getBlockStatus.mockResolvedValue(expected);

        const result = await service.getBlockStatus(1, 2);

        expect(readService.getBlockStatus).toHaveBeenCalledWith(1, 2);
        expect(result).toBe(expected);
    });

    it('isUserBlockedEitherWay returns true when isBlockedByMe', async () => {
        readService.getBlockStatus.mockResolvedValue({ isBlockedByMe: true, isBlockedByThem: false });
        expect(await service.isUserBlockedEitherWay(1, 2)).toBe(true);
    });

    it('isUserBlockedEitherWay returns true when isBlockedByThem', async () => {
        readService.getBlockStatus.mockResolvedValue({ isBlockedByMe: false, isBlockedByThem: true });
        expect(await service.isUserBlockedEitherWay(1, 2)).toBe(true);
    });

    it('isUserBlockedEitherWay returns false when neither party blocked', async () => {
        readService.getBlockStatus.mockResolvedValue({ isBlockedByMe: false, isBlockedByThem: false });
        expect(await service.isUserBlockedEitherWay(1, 2)).toBe(false);
    });

    it('getBlockedUsers delegates to BlockReadService.getBlockedUsers', async () => {
        const expected = [{ id: 10 }];
        readService.getBlockedUsers.mockResolvedValue(expected);

        const result = await service.getBlockedUsers(1);

        expect(readService.getBlockedUsers).toHaveBeenCalledWith(1);
        expect(result).toBe(expected);
    });

    it('getBlockedUserIdsForUser delegates to BlockReadService', async () => {
        readService.getBlockedUserIdsForUser.mockResolvedValue([2, 3]);

        const result = await service.getBlockedUserIdsForUser(1);

        expect(readService.getBlockedUserIdsForUser).toHaveBeenCalledWith(1);
        expect(result).toEqual([2, 3]);
    });
});
