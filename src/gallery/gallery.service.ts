import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import * as fs from 'fs';
import * as path from 'path';
import { Gallery } from './model/gallery.model';
import { GalleryAlbum } from './model/gallery-album.model';
import { GalleryLike } from './model/gallery-like.model';
import { GalleryComment } from './model/gallery-comment.model';
import { UserProfile } from '../user/model/user-profile.model';

import { CreateGalleryDto } from './dto/gallery.dto';
import { CreateGalleryCommentDto } from './dto/gallery-comment.dto';

import { NotificationService } from '../notification/notification.service';

@Injectable()
export class GalleryService {
  constructor(
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(GalleryAlbum)
    private readonly galleryAlbumModel: typeof GalleryAlbum,
    @InjectModel(GalleryLike)
    private readonly galleryLikeModel: typeof GalleryLike,
    @InjectModel(GalleryComment)
    private readonly galleryCommentModel: typeof GalleryComment,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,

    private readonly notificationService: NotificationService,
  ) {}

  async createGallery(
    dto: CreateGalleryDto,
    createdBy: number,
    albumImages: Express.Multer.File[],
  ) {
    if (!albumImages || albumImages.length === 0) {
      throw new BadRequestException('At least one album image is required.');
    }

    // Validate familyCode requirement based on privacy
    const privacy = dto.privacy ?? 'public';
    if (privacy === 'private' && !dto.familyCode) {
      throw new BadRequestException('familyCode is required for private privacy');
    }

    try {
      // Step 1: Create Gallery
      const galleryData: any = {
        galleryTitle: dto.galleryTitle,
        galleryDescription: dto.galleryDescription,
        createdBy,
        status: dto.status ?? 1,
        coverPhoto: dto.coverPhoto as any || null,
        privacy: privacy,
      };

      // Set familyCode - use empty string for public galleries if database requires it
      if (dto.familyCode) {
        galleryData.familyCode = dto.familyCode;
      } else {
        // For public galleries, use empty string if database doesn't allow null
        galleryData.familyCode = '';
      }

      const gallery = await this.galleryModel.create(galleryData);

      // Step 2: Save Album Images
      const albumData = albumImages.map((file) => ({
        galleryId: gallery.id,
        album: file.filename,
      }));

      await this.galleryAlbumModel.bulkCreate(albumData);

      // Step 3: Send notifications only for private galleries with familyCode
      if (privacy === 'private' && dto.familyCode) {
        try {
          // Fetch approved family members from ft_family_members
          const memberIds = await this.notificationService.getAdminsForFamily(dto.familyCode);

          // Extract memberIds excluding the creator
          // Send notification to all approved members (excluding the creator)
          if (memberIds.length > 0) {
            await this.notificationService.createNotification(
              {
                type: 'FAMILY_GALLERY_CREATED',
                title: 'New Gallery Added',
                message: `${gallery.galleryTitle} has been added to the family gallery.`,
                familyCode: dto.familyCode,
                referenceId: gallery.id,
                userIds: memberIds,
              },
              createdBy, // performedBy
            );
          }
        } catch (notificationError) {
          // Log notification error but don't fail the gallery creation
          console.error('Failed to send notifications:', notificationError);
        }
      }

      // Step 4: Return Response
      return {
        success: true,
        message: 'Gallery created successfully',
        data: {
          id: gallery.id,
          galleryTitle: gallery.galleryTitle,
          coverPhoto: gallery.coverPhoto,
          album: albumImages.map((img) => img.filename),
          totalImages: albumImages.length,
          privacy: privacy,
          familyCode: dto.familyCode || null, // Return null in response even if empty string in DB
        },
      };
    } catch (error) {
      // Enhanced error handling
      console.error('Gallery creation failed:', error);
      throw new BadRequestException(
        `Failed to create gallery: ${error.message || 'Unknown error occurred'}`
      );
    }
  }

