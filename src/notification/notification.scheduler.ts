import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationScheduler {
  private readonly logger = new Logger(NotificationScheduler.name);

  constructor(
    private notificationService: NotificationService,
    private schedulerRegistry: SchedulerRegistry,
  ) {
    // this.addCronJob(); // Cron functionality commented out per requirement
  }

  // addCronJob() {
  //   // Cron job implementation remains commented out
  // }
}
