/**
 * BLOCK OVERRIDE – unit tests for BlockReadService
 * Covers: TC-API-07, TC-API-08, TC-API-09
 */
import { BlockReadService } from './block.read.service';
import { Op } from 'sequelize';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeBlockRow = (
    blockerUserId: number,
    blockedUserId: number,
    deletedAt: Date | null = null,
) => ({ blockerUserId, blockedUserId, deletedAt });

const makeUserRow = (id: number, first = 'Test', last = 'User') => ({
    id,
    email: `user${id}@test.com`,
    mobile: '1234567890',
    userProfile: {
        firstName: first,
        lastName: last,
        profile: null,
        familyCode: 'FAM01',
    },
});

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------
const makeUserBlockModel = () => ({
    findAll: jest.fn(),
    findOne: jest.fn(),
});

const makeUserModel = () => ({
    findAll: jest.fn(),
    findByPk: jest.fn(),
});

const makeUserProfileModel = () => ({});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BlockReadService', () => {
    let service: BlockReadService;
    let userBlockModel: ReturnType<typeof makeUserBlockModel>;
    let userModel: ReturnType<typeof makeUserModel>;
    let userProfileModel: ReturnType<typeof makeUserProfileModel>;

    beforeEach(() => {
        userBlockModel = makeUserBlockModel();
        userModel = makeUserModel();
        userProfileModel = makeUserProfileModel();

        service = new BlockReadService(
            userBlockModel as any,
            userModel as any,
            userProfileModel as any,
        );
    });

    // ─── getBlockStatus ───────────────────────────────────────────────────────

    describe('getBlockStatus', () => {
        it('TC-API-07 – returns isBlockedByMe=true when A blocked B', async () => {
            userBlockModel.findAll.mockResolvedValue([makeBlockRow(1, 2)]);

            const result = await service.getBlockStatus(1, 2);

            expect(result).toEqual({ isBlockedByMe: true, isBlockedByThem: false });
        });

        it('TC-API-07 – returns isBlockedByThem=true when B blocked A (session is A)', async () => {
            userBlockModel.findAll.mockResolvedValue([makeBlockRow(2, 1)]);

            const result = await service.getBlockStatus(1, 2);

            expect(result).toEqual({ isBlockedByMe: false, isBlockedByThem: true });
        });

        it('TC-API-07 – returns both false when neither party has blocked the other', async () => {
            userBlockModel.findAll.mockResolvedValue([]);

            const result = await service.getBlockStatus(1, 2);

            expect(result).toEqual({ isBlockedByMe: false, isBlockedByThem: false });
        });

        it('TC-API-07 – returns both false when same userId supplied (self)', async () => {
            const result = await service.getBlockStatus(1, 1);

            expect(userBlockModel.findAll).not.toHaveBeenCalled();
            expect(result).toEqual({ isBlockedByMe: false, isBlockedByThem: false });
        });

        it('TC-API-07 – bidirectional: returns both true when A blocked B AND B blocked A', async () => {
            userBlockModel.findAll.mockResolvedValue([
                makeBlockRow(1, 2),
                makeBlockRow(2, 1),
            ]);

            const result = await service.getBlockStatus(1, 2);

            expect(result).toEqual({ isBlockedByMe: true, isBlockedByThem: true });
        });
    });

    // ─── getBlockedUsers ─────────────────────────────────────────────────────

    describe('getBlockedUsers', () => {
        it('TC-API-08 – returns empty array when blocker has no active blocks', async () => {
            userBlockModel.findAll.mockResolvedValue([]);

            const result = await service.getBlockedUsers(1);

            expect(result).toEqual([]);
            expect(userModel.findAll).not.toHaveBeenCalled();
        });

        it('TC-API-08 – returns active blocks with user profile summary', async () => {
            const blockRows = [
                { id: 10, blockerUserId: 1, blockedUserId: 2, createdAt: new Date() },
            ];
            userBlockModel.findAll.mockResolvedValue(blockRows);
            userModel.findAll.mockResolvedValue([makeUserRow(2, 'Alice', 'Smith')]);

            const result = await service.getBlockedUsers(1);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                id: 10,
                blockerUserId: 1,
                blockedUserId: 2,
                user: {
                    id: 2,
                    name: 'Alice Smith',
                    familyCode: 'FAM01',
                },
            });
        });

        it('TC-API-08 – includes only active blocks (rows where deletedAt IS NULL)', async () => {
            // findAll is called with deletedAt: null filter — verify the where clause
            userBlockModel.findAll.mockResolvedValue([]);
            await service.getBlockedUsers(1);

            expect(userBlockModel.findAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ blockerUserId: 1, deletedAt: null }),
                }),
            );
        });
    });

    // ─── getBlockedUserIdsForUser ─────────────────────────────────────────────

    describe('getBlockedUserIdsForUser', () => {
        it('TC-API-09 – returns bidirectional blocked IDs (both directions)', async () => {
            userBlockModel.findAll.mockResolvedValue([
                makeBlockRow(1, 2),  // A blocked B
                makeBlockRow(3, 1),  // C blocked A
            ]);

            const result = await service.getBlockedUserIdsForUser(1);

            expect(result).toContain(2);
            expect(result).toContain(3);
            expect(result).toHaveLength(2);
        });

        it('returns empty array when userId is falsy', async () => {
            const result = await service.getBlockedUserIdsForUser(0);
            expect(result).toEqual([]);
        });
    });
});
