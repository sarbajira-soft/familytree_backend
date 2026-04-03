import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Gallery } from '../gallery/model/gallery.model';
import { Post } from '../post/model/post.model';
import { Event } from '../event/model/event.model';
import { UserProfile } from './model/user-profile.model';
import { FamilyMember } from '../family/model/family-member.model';
import {
  canViewContent,
  ContentPrivacySettings,
  ContentPrivacyType,
  mergeContentPrivacySettings,
  normalizeContentPrivacySettings,
  normalizeFamilyCodes,
} from './content-privacy-settings.util';

type Tx = any;

@Injectable()
export class ContentVisibilityService {
  constructor(
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(Post)
    private readonly postModel: typeof Post,
    @InjectModel(Event)
    private readonly eventModel: typeof Event,
  ) {}

  canViewContent(
    viewerFamilyCodes: unknown,
    ownerSettings: unknown,
    type: ContentPrivacyType,
    viewerId?: number | null,
    ownerId?: number | null,
  ) {
    return canViewContent(
      viewerFamilyCodes,
      ownerSettings,
      type,
      viewerId,
      ownerId,
    );
  }

  async getContentPrivacySettings(userId: number): Promise<ContentPrivacySettings> {
    const profile = await this.userProfileModel.findOne({
      where: { userId },
      attributes: ['contentPrivacySettings'],
    });

    return normalizeContentPrivacySettings(
      (profile as any)?.contentPrivacySettings,
    );
  }

