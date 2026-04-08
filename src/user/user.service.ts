import { Injectable, BadRequestException, ForbiddenException, Inject, forwardRef, NotFoundException } from '@nestjs/common';

import { InjectModel } from '@nestjs/sequelize';
import { Op, literal } from 'sequelize';
import { User } from './model/user.model';
import { FamilyMember } from '../family/model/family-member.model';
import { FamilyTree } from '../family/model/family-tree.model';
import { UserProfile } from './model/user-profile.model';
import { Invite } from './model/invite.model';
import { MailService } from '../utils/mail.service';
import { UploadService } from '../uploads/upload.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { ForgetPasswordDto } from './dto/forget-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RegisterDto } from './dto/register.dto';
import { NotificationService } from '../notification/notification.service';
import { Family } from '../family/model/family.model';
import { Religion } from '../religion/model/religion.model';
import { Language } from '../language/model/language.model';
import { Gothram } from '../gothram/model/gothram.model';
import { Notification } from '../notification/model/notification.model';
import { MedusaCustomerSyncService } from '../medusa/medusa-customer-sync.service';
import { Gallery } from '../gallery/model/gallery.model';
import { Post } from '../post/model/post.model';
import { Event } from '../event/model/event.model';
import { AccountRecoveryToken } from './model/account-recovery-token.model';
import { FamilyMemberService } from '../family/family-member.service';
import { TreeProjectionService } from '../family/tree-projection.service';
import { ContentVisibilityService } from './content-visibility.service';
import {
  buildEmailHash,
  buildMobileHash,
  normalizeEmailValue,
  normalizeMobileValue,
} from '../common/security/field-encryption.util';
import { resolvePhoneNumber } from './privacy.util';
import {
  FAMILY_CONTENT_MEMBER_APPROVE_STATUSES,
  filterFamilyContentVisibilitySettings,
  mergeFamilyContentVisibilitySettings,
  normalizeFamilyContentVisibilitySettings,
} from './content-visibility-settings.util';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User)
    private readonly userModel: typeof User,

    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,

    @InjectModel(Family)
    private readonly familyModel: typeof Family,

    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,

    @InjectModel(FamilyTree)
    private readonly familyTreeModel: typeof FamilyTree,

    @InjectModel(Invite)
    private readonly inviteModel: typeof Invite,

    @InjectModel(Religion)
    private readonly religionModel: typeof Religion,

    @InjectModel(Language)
    private readonly languageModel: typeof Language,

    @InjectModel(Gothram)
    private readonly gothramModel: typeof Gothram,

    @InjectModel(Notification)
    private readonly notificationModel: typeof Notification,

    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,

    @InjectModel(Post)
    private readonly postModel: typeof Post,

    @InjectModel(Event)
    private readonly eventModel: typeof Event,

    @InjectModel(AccountRecoveryToken)
    private readonly accountRecoveryTokenModel: typeof AccountRecoveryToken,

    private readonly mailService: MailService,
    private readonly notificationService: NotificationService,

    @Inject(forwardRef(() => UploadService))
    private readonly uploadService: UploadService,
    private readonly medusaCustomerSyncService: MedusaCustomerSyncService,
    @Inject(forwardRef(() => FamilyMemberService))
    private readonly familyMemberService: FamilyMemberService,
    private readonly contentVisibilityService: ContentVisibilityService,
    private readonly treeProjectionService: TreeProjectionService,

  ) {}

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private validateStrongPassword(password: string) {
    const minLength = password?.length >= 8;
    const hasUpperCase = /[A-Z]/.test(password || '');
    const hasSpecialChar = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(
      password || '',
    );

    return {
      isValid: minLength && hasUpperCase && hasSpecialChar,
      minLength,
      hasUpperCase,
      hasSpecialChar,
    };
  }


  private buildEmailLookupOptions(email: string) {
    const normalizedEmail = normalizeEmailValue(email);
    if (!normalizedEmail) {
      return [];
    }

    return [
      { emailHash: buildEmailHash(normalizedEmail) },
      { email: { [Op.iLike]: normalizedEmail } },
    ];
  }

  private buildMobileLookupOptions(mobile: string) {
    const normalizedMobile = normalizeMobileValue(mobile);
    if (!normalizedMobile) {
      return [];
    }

    return [
      { mobileHash: buildMobileHash(normalizedMobile) },
      { mobile: normalizedMobile },
    ];
  }

  private normalizePrivacyScope(value: unknown) {
    return String(value || 'FAMILY').trim().toUpperCase() === 'PRIVATE'
      ? 'PRIVATE'
      : 'FAMILY';
  }
  private generateAccessToken(user: User): string {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        isAppUser: user.isAppUser,
        hasAcceptedTerms: user.hasAcceptedTerms,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' },
    );
  }

  private hashRecoveryToken(token: string): string {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
  }

  private generateRecoveryToken(): string {
    return crypto.randomInt(10_000_000, 99_999_999).toString();
  }

  private normalizeRecoveryIdentifier(identifier: string) {
    const raw = String(identifier || '').trim();
    if (!raw) {
      throw new BadRequestException('Identifier is required');
    }

    const isEmail = raw.includes('@');
    if (isEmail) {
      return {
        raw,
        isEmail: true,
        normalizedEmail: raw.toLowerCase(),
        normalizedMobile: null,
      };
    }

    const normalizedMobile = raw.replaceAll(/\D/g, '').slice(-14);
    if (normalizedMobile.length < 8) {
      throw new BadRequestException('Invalid identifier');
    }

    return {
      raw,
      isEmail: false,
      normalizedEmail: null,
      normalizedMobile,
    };
  }

  private async findUserByRecoveryIdentifier(
    identifier: string,
    options?: { transaction?: any; lock?: boolean; attributes?: string[] },
  ) {
    const normalized = this.normalizeRecoveryIdentifier(identifier);
    const whereClause = normalized.isEmail
      ? { [Op.or]: this.buildEmailLookupOptions(normalized.normalizedEmail) }
      : { [Op.or]: this.buildMobileLookupOptions(normalized.normalizedMobile) };

    return this.userModel.findOne({
      where: whereClause,
      ...(options?.attributes ? { attributes: options.attributes } : {}),
      ...(options?.transaction ? { transaction: options.transaction } : {}),
      ...(options?.lock && options?.transaction
        ? { lock: (options.transaction as any).LOCK.UPDATE }
        : {}),
    });
  }

  private isPendingDeletion(user: any): boolean {
    if (!user) return false;
    return (
      Number(user.status) === 3 ||
      String(user.lifecycleState || '').toLowerCase() === 'pending_deletion'
    );
  }

  private async hideFamilyContentForDeletedUser(userId: number) {
    await this.contentVisibilityService.hideContentForDeletedAccount(userId);
  }

  private async restoreFamilyContentForRecoveredUser(userId: number) {
    await this.contentVisibilityService.restorePublicContentForRecoveredAccount(userId);
  }

  async purgeExpiredDeletedUsers(limit = 25) {
    const now = new Date();
    const candidates = await this.userModel.findAll({
      where: {
        status: 3,
        purgeAfter: { [Op.lte]: now },
      } as any,
      attributes: ['id', 'medusaCustomerId'],
      order: [['purgeAfter', 'ASC']],
      limit,
    });

    let purgedCount = 0;
    for (const candidate of candidates) {
      const transaction = await this.userModel.sequelize.transaction();
      try {
        const user = await this.userModel.findByPk(candidate.id, {
          transaction,
          lock: (transaction as any).LOCK.UPDATE,
        });

        if (!user || Number(user.status) !== 3) {
          await transaction.commit();
          continue;
        }

        const purgeAfter = user.purgeAfter ? new Date(user.purgeAfter) : null;
        if (!purgeAfter || purgeAfter > now) {
          await transaction.commit();
          continue;
        }

        await this.accountRecoveryTokenModel.destroy({
          where: { userId: user.id } as any,
          transaction,
        });

        const medusaCustomerId = String((user as any)?.medusaCustomerId || '').trim();
        if (medusaCustomerId) {
          try {
            await this.medusaCustomerSyncService.deleteCustomer(medusaCustomerId);
          } catch (e) {
            console.error('Failed to delete Medusa customer during user purge:', e?.message || e);
          }
        }

        // Last line in purge: FK cascades remove owned rows.
        await user.destroy({ transaction });
        await transaction.commit();
        purgedCount++;
      } catch (error) {
        await transaction.rollback();
        console.error('Failed to purge deleted account:', error?.message || error);
      }
    }

    return { purgedCount };
  }

  async requestAccountDeletion(userId: number) {
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const transaction = await this.userModel.sequelize.transaction();
    try {
      const user = await this.userModel.findByPk(userId, {
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (this.isPendingDeletion(user)) {
        await transaction.commit();
        return {
          message: 'Account deletion already requested',
          data: {
            status: 'pending_deletion',
            deletedAt: user.deletedAt,
            purgeAfter: user.purgeAfter,
          },
        };
      }

      user.status = 3 as any;
      user.lifecycleState = 'pending_deletion';
      user.deletedAt = now;
      user.purgeAfter = purgeAfter;
      user.accessToken = null as any;
      await user.save({ transaction });

      await this.familyMemberModel.destroy({
        where: {
          memberId: userId,
          approveStatus: 'pending',
        } as any,
        transaction,
      });

      // NEW: Also delete pending requests where deleted user is the admin/approver (creatorId)
      await this.familyMemberModel.destroy({
        where: {
          creatorId: userId,
          approveStatus: 'pending',
        } as any,
        transaction,
      });

      await this.accountRecoveryTokenModel.destroy({
        where: { userId } as any,
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    const activeMemberships = await this.familyMemberModel.findAll({
      where: {
        memberId: userId,
        approveStatus: 'approved',
      } as any,
      attributes: ['familyCode'],
    });

    for (const membership of activeMemberships) {
      try {
        await this.familyMemberService.removeMemberForAccountDeletion(
          userId,
          String((membership as any).familyCode || ''),
        );
      } catch (error) {
        console.error(
          `Failed family detachment during account deletion user=${userId}, family=${(membership as any).familyCode}:`,
          error?.message || error,
        );
      }
    }

    await this.hideFamilyContentForDeletedUser(userId);

    return {
      message: 'Account deletion requested successfully',
      data: {
        status: 'pending_deletion',
        deletedAt: now,
        purgeAfter,
      },
    };
  }

  async requestAccountDeletionWithInitiator(userId: number, initiator?: { type: 'user' | 'admin'; id: number }) {
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const transaction = await this.userModel.sequelize.transaction();
    try {
      const user = await this.userModel.findByPk(userId, {
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (this.isPendingDeletion(user)) {
        const initiatorId = Number(initiator?.id);
        if (initiator?.type === 'admin' && Number.isFinite(initiatorId) && initiatorId > 0) {
          await user.update({ deletedByAdminId: initiatorId, deletedByUserId: null } as any, { transaction });
        } else if (initiator?.type === 'user' && Number.isFinite(initiatorId) && initiatorId > 0) {
          await user.update({ deletedByUserId: initiatorId, deletedByAdminId: null } as any, { transaction });
        }

        await transaction.commit();
        return {
          message: 'Account deletion already requested',
          data: {
            status: 'pending_deletion',
            deletedAt: user.deletedAt,
            purgeAfter: user.purgeAfter,
          },
        };
      }

      const initiatorId = Number(initiator?.id);
      const deletedByAdminId =
        initiator?.type === 'admin' && Number.isFinite(initiatorId) && initiatorId > 0 ? initiatorId : null;
      const deletedByUserId =
        initiator?.type === 'user' && Number.isFinite(initiatorId) && initiatorId > 0 ? initiatorId : null;

      user.status = 3 as any;
      user.lifecycleState = 'pending_deletion';
      user.deletedAt = now;
      user.purgeAfter = purgeAfter;
      (user as any).deletedByAdminId = deletedByAdminId;
      (user as any).deletedByUserId = deletedByUserId;
      user.accessToken = null as any;
      await user.save({ transaction });

      await this.familyMemberModel.destroy({
        where: {
          memberId: userId,
          approveStatus: 'pending',
        } as any,
        transaction,
      });

      await this.familyMemberModel.destroy({
        where: {
          creatorId: userId,
          approveStatus: 'pending',
        } as any,
        transaction,
      });

      await this.accountRecoveryTokenModel.destroy({
        where: { userId } as any,
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    const activeMemberships = await this.familyMemberModel.findAll({
      where: {
        memberId: userId,
        approveStatus: 'approved',
      } as any,
      attributes: ['familyCode'],
    });

    for (const membership of activeMemberships) {
      try {
        await this.familyMemberService.removeMemberForAccountDeletion(
          userId,
          String((membership as any).familyCode || ''),
        );
      } catch (error) {
        console.error(
          `Failed family detachment during account deletion user=${userId}, family=${(membership as any).familyCode}:`,
          error?.message || error,
        );
      }
    }

    await this.hideFamilyContentForDeletedUser(userId);

    return {
      message: 'Account deletion requested successfully',
      data: {
        status: 'pending_deletion',
        deletedAt: now,
        purgeAfter,
      },
    };
  }

  async requestAccountRecovery(identifier: string) {
    this.normalizeRecoveryIdentifier(identifier);

    await this.purgeExpiredDeletedUsers(10);

    const transaction = await this.userModel.sequelize.transaction();
    try {
      const user = await this.findUserByRecoveryIdentifier(identifier, {
        transaction,
        lock: true,
      });

      if (!user || !this.isPendingDeletion(user)) {
        await transaction.commit();
        return { message: 'If this account is recoverable, a token has been sent.' };
      }

      if ((user as any)?.deletedByAdminId) {
        await transaction.commit();
        return { message: 'If this account is recoverable, a token has been sent.' };
      }

      if (!user.purgeAfter || new Date(user.purgeAfter) <= new Date()) {
        throw new BadRequestException('Recovery window expired');
      }

      const token = this.generateRecoveryToken();
      const tokenHash = this.hashRecoveryToken(token);
      const expiresAt = new Date(
        Math.min(new Date(user.purgeAfter).getTime(), Date.now() + 15 * 60 * 1000),
      );

      await this.accountRecoveryTokenModel.destroy({
        where: {
          userId: user.id,
          usedAt: null,
        } as any,
        transaction,
      });

      await this.accountRecoveryTokenModel.create(
        {
          userId: user.id,
          tokenHash,
          expiresAt,
        } as any,
        { transaction },
      );

      await transaction.commit();

      if (user.email) {
        await this.mailService.sendPasswordResetOtp(user.email, token);
        return { message: 'Recovery token sent to email' };
      }

      if (process.env.NODE_ENV !== 'production') {
        return {
          message: 'Recovery token generated',
          token,
        };
      }

      return {
        message: 'If this account is recoverable, a token has been sent.',
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getAccountRecoveryStatus(identifier: string) {
    this.normalizeRecoveryIdentifier(identifier);

    await this.purgeExpiredDeletedUsers(10);

    const user = await this.findUserByRecoveryIdentifier(identifier, {
      attributes: ['id', 'status', 'lifecycleState', 'deletedAt', 'purgeAfter', 'deletedByAdminId', 'deletedByUserId'],
    });

    const now = new Date();
    const canRecover =
      !!user &&
      this.isPendingDeletion(user) &&
      !(user as any)?.deletedByAdminId &&
      !!user.purgeAfter &&
      new Date(user.purgeAfter).getTime() > now.getTime();

    return {
      message: 'If this account is recoverable, recovery details are returned.',
      data: {
        recoveryWindowEndsAt: canRecover ? user.purgeAfter : null,
        deletedAt: canRecover ? user.deletedAt : null,
        recoverable: canRecover,
      },
    };
  }

  async confirmAccountRecovery(token: string, identifier: string) {
    const rawToken = String(token || '').trim();
    if (!rawToken) {
      throw new BadRequestException('Token is required');
    }

    this.normalizeRecoveryIdentifier(identifier);
    await this.purgeExpiredDeletedUsers(10);

    const transaction = await this.userModel.sequelize.transaction();
    try {
      const user = await this.findUserByRecoveryIdentifier(identifier, {
        transaction,
        lock: true,
      });
      if (!user) {
        throw new BadRequestException('Invalid or expired recovery token');
      }

      if (!this.isPendingDeletion(user)) {
        throw new BadRequestException('Invalid or expired recovery token');
      }

      if ((user as any)?.deletedByAdminId) {
        throw new BadRequestException('Invalid or expired recovery token');
      }

      if (!user.purgeAfter || new Date(user.purgeAfter) <= new Date()) {
        throw new BadRequestException('Recovery window expired');
      }

      const tokenHash = this.hashRecoveryToken(rawToken);
      const recovery = await this.accountRecoveryTokenModel.findOne({
        where: {
          userId: user.id,
          tokenHash,
          usedAt: null,
          expiresAt: { [Op.gt]: new Date() },
        } as any,
        order: [['id', 'DESC']],
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      if (!recovery) {
        throw new BadRequestException('Invalid or expired recovery token');
      }

      await user.update(
        {
          status: 1,
          lifecycleState: 'active',
          deletedAt: null,
          purgeAfter: null,
          deletedByAdminId: null,
          deletedByUserId: null,
          accessToken: null,
        } as any,
        { transaction },
      );

      await recovery.update(
        { usedAt: new Date() } as any,
        { transaction },
      );

      await transaction.commit();

      // Restore content visibility for recovered account
      await this.restoreFamilyContentForRecoveredUser(user.id);

      return {
        message: 'Account recovered successfully. Rejoin the family tree to regain family visibility.',
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async adminRestoreDeletedUser(userId: number) {
    const id = Number(userId);
    if (!Number.isFinite(id) || Number.isNaN(id) || id <= 0) {
      throw new NotFoundException('User not found');
    }

    const transaction = await this.userModel.sequelize.transaction();
    try {
      const user = await this.userModel.findByPk(id, {
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (!this.isPendingDeletion(user)) {
        await transaction.commit();
        return { message: 'User is not deleted' };
      }

      await this.accountRecoveryTokenModel.destroy({ where: { userId: id } as any, transaction });

      await user.update(
        {
          status: 1,
          lifecycleState: 'active',
          deletedAt: null,
          purgeAfter: null,
          accessToken: null,
        } as any,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    await this.restoreFamilyContentForRecoveredUser(id);

    return { message: 'User restored successfully' };
  }

  async adminPurgeDeletedUserNow(userId: number) {
    const id = Number(userId);
    if (!Number.isFinite(id) || Number.isNaN(id) || id <= 0) {
      throw new NotFoundException('User not found');
    }

    const transaction = await this.userModel.sequelize.transaction();
    try {
      const user = await this.userModel.findByPk(id, {
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (!this.isPendingDeletion(user)) {
        throw new ForbiddenException('User must be soft deleted before it can be purged');
      }

      await this.accountRecoveryTokenModel.destroy({ where: { userId: id } as any, transaction });

      const medusaCustomerId = String((user as any)?.medusaCustomerId || '').trim();
      if (medusaCustomerId) {
        try {
          await this.medusaCustomerSyncService.deleteCustomer(medusaCustomerId);
        } catch (e) {
          console.error('Failed to delete Medusa customer during admin purge:', e?.message || e);
        }
      }

      await user.destroy({ transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    return { message: 'User permanently deleted' };
  }


  private async getAllowedContentVisibilityFamilyCodes(userId: number): Promise<string[]> {
    const normalizedUserId = Number(userId);
    if (!normalizedUserId) {
      return [];
    }

    const [reachableFamilyCodes, profile, memberships] = await Promise.all([
      this.treeProjectionService.getReachableFamilyCodesForUser(normalizedUserId),
      this.userProfileModel.findOne({
        where: { userId: normalizedUserId },
        attributes: ['familyCode', 'associatedFamilyCodes'],
      }),
      this.familyMemberModel.findAll({
        where: {
          memberId: normalizedUserId,
          approveStatus: { [Op.in]: FAMILY_CONTENT_MEMBER_APPROVE_STATUSES },
        } as any,
        attributes: ['familyCode'],
      }),
    ]);

    const associatedCodes = Array.isArray((profile as any)?.associatedFamilyCodes)
      ? ((profile as any)?.associatedFamilyCodes as any[])
      : [];

    return Array.from(
      new Set(
        [
          ...((reachableFamilyCodes || []).map((code) => String(code || '').trim().toUpperCase())),
          String((profile as any)?.familyCode || '').trim().toUpperCase(),
          ...associatedCodes.map((code) => String(code || '').trim().toUpperCase()),
          ...((memberships as any[]) || []).map((membership) =>
            String((membership as any)?.familyCode || '').trim().toUpperCase(),
          ),
        ].filter(Boolean),
      ),
    );
  }
  async getContentVisibilitySettings(userId: number) {
    const profile = await this.userProfileModel.findOne({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    const allowedFamilyCodes = await this.getAllowedContentVisibilityFamilyCodes(userId);
    const currentSettings = normalizeFamilyContentVisibilitySettings(
      (profile as any).contentVisibilitySettings,
    );
    const nextSettings = filterFamilyContentVisibilitySettings(
      currentSettings,
      allowedFamilyCodes,
    );

    if (JSON.stringify(nextSettings) !== JSON.stringify(currentSettings)) {
      await profile.update({ contentVisibilitySettings: nextSettings } as any);
    }

    return {
      message: 'Content visibility settings fetched successfully',
      data: {
        ...nextSettings,
        availableFamilyCodes: allowedFamilyCodes,
      },
    };
  }

  async updateContentVisibilitySettings(
    userId: number,
    dto: { posts?: { visibility?: 'all-members' | 'specific-family'; familyCodes?: string[] }; albums?: { visibility?: 'all-members' | 'specific-family'; familyCodes?: string[] }; events?: { visibility?: 'all-members' | 'specific-family'; familyCodes?: string[] } },
  ) {
    const profile = await this.userProfileModel.findOne({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    const allowedFamilyCodes = await this.getAllowedContentVisibilityFamilyCodes(userId);
    const mergedSettings = mergeFamilyContentVisibilitySettings(
      (profile as any).contentVisibilitySettings,
      dto,
    );
    const nextSettings = filterFamilyContentVisibilitySettings(
      mergedSettings,
      allowedFamilyCodes,
    );

    await profile.update({ contentVisibilitySettings: nextSettings } as any);
    await this.contentVisibilityService.applyFamilyContentVisibilitySettings(
      userId,
      nextSettings,
    );

    return {
      message: 'Content visibility settings updated successfully',
      data: {
        ...nextSettings,
        availableFamilyCodes: allowedFamilyCodes,
      },
    };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async register(registerDto: RegisterDto) {
    try {
      const normalizedEmail = (registerDto.email || '').trim().toLowerCase();

      // Input validation
      if (
        !normalizedEmail ||
        !registerDto.password ||
        !registerDto.firstName ||
        !registerDto.lastName ||
        !registerDto.countryCode ||
        !registerDto.mobile
      ) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'All required fields must be provided',
          error: 'Bad Request',
          requiredFields: [
            'email',
            'password',
            'firstName',
            'lastName',
            'countryCode',
            'mobile',
          ],
        });
      }

      if (!registerDto.hasAcceptedTerms) {
        throw new BadRequestException({
          statusCode: 400,
          message:
            'You must agree to the Terms & Conditions to create an account',
          error: 'TermsNotAccepted',
        });
      }

      const passwordValidation = this.validateStrongPassword(registerDto.password);
      if (!passwordValidation.isValid) {
        throw new BadRequestException({
          statusCode: 400,
          message:
            'Password must be at least 8 characters and include 1 uppercase letter and 1 special character',
          error: 'Bad Request',
        });
      }

      // Check for existing verified users (case-insensitive email)
      const existingVerifiedByEmail = await this.userModel.findOne({
        where: {
          status: 1,
          [Op.or]: this.buildEmailLookupOptions(normalizedEmail),
        },
      });

      if (existingVerifiedByEmail) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'An account with this email already exists',
          error: 'Bad Request',
        });
      }

      const existingVerifiedByMobile = await this.userModel.findOne({
        where: {
          status: 1,
          [Op.or]: this.buildMobileLookupOptions(registerDto.mobile),
        },
      });

      if (existingVerifiedByMobile) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'This phone number is already registered. Please use a different number.',
          error: 'Bad Request',
        });
      }

      // Check for existing unverified users with the same email
      const existingUnverifiedUser = await this.userModel.findOne({
        where: {
          [Op.or]: [
            { status: 0, [Op.or]: this.buildEmailLookupOptions(normalizedEmail) },
            { status: 0, [Op.or]: this.buildMobileLookupOptions(registerDto.mobile) },
          ],
        },
      });

      const otp = this.generateOtp();
      const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      const hashedPassword = await bcrypt.hash(registerDto.password, 12);

      try {
        let user: User = existingUnverifiedUser;

        if (existingUnverifiedUser) {
          // Update existing unverified user
          await existingUnverifiedUser.update({
            ...registerDto,
            email: normalizedEmail,
            password: hashedPassword,
            otp,
            otpExpiresAt,
            role: registerDto.role || 1, // Default to member if not specified
            isAppUser: true,
            hasAcceptedTerms: true,
            termsVersion: registerDto.termsVersion || 'v1.0.0',
            termsAcceptedAt: new Date(),
          });
        } else {
          // Create new user
          user = await this.userModel.create({
            ...registerDto,
            email: normalizedEmail,
            password: hashedPassword,
            otp,
            otpExpiresAt,
            status: 0, // unverified
            role: registerDto.role || 1, // Default to member
            isAppUser: true,
            hasAcceptedTerms: true,
            termsVersion: registerDto.termsVersion || 'v1.0.0',
            termsAcceptedAt: new Date(),
          });

          await this.userProfileModel.create({
            userId: user.id,
            firstName: registerDto.firstName,
            lastName: registerDto.lastName,
          });
        }

        try {
          if (user?.isAppUser && registerDto.email) {
            const syncRes = await this.medusaCustomerSyncService.upsertCustomer({
              customer_id: user.medusaCustomerId,
              email: registerDto.email,
              first_name: registerDto.firstName,
              last_name: registerDto.lastName,
              phone: `${registerDto.countryCode || ''}${registerDto.mobile || ''}`,
              password: registerDto.password,
              metadata: {
                app_user_id: user.id,
              },
            });

            if (syncRes?.customer_id && user.medusaCustomerId !== syncRes.customer_id) {
              await user.update({ medusaCustomerId: syncRes.customer_id });
            }
          }
        } catch (e) {
          console.error('Medusa customer sync failed:', e?.message || e);
        }

        // Send OTP email
        await this.mailService.sendVerificationOtp(normalizedEmail, otp);

        return {
          statusCode: 201,
          message: 'OTP sent to email',
          email: normalizedEmail,
          mobile: registerDto.countryCode + registerDto.mobile,
          expiresIn: '15 minutes',
        };
      } catch (error) {
        console.error('Error during user registration:', error);
        throw new BadRequestException({
          statusCode: 400,
          message: 'Failed to register user',
          error: 'Registration Error',
          details: error.message,
        });
      }
    } catch (error) {
      console.error('Registration error:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException({
        statusCode: 400,
        message: 'Registration failed',
        error: 'Registration Error',
        details: error.message,
      });
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const { userName, otp } = verifyOtpDto;

    if (!userName) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Email or mobile must be provided',
        error: 'Bad Request',
      });
    }

    const normalizedUserName = (userName || '').trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedUserName);
    const whereClause: any = isEmail
      ? { [Op.or]: this.buildEmailLookupOptions(normalizedUserName.toLowerCase()) }
      : { [Op.or]: this.buildMobileLookupOptions(normalizedUserName) };

    const user = await this.userModel.findOne({ where: whereClause });

    if (!user) {
      throw new BadRequestException({
        statusCode: 400,
        message: isEmail
          ? 'User with this email not found'
          : 'User with this mobile number not found',
        error: 'Bad Request',
      });
    }

    if (user.status === 1) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Account already verified',
        error: 'Bad Request',
      });
    }

    if (!user.otp || user.otp !== otp) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Invalid OTP',
        error: 'Bad Request',
      });
    }

    if (!user.otpExpiresAt || new Date(user.otpExpiresAt) < new Date()) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'OTP has expired',
        error: 'Bad Request',
      });
    }

    const accessToken = this.generateAccessToken(user);

    await user.update({
      status: 1,
      otp: null,
      otpExpiresAt: null,
      verifiedAt: new Date(),
      accessToken,
    });

    return {
      message: 'Account verified successfully',
      accessToken,
    };
  }

  async login(loginDto: LoginDto) {
    const usernameRaw = (loginDto.username || '').trim();
    const password = loginDto.password;

    if (!usernameRaw || !password) {
      throw new BadRequestException({ message: 'Username and password are required' });
    }

    const isEmail = usernameRaw.includes('@');
    const whereClause: any = isEmail
      ? { [Op.or]: this.buildEmailLookupOptions(usernameRaw.toLowerCase()) }
      : { [Op.or]: this.buildMobileLookupOptions(usernameRaw) };

    const user = await this.userModel.findOne({ where: whereClause });

    if (!user) {
      throw new BadRequestException({ message: 'Invalid credentials' });
    }

    if (this.isPendingDeletion(user)) {
      throw new ForbiddenException('Account scheduled for deletion. Use account recovery within 30 days.');
    }

    if (user.status !== 1) {
      throw new ForbiddenException('Account not verified');
    }

    const passwordMatches = await bcrypt.compare(password, user.password || '');
    if (!passwordMatches) {
      throw new BadRequestException({ message: 'Invalid credentials' });
    }

    const accessToken = this.generateAccessToken(user);
    await user.update({ accessToken, lastLoginAt: new Date() });

    return {
      message: 'Login successful',
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        mobile: user.mobile,
        countryCode: user.countryCode,
        role: user.role,
        isAppUser: user.isAppUser,
        hasAcceptedTerms: user.hasAcceptedTerms,
      },
    };
  }

  async resendOtp(resendOtpDto: ResendOtpDto) {
    const email = (resendOtpDto.email || '').trim().toLowerCase();
    const mobileWithCountry = (resendOtpDto.mobile || '').trim();

    if (!email && !mobileWithCountry) {
      throw new BadRequestException({ message: 'Email or mobile must be provided' });
    }

    let whereClause: any;
    if (email) {
      whereClause = { [Op.or]: this.buildEmailLookupOptions(email) };
    } else {
      const match = /^\+(\d{1,4})(\d{6,14})$/.exec(mobileWithCountry);
      if (!match) {
        throw new BadRequestException({ message: 'Invalid mobile format' });
      }

      whereClause = { [Op.or]: this.buildMobileLookupOptions(match[2]) };
    }

    const user = await this.userModel.findOne({ where: whereClause });
    if (!user) {
      throw new BadRequestException({ message: 'User not found' });
    }

    if (user.status === 1) {
      throw new BadRequestException({ message: 'Account already verified' });
    }

    const otp = this.generateOtp();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.update({ otp, otpExpiresAt });

    if (user.email) {
      await this.mailService.sendVerificationOtp(user.email, otp);
    }

    return { message: 'OTP resent successfully' };
  }

  async forgetPassword(forgetPasswordDto: ForgetPasswordDto) {
    const username = (forgetPasswordDto.username || '').trim();
    if (!username) {
      throw new BadRequestException({ message: 'Email or mobile must be provided' });
    }

    const isEmail = username.includes('@');
    const whereClause: any = isEmail
      ? { [Op.or]: this.buildEmailLookupOptions(username.toLowerCase()) }
      : { [Op.or]: this.buildMobileLookupOptions(username) };

    const user = await this.userModel.findOne({ where: whereClause });
    if (!user) {
      throw new BadRequestException({ message: 'User not found' });
    }

    const otp = this.generateOtp();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.update({ otp, otpExpiresAt });

    if (user.email) {
      await this.mailService.sendPasswordResetOtp(user.email, otp);
    }

    return { message: 'OTP sent successfully' };
  }

  async resetPassword(resetPasswordDto: {
    username: string;
    otp: string;
    newPassword: string;
    confirmPassword: string;
  }) {
    const { username, otp, newPassword, confirmPassword } = resetPasswordDto;

    // Validate required fields
    if (!username || !otp || !newPassword || !confirmPassword) {
      throw new BadRequestException({ message: 'All fields are required' });
    }

    // Check if passwords match
    if (newPassword !== confirmPassword) {
      throw new BadRequestException({ message: 'Passwords do not match' });
    }

    const passwordValidation = this.validateStrongPassword(newPassword);
    if (!passwordValidation.isValid) {
      throw new BadRequestException({
        message:
          'Password must be at least 8 characters and include 1 uppercase letter and 1 special character',
      });
    }

    // Determine whether the username is email or mobile
    const isEmail = username.includes('@');
    const whereClause: any = {
      otp,
      ...(isEmail
        ? { [Op.or]: this.buildEmailLookupOptions((username || '').trim()) }
        : { [Op.or]: this.buildMobileLookupOptions((username || '').trim()) }),
    };

    // Find user
    const user = await this.userModel.findOne({ where: whereClause });

    if (!user) {
      throw new BadRequestException({
        message: 'Invalid OTP or user not found',
      });
    }

    // Check OTP expiration
    if (!user.otpExpiresAt || new Date(user.otpExpiresAt) < new Date()) {
      throw new BadRequestException({ message: 'OTP has expired' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update the user record
    await user.update({
      password: hashedPassword,
      otp: null,
      otpExpiresAt: null,
    });

    try {
      if (user.isAppUser && user.email) {
        const syncRes = await this.medusaCustomerSyncService.updatePassword(
          user.email,
          newPassword,
        );

        if (syncRes?.customer_id && user.medusaCustomerId !== syncRes.customer_id) {
          await user.update({ medusaCustomerId: syncRes.customer_id });
        }
      }
    } catch (e) {
      console.error('Medusa password sync failed:', e?.message || e);
    }

    return { message: 'Password reset successful' };
  }

  async getUserProfile(id: number | string) {
    try {
      const user = await this.userModel.findOne({
        where: { id },
        attributes: [
          'id',
          'email',
          'mobile',
          'countryCode',
          'status',
          'role',
          'isAppUser',
          'lifecycleState',
          'deletedAt',
          'purgeAfter',
          'hasAcceptedTerms',
          'termsVersion',
          'termsAcceptedAt',
          'createdAt',
          'updatedAt',
        ],
        include: [
          {
            model: UserProfile,
            as: 'userProfile',
            required: false,
            include: [
              {
                model: FamilyMember,
                as: 'familyMember',
                attributes: ['familyCode', 'approveStatus'],
                required: false,
              },
              {
                model: Religion,
                as: 'religion',
                attributes: ['id', 'name'],
                required: false,
              },
              {
                model: Language,
                as: 'language',
                attributes: ['id', 'name', 'isoCode'],
                required: false,
              },
              {
                model: Gothram,
                as: 'gothram',
                attributes: ['id', 'name'],
                required: false,
              },
            ],
          },
        ],
      });

      if (!user) throw new NotFoundException('User profile not found');

      if (user.userProfile) {
        const latestMembership = await this.familyMemberModel.findOne({
          where: { memberId: Number(id) } as any,
          order: [
            [literal(`CASE "approveStatus" WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 WHEN 'rejected' THEN 2 WHEN 'cancelled' THEN 3 WHEN 'removed' THEN 4 ELSE 5 END`), 'ASC'],
            ['updatedAt', 'DESC'],
            ['id', 'DESC'],
          ],
        });

        (user.userProfile as any).setDataValue('familyMember', latestMembership || null);
      }

      if (user.userProfile?.profile) {
        user.userProfile.profile = this.uploadService.getFileUrl(
          user.userProfile.profile,
          'profile',
        );
      }

      return user;
    } catch (error) {
      console.error('Error in getUserProfile:', error);
      throw new BadRequestException({
        statusCode: 500,
        message: 'Failed to fetch user profile',
        error: 'Server Error',
        details: error.message,
      });
    }
  }

  async getUserAddressForGifting(id: number | string) {
    try {
      const user = await this.userModel.findOne({
        where: { id },
        attributes: ['id', 'email', 'mobile', 'countryCode'],
        include: [
          {
            model: UserProfile,
            as: 'userProfile',
            required: false,
            attributes: ['firstName', 'lastName', 'address', 'contactNumber', 'familyCode'],
          },
        ],
      });

      if (!user) {
        throw new NotFoundException('User profile not found');
      }

      const fullPhone = resolvePhoneNumber(user, user.userProfile);

      return {
        id: user.id,
        firstName: user.userProfile?.firstName || null,
        lastName: user.userProfile?.lastName || null,
        address: user.userProfile?.address || null,
        contactNumber: fullPhone || null,
        familyCode: user.userProfile?.familyCode || null,
      };
    } catch (error) {
      console.error('Error in getUserAddressForGifting:', error);
      throw new BadRequestException({
        statusCode: 500,
        message: 'Failed to fetch gifting address',
        error: 'Server Error',
        details: error.message,
      });
    }
  }

  async setPrivacy(userId: number, dto: { isPrivate?: boolean; emailPrivacy?: string; addressPrivacy?: string; phonePrivacy?: string; dobPrivacy?: string }) {
    const profile = await this.userProfileModel.findOne({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    const updates: Record<string, unknown> = {};
    if (typeof dto?.isPrivate === 'boolean') {
      updates.isPrivate = dto.isPrivate;
    }
    if (dto?.emailPrivacy !== undefined) {
      updates.emailPrivacy = this.normalizePrivacyScope(dto.emailPrivacy);
    }
    if (dto?.addressPrivacy !== undefined) {
      updates.addressPrivacy = this.normalizePrivacyScope(dto.addressPrivacy);
    }
    if (dto?.phonePrivacy !== undefined) {
      updates.phonePrivacy = this.normalizePrivacyScope(dto.phonePrivacy);
    }
    if (dto?.dobPrivacy !== undefined) {
      updates.dobPrivacy = this.normalizePrivacyScope(dto.dobPrivacy);
    }

    if (Object.keys(updates).length > 0) {
      await profile.update(updates as any);
    }

    return {
      message: 'Privacy updated successfully',
      data: {
        userId,
        isPrivate: !!profile.isPrivate,
        emailPrivacy: this.normalizePrivacyScope(profile.emailPrivacy),
        addressPrivacy: this.normalizePrivacyScope(profile.addressPrivacy),
        phonePrivacy: this.normalizePrivacyScope(profile.phonePrivacy),
        dobPrivacy: this.normalizePrivacyScope(profile.dobPrivacy),
      },
    };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async updateProfile(
    userId: number,
    dto: UpdateProfileDto,
    actor: { userId: number; role: number; isAppUser: boolean },
  ) {
    try {
      const targetUser = await this.userModel.findByPk(userId);
      const targetProfile = await this.userProfileModel.findOne({
        where: { userId },
      });

      if (!targetUser || !targetProfile) {
        throw new BadRequestException({ message: 'User not found' });
      }

      const originalEmail = targetUser.email;

      // -----------------------------
      // PERMISSION LOGIC
      // -----------------------------
      const isSelf = actor.userId === userId;
      const actorIsAdmin = actor.role === 2 || actor.role === 3;
      const targetIsAppUser = !!targetUser.isAppUser;

      const actorProfile = await this.userProfileModel.findOne({
        where: { userId: actor.userId },
      });

      const actorFamilyCode = actorProfile?.familyCode;
      const targetFamilyCode = targetProfile?.familyCode;

      // Member (role 1): can update ONLY self; never role/status
      if (actor.role === 1 && !isSelf) {
        throw new ForbiddenException(
          'Members can only update their own profile',
        );
      }

      // Admin / SuperAdmin rules
      if (actorIsAdmin) {
        if (!isSelf) {
          if (targetIsAppUser) {
            throw new ForbiddenException(
              'You are not permitted to update other user’s profile',
            );
          }

          // Must belong to same family
          if (
            !actorFamilyCode ||
            !targetFamilyCode ||
            actorFamilyCode !== targetFamilyCode
          ) {
            throw new ForbiddenException(
              'Admins can only update users within their own family',
            );
          }
        }
      }

      // Any invalid role
      if (actor.role !== 1 && !actorIsAdmin) {
        throw new ForbiddenException('You are not allowed to update profiles');
      }

      // -----------------------------
      // PROFILE IMAGE UPDATE
      // -----------------------------
      const originalProfileImage = targetProfile.profile;

      if (dto.removeProfile === true) {
        if (originalProfileImage && originalProfileImage !== '') {
          try {
            await this.uploadService.deleteFile(originalProfileImage, 'profile');
          } catch (e) {
            console.warn('Failed to delete old profile image:', e);
          }
        }

        targetProfile.profile = null;
        await targetProfile.save();
      }

      if (dto.profile && dto.profile !== '') {
        let newFilename = String(dto.profile || '').trim();

        if (newFilename.startsWith('http://') || newFilename.startsWith('https://')) {
          try {
            const url = new URL(newFilename);
            newFilename = url.pathname.replace(/^\/+/, '') || newFilename;
          } catch (_) {
            newFilename = String(dto.profile || '').trim();
          }
        }

        const cleanedProfileKey = String(newFilename || '')
          .trim()
          .replace(/^\/+/, '')
          .split('?')[0]
          .split('#')[0];

        let shouldUpdateProfileImage = true;

        if (cleanedProfileKey.startsWith('profile/')) {
          const parts = cleanedProfileKey.split('/').filter(Boolean);
          const isLegacyUserPath =
            parts.length === 3 &&
            parts[0] === 'profile' &&
            String(parts[1]) === String(userId);

          if (isLegacyUserPath) {
            shouldUpdateProfileImage = false;
          }
        }

        if (shouldUpdateProfileImage) {
          if (
            originalProfileImage &&
            originalProfileImage !== '' &&
            originalProfileImage !== cleanedProfileKey
          ) {
            try {
              await this.uploadService.deleteFile(originalProfileImage, 'profile');
            } catch (e) {
              console.warn('Failed to delete old profile image:', e);
            }
          }

          targetProfile.profile = cleanedProfileKey;
          await targetProfile.save();
        }
      }

      // -----------------------------
      // VALIDATE FAMILY CODE
      // -----------------------------
      if (dto.familyCode) {
        const exists = await this.familyModel.findOne({
          where: { familyCode: dto.familyCode },
        });

        if (!exists) {
          throw new BadRequestException({
            message: 'Invalid family code. Please enter a valid family code.',
          });
        }
      }

      const {
        email,
        countryCode,
        mobile,
        role,
        status,
        password,
        emailPrivacy,
        addressPrivacy,
        phonePrivacy,
        dobPrivacy,
      } = dto;

      // -----------------------------
      // CONTACT / PASSWORD PERMISSIONS
      // -----------------------------
      const actorCanChangeContact = isSelf;

      const actorCanChangeRoleStatus =
        actorIsAdmin &&
        !targetIsAppUser &&
        actorFamilyCode &&
        actorFamilyCode === targetFamilyCode;

      // -----------------------------
      // PASSWORD (only self)
      // -----------------------------
      if (password !== undefined) {
        throw new BadRequestException({
          message:
            'Password cannot be updated from Edit Profile. Please use OTP verification (Forgot Password / Reset Password).',
        });
      }

      // -----------------------------
      // EMAIL UPDATE
      // -----------------------------
      if (
        email !== undefined &&
        normalizeEmailValue(email) !== targetUser.email &&
        actorCanChangeContact
      ) {
        const emailExists = await this.userModel.findOne({
          where: {
            [Op.or]: this.buildEmailLookupOptions(email),
            id: { [Op.ne]: userId },
            status: { [Op.ne]: 3 },
          },
        });

        if (emailExists) {
          throw new BadRequestException({
            message: 'Email already in use by another user',
          });
        }

        targetUser.email = email;
      }

      // -----------------------------
      // MOBILE UPDATE
      // -----------------------------
      if (
        mobile !== undefined &&
        countryCode !== undefined &&
        actorCanChangeContact &&
        (mobile !== targetUser.mobile || countryCode !== targetUser.countryCode)
      ) {
        const mobileExists = await this.userModel.findOne({
          where: {
            [Op.or]: this.buildMobileLookupOptions(mobile),
            id: { [Op.ne]: userId },
            status: { [Op.ne]: 3 },
          },
        });

        if (mobileExists) {
          throw new BadRequestException({
            message: 'This phone number is already registered. Please use a different number.',
          });
        }

        targetUser.mobile = mobile;
        targetUser.countryCode = countryCode;
      }

      // -----------------------------
      // ROLE / STATUS (only admin)
      // -----------------------------
      if (actorCanChangeRoleStatus) {
        if (role !== undefined) targetUser.role = role;
        if (status !== undefined) targetUser.status = status;
      }

      await targetUser.save();

      // -----------------------------
      // UPDATE OTHER PROFILE FIELDS
      // -----------------------------
      const normalizedDto = { ...dto } as Record<string, any>;
      const normalizeId = (value: unknown) =>
        typeof value === 'number' && value > 0 ? value : null;

      if ('religionId' in normalizedDto) {
        normalizedDto.religionId = normalizeId(normalizedDto.religionId);
      }
      if ('languageId' in normalizedDto) {
        normalizedDto.languageId = normalizeId(normalizedDto.languageId);
      }
      if ('gothramId' in normalizedDto) {
        normalizedDto.gothramId = normalizeId(normalizedDto.gothramId);
      }
      if (normalizedDto.otherReligion) normalizedDto.religionId = null;
      if (normalizedDto.otherLanguage) normalizedDto.languageId = null;
      if (normalizedDto.otherGothram) normalizedDto.gothramId = null;
      if ('emailPrivacy' in normalizedDto) {
        normalizedDto.emailPrivacy = this.normalizePrivacyScope(emailPrivacy);
      }
      if ('addressPrivacy' in normalizedDto) {
        normalizedDto.addressPrivacy = this.normalizePrivacyScope(addressPrivacy);
      }
      if ('phonePrivacy' in normalizedDto) {
        normalizedDto.phonePrivacy = this.normalizePrivacyScope(phonePrivacy);
      }
      if ('dobPrivacy' in normalizedDto) {
        normalizedDto.dobPrivacy = this.normalizePrivacyScope(dobPrivacy);
      }

      const profileUpdates = {};
      const profileFields = [
        'firstName',
        'lastName',
        'gender',
        'dob',
        'age',
        'maritalStatus',
        'marriageDate',
        'spouseName',
        'childrenNames',
        'fatherName',
        'motherName',
        'religionId',
        'otherReligion',
        'languageId',
        'otherLanguage',
        'caste',
        'gothramId',
        'otherGothram',
        'kuladevata',
        'region',
        'hobbies',
        'likes',
        'dislikes',
        'favoriteFoods',
        'contactNumber',
        'countryId',
        'address',
        'bio',
        'emailPrivacy',
        'addressPrivacy',
        'phonePrivacy',
        'dobPrivacy',
      ];

      profileFields.forEach((field) => {
        if (normalizedDto[field] !== undefined) {
          profileUpdates[field] = normalizedDto[field];
        }
      });

      // ...
      if (Object.keys(profileUpdates).length > 0) {
        await targetProfile.update(profileUpdates);
      }

      // -----------------------------
      // FAMILY JOIN LOGIC
      // -----------------------------
      if (dto.familyCode) {
        const requestedFamilyCode = String(dto.familyCode || '').trim().toUpperCase();
        const currentFamilyCode = String(targetProfile.familyCode || '').trim().toUpperCase();

        // If user is switching families or joining for the first time, it must go through approval.
        // Never auto-approve or directly mutate userProfile.familyCode here.
        if (requestedFamilyCode && requestedFamilyCode !== currentFamilyCode) {
          // If a user already has a primary family, do NOT allow changing it via Edit Profile.
          // This blocks "admin joins another admin family without consent" and keeps family state consistent.
          if (currentFamilyCode) {
            throw new BadRequestException({
              message:
                'Family code cannot be changed from Edit Profile. Use the Join Family flow (admin approval required).',
            });
          }

          // Store the requested familyCode so the app can show "pending approval" UX.
          targetProfile.familyCode = requestedFamilyCode;

          await this.familyMemberService.requestToJoinFamily(
            {
              memberId: userId,
              familyCode: requestedFamilyCode,
              approveStatus: 'pending',
            } as any,
            userId,
          );
        }
      }

      await targetProfile.save();

      try {
        if (targetUser.isAppUser && targetUser.email) {
          const syncPayload: Record<string, unknown> = {
            customer_id: targetUser.medusaCustomerId,
            email: targetUser.email,
            first_name: targetProfile.firstName,
            last_name: targetProfile.lastName,
            phone: targetUser.mobile
              ? `${targetUser.countryCode || ''}${targetUser.mobile}`
              : undefined,
            metadata: {
              app_user_id: targetUser.id,
            },
          };

          if (originalEmail && originalEmail !== targetUser.email) {
            syncPayload.previous_email = originalEmail;
          }

          const syncRes = await this.medusaCustomerSyncService.upsertCustomer(
            syncPayload,
          );

          if (syncRes?.customer_id && targetUser.medusaCustomerId !== syncRes.customer_id) {
            await targetUser.update({ medusaCustomerId: syncRes.customer_id });
          }
        }
      } catch (e) {
        console.error('Medusa customer sync failed:', e?.message || e);
      }

      // -----------------------------
      // RETURN UPDATED USER
      // -----------------------------
      const updatedUser = await this.userModel.findByPk(userId, {
        include: [
          {
            model: UserProfile,
            as: 'userProfile',
            include: [
              {
                model: FamilyMember,
                as: 'familyMember',
                attributes: ['familyCode', 'approveStatus'],
              },
              { model: Religion, as: 'religion', attributes: ['id', 'name'] },
              {
                model: Language,
                as: 'language',
                attributes: ['id', 'name', 'isoCode'],
              },
              { model: Gothram, as: 'gothram', attributes: ['id', 'name'] },
            ],
          },
        ],
      });

      if (updatedUser.userProfile?.profile) {
        updatedUser.userProfile.profile = this.uploadService.getFileUrl(
          updatedUser.userProfile.profile,
          'profile',
        );
      }

      return {
        message: 'Profile updated successfully',
        data: {
          ...updatedUser.toJSON(),
          userProfile: updatedUser.userProfile?.toJSON(),
        },
      };
    } catch (err) {
      console.error('Update Profile Error:', err);

      if (err?.name === 'SequelizeValidationError') {
        throw new BadRequestException({
          message: 'Validation error',
          errors: err.errors.map((e) => e.message),
        });
      }

      throw new BadRequestException({ 
        message: err?.message || 'Something went wrong',
      });
    }
  }

  async deleteUser(userId: number, requesterId: number) {
    const requester = await this.userModel.findByPk(requesterId);
    if (!requester) {
      throw new ForbiddenException('Invalid requester');
    }

    const target = await this.userModel.findByPk(userId);
    if (!target) {
      throw new BadRequestException({ message: 'User not found' });
    }

    const isSelf = Number(requesterId) === Number(userId);
    const isAdmin = Number(requester.role) === 2 || Number(requester.role) === 3;
    if (!isSelf && !isAdmin) {
      throw new ForbiddenException('Only admins can delete other users');
    }

    if (Number(target.role) === 3 && Number(requester.role) !== 3) {
      throw new ForbiddenException('Only superadmin can delete a superadmin');
    }

    return this.requestAccountDeletionWithInitiator(userId, isSelf ? { type: 'user', id: requesterId } : { type: 'admin', id: requesterId });
  }

  async mergeUserData(
    existingUserId: number,
    currentUserId: number,
    notificationId?: number,
  ) {
    // 1. Fetch users and profiles
    const existingUser = await this.userModel.findByPk(existingUserId);
    const currentUser = await this.userModel.findByPk(currentUserId);
    const existingProfile = await this.userProfileModel.findOne({
      where: { userId: existingUserId },
    });
    const currentProfile = await this.userProfileModel.findOne({
      where: { userId: currentUserId },
    });

    if (!existingUser || !currentUser || !existingProfile || !currentProfile) {
      throw new BadRequestException('User or profile not found');
    }

    // Store the original profile image to delete later if needed
    const existingProfileImage = existingProfile.profile;
    const newProfileImage = currentProfile.profile;

    // 2. Overwrite all fields except id/userId and familyCode
    Object.assign(existingUser, currentUser.toJSON(), { id: existingUser.id });
    Object.assign(existingProfile, currentProfile.toJSON(), {
      id: existingProfile.id,
      userId: existingUserId,
      familyCode: existingProfile.familyCode,
    });

    // If the current user has a different profile image, handle S3 cleanup
    if (newProfileImage && newProfileImage !== existingProfileImage) {
      try {
        // Delete the old profile image from S3 if it exists
        if (existingProfileImage) {
          console.log(
            `Deleting old profile image for user ${existingUserId}:`,
            existingProfileImage,
          );
          await this.uploadService.deleteFile(existingProfileImage, 'profile');
        }
      } catch (error) {
        console.error('Error deleting old profile image during merge:', error);
        // Continue with merge even if image deletion fails
      }
    }

    // 3. Delete current user and profile
    try {
      // Delete the current user's profile image from S3 if it exists
      if (newProfileImage && newProfileImage !== existingProfileImage) {
        console.log(`Deleting current user's profile image:`, newProfileImage);
        await this.uploadService.deleteFile(newProfileImage, 'profile');
      }

      await currentProfile.destroy();
      await currentUser.destroy();
    } catch (error) {
      console.error('Error during user deletion in merge:', error);
      throw error; // Re-throw to ensure we don't leave data in an inconsistent state
    }

    // 4. Save the updated existing user and profile
    await existingUser.save();
    await existingProfile.save();

    // 5. Update notification type if notificationId is provided
    if (notificationId) {
      await this.notificationModel.update(
        { type: 'FAMILY_MEMBER_JOINED' },
        { where: { id: notificationId } },
      );
    }

    return {
      message:
        'User data swapped, current user deleted, and notification updated',
      userId: existingUserId,
    };
  }
}









