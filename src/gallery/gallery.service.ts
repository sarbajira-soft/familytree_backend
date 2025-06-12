import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import * as fs from 'fs';
import * as path from 'path';
import { Gallery } from './model/gallery.model';
import { UserProfile } from '../user/model/user-profile.model';
import { CreateGalleryDto } from './dto/gallery.dto';

@Injectable()
export class GalleryService {
  constructor(
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
  ) {}

  async createGallery(dto: CreateGalleryDto, createdBy: number) {
    // Validate family code against user's profile
    await this.validateFamilyCode(dto.familyCode, createdBy);

    // Ensure images array is not empty
    if (!dto.images || dto.images.length === 0) {
      throw new BadRequestException(
        'At least one image is required for gallery creation',
      );
    }

    const gallery = await this.galleryModel.create({
      ...dto,
      images: JSON.stringify(dto.images), // Store as JSON string
      createdBy,
    });

    return {
      message: 'Gallery created successfully',
      data: {
        ...gallery.toJSON(),
        images: JSON.parse(gallery.images), // Parse back to array for response
      },
    };
  }

  async getAll() {
    const galleries = await this.galleryModel.findAll({
      where: { status: 1 }, // Only active galleries
    });

    return galleries.map((gallery) => ({
      ...gallery.toJSON(),
      images: JSON.parse(gallery.images || '[]'),
    }));
  }

  async getByFamilyCode(familyCode: string) {
    const galleries = await this.galleryModel.findAll({
      where: {
        familyCode,
        status: 1,
      },
    });

    return galleries.map((gallery) => ({
      ...gallery.toJSON(),
      images: JSON.parse(gallery.images || '[]'),
    }));
  }

  async getById(id: number) {
    const gallery = await this.galleryModel.findByPk(id);
    if (!gallery) throw new NotFoundException('Gallery not found');

    return {
      ...gallery.toJSON(),
      images: JSON.parse(gallery.images || '[]'),
    };
  }

  async update(id: number, dto: CreateGalleryDto, loggedId: number) {
    const gallery = await this.galleryModel.findByPk(id);
    if (!gallery) throw new NotFoundException('Gallery not found');

    // Validate family code
    await this.validateFamilyCode(dto.familyCode, loggedId);

    // Handle image replacement
    if (dto.images && dto.images.length > 0) {
      // Delete old images
      const oldImages = JSON.parse(gallery.images || '[]');
      await this.deleteImageFiles(oldImages);
    }

    const updateData = {
      ...dto,
      images: dto.images ? JSON.stringify(dto.images) : gallery.images,
      createdBy: loggedId,
    };

    await gallery.update(updateData);

    return {
      message: 'Gallery updated successfully',
      data: {
        ...gallery.toJSON(),
        images: JSON.parse(gallery.images || '[]'),
      },
    };
  }

  async delete(id: number, loggedId: number) {
    const gallery = await this.galleryModel.findByPk(id);
    if (!gallery) throw new NotFoundException('Gallery not found');

    // Optional: Check if user has permission to delete (same family)
    await this.validateFamilyCode(gallery.familyCode, loggedId);

    // Delete associated images
    const images = JSON.parse(gallery.images || '[]');
    await this.deleteImageFiles(images);

    await gallery.destroy();
    return { message: 'Gallery deleted successfully' };
  }

  private async validateFamilyCode(familyCode: string, userId: number) {
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
    });

    if (!userProfile) {
      throw new NotFoundException('User profile not found');
    }

    if (userProfile.familyCode !== familyCode) {
      throw new ForbiddenException(
        'You can only create/access galleries for your family',
      );
    }
  }

  private async deleteImageFiles(imageFiles: string[]) {
    const uploadDir =
      process.env.GALLERY_PHOTO_UPLOAD_PATH || './uploads/gallery';

    for (const imageFile of imageFiles) {
      const imagePath = path.join(uploadDir, imageFile);

      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
          console.log('Gallery image deleted:', imagePath);
        } catch (err) {
          console.warn('Failed to delete gallery image:', err.message);
        }
      }
    }
  }
}
