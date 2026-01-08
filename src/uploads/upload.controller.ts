import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadService } from './upload.service';

class InitiateMultipartUploadDto {
  @IsString()
  fileName: string;

  @IsString()
  contentType: string;

  @IsOptional()
  @IsString()
  folder?: string;
}

class PresignPartQueryDto {
  @IsString()
  uploadId: string;

  @IsString()
  key: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber: number;
}

class ListPartsQueryDto {
  @IsString()
  uploadId: string;

  @IsString()
  key: string;
}

class CompletePartDto {
  @IsString()
  ETag: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  PartNumber: number;
}

class CompleteMultipartUploadDto {
  @IsString()
  uploadId: string;

  @IsString()
  key: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompletePartDto)
  parts: CompletePartDto[];
}

class AbortMultipartUploadDto {
  @IsString()
  uploadId: string;

  @IsString()
  key: string;
}

@ApiTags('Uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  private assertVideoMp4(fileName: string, contentType: string) {
    const lowerName = (fileName || '').toLowerCase();
    const lowerType = (contentType || '').toLowerCase();

    if (!lowerName.endsWith('.mp4')) {
      throw new BadRequestException('Only .mp4 files are allowed');
    }

    if (lowerType !== 'video/mp4') {
      throw new BadRequestException('Only video/mp4 content type is allowed');
    }
  }

  private normalizeFolder(folder?: string): string {
    const normalized = (folder || 'posts').trim();

    // For safety, only allow posts folder for now
    if (normalized !== 'posts') {
      throw new BadRequestException('Invalid folder');
    }

    return normalized;
  }

  @Post('multipart/initiate')
  async initiateMultipartUpload(@Body() dto: InitiateMultipartUploadDto) {
    this.assertVideoMp4(dto.fileName, dto.contentType);
    return this.uploadService.createMultipartUpload(
      dto.fileName,
      dto.contentType,
      this.normalizeFolder(dto.folder),
    );
  }

  @Get('multipart/presign-part')
  async presignPart(@Query() query: PresignPartQueryDto) {
    // Basic guard so clients can’t presign arbitrary keys
    if (!query.key || !query.key.startsWith('posts/')) {
      throw new BadRequestException('Invalid key');
    }
    return {
      url: await this.uploadService.getPresignedUploadPartUrl(
        query.key,
        query.uploadId,
        query.partNumber,
      ),
    };
  }

  @Get('multipart/list-parts')
  async listParts(@Query() query: ListPartsQueryDto) {
    if (!query.key || !query.key.startsWith('posts/')) {
      throw new BadRequestException('Invalid key');
    }
    return this.uploadService.listMultipartUploadParts(query.key, query.uploadId);
  }

  @Post('multipart/complete')
  async completeMultipartUpload(@Body() dto: CompleteMultipartUploadDto) {
    if (!dto.key || !dto.key.startsWith('posts/')) {
      throw new BadRequestException('Invalid key');
    }
    return this.uploadService.completeMultipartUpload(dto.key, dto.uploadId, dto.parts);
  }

  @Post('multipart/abort')
  async abortMultipartUpload(@Body() dto: AbortMultipartUploadDto) {
    if (!dto.key || !dto.key.startsWith('posts/')) {
      throw new BadRequestException('Invalid key');
    }
    return this.uploadService.abortMultipartUpload(dto.key, dto.uploadId);
  }
}
