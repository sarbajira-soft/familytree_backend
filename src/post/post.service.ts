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
import { Post } from './model/post.model';
import { PostLike } from './model/post-like.model';
import { PostComment } from './model/post-comment.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { CreatePostDto } from './dto/createpost.dto';

@Injectable()
export class PostService {
  constructor(
      @InjectModel(Post)
      private readonly postModel: typeof Post,
      @InjectModel(PostLike)
      private readonly postLikeModel: typeof PostLike,
      @InjectModel(PostComment)
      private readonly postCommentModel: typeof PostComment,
      @InjectModel(UserProfile)
      private readonly userProfileModel: typeof UserProfile,
      @InjectModel(User)
      private readonly userModel: typeof User,
  ) {}

  async createPost(
    dto: CreatePostDto,
    createdBy: number,
  ) {
    // Optional: Validate familyCode if needed
    // await this.validateFamilyCode(dto.familyCode, createdBy);

    // Create post
    const post = await this.postModel.create({
      caption: dto.caption,
      familyCode: dto.familyCode,
      createdBy,
      status: dto.status ?? 1,
      postImage: dto.postImage as any || null,
      privacy: dto.privacy ?? 'public',
    });

    return {
      message: 'Post created successfully',
      data: {
        id: post.id,
        caption: post.caption,
        postImage: post.postImage,
        privacy: post.privacy,
        familyCode: post.familyCode,
        status: post.status,
      },
    };
  }

  async updatePost(
    postId: number,
    userId: number,
    dto: CreatePostDto,
    newImage?: Express.Multer.File,
  ) {
    const post = await this.postModel.findOne({ where: { id: postId, createdBy: userId } });

    if (!post) {
      throw new NotFoundException('Post not found or access denied.');
    }

    const oldImage = post.postImage;

    // If new image uploaded, set it
    if (newImage) {
      dto.postImage = newImage.filename as any;

      // Delete old image file
      if (oldImage) {
        const uploadPath = process.env.POST_PHOTO_UPLOAD_PATH || './uploads/posts';
        const fullPath = `${uploadPath}/${oldImage}`;
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
    }

    await post.update({
      caption: dto.caption ?? post.caption,
      privacy: dto.privacy ?? post.privacy,
      familyCode: dto.familyCode ?? post.familyCode,
      status: dto.status ?? post.status,
      postImage: dto.postImage ?? post.postImage as any,
    });

    return {
      message: 'Post updated successfully',
      data: post,
    };
  }

  async getPostByOptions(
    privacy?: 'public' | 'private' | 'family',
    familyCode?: string,
    createdBy?: number,
    postId?: number,
    caption?: string,
    userId?: number
  ) {
    const whereClause: any = {};

    if (postId) whereClause.id = postId;

    if (privacy) {
      if (privacy === 'private' || privacy === 'family') {
        if (!familyCode) {
          throw new BadRequestException('familyCode is required for private/family privacy');
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

    if (caption) {
      whereClause.caption = { [Op.iLike]: `%${caption}%` };
    }

    const posts = await this.postModel.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
    });

    const baseUrl = process.env.BASE_URL || '';
    const uploadPath =
      process.env.POST_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/posts';

    const formatted = await Promise.all(
      posts.map(async (post) => {
        const postJson = post.toJSON();

        // Post image URL
        let postImageUrl: string | null = null;
        if (postJson.postImage) {
          postImageUrl = `${baseUrl}/${uploadPath}/${postJson.postImage}`;
        }

        // Get like count
        const likeCount = await this.postLikeModel.count({ where: { postId: post.id } });

        // Get comment count
        const commentCount = await this.postCommentModel.count({ where: { postId: post.id } });

        // Check if the user liked this post
        let isLiked = false;
        if (userId) {
          const existingLike = await this.postLikeModel.findOne({
            where: {
              postId: post.id,
              userId: userId, 
            },
          });
          isLiked = !!existingLike;
        }

        return {
          ...postJson,
          postImage: postImageUrl,
          likeCount,
          commentCount,
          isLiked, // ✅ Add this
        };
      })
    );

    return formatted;
  }

  async toggleLikePost(postId: number, userId: number) {
    const existingLike = await this.postLikeModel.findOne({ where: { postId, userId } });

    if (existingLike) {
      // User already liked it, so remove like
      await existingLike.destroy();
    } else {
      // User did not like yet, create like
      await this.postLikeModel.create({ postId, userId });
    }

    // Get the updated total like count
    const likeCount = await this.postLikeModel.count({ where: { postId } });

    return {
      liked: !existingLike,
      message: existingLike ? 'Like removed' : 'Post liked',
      totalLikes: likeCount,
    };
  }

  async addComment(postId: number, userId: number, comment: string) {
    return this.postCommentModel.create({ postId, userId, comment });
  }

  async getComments(postId: number, page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const baseUrl = process.env.BASE_URL || '';
    const profileUploadPath =
      process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';

    const { rows, count } = await this.postCommentModel.findAndCountAll({
      where: { postId },
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
        content: comment.comment,
        createdAt: comment.createdAt,
        user: comment.userProfile ? {
          firstName: comment.userProfile.firstName,
          lastName: comment.userProfile.lastName,
          profile: comment.userProfile.profile
            ? `${baseUrl}/${profileUploadPath}/${comment.userProfile.profile}`
            : null,
        } : null,
      })),
    };
  }

  async getCommentCount(postId: number) {
    const count = await this.postCommentModel.count({ where: { postId } });
    return { postId, likes: count };
  }

  async getLikeCount(postId: number) {
    const count = await this.postLikeModel.count({ where: { postId } });
    return { postId, likes: count };
  }

}