  async updateContentPrivacySettings(
    userId: number,
    updates: unknown,
  ): Promise<ContentPrivacySettings> {
    const profile = await this.userProfileModel.findOne({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    const nextSettings = mergeContentPrivacySettings(
      (profile as any)?.contentPrivacySettings,
      updates,
    );

    await profile.update({
      contentPrivacySettings: nextSettings,
    } as any);

    return nextSettings;
  }

  async getViewerFamilyCodes(userId?: number | null): Promise<string[]> {
    const normalizedUserId = Number(userId);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
      return [];
    }

    const [profile, memberships] = await Promise.all([
      this.userProfileModel.findOne({
        where: { userId: normalizedUserId },
        attributes: ['familyCode', 'associatedFamilyCodes'],
      }),
      this.familyMemberModel.findAll({
        where: {
          memberId: normalizedUserId,
          approveStatus: 'approved',
        } as any,
        attributes: ['familyCode'],
      }),
    ]);

    return Array.from(
      new Set([
        ...normalizeFamilyCodes((profile as any)?.familyCode ? [(profile as any).familyCode] : []),
        ...normalizeFamilyCodes((profile as any)?.associatedFamilyCodes),
        ...normalizeFamilyCodes(
          (memberships || []).map((membership: any) => membership.familyCode),
        ),
      ]),
    );
  }

  async getContentPrivacySettingsMap(
    ownerIds: Array<number | null | undefined>,
  ): Promise<Map<number, ContentPrivacySettings>> {
    const normalizedOwnerIds = Array.from(
      new Set(
        ownerIds
          .map((ownerId) => Number(ownerId))
          .filter((ownerId) => Number.isFinite(ownerId) && ownerId > 0),
      ),
    );

    const settingsMap = new Map<number, ContentPrivacySettings>();
    if (normalizedOwnerIds.length === 0) {
      return settingsMap;
    }

    const profiles = await this.userProfileModel.findAll({
      where: {
        userId: { [Op.in]: normalizedOwnerIds },
      },
      attributes: ['userId', 'contentPrivacySettings'],
    });

    for (const profile of profiles) {
      settingsMap.set(
        Number((profile as any).userId),
        normalizeContentPrivacySettings((profile as any).contentPrivacySettings),
      );
    }

    return settingsMap;
  }

  async canViewerAccessOwnerContent(
    viewerId: number | undefined,
    ownerId: number,
    type: ContentPrivacyType,
  ): Promise<boolean> {
    const [viewerFamilyCodes, ownerSettings] = await Promise.all([
      this.getViewerFamilyCodes(viewerId),
      this.getContentPrivacySettings(ownerId),
    ]);

    return this.canViewContent(
      viewerFamilyCodes,
      ownerSettings,
      type,
      viewerId,
      ownerId,
    );
  }

  async filterVisibleContent<T>(
    items: T[],
    options: {
      viewerId?: number;
      type: ContentPrivacyType;
      getOwnerId: (item: T) => number | null | undefined;
    },
  ): Promise<T[]> {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const ownerIds = items.map((item) => options.getOwnerId(item));
    const [viewerFamilyCodes, ownerSettingsMap] = await Promise.all([
      this.getViewerFamilyCodes(options.viewerId),
      this.getContentPrivacySettingsMap(ownerIds),
    ]);

    return items.filter((item) => {
      const ownerId = Number(options.getOwnerId(item));
      if (!Number.isFinite(ownerId) || ownerId <= 0) {
        return false;
      }

      return this.canViewContent(
        viewerFamilyCodes,
        ownerSettingsMap.get(ownerId),
        options.type,
        options.viewerId,
        ownerId,
      );
    });
  }

  async hideContentForDeletedAccount(userId: number, transaction?: Tx) {
    await this.galleryModel.update(
      {
        isVisibleToPublic: false,
        isVisibleToFamily: false,
        hiddenReason: 'account_deleted',
        recoveryFamilyCode: this.galleryModel.sequelize.col('familyCode') as any,
      } as any,
      { where: { createdBy: userId } as any, transaction },
    );

    await this.postModel.update(
      {
        isVisibleToPublic: false,
        isVisibleToFamily: false,
        hiddenReason: 'account_deleted',
        recoveryFamilyCode: this.postModel.sequelize.col('familyCode') as any,
      } as any,
      { where: { createdBy: userId } as any, transaction },
    );

    await this.eventModel.update(
      {
        isVisibleToFamily: false,
        hiddenReason: 'account_deleted',
        recoveryFamilyCode: this.eventModel.sequelize.col('familyCode') as any,
      } as any,
      { where: { createdBy: userId } as any, transaction },
    );
  }

  async restorePublicContentForRecoveredAccount(userId: number, transaction?: Tx) {
    await this.galleryModel.update(
      { isVisibleToPublic: true } as any,
      {
        where: {
          createdBy: userId,
          privacy: 'public',
        } as any,
        transaction,
      },
    );

    await this.postModel.update(
      { isVisibleToPublic: true } as any,
      {
        where: {
          createdBy: userId,
          privacy: 'public',
        } as any,
        transaction,
      },
    );
  }

  async hideFamilyContentForRemovedMember(
    memberId: number,
    familyCode: string,
    reason: 'member_removed' | 'account_deleted' = 'member_removed',
    transaction?: Tx,
  ) {
    await this.galleryModel.update(
      {
        isVisibleToFamily: false,
        hiddenReason: reason,
        recoveryFamilyCode: familyCode || null,
      } as any,
      {
        where: {
          createdBy: memberId,
          familyCode,
          privacy: { [Op.in]: ['private', 'family'] },
        } as any,
        transaction,
      },
    );

    await this.postModel.update(
      {
        isVisibleToFamily: false,
        hiddenReason: reason,
        recoveryFamilyCode: familyCode || null,
      } as any,
      {
        where: {
          createdBy: memberId,
          familyCode,
          privacy: { [Op.in]: ['private', 'family'] },
        } as any,
        transaction,
      },
    );

    await this.eventModel.update(
      {
        isVisibleToFamily: false,
        hiddenReason: reason,
        recoveryFamilyCode: familyCode || null,
      } as any,
      {
        where: {
          createdBy: memberId,
          familyCode,
        } as any,
        transaction,
      },
    );
  }

  async reconcileRecoveredFamilyContent(userId: number, familyCode: string, transaction?: Tx) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    if (!normalizedFamilyCode) return;

    await this.galleryModel.update(
      {
        isVisibleToFamily: true,
        hiddenReason: null,
      } as any,
      {
        where: {
          createdBy: userId,
          hiddenReason: 'account_deleted',
          recoveryFamilyCode: normalizedFamilyCode,
          privacy: { [Op.in]: ['private', 'family'] },
        } as any,
        transaction,
      },
    );

    await this.postModel.update(
      {
        isVisibleToFamily: true,
        hiddenReason: null,
      } as any,
      {
        where: {
          createdBy: userId,
          hiddenReason: 'account_deleted',
          recoveryFamilyCode: normalizedFamilyCode,
          privacy: { [Op.in]: ['private', 'family'] },
        } as any,
        transaction,
      },
    );

    await this.eventModel.update(
      {
        isVisibleToFamily: true,
        hiddenReason: null,
      } as any,
      {
        where: {
          createdBy: userId,
          hiddenReason: 'account_deleted',
          recoveryFamilyCode: normalizedFamilyCode,
        } as any,
        transaction,
      },
    );

    await this.galleryModel.destroy({
      where: {
        createdBy: userId,
        hiddenReason: 'account_deleted',
        privacy: { [Op.in]: ['private', 'family'] },
        recoveryFamilyCode: { [Op.ne]: normalizedFamilyCode },
      } as any,
      transaction,
    });

    await this.postModel.destroy({
      where: {
        createdBy: userId,
        hiddenReason: 'account_deleted',
        privacy: { [Op.in]: ['private', 'family'] },
        recoveryFamilyCode: { [Op.ne]: normalizedFamilyCode },
      } as any,
      transaction,
    });

    await this.eventModel.destroy({
      where: {
        createdBy: userId,
        hiddenReason: 'account_deleted',
        recoveryFamilyCode: { [Op.ne]: normalizedFamilyCode },
      } as any,
      transaction,
    });
  }
}
