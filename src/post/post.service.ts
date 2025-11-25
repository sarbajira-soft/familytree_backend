import {
  Injectable,
  BadRequestException,
  NotFoundException,
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
import { EditPostDto } from './dto/edit-post.dto';
import { NotificationService } from '../notification/notification.service';
import { UploadService } from '../uploads/upload.service';
import { PostGateway } from './post.gateway';
import { BaseCommentService } from '../common/services/base-comment.service';
import { NotificationGateway } from 'src/notification/notification.gateway';

@Injectable()
export class PostService {
  private readonly baseCommentService: BaseCommentService;

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
    private readonly notificationGateway: NotificationGateway,
    private readonly postGateway: PostGateway,
  ) {
    this.baseCommentService = new BaseCommentService();
  }

  async createPost(dto: CreatePostDto, createdBy: number) {
    // Extract just the filename if it's a full URL
    let postImage = dto.postImage;
    if (postImage && postImage.startsWith('http')) {
      try {
        const url = new URL(postImage);
        // Extract the filename from the path (remove the 'posts/' prefix if it exists)
        postImage = url.pathname.split('/').pop() || null;
      } catch (error) {
        console.error('Error parsing image URL:', error);
      }
    }

    // Step 1: Create post
    const post = await this.postModel.create({
      caption: dto.caption,
      familyCode: dto.familyCode || null,
      createdBy,
      status: dto.status ?? 1,
      postImage: postImage || null,
      privacy: dto.privacy ?? 'public',
    });

    // Step 2: Send notification only if familyCode exists (for private/family posts)
    if (
      dto.familyCode &&
      (dto.privacy === 'private' || dto.privacy === 'family')
    ) {
      const memberIds = await this.notificationService.getAdminsForFamily(
        dto.familyCode,
      );

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

    // Step 3: Broadcast new post via WebSocket if familyCode exists
    if (dto.familyCode) {
      this.postGateway.broadcastNewPost(dto.familyCode, {
        id: post.id,
        caption: post.caption,
        postImage: this.getPostImageUrl(post.postImage),
        privacy: post.privacy,
        familyCode: post.familyCode,
        status: post.status,
        createdBy,
        createdAt: post.createdAt,
      });
    }

    // Step 4: Return post details
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
    dto: CreatePostDto | EditPostDto,
    newImage?: Express.Multer.File | string,
  ) {
    const post = await this.postModel.findOne({
      where: { id: postId, createdBy: userId },
    });

    if (!post) {
      throw new NotFoundException('Post not found or access denied.');
    }

    const oldImage = post.postImage;
    let newImageFilename: string | null = null;

    // If new image is uploaded, process it
    if (newImage) {
      const uploadService = new UploadService();

      // 1. Delete the old image if it exists
      if (oldImage) {
        try {
          const oldImageUrl = this.getPostImageUrl(oldImage);
          if (oldImageUrl) {
            // Delete the old image from S3 or local storage
            if (oldImageUrl.includes('amazonaws.com')) {
              // Delete from S3
              await uploadService.deleteFile(oldImageUrl);
            } else {
              // Local file deletion
              const uploadPath =
                process.env.POST_PHOTO_UPLOAD_PATH || './uploads/posts';
              const imagePath = path.join(uploadPath, path.basename(oldImage));

              if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
              }
            }
          }
        } catch (error) {
          console.error('Error deleting old image:', error);
          // Continue with update even if old image deletion fails
        }
      }

      // 2. Check if newImage is a file (Multer.File) or a string (URL)
      if (typeof newImage !== 'string') {
        try {
          // 3. Upload the new image to S3 if it's a file
          const imageUrl = await uploadService.uploadFile(newImage, 'posts');

          // 4. Extract just the filename from the URL
          try {
            const url = new URL(imageUrl);
            newImageFilename = url.pathname.split('/').pop() || null;
          } catch (error) {
            console.error('Error parsing image URL:', error);
            // Fallback to storing the full URL if parsing fails
            newImageFilename = imageUrl;
          }
        } catch (error) {
          console.error('Error uploading new image:', error);
          throw new Error('Failed to upload new image');
        }
      } else {
        // If it's a string (URL), extract the filename
        try {
          const url = new URL(newImage);
          newImageFilename = url.pathname.split('/').pop() || null;
        } catch (e) {
          // If it's not a valid URL, use as is
          newImageFilename = newImage;
        }
      }
    }

    // Prepare update data
    const updateData: any = {
      caption: dto.caption ?? post.caption,
      privacy: dto.privacy ?? post.privacy,
      familyCode: dto.familyCode ?? post.familyCode,
      status: dto.status ?? post.status,
    };

    // Only update postImage if we have a new image
    if (newImageFilename !== null) {
      updateData.postImage = newImageFilename;
    }

    // Update the post
    await post.update(updateData);

    // Get the updated post with the full image URL
    const updatedPost = await this.postModel.findByPk(postId);
    const postJson = updatedPost?.toJSON() as any;

    if (postJson) {
      postJson.postImage = this.getPostImageUrl(postJson.postImage);
    }

    // Broadcast post update via WebSocket
    this.postGateway.broadcastPostUpdate(postId, postJson);

    return {
      message: 'Post updated successfully',
      data: postJson,
    };
  }

  private getPostImageUrl(filename: string | null): string | null {
    if (!filename) return null;

    // If the filename is already a full URL, return it as is
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      return filename;
    }

    // If S3 is configured, construct S3 URL
    if (process.env.S3_BUCKET_NAME && process.env.REGION) {
      return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.REGION}.amazonaws.com/posts/${filename}`;
    }

    // Fallback to local URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/uploads/posts/${filename}`;
  }

  /**
   * Checks if the new image is the same as the old one
   * @param newImage The new image file
   * @param oldImageFilename The filename of the old image
   * @returns boolean indicating if the images are the same
   */
  private async isSameImage(
    newImage: Express.Multer.File,
    oldImageFilename: string | null,
  ): Promise<boolean> {
    if (!oldImageFilename) return false;

    try {
      // Extract just the filename without path if it's a full URL
      let filename = oldImageFilename;
      try {
        const url = new URL(oldImageFilename);
        filename = url.pathname.split('/').pop() || oldImageFilename;
      } catch (e) {
        // Not a URL, use as is
      }

      // Compare filenames (without timestamps if any)
      const oldName = filename.split('_').pop()?.split('.')[0];
      const newName = newImage.originalname.split('.')[0];

      return oldName === newName;
    } catch (error) {
      console.error('Error comparing images:', error);
      return false; // If there's an error, assume they're different to be safe
    }
  }

  async getPostByOptions(
    privacy?: 'public' | 'private' | 'family',
    familyCode?: string,
    createdBy?: number,
    postId?: number,
    caption?: string,
    userId?: number,
  ) {
    const whereClause: any = {};

    if (postId) whereClause.id = postId;

    if (privacy) {
      if (privacy === 'private' || privacy === 'family') {
        if (!familyCode) {
          throw new BadRequestException(
            'familyCode is required for private/family privacy',
          );
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
    const profilePath =
      process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') ||
      'uploads/profile';

    const formatted = await Promise.all(
      posts.map(async (post) => {
        const postJson = post.toJSON() as any;

        // Get full image URL from filename
        const postImageUrl = this.getPostImageUrl(postJson.postImage);

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

        // Get profile image URL - check if it's already a full URL
        let profileImage = user?.profile || null;
        if (profileImage) {
          if (!profileImage.startsWith('http')) {
            // If S3 is configured, construct S3 URL, otherwise use local URL
            if (process.env.S3_BUCKET_NAME && process.env.REGION) {
              profileImage = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.REGION}.amazonaws.com/profile/${profileImage}`;
            } else {
              profileImage = `${baseUrl}/${profilePath}/${profileImage}`;
            }
          }
        }

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
      }),
    );

    return formatted;
  }

  async toggleLikePost(postId: number, userId: number) {
    const existingLike = await this.postLikeModel.findOne({
      where: { postId, userId },
    });

    if (existingLike) {
      await existingLike.destroy();
    } else {
      await this.postLikeModel.create({ postId, userId });
    }

    // LIKE COUNT
    const likeCount = await this.postLikeModel.count({ where: { postId } });

    // USER NAME
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
    });
    const userName = userProfile
      ? `${userProfile.firstName} ${userProfile.lastName}`
      : 'Unknown User';

    // POST OWNER
    const post = await this.postModel.findByPk(postId);
    if (!post) return;

    const postOwnerId = post.createdBy;

    // SEND NOTIFICATION ONLY IF LIKE AND NOT SELF-LIKE
    if (!existingLike && postOwnerId !== userId) {
      // 1️⃣ Emit standard notification
      await this.notificationService.notifyPostLike(
        postId,
        userId,
        userName,
        postOwnerId,
      );

      this.notificationGateway.sendNotificationToUser(postOwnerId.toString(), {
        type: 'post_like',
        postId,
        likedByUserId: userId,
        likedByName: userName,
        message: `${userName} liked your post`,
        createdAt: new Date(),
      });

      // 2️⃣ Emit post-like event (your frontend expects this)
      this.notificationGateway.server
        .to(`user:${postOwnerId}`)
        .emit('post-like', {
          postId,
          userId,
          userName,
          message: `${userName} liked your post`,
          time: new Date(),
        });

      // 3️⃣ Update unread count (optional)
      this.notificationGateway.updateUnreadCount(
        postOwnerId.toString(),
        likeCount,
      );
    }

    // Broadcast to all users for real-time like update
    this.postGateway.broadcastLike(
      postId,
      userId,
      likeCount,
      !existingLike,
      userName,
    );

    return {
      liked: !existingLike,
      message: existingLike ? 'Like removed' : 'Post liked',
      totalLikes: likeCount,
    };
  }

  async addComment(postId: number, userId: number, comment: string) {
    const newComment = await this.postCommentModel.create({
      postId,
      userId,
      comment,
    });

    // Fetch user
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
    });
    const userName = userProfile
      ? `${userProfile.firstName} ${userProfile.lastName}`
      : 'Unknown User';

    // Get Post Owner
    const post = await this.postModel.findByPk(postId);
    if (!post) return;

    const postOwnerId = post.createdBy;

    // 1️⃣ SEND NOTIFICATION ONLY IF NOT SELF-COMMENT
    if (postOwnerId !== userId) {
      await this.notificationService.notifyComment(
        postId,
        userId,
        userName,
        postOwnerId,
        comment,
      );

      // Real-time notification
      this.notificationGateway.sendNotificationToUser(postOwnerId.toString(), {
        type: 'post_comment',
        postId,
        comment,
        commentedByUserId: userId,
        commentedByName: userName,
        message: `${userName} commented on your post`,
        createdAt: new Date(),
      });

      // Frontend-specific event
      this.notificationGateway.server
        .to(`user:${postOwnerId}`)
        .emit('post-comment', {
          postId,
          userId,
          userName,
          comment,
          message: `${userName} commented on your post`,
          time: new Date(),
        });

    }


    // 2️⃣ Prepare formatted comment for UI
    const formattedComment = {
      id: newComment.id,
      content: newComment.comment,
      parentCommentId: newComment.parentCommentId,
      createdAt: newComment.createdAt,
      updatedAt: newComment.updatedAt,
      userId: newComment.userId,
      user: userProfile
        ? {
            firstName: userProfile.firstName,
            lastName: userProfile.lastName,
            profile: userProfile.profile
              ? `https://familytreeupload.s3.eu-north-1.amazonaws.com/profile/${userProfile.profile}`
              : null,
          }
        : null,
    };

    // 3️⃣ Broadcast comment to everyone watching the post
    this.postGateway.broadcastComment(postId, formattedComment);

    return formattedComment;
  }

  async getComments(postId: number, page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const baseUrl = process.env.BASE_URL || '';
    const profileUploadPath =
      process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') ||
      'uploads/profile';

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
        parentCommentId: comment.parentCommentId,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        userId: comment.userId,
        user: comment.userProfile
          ? {
              firstName: comment.userProfile.firstName,
              lastName: comment.userProfile.lastName,
              profile: comment.userProfile.profile
                ? `https://familytreeupload.s3.eu-north-1.amazonaws.com/profile/${comment.userProfile.profile}`
                : null,
            }
          : null,
      })),
    };
  }

  async getPost(postId: number) {
    const post = await this.postModel.findOne({
      where: { id: postId },
    });

    if (!post) {
      throw new Error(`Post with ID ${postId} not found`);
    }

    const postJson = post.toJSON() as any;
    const postImageUrl = this.getPostImageUrl(postJson.postImage);

    return {
      data: {
        ...postJson,
        postImage: postImageUrl,
      },
      imageUrl: postImageUrl || this.getPostImageUrl('default.png'),
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
    const post = await this.postModel.findOne({
      where: { id: postId, createdBy: userId },
    });

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
      try {
        const uploadService = new UploadService();
        const imageUrl = this.getPostImageUrl(imageFilename);

        if (imageUrl) {
          // Check if it's an S3 URL or local file
          if (imageUrl.includes('amazonaws.com')) {
            // Delete from S3
            await uploadService.deleteFile(imageUrl);
          } else {
            // Local file deletion
            const uploadPath =
              process.env.POST_PHOTO_UPLOAD_PATH || './uploads/posts';
            const imagePath = path.join(
              uploadPath,
              path.basename(imageFilename),
            );

            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting post image:', error);
        // Continue with post deletion even if image deletion fails
      }
    }

    // Delete the post
    await post.destroy();

    // Broadcast post deletion via WebSocket
    this.postGateway.broadcastPostDeleted(postId, post.familyCode);

    return {
      message:
        'Post deleted successfully along with associated comments and likes',
    };
  }

  /**
   * Edit a post comment - reuses base service
   */
  async editPostComment(
    commentId: number,
    userId: number,
    newCommentText: string,
  ) {
    const result = await this.baseCommentService.editComment(
      this.postCommentModel,
      commentId,
      userId,
      newCommentText,
      'comment', // Post uses 'comment' field
    );

    // Get user profile to include in response
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
    });

    // Format response to match GET comments structure
    const formattedComment = {
      id: result.data.id,
      content: result.data.comment, // Use the actual field from database
      parentCommentId: result.data.parentCommentId,
      createdAt: result.data.createdAt,
      updatedAt: result.data.updatedAt,
      userId: result.data.userId,
      user: userProfile
        ? {
            firstName: userProfile.firstName,
            lastName: userProfile.lastName,
            profile: userProfile.profile
              ? `https://familytreeupload.s3.eu-north-1.amazonaws.com/profile/${userProfile.profile}`
              : null,
          }
        : null,
    };

    return formattedComment;
  }

  /**
   * Delete a post comment - reuses base service
   */
  async deletePostComment(commentId: number, userId: number) {
    return this.baseCommentService.deleteComment(
      this.postCommentModel,
      commentId,
      userId,
    );
  }

  /**
   * Reply to a post comment - reuses base service
   */
  async replyToPostComment(
    postId: number,
    parentCommentId: number,
    userId: number,
    replyText: string,
  ) {
    const result = await this.baseCommentService.replyToComment(
      this.postCommentModel,
      parentCommentId,
      userId,
      replyText,
      { postId }, // Additional data
      'comment', // Post uses 'comment' field
    );

    // Get user profile to include in response
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
    });

    // Format response to match GET comments structure
    const formattedComment = {
      id: result.data.id,
      content: result.data.comment, // Use the actual field from database
      parentCommentId: result.data.parentCommentId,
      createdAt: result.data.createdAt,
      updatedAt: result.data.updatedAt,
      userId: result.data.userId,
      user: userProfile
        ? {
            firstName: userProfile.firstName,
            lastName: userProfile.lastName,
            profile: userProfile.profile
              ? `https://familytreeupload.s3.eu-north-1.amazonaws.com/profile/${userProfile.profile}`
              : null,
          }
        : null,
    };

    return formattedComment;
  }
}