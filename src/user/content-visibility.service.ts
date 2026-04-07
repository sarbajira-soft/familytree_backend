import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Gallery } from '../gallery/model/gallery.model';
import { Post } from '../post/model/post.model';
import { Event } from '../event/model/event.model';
import { UserProfile } from './model/user-profile.model';
import {
  FamilyContentVisibilitySettings,
  FamilyContentVisibilityType,
  isFamilyContentVisibleForType,
  normalizeFamilyContentVisibilitySettings,
} from './content-visibility-settings.util';

type Tx = any;

@Injectable()
export class ContentVisibilityService {
  constructor(
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(Post)
    private readonly postModel: typeof Post,
    @InjectModel(Event)
    private readonly eventModel: typeof Event,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
  ) {}

  private canToggleFamilyContentVisibility() {
    return {
      [Op.or]: [{ hiddenReason: null }, { hiddenReason: 'content_privacy_disabled' }],
    } as any;
  }

  private getFamilyContentVisible(
    settings: FamilyContentVisibilitySettings,
    type: FamilyContentVisibilityType,
  ): boolean {
    return isFamilyContentVisibleForType(settings, type);
  }

  private async syncPostFamilyVisibility(
    userId: number,
    settings: FamilyContentVisibilitySettings,
    transaction?: Tx,
  ) {
    const isVisibleToFamily = this.getFamilyContentVisible(settings, 'posts');

    await this.postModel.update(
      {
        isVisibleToFamily,
        isVisibleToPublic: false,
        hiddenReason: isVisibleToFamily ? null : 'content_privacy_disabled',
      } as any,
      {
        where: {
          createdBy: userId,
          deletedAt: null,
          privacy: { [Op.in]: ['private', 'family'] },
          ...this.canToggleFamilyContentVisibility(),
        } as any,
        transaction,
      },
    );
  }

  private async syncGalleryFamilyVisibility(
    userId: number,
    settings: FamilyContentVisibilitySettings,
    transaction?: Tx,
  ) {
    const isVisibleToFamily = this.getFamilyContentVisible(settings, 'albums');

    await this.galleryModel.update(
      {
        isVisibleToFamily,
        isVisibleToPublic: false,
        hiddenReason: isVisibleToFamily ? null : 'content_privacy_disabled',
      } as any,
      {
        where: {
          createdBy: userId,
          deletedAt: null,
          privacy: { [Op.in]: ['private', 'family'] },
          ...this.canToggleFamilyContentVisibility(),
        } as any,
        transaction,
      },
    );
  }

  private async syncEventFamilyVisibility(
    userId: number,
    settings: FamilyContentVisibilitySettings,
    transaction?: Tx,
  ) {
    const isVisibleToFamily = this.getFamilyContentVisible(settings, 'events');

    await this.eventModel.update(
      {
        isVisibleToFamily,
        hiddenReason: isVisibleToFamily ? null : 'content_privacy_disabled',
      } as any,
      {
        where: {
          createdBy: userId,
          deletedAt: null,
          familyCode: { [Op.ne]: null },
          ...this.canToggleFamilyContentVisibility(),
        } as any,
        transaction,
      },
    );
  }

  async getFamilyContentVisibilitySettingsForUser(
    userId: number,
    transaction?: Tx,
  ): Promise<FamilyContentVisibilitySettings> {
    const profile = await this.userProfileModel.findOne({
      where: { userId } as any,
      attributes: ['contentVisibilitySettings'],
      ...(transaction ? { transaction } : {}),
    });

    return normalizeFamilyContentVisibilitySettings(
      (profile as any)?.contentVisibilitySettings,
    );
  }

  async applyFamilyContentVisibilitySettings(
    userId: number,
    settings: unknown,
    transaction?: Tx,
  ) {
    const normalizedSettings = normalizeFamilyContentVisibilitySettings(settings);

    await this.syncGalleryFamilyVisibility(userId, normalizedSettings, transaction);
    await this.syncPostFamilyVisibility(userId, normalizedSettings, transaction);
    await this.syncEventFamilyVisibility(userId, normalizedSettings, transaction);
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

  async hideContentForRemovedFamily(
    userId: number,
    familyCode: string,
    reason = 'member_removed',
    transaction?: Tx,
  ) {
    await this.galleryModel.update(
      {
        isVisibleToPublic: false,
        isVisibleToFamily: false,
        hiddenReason: reason,
      } as any,
      {
        where: {
          createdBy: userId,
          familyCode,
          deletedAt: null,
        } as any,
        transaction,
      },
    );

    await this.postModel.update(
      {
        isVisibleToPublic: false,
        isVisibleToFamily: false,
        hiddenReason: reason,
      } as any,
      {
        where: {
          createdBy: userId,
          familyCode,
          deletedAt: null,
        } as any,
        transaction,
      },
    );

    await this.eventModel.update(
      {
        isVisibleToFamily: false,
        hiddenReason: reason,
      } as any,
      {
        where: {
          createdBy: userId,
          familyCode,
          deletedAt: null,
        } as any,
        transaction,
      },
    );
  }

  async restoreContentForRecoveredAccount(userId: number, transaction?: Tx) {
    await this.galleryModel.update(
      {
        isVisibleToPublic: true,
        isVisibleToFamily: true,
        hiddenReason: null,
      } as any,
      {
        where: {
          createdBy: userId,
          hiddenReason: 'account_deleted',
        } as any,
        transaction,
      },
    );

    await this.postModel.update(
      {
        isVisibleToPublic: true,
        isVisibleToFamily: true,
        hiddenReason: null,
      } as any,
      {
        where: {
          createdBy: userId,
          hiddenReason: 'account_deleted',
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
        } as any,
        transaction,
      },
    );
  }

  async restoreContentForFamilyRejoin(
    userId: number,
    familyCode: string,
    transaction?: Tx,
  ) {
    await this.galleryModel.update(
      {
        isVisibleToFamily: true,
        hiddenReason: null,
      } as any,
      {
        where: {
          createdBy: userId,
          familyCode,
          hiddenReason: 'member_removed',
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
          familyCode,
          hiddenReason: 'member_removed',
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
          familyCode,
          hiddenReason: 'member_removed',
        } as any,
        transaction,
      },
    );
  }

  async hideFamilyContentForRemovedMember(
    userId: number,
    familyCode: string,
    reason = 'member_removed',
    transaction?: Tx,
  ) {
    await this.hideContentForRemovedFamily(userId, familyCode, reason, transaction);
  }

  async reconcileRecoveredFamilyContent(
    userId: number,
    familyCode: string,
    transaction?: Tx,
  ) {
    await this.restoreContentForFamilyRejoin(userId, familyCode, transaction);
  }

  async restorePublicContentForRecoveredAccount(
    userId: number,
    transaction?: Tx,
  ) {
    await this.restoreContentForRecoveredAccount(userId, transaction);
  }
}
