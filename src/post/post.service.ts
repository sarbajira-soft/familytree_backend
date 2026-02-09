import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { Post } from './model/post.model';
import { PostLike } from './model/post-like.model';
import { PostComment } from './model/post-comment.model';
import { UserProfile } from '../user/model/user-profile.model';
import { CreatePostDto } from './dto/createpost.dto';
import { EditPostDto } from './dto/edit-post.dto';
import { NotificationService } from '../notification/notification.service';
import { UploadService } from '../uploads/upload.service';
import { PostGateway } from './post.gateway';
import { BaseCommentService } from '../common/services/base-comment.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { BlockingService } from '../blocking/blocking.service';
import { FamilyMember } from '../family/model/family-member.model';
import { FamilyLink } from '../family/model/family-link.model';

type PostWithProfile = Post & { userProfile?: UserProfile };
type PostCommentWithProfile = PostComment & { userProfile?: UserProfile };

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

    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,

    @InjectModel(FamilyLink)
    private readonly familyLinkModel: typeof FamilyLink,

    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
    private readonly postGateway: PostGateway,

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

    if (membership?.approveStatus !== 'approved') {
      throw new ForbiddenException('Not allowed to access this family content');
    }

    if (membership?.isBlocked) {
      throw new ForbiddenException('You have been blocked from this family');
    }
  }

  private async getAccessibleFamilyCodesForUser(userId: number): Promise<string[]> {
    if (!userId) {
      return [];
    }

    const memberships = await this.familyMemberModel.findAll({
      where: { memberId: userId, approveStatus: 'approved' },
      attributes: ['familyCode', 'isBlocked'],
    });

    const base = Array.from(
      new Set(
        memberships
          .filter((member) => !!member.familyCode && !member.isBlocked)
          .map((member) => String(member.familyCode)),
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
      },
      attributes: ['familyCodeLow', 'familyCodeHigh'],
    });

    const candidate = new Set<string>(base);
    for (const link of links) {
      const low = String(link.familyCodeLow);
      const high = String(link.familyCodeHigh);
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

  private getPostMediaUrl(filename: string | null): string | null {
    if (!filename) return null;

    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      return filename;
    }

    if (process.env.S3_BUCKET_NAME && process.env.REGION) {
      return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.REGION}.amazonaws.com/posts/${filename}`;
    }

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/uploads/posts/${filename}`;
  }

  private normalizeFamilyCodeInput(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.toUpperCase();
  }

  private getPostImageUrl(filename: string | null): string | null {
    return this.getPostMediaUrl(filename);
  }

  private getPostVideoUrl(filename: string | null): string | null {
    if (!filename) return null;
    return this.getPostMediaUrl(filename);
  }

  private extractFilenameFromUrl(value: string, label: string): string {
    try {
      const url = new URL(value);
      return url.pathname.split('/').pop() || value;
    } catch (error) {
      console.error(`Error parsing ${label} URL:`, error);
      return value;
    }
  }

  private extractFilenameFromPath(value: string): string {
    return value.split('/').pop() || value;
  }

  private normalizePostImageInput(postImage?: string | null): string | null {
    if (!postImage) return null;
    return postImage.startsWith('http')
      ? this.extractFilenameFromUrl(postImage, 'image')
      : postImage;
  }

  private normalizePostVideoInput(postVideo?: string | null): string | null {
    if (!postVideo) return null;
    if (postVideo.startsWith('http')) {
      return this.extractFilenameFromUrl(postVideo, 'video');
    }
    return postVideo.includes('/')
      ? this.extractFilenameFromPath(postVideo)
      : postVideo;
  }

  private resolveCaption(
    caption: string | undefined | null,
    fallback: string | null,
  ): { caption: string; hasCaption: boolean } {
    if (caption === undefined) {
      const resolved = fallback ?? '';
      return { caption: resolved, hasCaption: resolved.length > 0 };
    }

    const trimmed = caption?.trim() ?? '';
    return { caption: trimmed, hasCaption: trimmed.length > 0 };
  }

  private ensurePostHasContent(
    hasCaption: boolean,
    hasImage: boolean,
    hasVideo: boolean,
  ): void {
    if (hasCaption || hasImage || hasVideo) {
      return;
    }
    throw new BadRequestException('Either caption or image or video is required');
  }

  private async deletePostImageFile(imageFilename: string | null): Promise<void> {
    if (!imageFilename) return;

    try {
      const uploadService = new UploadService();
      const imageUrl = this.getPostImageUrl(imageFilename);

      if (!imageUrl) return;

      if (imageUrl.includes('amazonaws.com')) {
        await uploadService.deleteFile(imageUrl);
        return;
      }

      const uploadPath =
        process.env.POST_PHOTO_UPLOAD_PATH || './uploads/posts';
      const imagePath = path.join(uploadPath, path.basename(imageFilename));

      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    } catch (error) {
      console.error('Error deleting post image:', error);
    }
  }

  private async deletePostVideoFile(videoFilename: string | null): Promise<void> {
    if (!videoFilename) return;

    try {
      const uploadService = new UploadService();
      const videoUrl = this.getPostVideoUrl(videoFilename);

      if (videoUrl) {
        await uploadService.deleteFile(videoUrl, 'posts');
      }
    } catch (error) {
      console.error('Error deleting post video:', error);
    }
  }

  private async resolvePostImageUpdate(
    newImage: Express.Multer.File | string | undefined,
    oldImage: string | null,
  ): Promise<string | null> {
    if (!newImage) return null;

    await this.deletePostImageFile(oldImage);

    if (typeof newImage === 'string') {
      return this.normalizePostImageInput(newImage);
    }

    try {
      const uploadService = new UploadService();
      const imageUrl = await uploadService.uploadFile(newImage, 'posts');
      return this.extractFilenameFromUrl(imageUrl, 'image');
    } catch (error) {
      console.error('Error uploading new image:', error);
      throw new Error('Failed to upload new image');
    }
  }

  private async resolvePostVideoUpdate(
    postVideo: string | undefined,
    oldVideo: string | null,
  ): Promise<{ filename: string | null; isProvided: boolean }> {
    if (postVideo === undefined) {
      return { filename: null, isProvided: false };
    }

    const trimmed = postVideo.trim();
    const filename = trimmed ? this.normalizePostVideoInput(trimmed) : null;

    if (oldVideo && oldVideo !== filename) {
      await this.deletePostVideoFile(oldVideo);
    }

    return { filename, isProvided: true };
  }

  private async notifyFamilyPostCreation(
    dto: CreatePostDto,
    post: Post,
    createdBy: number,
  ): Promise<void> {
    if (
      !dto.familyCode ||
      !(dto.privacy === 'private' || dto.privacy === 'family')
    ) {
      return;
    }

    const memberIds = await this.notificationService.getAdminsForFamily(
      dto.familyCode,
    );

    if (memberIds.length === 0) {
      return;
    }

    await this.notificationService.createNotification(
      {
        type: 'FAMILY_POST_CREATED',
        title: 'New Family Post',
        message: 'A new post has been shared in the family feed.',
        familyCode: dto.familyCode,
        referenceId: post.id,
        userIds: memberIds,
      },
      createdBy,
    );
  }

  private broadcastNewPost(dto: CreatePostDto, post: Post, createdBy: number): void {
    if (!dto.familyCode) {
      return;
    }

    this.postGateway.broadcastNewPost(dto.familyCode, {
      id: post.id,
      caption: post.caption,
      postImage: this.getPostImageUrl(post.postImage),
      postVideo: this.getPostVideoUrl(post.postVideo),

      privacy: post.privacy,
      familyCode: post.familyCode,
      status: post.status,
      createdBy,
      createdAt: post.createdAt,
    });
  }

  async createPost(dto: CreatePostDto, createdBy: number) {
    const postImage = this.normalizePostImageInput(dto.postImage);
    const postVideo = this.normalizePostVideoInput(dto.postVideo);

    const { caption: captionToStore, hasCaption } = this.resolveCaption(
      dto.caption,
      '',
    );
    const hasImage = !!postImage;
    const hasVideo = !!postVideo;

    this.ensurePostHasContent(hasCaption, hasImage, hasVideo);

    const privacy = (dto.privacy ?? 'public') as 'public' | 'private' | 'family';
    let familyCode = this.normalizeFamilyCodeInput((dto as any).familyCode);

    // For family/private posts, derive familyCode from the creator’s profile if not provided.
    if (privacy === 'private' || privacy === 'family') {
      if (!familyCode) {
        const profile = await this.userProfileModel.findOne({
          where: { userId: createdBy },
          attributes: ['familyCode'],
        });
        familyCode = this.normalizeFamilyCodeInput((profile as any)?.familyCode);
      }

      if (!familyCode) {
        throw new BadRequestException(
          'You must join a family to create private/family posts',
        );
      }

      await this.assertUserCanAccessFamilyContent(createdBy, familyCode);
    } else {
      // Public posts should not carry a familyCode.
      familyCode = null;
    }

    const dtoForBroadcast = { ...(dto as any), familyCode: familyCode || undefined } as CreatePostDto;

    // Step 1: Create post
    const post = await this.postModel.create({
      caption: captionToStore,
      familyCode,
      createdBy,
      status: dto.status ?? 1,
      postImage: hasImage ? postImage : null,
      postVideo: hasVideo ? postVideo : null,
      privacy,
    });

    await this.notifyFamilyPostCreation(dtoForBroadcast, post, createdBy);
    this.broadcastNewPost(dtoForBroadcast, post, createdBy);

    // Return post details
    return {
      message: 'Post created successfully',
      data: {
        id: post.id,
        caption: post.caption,
        postImage: post.postImage,
        postVideo: post.postVideo,

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
    const newImageFilename = await this.resolvePostImageUpdate(
      newImage,
      post.postImage,
    );
    const { filename: newVideoFilename, isProvided: isVideoProvided } =
      await this.resolvePostVideoUpdate(dto.postVideo, post.postVideo);

    const finalPostImage = newImageFilename ?? post.postImage;
    const finalPostVideo = isVideoProvided ? newVideoFilename : post.postVideo;
    const { caption: finalCaption, hasCaption } = this.resolveCaption(
      dto.caption,
      post.caption ?? '',
    );
    const hasImage = !!finalPostImage;
    const hasVideo = !!finalPostVideo;

    this.ensurePostHasContent(hasCaption, hasImage, hasVideo);

    const privacy = ((dto as any).privacy ?? post.privacy) as
      | 'public'
      | 'private'
      | 'family';

    const familyCodeInput = this.normalizeFamilyCodeInput((dto as any).familyCode);

    let familyCodeFinal: string | null =
      familyCodeInput ?? this.normalizeFamilyCodeInput((post as any).familyCode);

    if (privacy === 'private' || privacy === 'family') {
      if (!familyCodeFinal) {
        const profile = await this.userProfileModel.findOne({
          where: { userId },
          attributes: ['familyCode'],
        });
        familyCodeFinal = this.normalizeFamilyCodeInput((profile as any)?.familyCode);
      }

      if (!familyCodeFinal) {
        throw new BadRequestException(
          'You must join a family to use private/family privacy',
        );
      }

      await this.assertUserCanAccessFamilyContent(userId, familyCodeFinal);
    } else {
      // Public posts should not carry a familyCode.
      familyCodeFinal = null;
    }

    // Prepare update data using the normalized values
    const updateData: any = {
      caption: finalCaption,
      privacy,
      familyCode: familyCodeFinal,
      status: dto.status ?? post.status,
    };

    if (newImageFilename !== null) {
      updateData.postImage = newImageFilename;
    }

    // Only update postVideo if it was provided
    if (isVideoProvided) {
      updateData.postVideo = newVideoFilename;
    }

    // Update the post
    await post.update(updateData);

    // Get the updated post with the full image URL
    const updatedPost = await this.postModel.findByPk(postId);
    const postJson = updatedPost?.get({ plain: true }) as PostWithProfile;
    const formattedPost = postJson
      ? {
          ...postJson,
          postImage: this.getPostImageUrl(postJson.postImage),
          postVideo: this.getPostVideoUrl(postJson.postVideo),
        }
      : null;

    if (formattedPost) {
      this.postGateway.broadcastPostUpdate(postId, formattedPost);
    }

    return {
      message: 'Post updated successfully',
      data: formattedPost,
    };
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

    if (privacy === 'private' || privacy === 'family') {
      // If familyCode is provided, scope to that family (and enforce access).
      // If familyCode is omitted, return the viewer’s "family feed" across all accessible family codes.
      if (familyCode) {
        await this.assertUserCanAccessFamilyOrLinked(userId, familyCode);
        whereClause.familyCode = familyCode;
      } else {
        const accessible = userId
          ? await this.getAccessibleFamilyCodesForUser(userId)
          : [];

        if (!accessible || accessible.length === 0) {
          throw new ForbiddenException('Not allowed to access this family content');
        }

        whereClause.familyCode = { [Op.in]: accessible };
      }

      whereClause.privacy = privacy;
    } else if (privacy === 'public') {
      whereClause.privacy = 'public';
    }

    if (createdBy) whereClause.createdBy = createdBy;

    if (caption) {
      whereClause.caption = { [Op.iLike]: `%${caption}%` };
    }

    // User-to-user blocking: hide blocked users' posts in any feed
    const blockedUserIds = userId
      ? await this.blockingService.getBlockedUserIdsForUser(userId)
      : [];
    if (blockedUserIds.length > 0) {
      whereClause.createdBy = {
        ...(whereClause.createdBy ? { [Op.eq]: whereClause.createdBy } : {}),
        [Op.notIn]: blockedUserIds,
      };
    }

    // Private account enforcement:
    // - If viewer is logged in: allow posts from non-private users, plus the viewer's own posts
    // - If viewer is not logged in: only allow non-private users
    const profileVisibilityWhere = userId
      ? { [Op.or]: [{ isPrivate: false }, { isPrivate: null }, { userId }] }
      : { [Op.or]: [{ isPrivate: false }, { isPrivate: null }] };

    const posts = await this.postModel.findAll({
      where: whereClause,
      include: [
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

    const baseUrl = process.env.BASE_URL || '';
    const profilePath =
      process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') ||
      'uploads/profile';

    const formatted = await Promise.all(
      posts.map(async (post) => {
        const postJson: PostWithProfile = post.get({ plain: true }) as PostWithProfile;

        // Get full image URL from filename
        const postImageUrl = this.getPostImageUrl(postJson.postImage);
        const postVideoUrl = this.getPostVideoUrl(postJson.postVideo);

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
          postVideo: postVideoUrl,
          likeCount,
          commentCount,
          isLiked,
          user: {
            userId: postJson.createdBy,
            name: fullName,
            profile: profileImage,
          },
        };
      }),
    );

    return formatted;
  }

  async toggleLikePost(postId: number, userId: number) {
    const post = await this.postModel.findByPk(postId);
    if (!post) return;

    // Admin family-block: deny interactions on family/private posts if blocked
    if (post.familyCode && (post.privacy === 'private' || post.privacy === 'family')) {
      await this.assertUserCanAccessFamilyOrLinked(userId, post.familyCode);
    }

    const existingLike = await this.postLikeModel.findOne({
      where: { postId, userId },
    });

    const postOwnerId = post.createdBy;
    const usersBlockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      postOwnerId,
    );

    // Blocking policy: no interactions between blocked users.
    // Allow removing an existing like (cleanup), but block adding a new like.
    if (!existingLike && usersBlockedEitherWay && postOwnerId !== userId) {
      throw new ForbiddenException('Not allowed');
    }

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

    // Note: usersBlockedEitherWay computed above for interaction enforcement + notifications.

    // SEND NOTIFICATION ONLY IF LIKE AND NOT SELF-LIKE
    if (!existingLike && postOwnerId !== userId && !usersBlockedEitherWay) {
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
    const post = await this.postModel.findByPk(postId);
    if (!post) return;

    // Admin family-block: deny interactions on family/private posts if blocked
    if (post.familyCode && (post.privacy === 'private' || post.privacy === 'family')) {
      await this.assertUserCanAccessFamilyOrLinked(userId, post.familyCode);
    }

    const postOwnerId = post.createdBy;
    const usersBlockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      postOwnerId,
    );

    if (usersBlockedEitherWay && postOwnerId !== userId) {
      throw new ForbiddenException('You cannot comment due to blocking');
    }

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

    // 1️⃣ SEND NOTIFICATION ONLY IF NOT SELF-COMMENT
    if (postOwnerId !== userId && !usersBlockedEitherWay) {
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
            userId: newComment.userId,
            firstName: userProfile.firstName,
            lastName: userProfile.lastName,
            profile: userProfile.profile
              ? `${process.env.S3_BUCKET_URL /* || 'https://familytreeupload.s3.eu-north-1.amazonaws.com' */}/profile/${userProfile.profile}`
              : null,
          }
        : null,
    };

    // 3️⃣ Broadcast comment to everyone watching the post
    this.postGateway.broadcastComment(postId, formattedComment);

    return formattedComment;
  }

  async getPost(postId: number, requestingUserId?: number) {
    const post = await this.postModel.findOne({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException(`Post with ID ${postId} not found`);
    }

    if (
      post.familyCode &&
      (post.privacy === 'private' || post.privacy === 'family')
    ) {
      if (!requestingUserId) {
        throw new ForbiddenException('Not allowed to view this post');
      }
      await this.assertUserCanAccessFamilyOrLinked(requestingUserId, post.familyCode);
    }

    // Hard rule: blocked users cannot view each other's posts (even public).
    if (requestingUserId && post.createdBy && post.createdBy !== requestingUserId) {
      const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
        requestingUserId,
        post.createdBy,
      );
      if (blockedEitherWay) {
        throw new NotFoundException('Post not found');
      }
    }

    const postJson: PostWithProfile = post.get({ plain: true }) as PostWithProfile;
    const postImageUrl = this.getPostImageUrl(postJson.postImage);
    const postVideoUrl = this.getPostVideoUrl(postJson.postVideo);

    return {
      data: {
        ...postJson,
        postImage: postImageUrl,
        postVideo: postVideoUrl,
      },
      imageUrl: postImageUrl || this.getPostImageUrl('default.png'),
    };
  }

  async getComments(
    postId: number,
    page = 1,
    limit = 10,
    requestingUserId?: number,
  ) {
    const post = await this.postModel.findByPk(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (
      requestingUserId &&
      post.familyCode &&
      (post.privacy === 'private' || post.privacy === 'family')
    ) {
      await this.assertUserCanAccessFamilyOrLinked(
        requestingUserId,
        post.familyCode,
      );
    }

    // Hard rule: blocked users cannot view each other's posts/comments.
    if (requestingUserId && post.createdBy && post.createdBy !== requestingUserId) {
      const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
        requestingUserId,
        post.createdBy,
      );
      if (blockedEitherWay) {
        throw new NotFoundException('Post not found');
      }
    }

    const offset = (page - 1) * limit;

    const blockedUserIds = requestingUserId
      ? await this.blockingService.getBlockedUserIdsForUser(requestingUserId)
      : [];

    const { rows, count } = await this.postCommentModel.findAndCountAll({
      where: {
        postId,
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

    const comments = rows.map((comment) => {
      const commentJson: PostCommentWithProfile =
        comment.get({ plain: true }) as PostCommentWithProfile;

      return {
        id: commentJson.id,
        content: commentJson.comment,
        parentCommentId: commentJson.parentCommentId,
        createdAt: commentJson.createdAt,
        updatedAt: commentJson.updatedAt,
        userId: commentJson.userId,
        user: commentJson.userProfile
          ? {
              userId: commentJson.userId,
              firstName: commentJson.userProfile.firstName,
              lastName: commentJson.userProfile.lastName,
              profile: commentJson.userProfile.profile
                ? `${process.env.S3_BUCKET_URL /* || 'https://familytreeupload.s3.eu-north-1.amazonaws.com' */}/profile/${commentJson.userProfile.profile}`
                : null,
            }
          : null,
      };
    });

    return {
      total: count,
      page,
      limit,
      comments,
    };
  }

  async getCommentCount(postId: number, requestingUserId?: number) {
    const post = await this.postModel.findByPk(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.familyCode && (post.privacy === 'private' || post.privacy === 'family')) {
      if (!requestingUserId) {
        throw new ForbiddenException('Not allowed');
      }
      await this.assertUserCanAccessFamilyOrLinked(requestingUserId, post.familyCode);
    }

    if (requestingUserId && post.createdBy && post.createdBy !== requestingUserId) {
      const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
        requestingUserId,
        post.createdBy,
      );
      if (blockedEitherWay) {
        throw new NotFoundException('Post not found');
      }
    }

    const blockedUserIds = requestingUserId
      ? await this.blockingService.getBlockedUserIdsForUser(requestingUserId)
      : [];

    const count = await this.postCommentModel.count({
      where: {
        postId,
        ...(blockedUserIds.length > 0
          ? { userId: { [Op.notIn]: blockedUserIds } }
          : {}),
      },
    });

    return { postId, commentCount: count };
  }

  async getLikeCount(postId: number, requestingUserId?: number) {
    const post = await this.postModel.findByPk(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.familyCode && (post.privacy === 'private' || post.privacy === 'family')) {
      if (!requestingUserId) {
        throw new ForbiddenException('Not allowed');
      }
      await this.assertUserCanAccessFamilyOrLinked(requestingUserId, post.familyCode);
    }

    if (requestingUserId && post.createdBy && post.createdBy !== requestingUserId) {
      const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
        requestingUserId,
        post.createdBy,
      );
      if (blockedEitherWay) {
        throw new NotFoundException('Post not found');
      }
    }

    const blockedUserIds = requestingUserId
      ? await this.blockingService.getBlockedUserIdsForUser(requestingUserId)
      : [];

    const count = await this.postLikeModel.count({
      where: {
        postId,
        ...(blockedUserIds.length > 0
          ? { userId: { [Op.notIn]: blockedUserIds } }
          : {}),
      },
    });

    return { postId, likeCount: count };
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

    await this.deletePostImageFile(post.postImage);
    await this.deletePostVideoFile(post.postVideo);

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
    const comment = await this.postCommentModel.findByPk(commentId);
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    const post = await this.postModel.findByPk(comment.postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.familyCode && (post.privacy === 'private' || post.privacy === 'family')) {
      await this.assertUserCanAccessFamilyOrLinked(userId, post.familyCode);
    }

    const usersBlockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      post.createdBy,
    );
    if (usersBlockedEitherWay && post.createdBy !== userId) {
      throw new ForbiddenException('You cannot edit comment due to blocking');
    }

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
            userId: result.data.userId,
            firstName: userProfile.firstName,
            lastName: userProfile.lastName,
            profile: userProfile.profile
              ? `${process.env.S3_BUCKET_URL}/profile/${userProfile.profile}`
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
    const comment = await this.postCommentModel.findByPk(commentId);
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    const post = await this.postModel.findByPk(comment.postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.familyCode && (post.privacy === 'private' || post.privacy === 'family')) {
      await this.assertUserCanAccessFamilyOrLinked(userId, post.familyCode);
    }

    const usersBlockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      post.createdBy,
    );
    if (usersBlockedEitherWay && post.createdBy !== userId) {
      throw new ForbiddenException('You cannot delete comment due to blocking');
    }

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
    const post = await this.postModel.findByPk(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.familyCode && (post.privacy === 'private' || post.privacy === 'family')) {
      await this.assertUserCanAccessFamilyOrLinked(userId, post.familyCode);
    }

    const usersBlockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      userId,
      post.createdBy,
    );
    if (usersBlockedEitherWay && post.createdBy !== userId) {
      throw new ForbiddenException('You cannot comment due to blocking');
    }

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
            userId: result.data.userId,
            firstName: userProfile.firstName,
            lastName: userProfile.lastName,
            profile: userProfile.profile
              ? `${process.env.S3_BUCKET_URL}/profile/${userProfile.profile}`
              : null,
          }
        : null,
    };

    return formattedComment;
  }
}
