import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/posts',
})
export class PostGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PostGateway.name);
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        this.logger.warn(`Client ${client.id} attempted to connect without token`);
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token);
      const userId = payload.sub || payload.userId;

      if (!userId) {
        this.logger.warn(`Client ${client.id} has invalid token payload`);
        client.disconnect();
        return;
      }

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId).add(client.id);

      client.data.userId = userId;
      client.join(`user:${userId}`);

      this.logger.log(`Client ${client.id} connected to posts for user ${userId}`);

      client.emit('connected', { 
        message: 'Connected to post service',
        userId 
      });

    } catch (error) {
      this.logger.error(`Connection error for client ${client.id}:`, error.message);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    
    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId).delete(client.id);
      
      if (this.userSockets.get(userId).size === 0) {
        this.userSockets.delete(userId);
      }
      
      this.logger.log(`Client ${client.id} disconnected from posts for user ${userId}`);
    }
  }

  // Subscribe to specific post updates
  @SubscribeMessage('join-post')
  handleJoinPost(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: number },
  ) {
    const userId = client.data.userId;
    
    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    client.join(`post:${data.postId}`);
    this.logger.log(`User ${userId} joined post room: ${data.postId}`);
    
    return { 
      event: 'joined-post', 
      data: { postId: data.postId, message: 'Successfully joined post room' } 
    };
  }

  // Leave specific post room
  @SubscribeMessage('leave-post')
  handleLeavePost(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: number },
  ) {
    client.leave(`post:${data.postId}`);
    this.logger.log(`User ${client.data.userId} left post room: ${data.postId}`);
    
    return { 
      event: 'left-post', 
      data: { postId: data.postId } 
    };
  }

  // Subscribe to family feed
  @SubscribeMessage('join-family-feed')
  handleJoinFamilyFeed(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { familyCode: string },
  ) {
    const userId = client.data.userId;
    
    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    client.join(`family:${data.familyCode}`);
    this.logger.log(`User ${userId} joined family feed: ${data.familyCode}`);
    
    return { 
      event: 'joined-family-feed', 
      data: { familyCode: data.familyCode, message: 'Successfully joined family feed' } 
    };
  }

  // Leave family feed
  @SubscribeMessage('leave-family-feed')
  handleLeaveFamilyFeed(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { familyCode: string },
  ) {
    client.leave(`family:${data.familyCode}`);
    this.logger.log(`User ${client.data.userId} left family feed: ${data.familyCode}`);
    
    return { 
      event: 'left-family-feed', 
      data: { familyCode: data.familyCode } 
    };
  }

  // ============ Broadcast Methods ============

  // Broadcast new like to all users viewing the post
  broadcastLike(postId: number, userId: number, likeCount: number, isLiked: boolean, userName?: string) {
    this.logger.log(`Broadcasting like update for post ${postId}: ${isLiked ? 'liked' : 'unliked'} by user ${userId}`);
    this.server.to(`post:${postId}`).emit('post-liked', {
      postId,
      userId,
      userName,
      likeCount,
      isLiked,
      timestamp: new Date().toISOString(),
    });
  }

  // Broadcast new comment to all users viewing the post
  broadcastComment(postId: number, comment: any) {
    this.logger.log(`Broadcasting new comment for post ${postId}`);
    this.server.to(`post:${postId}`).emit('new-comment', {
      postId,
      comment,
      timestamp: new Date().toISOString(),
    });
  }

  // Broadcast comment deletion
  broadcastCommentDeleted(postId: number, commentId: number) {
    this.logger.log(`Broadcasting comment deletion for post ${postId}, comment ${commentId}`);
    this.server.to(`post:${postId}`).emit('comment-deleted', {
      postId,
      commentId,
      timestamp: new Date().toISOString(),
    });
  }

  // Broadcast new post to family feed
  broadcastNewPost(familyCode: string, post: any) {
    this.logger.log(`Broadcasting new post to family feed: ${familyCode}`);
    this.server.to(`family:${familyCode}`).emit('new-post', {
      familyCode,
      post,
      timestamp: new Date().toISOString(),
    });
  }

  // Broadcast post update
  broadcastPostUpdate(postId: number, post: any) {
    this.logger.log(`Broadcasting post update for post ${postId}`);
    this.server.to(`post:${postId}`).emit('post-updated', {
      postId,
      post,
      timestamp: new Date().toISOString(),
    });
  }

  // Broadcast post deletion
  broadcastPostDeleted(postId: number, familyCode?: string) {
    this.logger.log(`Broadcasting post deletion for post ${postId}`);
    this.server.to(`post:${postId}`).emit('post-deleted', {
      postId,
      timestamp: new Date().toISOString(),
    });

    // Also broadcast to family feed if familyCode exists
    if (familyCode) {
      this.server.to(`family:${familyCode}`).emit('post-deleted', {
        postId,
        familyCode,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Get connected users count
  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  // Check if user is connected
  isUserConnected(userId: string): boolean {
    return this.userSockets.has(userId) && this.userSockets.get(userId).size > 0;
  }
}
