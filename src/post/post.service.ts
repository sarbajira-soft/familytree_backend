import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import * as fs from 'fs';
import * as path from 'path';
import { Post } from './model/post.model';
import { UserProfile } from '../user/model/user-profile.model';
import { CreatePostDto } from './dto/post.dto';

@Injectable()
export class PostService {
  constructor(
    @InjectModel(Post)
    private readonly postModel: typeof Post,
    // TODO: Uncomment when implementing family code validation
    // @InjectModel(UserProfile)
    // private readonly userProfileModel: typeof UserProfile,
  ) {}

  async createPost(dto: CreatePostDto, createdBy: number) {
    // TODO: Validate family code against user's profile
    // await this.validateFamilyCode(dto.familyCode, createdBy);

    const post = await this.postModel.create({
      ...dto,
      createdBy,
    });

    return {
      message: 'Post created successfully',
      data: post,
    };
  }

  async getAll() {
    return await this.postModel.findAll();
  }

  async getByFamilyCode(familyCode: string) {
    const posts = await this.postModel.findAll({
      where: { 
        familyCode,
        status: 1 
      },
    });

    return posts;
  }

  async getById(id: number) {
    const post = await this.postModel.findByPk(id);
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async update(id: number, dto: any, newFileName?: string, loggedId?: number) {
    const post = await this.postModel.findByPk(id);
    if (!post) throw new NotFoundException('Post not found');

    // TODO: Validate family code
    // await this.validateFamilyCode(dto.familyCode, loggedId);

    // Delete old image file if new one is uploaded
    if (newFileName && post.postImage) {
      const oldFile = post.postImage;
      const uploadDir = process.env.POST_IMAGE_UPLOAD_PATH || './uploads/posts';
      const oldFilePath = path.join(uploadDir, oldFile);

      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
          console.log('Old post image deleted:', oldFilePath);
        } catch (err) {
          console.warn('Failed to delete old image:', err.message);
        }
      }
    }

    dto.createdBy = loggedId;
    await post.update(dto);

    return {
      message: 'Post updated successfully',
      data: post,
    };
  }

  async delete(id: number, loggedId?: number) {
    const post = await this.postModel.findByPk(id);
    if (!post) throw new NotFoundException('Post not found');

    // TODO: Check if user has permission to delete (same family)
    // await this.validateUserFamilyAccess(post.familyCode, loggedId);

    // Optional: delete associated image
    if (post.postImage) {
      const uploadDir = process.env.POST_IMAGE_UPLOAD_PATH || './uploads/posts';
      const imagePath = path.join(uploadDir, post.postImage);

      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (err) {
          console.warn('Failed to delete post image:', err.message);
        }
      }
    }

    await post.destroy();
    return { message: 'Post deleted successfully' };
  }

  // TODO: Uncomment and implement family code validation later
  // private async validateFamilyCode(familyCode: string, userId: number) {
  //   const userProfile = await this.userProfileModel.findOne({
  //     where: { userId }
  //   });

  //   if (!userProfile) {
  //     throw new NotFoundException('User profile not found');
  //   }

  //   if (userProfile.familyCode !== familyCode) {
  //     throw new ForbiddenException('You can only create/access posts for your family');
  //   }
  // }

  // private async validateUserFamilyAccess(postFamilyCode: string, userId: number) {
  //   const userProfile = await this.userProfileModel.findOne({
  //     where: { userId }
  //   });

  //   if (!userProfile) {
  //     throw new NotFoundException('User profile not found');
  //   }

  //   if (userProfile.familyCode !== postFamilyCode) {
  //     throw new ForbiddenException('You can only access posts from your family');
  //   }
  // }
}