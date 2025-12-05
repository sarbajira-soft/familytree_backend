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
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';



const allowedNotificationOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

@WebSocketGateway({
  cors: {
    origin:
      allowedNotificationOrigins.length > 0
        ? allowedNotificationOrigins
        : false, // Configure this properly in production
    credentials: true,
  },
  namespace: '/notifications',
})
// @WebSocketGateway({
//   cors: {
//     origin: '*', // Configure this properly in production
//     credentials: true,
//   },
//   namespace: '/notifications',
// })
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds

  constructor(private jwtService: JwtService) {
    // this.logger.log(
    //   `NotificationGateway using secret: ${process.env.JWT_SECRET}`,
    // );
  }

  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake

      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.split(' ')[1];
      if (!token) {
        this.logger.warn(
          `Client ${client.id} attempted to connect without token`,
        );
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = await this.jwtService.verifyAsync(token);
      this.logger.log(`Verified token payload: ${JSON.stringify(payload)}`);
      const userId = payload.id || payload.sub || payload.userId;

      if (!userId) {
        this.logger.warn(`Client ${client.id} has invalid token payload`);
        client.disconnect();
        return;
      }

      // Store user-socket mapping
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId).add(client.id);

      // Store userId in socket data for later use
      client.data.userId = userId;

      // Join user-specific room
      client.join(`user:${userId}`);

      this.logger.log(`Client ${client.id} connected for user ${userId}`);
      this.logger.log(
        `Total connections for user ${userId}: ${
          this.userSockets.get(userId).size
        }`,
      );

      // Send connection confirmation
      client.emit('connected', {
        message: 'Connected to notification service',
        userId,
      });
    } catch (error) {
      this.logger.error(
        `Connection error for client ${client.id}:`,
        error.message,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;

    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId).delete(client.id);

      // Clean up empty sets
      if (this.userSockets.get(userId).size === 0) {
        this.userSockets.delete(userId);
      }

      this.logger.log(`Client ${client.id} disconnected for user ${userId}`);
    } else {
      this.logger.log(`Client ${client.id} disconnected (no user association)`);
    }
  }

  @SubscribeMessage('subscribe-notifications')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const userId = client.data.userId;

    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    client.join(`user:${userId}`);
    this.logger.log(`User ${userId} subscribed to notifications`);

    return {
      event: 'subscribed',
      data: { message: 'Successfully subscribed to notifications' },
    };
  }

  @SubscribeMessage('unsubscribe-notifications')
  handleUnsubscribe(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;

    if (userId) {
      client.leave(`user:${userId}`);
      this.logger.log(`User ${userId} unsubscribed from notifications`);
    }

    return {
      event: 'unsubscribed',
      data: { message: 'Successfully unsubscribed from notifications' },
    };
  }

  // Method to send notification to specific user
  sendNotificationToUser(userId: string, notification: any) {
    this.logger.log(
      `Sending notification to user ${userId}:`,
      notification.type,
    );
    this.server.to(`user:${userId}`).emit('notification', notification);
  }

  // Method to send notification to multiple users
  sendNotificationToUsers(userIds: string[], notification: any) {
    userIds.forEach((userId) => {
      this.sendNotificationToUser(userId, notification);
    });
  }

  // Method to send post-like event to a specific user
  sendPostLikeEvent(userId: string | number, data: any) {
    this.logger.log(`Sending post-like event to user ${userId}`);
    this.server.to(`user:${userId}`).emit('post-like', data);
  }

  // Method to update unread count for user
  updateUnreadCount(userId: string, count: number) {
    this.logger.log(`Updating unread count for user ${userId}: ${count}`);
    this.server.to(`user:${userId}`).emit('unread-count-update', { count });
  }

  // Method to notify notification status change
  notifyNotificationUpdate(
    userId: string,
    notificationId: string,
    status: string,
  ) {
    this.logger.log(
      `Notifying user ${userId} of notification ${notificationId} status: ${status}`,
    );
    this.server.to(`user:${userId}`).emit('notification-updated', {
      notificationId,
      status,
    });
  }

  // Get connected users count
  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  // Check if user is connected
  isUserConnected(userId: string): boolean {
    return (
      this.userSockets.has(userId) && this.userSockets.get(userId).size > 0
    );
  }

  // Get all connected socket IDs for a user
  getUserSockets(userId: string): string[] {
    return this.userSockets.has(userId)
      ? Array.from(this.userSockets.get(userId))
      : [];
  }
}
