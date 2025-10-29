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
  namespace: '/events',
})
export class EventGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventGateway.name);
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

      this.logger.log(`Client ${client.id} connected to events for user ${userId}`);

      client.emit('connected', { 
        message: 'Connected to event service',
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
      
      this.logger.log(`Client ${client.id} disconnected from events for user ${userId}`);
    }
  }

  // Subscribe to specific event updates
  @SubscribeMessage('join-event')
  handleJoinEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: number },
  ) {
    const userId = client.data.userId;
    
    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    client.join(`event:${data.eventId}`);
    this.logger.log(`User ${userId} joined event room: ${data.eventId}`);
    
    return { 
      event: 'joined-event', 
      data: { eventId: data.eventId, message: 'Successfully joined event room' } 
    };
  }

  // Leave specific event room
  @SubscribeMessage('leave-event')
  handleLeaveEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: number },
  ) {
    client.leave(`event:${data.eventId}`);
    this.logger.log(`User ${client.data.userId} left event room: ${data.eventId}`);
    
    return { 
      event: 'left-event', 
      data: { eventId: data.eventId } 
    };
  }

  // Subscribe to family events calendar
  @SubscribeMessage('join-family-events')
  handleJoinFamilyEvents(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { familyCode: string },
  ) {
    const userId = client.data.userId;
    
    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    client.join(`family-events:${data.familyCode}`);
    this.logger.log(`User ${userId} joined family events: ${data.familyCode}`);
    
    return { 
      event: 'joined-family-events', 
      data: { familyCode: data.familyCode, message: 'Successfully joined family events' } 
    };
  }

  // Leave family events calendar
  @SubscribeMessage('leave-family-events')
  handleLeaveFamilyEvents(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { familyCode: string },
  ) {
    client.leave(`family-events:${data.familyCode}`);
    this.logger.log(`User ${client.data.userId} left family events: ${data.familyCode}`);
    
    return { 
      event: 'left-family-events', 
      data: { familyCode: data.familyCode } 
    };
  }

  // ============ Broadcast Methods ============

  // Broadcast new event to family
  broadcastNewEvent(familyCode: string, event: any) {
    this.logger.log(`Broadcasting new event to family: ${familyCode}`);
    this.server.to(`family-events:${familyCode}`).emit('new-event', {
      familyCode,
      event,
      timestamp: new Date().toISOString(),
    });
  }

  // Broadcast event update
  broadcastEventUpdate(eventId: number, event: any, familyCode?: string) {
    this.logger.log(`Broadcasting event update for event ${eventId}`);
    this.server.to(`event:${eventId}`).emit('event-updated', {
      eventId,
      event,
      timestamp: new Date().toISOString(),
    });

    // Also broadcast to family events if familyCode exists
    if (familyCode) {
      this.server.to(`family-events:${familyCode}`).emit('event-updated', {
        eventId,
        event,
        familyCode,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Broadcast event deletion
  broadcastEventDeleted(eventId: number, familyCode?: string) {
    this.logger.log(`Broadcasting event deletion for event ${eventId}`);
    this.server.to(`event:${eventId}`).emit('event-deleted', {
      eventId,
      timestamp: new Date().toISOString(),
    });

    // Also broadcast to family events if familyCode exists
    if (familyCode) {
      this.server.to(`family-events:${familyCode}`).emit('event-deleted', {
        eventId,
        familyCode,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Broadcast RSVP update
  broadcastRSVPUpdate(eventId: number, rsvp: any) {
    this.logger.log(`Broadcasting RSVP update for event ${eventId}`);
    this.server.to(`event:${eventId}`).emit('rsvp-updated', {
      eventId,
      rsvp,
      timestamp: new Date().toISOString(),
    });
  }

  // Broadcast event reminder
  broadcastEventReminder(eventId: number, familyCode: string, event: any) {
    this.logger.log(`Broadcasting event reminder for event ${eventId}`);
    this.server.to(`family-events:${familyCode}`).emit('event-reminder', {
      eventId,
      event,
      familyCode,
      timestamp: new Date().toISOString(),
    });
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
