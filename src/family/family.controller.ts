import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BlockingService } from '../blocking/blocking.service';
import { FamilyLinkService } from '../notification/family-link.service';
import { NotificationService } from '../notification/notification.service';
import { UploadService } from '../uploads/upload.service';
import { imageFileFilter } from '../utils/upload.utils';
import { CreateFamilyDto } from './dto/create-family.dto';
import { FamilyService } from './family.service';

@ApiTags('Family')
@Controller('family')
export class FamilyController {
  constructor(
    private readonly familyService: FamilyService,
    private readonly uploadService: UploadService,
    private readonly notificationService: NotificationService,
    private readonly blockingService: BlockingService,
    private readonly familyLinkService: FamilyLinkService,
  ) { }

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @UseInterceptors(FileInterceptor('familyPhoto', {
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new family' })
  @ApiResponse({ status: 201, description: 'Family created successfully' })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateFamilyDto,
  ) {
    const loggedInUser = req.user;

    if (file) {
      // Upload to S3 and get the file path
      body.familyPhoto = await this.uploadService.uploadFile(file, 'family');
    }

    return this.familyService.createFamily(body, loggedInUser.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all families' })
  @ApiResponse({ status: 200, description: 'List of families' })
  getAll() {
    return this.familyService.getAll();
  }

  @Get('code/:familyCode')
  @ApiOperation({ summary: 'Get family by code' })
  @ApiResponse({ status: 200, description: 'Family found' })
  getByCode(@Param('familyCode') familyCode: string) {
    return this.familyService.getByCode(familyCode);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  @UseInterceptors(FileInterceptor('familyPhoto', {
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update family by ID' })
  async update(
    @Req() req,
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateFamilyDto
  ) {
    const loggedInUser = req.user;
    let fileName: string | undefined;

    if (file) {
      // Upload to S3 and get the file path
      fileName = await this.uploadService.uploadFile(file, 'family');
      body.familyPhoto = fileName;
    }

    return this.familyService.update(id, body, fileName, loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete family by ID (admin only)' })
  async delete(@Param('id') id: number, @Req() req) {
    const userId = req.user.userId;
    return this.familyService.delete(id, userId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search families by code or name (autocomplete)' })
  async searchFamilies(@Query('query') query: string) {
    if (!query || query.length < 4) {
      return [];
    }
    return this.familyService.searchFamilies(query);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tree/create')
  @UseInterceptors(AnyFilesInterceptor({
    storage: memoryStorage(),
    fileFilter: imageFileFilter,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or update family tree (removes existing data and creates new)' })
  @ApiResponse({ status: 201, description: 'Family tree created/updated successfully' })
  @HttpCode(HttpStatus.CREATED)
  async createFamilyTree(
    @Req() req,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Body() body: any // all form fields
  ) {
    // Parse person_count
    const personCount = parseInt(body.person_count, 10);
    if (isNaN(personCount) || personCount < 1) {
      throw new BadRequestException('Invalid or missing person_count');
    }

    // Upload all received images to S3 first (multer memoryStorage provides file.buffer; file.filename is undefined)
    const uploadedImageMap: Record<string, string> = {};
    if (Array.isArray(files) && files.length > 0) {
      await Promise.all(
        files.map(async (file) => {
          if (!file?.fieldname) return;
          const uploadedFileName = await this.uploadService.uploadFile(
            file,
            'profile',
          );
          uploadedImageMap[file.fieldname] = uploadedFileName;
        }),
      );
    }

    // Build people array
    const people = [];
    for (let i = 0; i < personCount; i++) {
      const prefix = `person_${i}_`;
      const person: any = {};
      // List of possible fields
      const fields = [
        'id', 'name', 'gender', 'age', 'generation', 'birthOrder', 'memberId',
        'parents', 'children', 'spouses', 'siblings', 'img', 'lifeStatus',
        'nodeUid', 'isExternalLinked', 'canonicalFamilyCode', 'canonicalNodeUid'
      ];
      for (const field of fields) {
        const key = prefix + field;
        if (field === 'img') {
          // Handle newly uploaded file or keep existing reference from payload.
          // If omitted, leave as undefined to preserve existing profile image.
          if (uploadedImageMap[key]) {
            person.img = uploadedImageMap[key];
          } else if (body[key]) {
            person.img = body[key];
          }
        } else {
          person[field] = body[key] !== undefined ? body[key] : null;
        }
      }

      // Add relationshipCode from payload
      person.relationshipCode = body[`${prefix}relationshipCode`] || '';
      // Optionally, split comma-separated fields into arrays
      ['parents', 'children', 'spouses', 'siblings'].forEach(rel => {
        if (typeof person[rel] === 'string' && person[rel]) {
          person[rel] = person[rel].split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0);
        } else {
          person[rel] = [];
        }
      });
      // Convert numeric fields
      ['id', 'age', 'generation', 'birthOrder', 'memberId'].forEach(numField => {
        if (person[numField] !== null && person[numField] !== undefined && person[numField] !== '') {
          person[numField] = isNaN(Number(person[numField])) ? person[numField] : Number(person[numField]);
        } else {
          person[numField] = null;
        }
      });

      // Convert boolean fields
      if (person.isExternalLinked !== null && person.isExternalLinked !== undefined && person.isExternalLinked !== '') {
        const raw = String(person.isExternalLinked).trim().toLowerCase();
        person.isExternalLinked = raw === 'true' || raw === '1' || raw === 'yes';
      } else {
        person.isExternalLinked = false;
      }
      people.push(person);
    }

    // Attach updated people to dto/body
    body.members = people;
    // Optionally, remove all person_* fields from body
    Object.keys(body).forEach(key => {
      if (/^person_\d+_/.test(key) || key === 'person_count') {
        delete body[key];
      }
    });
    // familyCode should be present in body
    const loggedInUser = req.user;
    return this.familyService.createFamilyTree(body, loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('tree/:familyCode')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get family tree by family code' })
  @ApiResponse({ status: 200, description: 'Family tree retrieved successfully' })
  async getFamilyTree(@Param('familyCode') familyCode: string, @Req() req) {
    const userId = Number(req.user?.userId || req.user?.id);
    const response = await this.familyService.getFamilyTree(familyCode, userId);

    // BLOCK OVERRIDE: Injected new blockStatus contract into family tree people payload.
    const people = await Promise.all(
      (response?.people || []).map(async (person: any) => {
        // BLOCK OVERRIDE: Prefer canonical userId when both userId/memberId exist.
        const otherUserId = Number(person?.userId || person?.memberId);
        if (!otherUserId || Number(otherUserId) === Number(userId)) {
          return {
            ...person,
            blockStatus: { isBlockedByMe: false, isBlockedByThem: false },
          };
        }

        const blockStatus = await this.blockingService.getBlockStatus(
          userId,
          otherUserId,
        );
        return { ...person, blockStatus };
      }),
    );

    return { ...response, people };
  }

  @UseGuards(JwtAuthGuard)
  @Get('linked-families')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get linked families for the logged-in user (Link Family Tree)' })
  async getLinkedFamilies(@Req() req) {
    const userId = req.user?.userId;
    return this.familyService.getLinkedFamiliesForCurrentUser(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('user/:userId/associated-prefixes')
  @ApiOperation({ summary: 'Get associated family prefixes (spouse-connected)' })
  @ApiResponse({ status: 200, description: 'Associated family prefixes retrieved successfully' })
  async getAssociatedFamilyPrefixes(@Param('userId', ParseIntPipe) userId: number) {
    return this.familyService.getAssociatedFamilyPrefixes(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('user/:userId/families')
  async getUserFamilyCodes(@Param('userId') userId: number) {
    return this.familyService.getUserFamilyCodes(userId);
  }

  @Get('user/:userId/relationships')
  @ApiOperation({ summary: 'Get all relationships for a user' })
  @ApiResponse({ status: 200, description: 'User relationships retrieved successfully' })
  async getUserRelationships(@Param('userId') userId: number) {
    return this.familyService.getUserRelationships(userId);
  }

  @Get('associated/:familyCode')
  @ApiOperation({ summary: 'Get associated family tree by family code (legacy - redirects to userId-based method)' })
  @ApiResponse({ status: 200, description: 'Associated family tree retrieved successfully' })
  async getAssociatedFamilyTree(@Param('familyCode') familyCode: string) {
    return this.familyService.getAssociatedFamilyTree(familyCode);
  }

  @Get('associated-by-user/:userId')
  @ApiOperation({ summary: 'Get associated family tree by userId - traverses all connected family codes' })
  @ApiResponse({ status: 200, description: 'Associated family tree retrieved successfully' })
  async getAssociatedFamilyTreeByUserId(@Param('userId', ParseIntPipe) userId: number) {
    return this.familyService.getAssociatedFamilyTreeByUserId(userId);
  }

  @Post('sync-person/:userId')
  @ApiOperation({ summary: 'Sync person data across all family trees they appear in' })
  @ApiResponse({ status: 200, description: 'Person data synced successfully' })
  async syncPersonAcrossAllTrees(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() updates: any
  ) {
    return this.familyService.syncPersonAcrossAllTrees(userId, updates);
  }

  @Post('create-manual-tree/:userId')
  @ApiOperation({ summary: 'Create manual associated tree for a user' })
  @ApiResponse({ status: 201, description: 'Manual associated tree created successfully' })
  async createManualAssociatedTree(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() data: { familyCode: string; basicInfo: any }
  ) {
    return this.familyService.createManualAssociatedTree(userId, data.familyCode, data.basicInfo);
  }

  @Post('replace-manual-tree')
  @ApiOperation({ summary: 'Replace manual tree with auto-generated complete tree' })
  @ApiResponse({ status: 200, description: 'Manual tree replaced successfully' })
  async replaceManualTreeWithComplete(
    @Body() data: { oldFamilyCode: string; newCompleteTreeData: any }
  ) {
    return this.familyService.replaceManualTreeWithComplete(data.oldFamilyCode, data.newCompleteTreeData);
  }

  @UseGuards(JwtAuthGuard)
  @Post('user/:userId/add-spouse')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add spouse relationship and update associated family codes' })
  @ApiResponse({ status: 201, description: 'Spouse relationship created and associated codes updated' })
  async addSpouseRelationship(
    @Param('userId') userId: number,
    @Body('spouseUserId') spouseUserId: number
  ) {
    const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      Number(userId),
      Number(spouseUserId),
    );
    if (blockedEitherWay) {
      throw new ForbiddenException('Not allowed');
    }

    return this.familyService.addSpouseRelationship(userId, spouseUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('request-association')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request association between families (sends a notification to target user)' })
  @ApiResponse({ status: 201, description: 'Association request notification sent' })
  async requestAssociation(
    @Req() req,
    @Body() body: { targetUserId: number; requesterUserId?: number; familyCode?: string }
  ) {
    const loggedInUserId: number = req.user?.userId;
    const targetUserId: number = Number(body?.targetUserId);
    // Use the specific card's userId if provided, otherwise fall back to logged-in user
    const requesterId: number = body?.requesterUserId ? Number(body.requesterUserId) : loggedInUserId;

    if (!requesterId || !targetUserId) {
      throw new BadRequestException('Missing requesterId or targetUserId');
    }

    if (Number(requesterId) === Number(targetUserId)) {
      throw new BadRequestException('You cannot send an association request to yourself');
    }

    // Hard rule: if either user has blocked the other, no association requests can be sent (no admin bypass).
    const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
      requesterId,
      targetUserId,
    );
    if (blockedEitherWay) {
      throw new ForbiddenException('Not allowed');
    }

    // Get requester's family code from user profile instead of relying on token or body
    const requesterProfile = await this.familyService.getFamilyByUserId(requesterId);
    if (!requesterProfile || !requesterProfile.familyCode) {
      throw new BadRequestException('Requester must have a family code to send association request');
    }

    // Track who initiated the request (may differ from requesterId when acting on behalf of a member)
    const initiatorProfile = loggedInUserId
      ? await this.familyService.getFamilyByUserId(loggedInUserId)
      : null;

    // Get target user's family code for the notification
    const targetProfile = await this.familyService.getFamilyByUserId(targetUserId);
    if (!targetProfile || !targetProfile.familyCode) {
      throw new BadRequestException('Target user must have a family code to receive association request');
    }

    // Prevent duplicates: if there's already a pending request between these users (either direction), re-use it.
    const existingPending =
      await this.notificationService.findPendingAssociationRequestBetweenUsers({
        userA: requesterId,
        userB: targetUserId,
        familyA: requesterProfile.familyCode,
        familyB: targetProfile.familyCode,
      } as any);

    if (existingPending) {
      return {
        message: 'Association request already pending',
        notificationId: existingPending.id,
        requestId: existingPending.referenceId || existingPending.id,
      };
    }

    // Get requester's name for better notification message
    const requesterName = await this.familyService.getUserName(requesterId);

    // Also notify admins of the target family
    const adminUserIds = await this.notificationService.getAdminsForFamily(targetProfile.familyCode);
    const recipientIds = Array.from(new Set([targetUserId, ...adminUserIds]));

    const dto = {
      type: 'FAMILY_ASSOCIATION_REQUEST',
      title: 'Family Association Request',
      message: `${requesterName} wants to connect families. Admins have been notified.`,
      familyCode: targetProfile.familyCode,
      referenceId: requesterId, // Use requesterId as reference
      data: {
        senderId: requesterId,
        senderName: requesterName,
        senderFamilyCode: requesterProfile.familyCode,
        initiatorUserId: loggedInUserId,
        initiatorFamilyCode: initiatorProfile?.familyCode || requesterProfile.familyCode,
        targetUserId: targetUserId,
        targetFamilyCode: targetProfile.familyCode,
        adminUserIds,
        requestType: 'family_association'
      },
      userIds: recipientIds,
    } as const;

    const result = await this.notificationService.createNotification(dto as any, requesterId);
    return { message: 'Association request sent', ...result };
  }

  @UseGuards(JwtAuthGuard)
  @Post('cleanup-userid-data')
  @ApiOperation({ summary: 'Clean up invalid userId data in database' })
  @ApiResponse({ status: 200, description: 'Data cleanup completed' })
  async cleanupUserIdData() {
    const cleanedCount = await this.familyService.cleanupInvalidUserIdData();
    return {
      message: 'Data cleanup completed successfully',
      cleanedRecords: cleanedCount
    };
  }


  // --- Association request responses (proxy endpoints) ---
  @UseGuards(JwtAuthGuard)
  @Post('accept-association')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept a family association request' })
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ status: 200, description: 'Successfully accepted the association request' })
  @ApiResponse({ status: 400, description: 'Invalid request or missing parameters' })
  @ApiResponse({ status: 403, description: 'Not authorized to accept this request' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async acceptAssociation(
    @Req() req,
    @Body() body: { requestId: number }
  ) {
    const userId: number = req.user?.userId;
    const requestId = Number(body?.requestId);

    if (!userId) {
      throw new ForbiddenException('Unauthorized: missing user context');
    }
    if (!requestId || Number.isNaN(requestId) || requestId <= 0) {
      throw new BadRequestException('requestId is required and must be a positive number');
    }

    try {
      const result = await this.notificationService.respondToNotification(
        requestId,
        'accept',
        userId
      );

      return {
        success: true,
        message: 'Association request accepted successfully',
        data: result
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('acceptAssociation error:', { userId, requestId, error });
      if (error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to process association request');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('reject-association')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a family association request' })
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ status: 200, description: 'Successfully rejected the association request' })
  @ApiResponse({ status: 400, description: 'Invalid request or missing parameters' })
  @ApiResponse({ status: 403, description: 'Not authorized to reject this request' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async rejectAssociation(
    @Req() req,
    @Body() body: { requestId: number }
  ) {
    const userId: number = req.user?.userId;
    const requestId = Number(body?.requestId);

    if (!userId) {
      throw new ForbiddenException('Unauthorized: missing user context');
    }
    if (!requestId || Number.isNaN(requestId) || requestId <= 0) {
      throw new BadRequestException('requestId is required and must be a positive number');
    }

    try {
      const result = await this.notificationService.respondToNotification(
        requestId,
        'reject',
        userId
      );

      return {
        success: true,
        message: 'Association request rejected successfully',
        data: result
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('rejectAssociation error:', { userId, requestId, error });
      if (error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to process association rejection');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('request-tree-link')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request a cross-family tree link by nodeUid (parent/child/sibling)' })
  @HttpCode(HttpStatus.CREATED)
  async requestTreeLink(
    @Req() req,
    @Body()
    body: {
      senderNodeUid: string;
      receiverFamilyCode: string;
      receiverNodeUid: string;
      relationshipType: 'parent' | 'child' | 'sibling';
      parentRole?: 'father' | 'mother';
    },
  ) {
    const requesterUserId: number = req.user?.userId;
    const senderNodeUid = String(body?.senderNodeUid || '').trim();
    const receiverFamilyCode = String(body?.receiverFamilyCode || '').trim();
    const receiverNodeUid = String(body?.receiverNodeUid || '').trim();
    const relationshipType = body?.relationshipType;
    const parentRole = body?.parentRole;

    if (!requesterUserId) {
      throw new ForbiddenException('Unauthorized: missing user context');
    }
    if (!senderNodeUid || !receiverFamilyCode || !receiverNodeUid || !relationshipType) {
      throw new BadRequestException('Missing senderNodeUid, receiverFamilyCode, receiverNodeUid, or relationshipType');
    }

    return this.familyLinkService.createTreeLinkRequestNotification({
      requesterUserId,
      senderNodeUid,
      receiverFamilyCode,
      receiverNodeUid,
      relationshipType,
      parentRole,
    } as any);
  }

  @UseGuards(JwtAuthGuard)
  @Get('tree-link-requests/sent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List pending tree link requests created by the logged-in user' })
  @ApiResponse({ status: 200, description: 'Pending tree link requests returned' })
  async listSentTreeLinkRequests(@Req() req) {
    const actingUserId: number = req.user?.userId;
    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized: missing user context');
    }

    return this.familyLinkService.getPendingTreeLinkRequestsForUser(actingUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('revoke-tree-link-request')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke (cancel) a pending tree link request (admin/creator only)' })
  @HttpCode(HttpStatus.OK)
  async revokeTreeLinkRequest(
    @Req() req,
    @Body() body: { treeLinkRequestId: number },
  ) {
    const actingUserId: number = req.user?.userId;
    const treeLinkRequestId = Number(body?.treeLinkRequestId);

    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized: missing user context');
    }
    if (!treeLinkRequestId || Number.isNaN(treeLinkRequestId) || treeLinkRequestId <= 0) {
      throw new BadRequestException('treeLinkRequestId is required and must be a positive number');
    }

    return this.familyLinkService.revokeTreeLinkRequest(treeLinkRequestId, actingUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('unlink-tree-link')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlink (remove) an external-linked card from this family tree' })
  @HttpCode(HttpStatus.OK)
  async unlinkTreeLink(
    @Req() req,
    @Body()
    body: {
      familyCode: string;
      nodeUid: string;
    },
  ) {
    const actingUserId: number = req.user?.userId;
    const familyCode = String(body?.familyCode || '').trim();
    const nodeUid = String(body?.nodeUid || '').trim();

    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized: missing user context');
    }
    if (!familyCode || !nodeUid) {
      throw new BadRequestException('familyCode and nodeUid are required');
    }

    return this.familyService.unlinkTreeLinkExternalCard({
      actingUserId,
      familyCode,
      nodeUid,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('tree/repair')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Repair/normalize a family tree (admin only)' })
  @HttpCode(HttpStatus.OK)
  async repairTree(
    @Req() req,
    @Body()
    body: {
      familyCode: string;
      fixExternalGenerations?: boolean;
    },
  ) {
    const actingUserId: number = req.user?.userId;
    const familyCode = String(body?.familyCode || '').trim();
    const fixExternalGenerations = body?.fixExternalGenerations;

    return this.familyService.repairFamilyTree({
      actingUserId,
      familyCode,
      fixExternalGenerations,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('unlink-linked-family')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlink (remove) a linked-family connection' })
  @HttpCode(HttpStatus.OK)
  async unlinkLinkedFamily(
    @Req() req,
    @Body()
    body: {
      otherFamilyCode: string;
    },
  ) {
    const actingUserId: number = req.user?.userId;
    const otherFamilyCode = String(body?.otherFamilyCode || '').trim();

    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized: missing user context');
    }
    if (!otherFamilyCode) {
      throw new BadRequestException('otherFamilyCode is required');
    }

    return this.familyService.unlinkLinkedFamily({
      actingUserId,
      otherFamilyCode,
    });
  }

  // ==================== NEW ASSOCIATION ENDPOINTS (TODO: Implement service methods) ====================

  // TODO: Implement these endpoints after creating the service methods
  // @UseGuards(JwtAuthGuard)
  // @Post('associations/request')
  // async sendAssociationRequest(@Body() dto: any, @Req() req: any) {
  //   const requesterId = req.user.userId;
  //   return this.familyService.sendAssociationRequest(requesterId, dto.targetUserId, dto.message);
  // }

}
