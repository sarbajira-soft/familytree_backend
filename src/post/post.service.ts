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
import { NotificationService } from '../notification/notification.service';

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

      private readonly notificationService: NotificationService,
  ) {}

  async createPost(
    dto: CreatePostDto,
    createdBy: number,
  ) {
    // Step 1: Create post
    const post = await this.postModel.create({
      caption: dto.caption,
      familyCode: dto.familyCode || null,
      createdBy,
      status: dto.status ?? 1,
      postImage: dto.postImage as any || null,
      privacy: dto.privacy ?? 'public',
    });

    // Step 2: Send notification only if familyCode exists (for private/family posts)
    if (dto.familyCode && (dto.privacy === 'private' || dto.privacy === 'family')) {
      const memberIds = await this.notificationService.getAdminsForFamily(dto.familyCode);

      if (memberIds.length > 0) {
        await this.notificationService.createNotification(
          {
            type: 'FAMILY_POST_CREATED',
            title: 'New Family Post',
            message: `A new post has been shared in the family feed.`,
            familyCode: dto.familyCode,
            referenceId: post.id,
            userIds: memberIds,
          },
          createdBy, // performedBy
        );
      }
    }

    // Step 3: Return post details
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
      familyCode: dto.familyCode || null,
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
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          attributes: ['firstName', 'lastName', 'profile'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    const baseUrl = process.env.BASE_URL || '';
    const postPath = process.env.POST_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/posts';
    const profilePath = process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';

    const formatted = await Promise.all(
      posts.map(async (post) => {
        const postJson = post.toJSON() as any;

        // Post image URL
        const postImageUrl = postJson.postImage ? `${baseUrl}/${postPath}/${postJson.postImage}` : null;

        // Get like count and comment count
        const [likeCount, commentCount] = await Promise.all([
          this.postLikeModel.count({ where: { postId: post.id } }),
          this.postCommentModel.count({ where: { postId: post.id } }),
        ]);

        // Check if the user liked this post
        let isLiked = false;
        if (userId) {
          const existingLike = await this.postLikeModel.findOne({
            where: { postId: post.id, userId },
          });
          isLiked = !!existingLike;
        }

        // Format user info
        const user = postJson.userProfile;
        const fullName = user ? `${user.firstName} ${user.lastName}` : null;
        const profileImage = user?.profile ? `${baseUrl}/${profilePath}/${user.profile}` : null;

        return {
          ...postJson,
          postImage: postImageUrl,
          likeCount,
          commentCount,
          isLiked,
          user: {
            name: fullName,
            profile: profileImage,
          },
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

async getPost(postId: number) {
  const baseUrl = process.env.BASE_URL || '';
  const postUploadPath = process.env.POST_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/posts';

  const post = await this.postModel.findOne({
      where: { id: postId },
    });

    if (!post) {
      throw new Error(`Post with ID ${postId} not found`);
    }

    if(post.postImage){
      post.postImage = `${baseUrl}/${postUploadPath}/${post.postImage}`;
    }

    return {
      data: post,
      imageUrl: `${baseUrl}/${postUploadPath}/${post.postImage || 'default.png'}`
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

  async deletePost(postId: number, userId: number) {
    const post = await this.postModel.findOne({ where: { id: postId, createdBy: userId } });

    if (!post) {
      throw new NotFoundException('Post not found or access denied.');
    }

    // Delete related comments
    await this.postCommentModel.destroy({ where: { postId } });

    // Delete related likes
    await this.postLikeModel.destroy({ where: { postId } });

    // Delete image file if exists
    const imageFilename = post.postImage;
    if (imageFilename) {
      const uploadPath = process.env.POST_PHOTO_UPLOAD_PATH || './uploads/posts';
      const imagePath = `${uploadPath}/${imageFilename}`;

      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    // Delete the post
    await post.destroy();

    return {
      message: 'Post deleted successfully along with associated comments and likes',
    };
  }

}
