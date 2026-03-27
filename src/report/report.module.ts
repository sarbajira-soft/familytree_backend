import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { ContentReport } from './model/content-report.model';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

import { Post } from '../post/model/post.model';
import { Gallery } from '../gallery/model/gallery.model';
import { Event } from '../event/model/event.model';

@Module({
  imports: [SequelizeModule.forFeature([ContentReport, Post, Gallery, Event])],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
