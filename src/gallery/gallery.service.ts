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
    private readonly uploadService: UploadService,
  ) {}

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
      // For cover photos, use 'gallery/cover' folder
      // For album images, use 'gallery' folder
      let folder = 'gallery';
      if (subfolder === 'cover') {
        folder = 'gallery/cover';
      } else if (subfolder) {
        folder = `gallery/${subfolder}`;
      }
      
      // Upload the file and get the full URL
      const fileUrl = await this.uploadService.uploadFile(file, folder);
      
      // For S3, the uploadService.uploadFile returns just the filename when successful
      // So we can use that directly instead of parsing it from a URL
      const filename = fileUrl;
      
      if (!filename) {
        throw new Error('Failed to get filename from upload service');
      }
      
      const fullUrl = this.constructGalleryImageUrl(filename, subfolder);
      
      console.log('File uploaded successfully:', {
        originalName: file.originalname,
        uploadedAs: filename,
        folder,
        fullUrl: fullUrl,
        'filenameType': typeof filename,
        'isString': typeof filename === 'string',
        'isURL': filename.startsWith ? filename.startsWith('http') : 'unknown'
      });
      
      console.log('Constructed full URL from filename:', {
        input: filename,
        output: fullUrl,
        subfolder: subfolder
      });
      
      return filename;
    } catch (error) {
      console.error('Error uploading gallery file:', error);
      throw new Error('Failed to upload file to gallery');
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

    const transaction = await this.galleryModel.sequelize.transaction();
    
    try {
      // Step 1: Create Gallery
      const galleryData: any = {
        galleryTitle: dto.galleryTitle,
        galleryDescription: dto.galleryDescription,
        privacy,
        familyCode: privacy === 'private' ? dto.familyCode : '',
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
            name: fullName,
            profile: profileImage,
          },
        };
      })
    );

    return formatted;
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
      const updateData: Partial<Gallery> = {
        galleryTitle: dto.galleryTitle,
        galleryDescription: dto.galleryDescription,
        privacy: dto.privacy,
        status: dto.status ?? existingGallery.status,
      };

      // Handle privacy and family code updates
      if (dto.privacy === 'private') {
        if (!dto.familyCode) {
          throw new BadRequestException('familyCode is required for private privacy');
        }
        updateData.familyCode = dto.familyCode;
      } else {
        updateData.familyCode = ''; // Clear family code for public galleries
      }

      // Handle cover photo update if provided
      if (dto.coverPhoto) {
        try {
          // If it's a file, upload it to S3 in the cover subfolder
          if (typeof dto.coverPhoto !== 'string') {
            // Store the old cover photo before updating
            const oldCoverPhoto = existingGallery.coverPhoto;
            
            // Upload new cover photo to gallery/cover folder
            const newCoverPhoto = await this.uploadGalleryFile(dto.coverPhoto, 'cover');
            console.log('New cover photo uploaded:', newCoverPhoto);
            updateData.coverPhoto = newCoverPhoto;
            
            // Log current state before deletion
            console.log('=== COVER PHOTO UPDATE DEBUG ===');
            console.log('Current cover photo in DB (raw):', JSON.stringify(oldCoverPhoto));
            console.log('New cover photo to be saved (raw):', JSON.stringify(newCoverPhoto));
            
            // Always attempt to delete old cover photo if it exists and is different from the new one
            if (oldCoverPhoto) {
              console.log('Proceeding with cover photo deletion...');
              console.log('Attempting to delete old cover photo:', {
                oldCover: oldCoverPhoto,
                newCover: newCoverPhoto,
                areDifferent: oldCoverPhoto !== newCoverPhoto
              });
              
              try {
                // Get the filename from the URL or use as is
                let filenameToDelete = oldCoverPhoto;
                
                // If it's a full URL, extract just the filename
                if (oldCoverPhoto.includes('amazonaws.com')) {
                  // For S3 URLs, we need to extract the key properly
                  const url = new URL(oldCoverPhoto);
                  // The key is the path without the leading slash
                  const key = url.pathname.substring(1);
                  console.log('Deleting S3 object with key:', key);
                  // Delete using the full S3 key
                  const deleted = await this.uploadService.deleteFile(key);
                  if (deleted) {
                    console.log('Successfully deleted old cover photo from S3');
                  } else {
                    console.warn('Failed to delete cover photo from S3');
                  }
                } else {
                  // For local files or direct filenames
                  const cleanFilename = this.getGalleryImageFilenameFromUrl(oldCoverPhoto) || oldCoverPhoto;
                  console.log('Deleting local file with filename:', cleanFilename);
                  // Delete from the cover folder
                  const deleted = await this.uploadService.deleteFile(cleanFilename, 'gallery/cover');
                  if (deleted) {
                    console.log('Successfully deleted old cover photo from local storage');
                  } else {
                    console.warn('Failed to delete cover photo from local storage');
                  }
                }
              } catch (error) {
                console.error('Error in cover photo cleanup:', error);
                // Continue with the update even if cleanup fails
              }
            } else {
              console.log('No need to delete old cover photo: No existing cover photo');
            }
          } else {
            // If it's a string, extract filename if it's a URL
            if (dto.coverPhoto.startsWith('http')) {
              const url = new URL(dto.coverPhoto);
              updateData.coverPhoto = url.pathname.split('/').pop() || dto.coverPhoto;
            } else {
              updateData.coverPhoto = dto.coverPhoto;
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
              // Continue even if file deletion fails
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

  async getGalleryComments(galleryId: number, page = 1, limit = 10) {
    const offset = (page - 1) * limit;

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
              profile: this.constructGalleryImageUrl(comment.userProfile.profile, 'profile'),
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

}
