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

    // Check if user is the owner of the comment
    if (comment['userId'] !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    // Delete all replies first (cascade delete)
    await commentModel.destroy({
      where: { parentCommentId: commentId },
    });

    // Delete the comment
    await comment.destroy();

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
    // Verify parent comment exists
    const parentComment = await commentModel.findByPk(parentCommentId);

    if (!parentComment) {
      throw new NotFoundException('Parent comment not found');
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

    // Second pass: build the tree structure
    comments.forEach(comment => {
      if (comment.parentCommentId) {
        // This is a reply, add it to parent's replies array
        const parent = commentMap.get(comment.parentCommentId);
        if (parent) {
          parent.replies.push(commentMap.get(comment.id));
        }
      } else {
        // This is a root comment
        rootComments.push(commentMap.get(comment.id));
      }
    });

    return rootComments;
  }
}
