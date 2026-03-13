import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Gallery } from '../gallery/model/gallery.model';
import { Post } from '../post/model/post.model';
import { Event } from '../event/model/event.model';

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
  ) {}

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
