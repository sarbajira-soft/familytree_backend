import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * Base service for comment operations with reusable logic
 * Supports edit, delete, and reply functionality
 */
export class BaseCommentService {
  /**
   * Edit a comment - only owner can edit
   * @param commentModel The comment model (PostComment or GalleryComment)
   * @param commentId Comment ID to edit
   * @param userId User ID making the request
   * @param newCommentText New comment text
   * @param commentField Field name for comment text ('comment' or 'comments')
   */
  async editComment(
    commentModel: any,
    commentId: number,
    userId: number,
    newCommentText: string,
    commentField: string = 'comment',
  ): Promise<any> {
    const comment = await commentModel.findByPk(commentId);

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment['deletedAt']) {
      throw new NotFoundException('Comment not found');
    }

    // Check if user is the owner of the comment
    if (comment['userId'] !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    // Update the comment
    await comment.update({ [commentField]: newCommentText });

    return {
      success: true,
      message: 'Comment updated successfully',
      data: comment,
    };
  }

  /**
   * Delete a comment - only owner can delete
   * @param commentModel The comment model (PostComment or GalleryComment)
   * @param commentId Comment ID to delete
   * @param userId User ID making the request
   */
  async deleteComment(
    commentModel: any,
    commentId: number,
    userId: number,
  ): Promise<any> {
    const comment = await commentModel.findByPk(commentId);

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment['deletedAt']) {
      return {
        success: true,
        message: 'Comment already deleted',
      };
    }

    // Check if user is the owner of the comment
    if (comment['userId'] !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    const now = new Date();

    // Soft delete all replies first (cascade through all descendants)
    const replyIdsToDelete: number[] = [];
    const toVisit: number[] = [commentId];
    while (toVisit.length > 0) {
      const parentIds = toVisit.splice(0, toVisit.length);
      const children = await commentModel.findAll({
        where: { parentCommentId: parentIds, deletedAt: null },
        attributes: ['id'],
      });
      const childIds = (children || [])
        .map((row) => Number(row?.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (childIds.length === 0) {
        continue;
      }
      replyIdsToDelete.push(...childIds);
      toVisit.push(...childIds);
    }

    if (replyIdsToDelete.length > 0) {
      await commentModel.update(
        { deletedAt: now, deletedByUserId: userId, deletedByAdminId: null },
        { where: { id: replyIdsToDelete, deletedAt: null } },
      );
    }

    // Soft delete the comment
    await comment.update({ deletedAt: now, deletedByUserId: userId, deletedByAdminId: null });

    return {
      success: true,
      message: 'Comment and its replies deleted successfully',
    };
  }

  /**
   * Add a reply to a comment
   * @param commentModel The comment model (PostComment or GalleryComment)
   * @param parentCommentId Parent comment ID
   * @param userId User ID making the reply
   * @param replyText Reply text
   * @param additionalData Additional data like postId or galleryId
   * @param commentField Field name for comment text ('comment' or 'comments')
   */
  async replyToComment(
    commentModel: any,
    parentCommentId: number,
    userId: number,
    replyText: string,
    additionalData: any,
    commentField: string = 'comment',
  ): Promise<any> {
    // Verify parent comment exists and normalize parentCommentId to the root comment.
    let parentComment = await commentModel.findByPk(parentCommentId);

    if (!parentComment) {
      throw new NotFoundException('Parent comment not found');
    }

    if (parentComment['deletedAt']) {
      throw new NotFoundException('Parent comment not found');
    }

    // Enforce one-level replies: if replying to a reply, attach to the root comment.
    while (parentComment && parentComment['parentCommentId']) {
      const rootCandidateId = Number(parentComment['parentCommentId']);
      if (!Number.isFinite(rootCandidateId) || rootCandidateId <= 0) {
        break;
      }
      const rootCandidate = await commentModel.findByPk(rootCandidateId);
      if (!rootCandidate || rootCandidate['deletedAt']) {
        break;
      }
      parentCommentId = rootCandidateId;
      parentComment = rootCandidate;
    }

    // Create the reply
    const reply = await commentModel.create({
      ...additionalData,
      userId,
      [commentField]: replyText,
      parentCommentId,
    });

    return {
      success: true,
      message: 'Reply added successfully',
      data: reply,
    };
  }

  /**
   * Get comments with nested replies
   * @param comments Array of comments
   * @param commentField Field name for comment text ('comment' or 'comments')
   */
  buildCommentTree(comments: any[], commentField: string = 'comment'): any[] {
    const commentMap = new Map();
    const rootComments = [];

    // First pass: create a map of all comments
    comments.forEach(comment => {
      commentMap.set(comment.id, {
        ...comment,
        replies: [],
      });
    });

    const rootCache = new Map<number, number>();
    const getRootId = (commentId: number): number => {
      if (!Number.isFinite(commentId) || commentId <= 0) return commentId;
      if (rootCache.has(commentId)) return rootCache.get(commentId);

      const node = commentMap.get(commentId);
      const parentId = Number(node?.parentCommentId);
      if (!parentId) {
        rootCache.set(commentId, commentId);
        return commentId;
      }
      const root = getRootId(parentId);
      rootCache.set(commentId, root);
      return root;
    };

    // Second pass: build a flat (one-level) reply structure
    comments.forEach(comment => {
      const node = commentMap.get(comment.id);
      if (!node) return;

      if (comment.parentCommentId) {
        const rootId = getRootId(Number(comment.id));
        const root = commentMap.get(rootId);
        if (root && rootId !== Number(comment.id)) {
          root.replies.push(node);
        } else {
          rootComments.push(node);
        }
      } else {
        rootComments.push(node);
      }
    });

    return rootComments;
  }
}
