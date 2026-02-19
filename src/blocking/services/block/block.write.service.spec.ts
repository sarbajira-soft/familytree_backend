/**
 * BLOCK OVERRIDE – unit tests for BlockWriteService
 * Covers: TC-DB-02, TC-DB-03, TC-DB-04, TC-API-01, TC-API-02, TC-API-03, TC-API-04, TC-API-05, TC-API-06
 */
import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { BlockWriteService } from './block.write.service';
import { BlockType } from '../../model/user-block.model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeBlock = (overrides: Record<string, any> = {}) => ({
    id: 1,
    blockerUserId: 1,
    blockedUserId: 2,
    blockType: BlockType.USER,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

const makeUser = (id: number) => ({ id, email: `user${id}@test.com` });

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------
const makeUserBlockModel = (overrides: Partial<Record<string, jest.Mock>> = {}) => ({
    findOne: jest.fn(),
    create: jest.fn(),
    ...overrides,
});

const makeUserModel = (overrides: Partial<Record<string, jest.Mock>> = {}) => ({
    findByPk: jest.fn(),
    ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BlockWriteService', () => {
    let service: BlockWriteService;
    let userBlockModel: ReturnType<typeof makeUserBlockModel>;
    let userModel: ReturnType<typeof makeUserModel>;

    beforeEach(() => {
        userBlockModel = makeUserBlockModel();
        userModel = makeUserModel();
        service = new BlockWriteService(
            userBlockModel as any,
            userModel as any,
        );
    });

    // ─── blockUser ────────────────────────────────────────────────────────────

    describe('blockUser', () => {
        it('TC-API-01 – creates an active block record on success', async () => {
            const newBlock = makeBlock();
            userModel.findByPk.mockResolvedValue(makeUser(2));
            userBlockModel.findOne.mockResolvedValue(null); // no existing active block
            userBlockModel.create.mockResolvedValue(newBlock);

            const result = await service.blockUser(1, 2);

            expect(userBlockModel.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    blockerUserId: 1,
                    blockedUserId: 2,
                    blockType: BlockType.USER,
                    deletedAt: null,
                }),
            );
            expect(result.deletedAt).toBeNull();
        });

        it('TC-API-02 – throws BadRequestException when blocking self', async () => {
            await expect(service.blockUser(1, 1)).rejects.toThrow(BadRequestException);
        });

        it('TC-API-03 – throws ConflictException when active block already exists (TC-DB-02)', async () => {
            userModel.findByPk.mockResolvedValue(makeUser(2));
            userBlockModel.findOne.mockResolvedValue(makeBlock()); // already blocked

            await expect(service.blockUser(1, 2)).rejects.toThrow(ConflictException);
        });

        it('TC-API-01 (404) – throws NotFoundException when target user does not exist', async () => {
            userModel.findByPk.mockResolvedValue(null);

            await expect(service.blockUser(1, 999)).rejects.toThrow(NotFoundException);
        });

        it('TC-DB-04 – re-block after soft-delete creates a new record (second block ok)', async () => {
            userModel.findByPk.mockResolvedValue(makeUser(2));
            userBlockModel.findOne.mockResolvedValue(null); // old record was soft-deleted → no active block
            const newBlock = makeBlock({ id: 2 });
            userBlockModel.create.mockResolvedValue(newBlock);

            const result = await service.blockUser(1, 2);

            expect(userBlockModel.create).toHaveBeenCalledTimes(1);
            expect(result.id).toBe(2);
        });
    });

    // ─── unblockUser ──────────────────────────────────────────────────────────

    describe('unblockUser', () => {
        it('TC-API-04 / TC-DB-03 – soft-deletes the active block record on success', async () => {
            const activeBlock = makeBlock();
            userModel.findByPk.mockResolvedValue(makeUser(2));
            userBlockModel.findOne
                .mockResolvedValueOnce(activeBlock)   // active block found
                .mockResolvedValueOnce(activeBlock);  // prior record (in case of 409 branch)

            await service.unblockUser(1, 2);

            expect(activeBlock.update).toHaveBeenCalledWith(
                expect.objectContaining({ deletedAt: expect.any(Date) }),
            );
        });

        it('TC-API-05 – throws NotFoundException when no historical record exists', async () => {
            userModel.findByPk.mockResolvedValue(makeUser(2));
            userBlockModel.findOne
                .mockResolvedValueOnce(null)  // no active block
                .mockResolvedValueOnce(null); // no prior record at all

            await expect(service.unblockUser(1, 2)).rejects.toThrow(NotFoundException);
        });

        it('TC-API-06 – throws ConflictException when already unblocked (prior soft-deleted record exists)', async () => {
            const softDeletedBlock = makeBlock({ deletedAt: new Date() });
            userModel.findByPk.mockResolvedValue(makeUser(2));
            userBlockModel.findOne
                .mockResolvedValueOnce(null)              // no active block
                .mockResolvedValueOnce(softDeletedBlock); // prior record found but already deleted

            await expect(service.unblockUser(1, 2)).rejects.toThrow(ConflictException);
        });

        it('TC-API-05 (404) – throws NotFoundException when target user does not exist', async () => {
            userModel.findByPk.mockResolvedValue(null);

            await expect(service.unblockUser(1, 999)).rejects.toThrow(NotFoundException);
        });
    });
});
