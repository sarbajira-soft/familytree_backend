import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UserService } from './user.service';

@Injectable()
export class UserAccountCleanupService implements OnModuleInit, OnModuleDestroy {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private readonly userService: UserService) {}

  onModuleInit() {
    this.userService.purgeExpiredDeletedUsers(50).catch((error) => {
      console.error('Initial account purge failed:', error?.message || error);
    });

    // Every 10 minutes: purge accounts past the 30-day recovery window.
    this.intervalHandle = setInterval(async () => {
      if (this.isRunning) {
        return;
      }

      this.isRunning = true;
      try {
        await this.userService.purgeExpiredDeletedUsers(50);
      } catch (error) {
        console.error('Account purge worker failed:', error?.message || error);
      } finally {
        this.isRunning = false;
      }
    }, 10 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
