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
 
import { CreateGalleryDto, UpdateGalleryDto } from './dto/gallery.dto';
import { CreateGalleryCommentDto } from './dto/gallery-comment.dto';

import { NotificationService } from '../notification/notification.service';
import { UploadService } from '../uploads/upload.service';
import { BaseCommentService } from '../common/services/base-comment.service';
import { FamilyMember } from '../family/model/family-member.model';
import { BlockingService } from '../blocking/blocking.service';
import { FamilyLink } from '../family/model/family-link.model';

@Injectable()
export class GalleryService {
  private readonly baseCommentService: BaseCommentService;

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

    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,

    @InjectModel(FamilyLink)
    private readonly familyLinkModel: typeof FamilyLink,

    private readonly notificationService: NotificationService,
    private readonly uploadService: UploadService,

    private readonly blockingService: BlockingService,
  ) {
    this.baseCommentService = new BaseCommentService();
  }

  private async assertUserCanAccessFamilyContent(userId: number, familyCode: string): Promise<void> {
    if (!userId || !familyCode) {
      throw new ForbiddenException('Not allowed to access this family content');
    }

    const membership = await this.familyMemberModel.findOne({
      where: { memberId: userId, familyCode },
    });

    if (!membership || (membership as any).approveStatus !== 'approved') {
      throw new ForbiddenException('Not allowed to access this family content');
    }

    // BLOCK OVERRIDE: Legacy family-member block flag removed; access checks no longer use ft_family_members.isBlocked.
  }

  private async getAccessibleFamilyCodesForUser(userId: number): Promise<string[]> {
    if (!userId) {
      return [];
    }

    const memberships = await this.familyMemberModel.findAll({
      where: { memberId: userId, approveStatus: 'approved' } as any,
      // BLOCK OVERRIDE: Removed legacy blocked-membership projection.
      attributes: ['familyCode'],
    });

    const base = Array.from(
      new Set(
        (memberships as any[])
          .filter((m: any) => !!(m as any).familyCode)
          .map((m: any) => String((m as any).familyCode)),
      ),
    );

    if (base.length === 0) {
      return [];
    }

    const links = await this.familyLinkModel.findAll({
      where: {
        status: 'active',
        [Op.or]: [
          { familyCodeLow: { [Op.in]: base } },
          { familyCodeHigh: { [Op.in]: base } },
        ],
      } as any,
      attributes: ['familyCodeLow', 'familyCodeHigh'],
    });

    const candidate = new Set<string>(base);
    for (const l of links as any[]) {
      const low = String((l as any).familyCodeLow);
      const high = String((l as any).familyCodeHigh);
      if (base.includes(low)) candidate.add(high);
      if (base.includes(high)) candidate.add(low);
    }

    return Array.from(candidate);
  }

  private async assertUserCanAccessFamilyOrLinked(
    userId: number,
    familyCode: string,
  ): Promise<void> {
    if (!userId || !familyCode) {
      throw new ForbiddenException('Not allowed to access this family content');
    }

    const accessible = await this.getAccessibleFamilyCodesForUser(userId);
    if (!accessible.includes(String(familyCode))) {
      throw new ForbiddenException('Not allowed to access this family content');
    }
  }

  private getGalleryImageFilenameFromUrl(url: string): string | null {
    if (!url) return null;
    
    try {
      const parsedUrl = new URL(url);
      // Extract the filename from the path
      return parsedUrl.pathname.split('/').pop() || null;
    } catch (e) {
      // If it's not a valid URL, return as is (might already be a filename)
      return url;
    }
  }

  private constructGalleryImageUrl(filename: string, subfolder?: string): string {
    if (!filename) return null;
    
    // If it's already a full URL, return as is
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      // If it's a local URL, try to extract the filename
      if (filename.includes('localhost') || filename.includes('127.0.0.1')) {
        const url = new URL(filename);
        filename = url.pathname.split('/').pop() || filename;
      } else {
        // For S3 URLs, check if it's a cover image and needs to be in the cover folder
        if (subfolder === 'cover' && !filename.includes('/cover/')) {
          // This is a cover image that's not in the cover folder yet
          const url = new URL(filename);
          const pathParts = url.pathname.split('/');
          const existingFilename = pathParts.pop();
          // Reconstruct the URL with the cover folder
          return `${url.origin}/cover/${existingFilename}`;
        }
        return filename;
      }
    }

    // If S3 is configured, construct S3 URL
    if (process.env.S3_BUCKET_NAME && process.env.REGION) {
      const s3BaseUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.REGION}.amazonaws.com`;
      if (subfolder === 'cover') {
        return `${s3BaseUrl}/gallery/cover/${filename}`;
      } else if (subfolder) {
        return `${s3BaseUrl}/${subfolder}/${filename}`;
      }
      return `${s3BaseUrl}/gallery/${filename}`;
    }

    // Fallback to local URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    let uploadPath = 'uploads';
    
    if (subfolder) {
      uploadPath = `uploads/${subfolder}`;
    } else {
      uploadPath = process.env.GALLERY_PHOTO_UPLOAD_PATH?.replace(/^\.?\/?/, '') || 'uploads/gallery';
    }
    
    return `${baseUrl.replace(/\/$/, '')}/${uploadPath.replace(/\/$/, '')}/${filename}`;
  }

  /**
   * Uploads a file to S3 and returns the filename
   * @param file File to upload
   * @param subfolder Optional subfolder in the gallery bucket
   * @returns Promise<string> The filename of the uploaded file
   */
  async uploadGalleryFile(file: Express.Multer.File, subfolder?: string): Promise<string> {
    try {
      // Define the upload path based on subfolder
      const uploadPath = subfolder ? `gallery/${subfolder}` : 'gallery';
      
      // Upload the file using the upload service
      const fileName = await this.uploadService.uploadFile(file, uploadPath);
      
      // Log the successful upload
      const fullUrl = this.constructGalleryImageUrl(fileName, subfolder);
      
      console.log('File uploaded successfully:', {
        originalName: file.originalname,
        uploadedAs: fileName,
        uploadPath,
        fullUrl,
        filenameType: typeof fileName,
        isString: typeof fileName === 'string',
        isURL: fileName.startsWith ? fileName.startsWith('http') : 'unknown'
      });
      
      console.log('Constructed full URL from filename:', {
        input: fileName,
        output: fullUrl,
        subfolder
      });
      
      return fileName;
    } catch (error) {
      console.error('Error uploading gallery file:', error);
      throw new Error('Failed to upload file to gallery');
    }
  }

  /**
   * Helper method to delete a cover photo from storage
   * @param coverPhoto The cover photo URL or filename to delete
   */
  private async deleteCoverPhoto(coverPhoto: string): Promise<void> {
    console.log('Deleting cover photo:', coverPhoto);
    
    try {
      if (coverPhoto.includes('amazonaws.com')) {
        const url = new URL(coverPhoto);
        let key = url.pathname.substring(1);
        
        if (!key.startsWith('gallery/cover/') && key.includes('/cover/')) {
          const parts = key.split('/cover/');
          key = `gallery/cover/${parts[parts.length - 1]}`;
        } else if (!key.startsWith('gallery/')) {
          key = `gallery/cover/${key}`;
        }
        
        console.log('Deleting S3 object with key:', key);
        await this.uploadService.deleteFile(key);
      } else {
        const cleanFilename = this.getGalleryImageFilenameFromUrl(coverPhoto) || coverPhoto;
        console.log('Deleting local file with filename:', cleanFilename);
        await this.uploadService.deleteFile(cleanFilename, 'gallery/cover');
      }
      console.log('Successfully deleted cover photo');
    } catch (error) {
      console.error('Error deleting cover photo:', error);
      // Continue even if deletion fails
    }
  }

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

    if (privacy === 'private' && dto.familyCode) {
      await this.assertUserCanAccessFamilyContent(createdBy, dto.familyCode);
    }

    const transaction = await this.galleryModel.sequelize.transaction();
    
    try {
      // Step 1: Create Gallery
      const galleryData: any = {
        galleryTitle: dto.galleryTitle,
        galleryDescription: dto.galleryDescription,
        privacy,
        familyCode: privacy === 'private' ? dto.familyCode : null,
        status: dto.status ?? 1,
        createdBy,
      };

      // Handle cover photo if provided
      if (dto.coverPhoto) {
        // If it's a file, upload it to S3
        if (typeof dto.coverPhoto !== 'string') {
          galleryData.coverPhoto = await this.uploadGalleryFile(dto.coverPhoto, 'cover');
        } else {
          // If it's already a string (filename), use it as is
          galleryData.coverPhoto = dto.coverPhoto;
        }
      }

      // Create gallery within transaction
      const gallery = await this.galleryModel.create(galleryData, { transaction });
      const galleryId = gallery.id;

      // Step 2: Upload album images to S3 and create gallery album entries
      const albumData = [];
      for (const image of albumImages) {
        try {
          const filename = await this.uploadGalleryFile(image);
          albumData.push({
            galleryId,
            album: filename,
          });
        } catch (error) {
          console.error('Error uploading gallery image:', error);
          // Continue with other images even if one fails
        }
      }
      
      if (albumData.length === 0) {
        // If no images were uploaded successfully, rollback and throw error
        await transaction.rollback();
        throw new BadRequestException('Failed to upload gallery images');
      }

      // Create album entries within the same transaction
      await this.galleryAlbumModel.bulkCreate(albumData, { transaction });

      // Step 3: Send notifications only for private galleries with familyCode
      if (privacy === 'private' && dto.familyCode) {
        try {
          // Find all users with this family code (excluding the creator)
          const users = await this.userProfileModel.findAll({
            where: {
              familyCode: dto.familyCode,
              userId: { [Op.ne]: createdBy },
            },
            transaction
          });

          // Send notification to all users at once
          const userIds = users.map(user => user.userId);
          await this.notificationService.createNotification(
            {
              type: 'GALLERY_SHARED',
              title: 'New Private Gallery',
              message: `A new private gallery "${dto.galleryTitle}" has been shared with your family`,
              familyCode: dto.familyCode,
              referenceId: galleryId,
              userIds,
            },
            createdBy
          ).catch(error => {
            console.error('Error sending gallery share notifications:', error);
          });
        } catch (error) {
          console.error('Error in notification process:', error);
          // Don't fail the gallery creation if notifications fail
        }
      }

      // Commit the transaction if everything succeeded
      await transaction.commit();

      // Step 4: Return the created gallery with full URLs
      const createdGallery = await this.galleryModel.findByPk(galleryId, {
        include: [
          {
            model: this.galleryAlbumModel,
            as: 'galleryAlbums',
            attributes: ['id', 'album'],
          },
        ],
      });

      const response = {
        success: true,
        message: 'Gallery created successfully',
        data: {
          id: createdGallery.id,
          galleryTitle: createdGallery.galleryTitle,
          galleryDescription: createdGallery.galleryDescription,
          coverPhoto: createdGallery.coverPhoto 
            ? this.constructGalleryImageUrl(createdGallery.coverPhoto)
            : null,
          album: createdGallery.galleryAlbums.map(album => ({
            id: album.id,
            url: this.constructGalleryImageUrl(album.album)
          })),
          totalImages: createdGallery.galleryAlbums.length,
          privacy: createdGallery.privacy,
          familyCode: createdGallery.familyCode || null,
          status: createdGallery.status,
          createdBy: createdGallery.createdBy,
          createdAt: createdGallery.createdAt,
          updatedAt: createdGallery.updatedAt
        },
      };

      return response;
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
        await this.assertUserCanAccessFamilyOrLinked(userId, familyCode);
        whereClause.privacy = privacy;
        whereClause.familyCode = familyCode;
      } else if (privacy === 'public') {
        whereClause.privacy = 'public';
      } else {
        throw new BadRequestException('Invalid privacy value');
      }
    }

    if (createdBy) whereClause.createdBy = createdBy;

    const blockedUserIds = userId
      ? await this.blockingService.getBlockedUserIdsForUser(userId)
      : [];

    if (blockedUserIds.length > 0) {
      whereClause.createdBy = {
        ...(whereClause.createdBy ? { [Op.eq]: whereClause.createdBy } : {}),
        [Op.notIn]: blockedUserIds,
      };
    }

    const profileVisibilityWhere = userId
      ? { [Op.or]: [{ isPrivate: false }, { userId }] }
      : { isPrivate: false };

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
          required: true,
          where: profileVisibilityWhere,
          attributes: ['firstName', 'lastName', 'profile'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    const formatted = await Promise.all(
      galleries.map(async (gallery) => {
        const galleryJson = gallery.toJSON() as any;

        // Format album image URLs using constructGalleryImageUrl
        const albumImages = (galleryJson.galleryAlbums || []).map((album) => ({
          ...album,
          album: this.constructGalleryImageUrl(album.album),
        }));

        // Set cover photo using constructGalleryImageUrl with 'cover' subfolder
        let coverImageUrl: string | null = null;
        if (galleryJson.coverPhoto) {
          coverImageUrl = this.constructGalleryImageUrl(galleryJson.coverPhoto, 'cover');
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
        const profileImage = user?.profile ? this.constructGalleryImageUrl(user.profile, 'profile') : null;

        return {
          ...galleryJson,
          coverPhoto: coverImageUrl,
          galleryAlbums: albumImages,
          likeCount,
          commentCount,
          ...(userId !== undefined && { isLiked }),
          familyCode: galleryJson.familyCode || null, // Convert empty string to null in response
          user: {
            userId: galleryJson.createdBy,
            name: fullName,
            profile: profileImage,
          },
        };
      })
    );

    return formatted;
  }

  async toggleLikeGallery(galleryId: number, userId: number) {
    const gallery = await this.galleryModel.findByPk(galleryId);
    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    if (gallery.familyCode && gallery.privacy === 'private') {
      await this.assertUserCanAccessFamilyOrLinked(userId, gallery.familyCode);
    }

    const usersBlockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      gallery.createdBy,
    );
    if (usersBlockedEitherWay && gallery.createdBy !== userId) {
      throw new ForbiddenException('Not allowed');
    }

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
    const gallery = await this.galleryModel.findByPk(dto.galleryId);
    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    if (gallery.familyCode && gallery.privacy === 'private') {
      await this.assertUserCanAccessFamilyOrLinked(userId, gallery.familyCode);
    }

    const usersBlockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      gallery.createdBy,
    );
    if (usersBlockedEitherWay && gallery.createdBy !== userId) {
      throw new ForbiddenException('You cannot comment due to blocking');
    }

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

  async updateGallery(
    galleryId: number,
    dto: UpdateGalleryDto,
    userId: number,
    newAlbumImages: Express.Multer.File[] = [],
  ) {
    // Start a transaction for atomic updates
    const transaction = await this.galleryModel.sequelize.transaction();
    
    try {
      // Step 1: Find the existing gallery
      const existingGallery = await this.galleryModel.findByPk(galleryId, {
        include: [
          {
            model: this.galleryAlbumModel,
            as: 'galleryAlbums',
          },
        ],
        transaction,
      });

      if (!existingGallery) {
        throw new NotFoundException('Gallery not found');
      }

      // Check if the user has permission to update this gallery
      if (existingGallery.createdBy !== userId) {
        throw new ForbiddenException('You do not have permission to update this gallery');
      }

      // Step 2: Prepare gallery update data
      const resolvedPrivacy = dto.privacy ?? existingGallery.privacy;
      const updateData: Partial<Gallery> = {};

      if (dto.galleryTitle !== undefined) {
        updateData.galleryTitle = dto.galleryTitle;
      }
      if (dto.galleryDescription !== undefined) {
        updateData.galleryDescription = dto.galleryDescription;
      }
      if (dto.status !== undefined) {
        updateData.status = dto.status;
      }
      if (dto.privacy !== undefined) {
        updateData.privacy = resolvedPrivacy;
      }

      // Handle privacy and family code updates
      if (resolvedPrivacy === 'private') {
        const resolvedFamilyCode = dto.familyCode || existingGallery.familyCode;
        if (!resolvedFamilyCode) {
          throw new BadRequestException('familyCode is required for private privacy');
        }
        if (dto.privacy !== undefined || dto.familyCode !== undefined) {
          updateData.familyCode = resolvedFamilyCode;
        }
      } else if (resolvedPrivacy === 'public') {
        if (dto.privacy !== undefined) {
          updateData.familyCode = ''; // Clear family code for public galleries
        }
      }

      // Handle cover photo update if provided or being removed
      if (dto.coverPhoto !== undefined) {
        try {
          // Store the old cover photo before any updates
          const oldCoverPhoto = existingGallery.coverPhoto;
          
          // Handle different cases for cover photo update
          if (dto.coverPhoto === null || dto.coverPhoto === '' || dto.coverPhoto === 'null' || dto.coverPhoto === 'remove') {
            // Case 1: Cover photo is being removed
            updateData.coverPhoto = null;
            console.log('Removing cover photo from gallery');
            
            // If there was an old cover photo, delete it
            if (oldCoverPhoto) {
              console.log('Deleting old cover photo:', oldCoverPhoto);
              await this.deleteCoverPhoto(oldCoverPhoto);
            }
          } else if (dto.coverPhoto && typeof dto.coverPhoto !== 'string') {
            // Case 2: New cover photo file is provided (as Express.Multer.File or similar)
            const fileToUpload = dto.coverPhoto as Express.Multer.File;
            const newCoverPhoto = await this.uploadGalleryFile(fileToUpload, 'cover');
            console.log('New cover photo uploaded:', newCoverPhoto);
            updateData.coverPhoto = newCoverPhoto;
            
            // Delete old cover photo if it exists and is different from the new one
            if (oldCoverPhoto && oldCoverPhoto !== newCoverPhoto) {
              console.log('Replacing old cover photo:', oldCoverPhoto);
              await this.deleteCoverPhoto(oldCoverPhoto);
            }
          } else if (typeof dto.coverPhoto === 'string' && dto.coverPhoto.startsWith('http')) {
            // Case 3: Cover photo is a URL (from existing album image)
            const coverPhotoStr = dto.coverPhoto as string;
            const url = new URL(coverPhotoStr);
            // Extract just the filename part from the URL
            const filename = url.pathname.split('/').pop() || coverPhotoStr;
            console.log('Using existing image as cover:', filename);
            
            if (url.hostname.includes('amazonaws.com')) {
              updateData.coverPhoto = filename;
            } else {
              updateData.coverPhoto = coverPhotoStr;
            }
            
            // Delete old cover photo if it's different from the new one
            if (oldCoverPhoto && oldCoverPhoto !== updateData.coverPhoto) {
              await this.deleteCoverPhoto(oldCoverPhoto);
            }
          } else if (typeof dto.coverPhoto === 'string') {
            // Case 4: Cover photo is a direct filename (string)
            const coverPhotoStr = dto.coverPhoto as string;
            updateData.coverPhoto = coverPhotoStr;
            
            // Delete old cover photo if it's different from the new one
            if (oldCoverPhoto && oldCoverPhoto !== coverPhotoStr) {
              await this.deleteCoverPhoto(oldCoverPhoto);
            }
          }
        } catch (error) {
          console.error('Error updating cover photo:', error);
          throw new BadRequestException('Failed to update cover photo');
        }
      }

      // Step 4: Update the gallery
      await existingGallery.update(updateData, { transaction });

      // Step 5: Handle album images if any new ones are provided
      if (newAlbumImages && newAlbumImages.length > 0) {
        const albumData = [];
        
        for (const image of newAlbumImages) {
          try {
            const filename = await this.uploadGalleryFile(image);
            albumData.push({
              galleryId,
              album: filename,
            });
          } catch (error) {
            console.error('Error uploading gallery image:', error);
            // Continue with other images even if one fails
          }
        }

        if (albumData.length > 0) {
          await this.galleryAlbumModel.bulkCreate(albumData, { transaction });
        }
      }

      // Step 6: Handle image deletions if specified in the DTO
      if (dto.removedImageIds && Array.isArray(dto.removedImageIds) && dto.removedImageIds.length > 0) {
        // Find the images to be deleted
        const imagesToDelete = await this.galleryAlbumModel.findAll({
          where: {
            id: dto.removedImageIds,
            galleryId,
          },
          transaction,
        });

        // Delete the files from S3
        await Promise.all(
          imagesToDelete.map(async (image) => {
            try {
              await this.uploadService.deleteFile(`gallery/${image.album}`);
            } catch (error) {
              console.error(`Error deleting image ${image.album}:`, error);
              // Continue with other deletions even if one fails
            }
          })
        );

        // Delete the database records
        await this.galleryAlbumModel.destroy({
          where: {
            id: dto.removedImageIds,
            galleryId,
          },
          transaction,
        });
      }

      // Commit the transaction if everything succeeded
      await transaction.commit();

      // Step 7: Return the updated gallery with full URLs
      const updatedGallery = await this.galleryModel.findByPk(galleryId, {
        include: [
          {
            model: this.galleryAlbumModel,
            as: 'galleryAlbums',
          },
        ],
      });

      // Format the response with full URLs
      const response = {
        success: true,
        message: 'Gallery updated successfully',
        data: {
          id: updatedGallery.id,
          galleryTitle: updatedGallery.galleryTitle,
          galleryDescription: updatedGallery.galleryDescription,
          coverPhoto: updatedGallery.coverPhoto 
            ? this.constructGalleryImageUrl(updatedGallery.coverPhoto)
            : null,
          album: updatedGallery.galleryAlbums.map(album => ({
            id: album.id,
            url: this.constructGalleryImageUrl(album.album)
          })),
          totalImages: updatedGallery.galleryAlbums.length,
          privacy: updatedGallery.privacy,
          familyCode: updatedGallery.familyCode || null,
          status: updatedGallery.status,
          createdBy: updatedGallery.createdBy,
          updatedAt: updatedGallery.updatedAt
        },
      };

      return response;
    } catch (error) {
      // Rollback the transaction on error
      await transaction.rollback();
      console.error('Gallery update failed:', error);
      
      // Handle specific error types
      if (error instanceof BadRequestException || 
          error instanceof NotFoundException ||
          error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new BadRequestException(
        `Failed to update gallery: ${error.message || 'Unknown error occurred'}`
      );
    }
  }

  async deleteGallery(galleryId: number) {
    const transaction = await this.galleryModel.sequelize.transaction();
    
    try {
      // 1. Find the gallery with its album images
      const gallery = await this.galleryModel.findByPk(galleryId, {
        include: [
          {
            model: this.galleryAlbumModel,
            as: 'galleryAlbums',
          },
        ],
        transaction,
      });

      if (!gallery) {
        throw new NotFoundException('Gallery not found');
      }

      // 2. Delete cover photo from S3 if it exists
      if (gallery.coverPhoto) {
        try {
          await this.uploadService.deleteFile(`gallery/cover/${gallery.coverPhoto}`);
        } catch (error) {
          console.error(`Error deleting cover photo ${gallery.coverPhoto}:`, error);
          // Continue with deletion even if file deletion fails
        }
      }

      // 3. Delete all album images from S3
      if (gallery.galleryAlbums && gallery.galleryAlbums.length > 0) {
        await Promise.all(
          gallery.galleryAlbums.map(async (album) => {
            try {
              await this.uploadService.deleteFile(`gallery/${album.album}`);
            } catch (error) {
              console.error(`Error deleting album image ${album.album}:`, error);
              // Continue with other deletions even if one fails
            }
          })
        );
      }

      // 4. Delete all related records (likes, comments, album entries)
      await Promise.all([
        this.galleryAlbumModel.destroy({
          where: { galleryId },
          transaction,
        }),
        this.galleryLikeModel.destroy({
          where: { galleryId },
          transaction,
        }),
        this.galleryCommentModel.destroy({
          where: { galleryId },
          transaction,
        }),
      ]);

      // 5. Finally, delete the gallery itself
      await gallery.destroy({ transaction });

      // Commit the transaction
      await transaction.commit();

      return {
        success: true,
        message: 'Gallery and all associated data deleted successfully',
        deletedGalleryId: galleryId,
      };
    } catch (error) {
      // Rollback the transaction on error
      await transaction.rollback();
      console.error('Gallery deletion failed:', error);
      
      // Handle specific error types
      if (error instanceof NotFoundException) {
        throw error;
      }
      
      throw new BadRequestException(
        `Failed to delete gallery: ${error.message || 'Unknown error occurred'}`
      );
    }
  }

  async getGalleryComments(
    galleryId: number,
    page = 1,
    limit = 10,
    requestingUserId?: number,
  ) {
    const gallery = await this.galleryModel.findByPk(galleryId);
    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    // Enforce access to private galleries
    if (gallery.familyCode && gallery.privacy === 'private') {
      if (!requestingUserId) {
        throw new ForbiddenException('Not allowed to view this gallery');
      }
      await this.assertUserCanAccessFamilyOrLinked(requestingUserId, gallery.familyCode);
    }

    // Hard rule: blocked users cannot view each other's galleries/comments (even public).
    if (requestingUserId && gallery.createdBy && gallery.createdBy !== requestingUserId) {
      const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
        requestingUserId,
        gallery.createdBy,
      );
      if (blockedEitherWay) {
        throw new NotFoundException('Gallery not found');
      }
    }

    const offset = (page - 1) * limit;

    const blockedUserIds = requestingUserId
      ? await this.blockingService.getBlockedUserIdsForUser(requestingUserId)
      : [];

    const { rows, count } = await this.galleryCommentModel.findAndCountAll({
      where: {
        galleryId,
        ...(blockedUserIds.length > 0
          ? { userId: { [Op.notIn]: blockedUserIds } }
          : {}),
      },
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
        parentCommentId: comment.parentCommentId,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        userId: comment.userId,
        user: comment.userProfile
          ? {
              userId: comment.userId,
              firstName: comment.userProfile.firstName,
              lastName: comment.userProfile.lastName,
              profile: this.constructGalleryImageUrl(comment.userProfile.profile, 'profile'),
            }
          : null,
      })),
    };
  }

  async getGalleryCommentCount(galleryId: number, requestingUserId?: number) {
    const gallery = await this.galleryModel.findByPk(galleryId);
    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    if (gallery.familyCode && gallery.privacy === 'private') {
      if (!requestingUserId) {
        throw new ForbiddenException('Not allowed');
      }
      await this.assertUserCanAccessFamilyOrLinked(requestingUserId, gallery.familyCode);
    }

    if (requestingUserId && gallery.createdBy && gallery.createdBy !== requestingUserId) {
      const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
        requestingUserId,
        gallery.createdBy,
      );
      if (blockedEitherWay) {
        throw new NotFoundException('Gallery not found');
      }
    }

    const blockedUserIds = requestingUserId
      ? await this.blockingService.getBlockedUserIdsForUser(requestingUserId)
      : [];

    const count = await this.galleryCommentModel.count({
      where: {
        galleryId,
        ...(blockedUserIds.length > 0
          ? { userId: { [Op.notIn]: blockedUserIds } }
          : {}),
      },
    });

    return { galleryId, commentCount: count };
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

    if (gallery.familyCode && gallery.privacy === 'private') {
      if (!userId) {
        throw new ForbiddenException('Not allowed to view this gallery');
      }
      await this.assertUserCanAccessFamilyOrLinked(userId, gallery.familyCode);
    }

    if (userId) {
      const usersBlockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
        userId,
        gallery.createdBy,
      );
      if (usersBlockedEitherWay && gallery.createdBy !== userId) {
        throw new NotFoundException('Gallery not found');
      }
    }

    const galleryJson = gallery.toJSON();

    // Format album image URLs
    const albumImages = (galleryJson.galleryAlbums || []).map((album) => ({
      ...album,
      album: this.constructGalleryImageUrl(album.album),
    }));

    // Set cover photo using constructGalleryImageUrl with 'cover' subfolder
    let coverImageUrl: string | null = null;
    if (galleryJson.coverPhoto) {
      coverImageUrl = this.constructGalleryImageUrl(galleryJson.coverPhoto, 'cover');
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

  /**
   * Edit a gallery comment - reuses base service
   */
  async editGalleryComment(commentId: number, userId: number, newCommentText: string) {
    const comment = await this.galleryCommentModel.findByPk(commentId);
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    const gallery = await this.galleryModel.findByPk((comment as any).galleryId);
    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      (gallery as any).createdBy,
    );
    if (blockedEitherWay && (gallery as any).createdBy !== userId) {
      throw new ForbiddenException('Not allowed');
    }

    return this.baseCommentService.editComment(
      this.galleryCommentModel,
      commentId,
      userId,
      newCommentText,
      'comments', // Gallery uses 'comments' field
    );
  }

  /**
   * Delete a gallery comment - reuses base service
   */
  async deleteGalleryComment(commentId: number, userId: number) {
    const comment = await this.galleryCommentModel.findByPk(commentId);
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    const gallery = await this.galleryModel.findByPk((comment as any).galleryId);
    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      (gallery as any).createdBy,
    );
    if (blockedEitherWay && (gallery as any).createdBy !== userId) {
      throw new ForbiddenException('Not allowed');
    }

    return this.baseCommentService.deleteComment(
      this.galleryCommentModel,
      commentId,
      userId,
    );
  }

  /**
   * Reply to a gallery comment - reuses base service
   */
  async replyToGalleryComment(
    galleryId: number,
    parentCommentId: number,
    userId: number,
    replyText: string,
  ) {
    const gallery = await this.galleryModel.findByPk(galleryId);
    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    if (gallery.familyCode && gallery.privacy === 'private') {
      await this.assertUserCanAccessFamilyOrLinked(userId, gallery.familyCode);
    }

    const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      (gallery as any).createdBy,
    );
    if (blockedEitherWay && (gallery as any).createdBy !== userId) {
      throw new ForbiddenException('Not allowed');
    }

    return this.baseCommentService.replyToComment(
      this.galleryCommentModel,
      parentCommentId,
      userId,
      replyText,
      { galleryId }, // Additional data
      'comments', // Gallery uses 'comments' field
    );
  }

}