  async getGalleryByOptions(
    privacy: 'public' | 'private',
    familyCode?: string,
    createdBy?: number,
    galleryId?: number,
    galleryTitle?: string,
    userId?: number,
  ) {
    const whereClause: any = {};

    if (galleryId) whereClause.id = galleryId;

    if (galleryTitle) {
      whereClause.galleryTitle = {
        [Op.like]: `%${galleryTitle}%`,
      };
    }

    if (privacy) {
      if (privacy === 'private') {
        if (!familyCode) {
          throw new BadRequestException('familyCode is required for private privacy');
        }
        whereClause.privacy = privacy;
        whereClause.familyCode = familyCode;
      } else if (privacy === 'public') {
        whereClause.privacy = 'public';
      } else {
        throw new BadRequestException('Invalid privacy value');
      }
    }

    if (createdBy) whereClause.createdBy = createdBy;

    const galleries = await this.galleryModel.findAll({
      where: whereClause,
      include: [
        {
          model: this.galleryAlbumModel,
          as: 'galleryAlbums',
        },
        {
          model: this.userProfileModel,
          as: 'userProfile',
          attributes: ['firstName', 'lastName', 'profile'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    const baseUrl = process.env.BASE_URL || '';
    const uploadPath = process.env.GALLERY_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/gallery';
    const profilePath = process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';

    const formatted = await Promise.all(
      galleries.map(async (gallery) => {
        const galleryJson = gallery.toJSON() as any;

        // Format album image URLs
        const albumImages = (galleryJson.galleryAlbums || []).map((album) => ({
          ...album,
          album: album.album ? `${baseUrl}/${uploadPath}/${album.album}` : null,
        }));

        // Set cover photo
        let coverImageUrl: string | null = null;
        if (galleryJson.coverPhoto) {
          coverImageUrl = `${baseUrl}/${uploadPath}/${galleryJson.coverPhoto}`;
        } else if (albumImages.length > 0) {
          coverImageUrl = albumImages[0].album;
        }

        // Get like count and comment count
        const [likeCount, commentCount] = await Promise.all([
          this.galleryLikeModel.count({ where: { galleryId: gallery.id } }),
          this.galleryCommentModel.count({ where: { galleryId: gallery.id } }),
        ]);

        // Check if current user liked this gallery
        let isLiked = false;
        if (userId) {
          const liked = await this.galleryLikeModel.findOne({
            where: { galleryId: gallery.id, userId },
          });
          isLiked = !!liked;
        }

        // Format user info
        const user = galleryJson.userProfile;
        const fullName = user ? `${user.firstName} ${user.lastName}` : null;
        const profileImage = user?.profile ? `${baseUrl}/${profilePath}/${user.profile}` : null;

        return {
          ...galleryJson,
          coverPhoto: coverImageUrl,
          galleryAlbums: albumImages,
          likeCount,
          commentCount,
          ...(userId !== undefined && { isLiked }),
          familyCode: galleryJson.familyCode || null, // Convert empty string to null in response
          user: {
            name: fullName,
            profile: profileImage,
          },
        };
      })
    );

    return formatted;
  }

  async updateGallery(
    id: number,
    dto: CreateGalleryDto,
    updatedBy: number,
    coverPhotoFile?: Express.Multer.File,
    albumFiles?: Express.Multer.File[],
  ) {
    const gallery = await this.galleryModel.findByPk(id, {
      include: [{ model: this.galleryAlbumModel, as: 'galleryAlbums' }],
    });

    if (!gallery) throw new NotFoundException('Gallery not found');

    // Validate familyCode requirement based on privacy
    const privacy = dto.privacy ?? gallery.privacy;
    if (privacy === 'private' && !dto.familyCode) {
      throw new BadRequestException('familyCode is required for private privacy');
    }

    const uploadPath = process.env.GALLERY_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/gallery';

    // Delete old cover photo if new one uploaded
    if (coverPhotoFile && gallery.coverPhoto) {
      const oldCover = `${uploadPath}/${gallery.coverPhoto}`;
      if (fs.existsSync(oldCover)) fs.unlinkSync(oldCover);
      dto.coverPhoto = coverPhotoFile.filename as any;
    }

    // Delete old album images if new images uploaded
    if (albumFiles && albumFiles.length > 0 && gallery.galleryAlbums?.length > 0) {
      for (const album of gallery.galleryAlbums) {
        const imgPath = `${uploadPath}/${album.album}`;
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        await album.destroy();
      }

      // Insert new album images
      await Promise.all(
        albumFiles.map((file) =>
          this.galleryAlbumModel.create({ galleryId: id, album: file.filename }),
        ),
      );
    }

    // Update fields
    const updateData = { ...dto as any };
    if (privacy === 'public' && !dto.familyCode) {
      updateData.familyCode = ''; // Use empty string instead of null for database compatibility
    }
    await gallery.update(updateData);

    // Return updated gallery with full URLs
    const baseUrl = process.env.BASE_URL || '';
    const newGallery = await this.galleryModel.findByPk(id, {
      include: [{ model: this.galleryAlbumModel, as: 'galleryAlbums' }],
    });

    const galleryJson = newGallery.toJSON();
    const albumImages = galleryJson.galleryAlbums.map((album) => ({
      ...album,
      album: `${baseUrl}/${uploadPath}/${album.album}`,
    }));

    let coverImageUrl = galleryJson.coverPhoto
      ? `${baseUrl}/${uploadPath}/${galleryJson.coverPhoto}`
      : albumImages[0]?.album || null;

    return {
      message: 'Gallery updated successfully',
      data: {
        ...galleryJson,
        coverPhoto: coverImageUrl,
        galleryAlbums: albumImages,
      },
    };
  }

  async deleteGallery(id: number) {
    const gallery = await this.galleryModel.findByPk(id, {
      include: [{ model: this.galleryAlbumModel, as: 'galleryAlbums' }],
    });

    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    const uploadPath =
      process.env.GALLERY_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/gallery';

    // 🧹 Delete album images (DB + files)
    for (const album of gallery.galleryAlbums || []) {
      const filePath = `${uploadPath}/${album.album}`;
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await album.destroy();
    }

    // Delete cover photo file
    if (gallery.coverPhoto) {
      const coverPath = `${uploadPath}/${gallery.coverPhoto}`;
      if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
    }

    // Delete gallery record
    await gallery.destroy();

    return {
      message: 'Gallery and all related images deleted successfully',
    };
  }

  async toggleLikeGallery(galleryId: number, userId: number) {
    const existingLike = await this.galleryLikeModel.findOne({
      where: { galleryId, userId },
    });

    if (existingLike) {
      // User already liked it, so remove like
      await existingLike.destroy();
    } else {
      // User did not like yet, create like
      await this.galleryLikeModel.create({ galleryId, userId });
    }

    // Get updated like count
    const likeCount = await this.galleryLikeModel.count({ where: { galleryId } });

    return {
      liked: !existingLike,
      message: existingLike ? 'Gallery unliked' : 'Gallery liked',
      totalLikes: likeCount,
    };
  }

  async getGalleryLikeCount(galleryId: number) {
    const count = await this.galleryLikeModel.count({
      where: { galleryId },
    });
    return { galleryId, likes: count };
  }

  async addGalleryComment(dto: CreateGalleryCommentDto, userId: number) {
    const comment = await this.galleryCommentModel.create({
      galleryId: dto.galleryId,
      userId,
      comments: dto.comments,
    });

    return {
      message: 'Comment added successfully',
      data: comment,
    };
  }

  async getGalleryComments(galleryId: number, page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const baseUrl = process.env.BASE_URL || '';
    const profileUploadPath =
      process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';

    const { rows, count } = await this.galleryCommentModel.findAndCountAll({
      where: { galleryId },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          attributes: ['firstName', 'lastName', 'profile'],
        },
      ],
    });

    return {
      total: count,
      page,
      limit,
      comments: rows.map((comment: any) => ({
        id: comment.id,
        comment: comment.comments,
        createdAt: comment.createdAt,
        user: comment.userProfile
          ? {
              firstName: comment.userProfile.firstName,
              lastName: comment.userProfile.lastName,
              profile: comment.userProfile.profile
                ? `${baseUrl}/${profileUploadPath}/${comment.userProfile.profile}`
                : null,
            }
          : null,
      })),
    };
  }

  async getGalleryCommentCount(galleryId: number) {
    const count = await this.galleryCommentModel.count({
      where: { galleryId },
    });

    return {
      galleryId,
      commentCount: count,
    };
  }

  async getGalleryById(
    galleryId: number,
    userId?: number, // optional, to check like status
  ) {
    if (!galleryId) {
      throw new BadRequestException('galleryId is required');
    }

    const gallery = await this.galleryModel.findOne({
      where: { id: galleryId },
      include: [
        {
          model: this.galleryAlbumModel,
          as: 'galleryAlbums',
        },
      ],
    });

    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    const baseUrl = process.env.BASE_URL || '';
    const uploadPath =
      process.env.GALLERY_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') ||
      'uploads/gallery';

    const galleryJson = gallery.toJSON();

    // Format album image URLs
    const albumImages = (galleryJson.galleryAlbums || []).map((album) => ({
      ...album,
      album: album.album ? `${baseUrl}/${uploadPath}/${album.album}` : null,
    }));

    // Set cover photo
    let coverImageUrl: string | null = null;
    if (galleryJson.coverPhoto) {
      coverImageUrl = `${baseUrl}/${uploadPath}/${galleryJson.coverPhoto}`;
    } else if (albumImages.length > 0) {
      coverImageUrl = albumImages[0].album;
    }

    // Get like and comment counts
    const [likeCount, commentCount] = await Promise.all([
      this.galleryLikeModel.count({ where: { galleryId } }),
      this.galleryCommentModel.count({ where: { galleryId } }),
    ]);

    // Check if user liked this gallery
    let isLiked = false;
    if (userId) {
      const liked = await this.galleryLikeModel.findOne({
        where: { galleryId, userId },
      });
      isLiked = !!liked;
    }

    return {
      ...galleryJson,
      coverPhoto: coverImageUrl,
      galleryAlbums: albumImages,
      likeCount,
      commentCount,
      familyCode: galleryJson.familyCode || null, // Convert empty string to null in response
      ...(userId !== undefined && { isLiked }),
    };
  }

}
