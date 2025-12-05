import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { FamilyMergeRequest } from './model/family-merge-request.model';
import { FamilyMergeState } from './model/family-merge-state.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { NotificationService } from '../notification/notification.service';
import { FamilyService } from './family.service';
import { CreateFamilyTreeDto, FamilyTreeMemberDto } from './dto/family-tree.dto';

@Injectable()
export class FamilyMergeService {
  constructor(
    @InjectModel(FamilyMergeRequest)
    private readonly familyMergeModel: typeof FamilyMergeRequest,
    @InjectModel(FamilyMergeState)
    private readonly familyMergeStateModel: typeof FamilyMergeState,
    @InjectModel(Family)
    private readonly familyModel: typeof Family,
    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,
    @InjectModel(User)
    private readonly userModel: typeof User,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
    private readonly notificationService: NotificationService,
    private readonly familyService: FamilyService,
  ) {}

  private async assertUserIsAdminOfFamily(userId: number, familyCode: string): Promise<void> {
    const user = await this.userModel.findByPk(userId);
    if (!user || (user.role !== 2 && user.role !== 3)) {
      throw new ForbiddenException('Only admins can manage family merge requests');
    }

    const membership = await this.familyMemberModel.findOne({
      where: {
        memberId: userId,
        familyCode,
        approveStatus: 'approved',
      },
    });

    if (!membership) {
      throw new ForbiddenException('Admin must belong to the primary family');
    }
  }

  async searchFamilies(params: { familyCode?: string; adminPhone?: string }) {
    const { familyCode, adminPhone } = params;

    const familiesMap = new Map<string, Family>();

    // Search by family code prefix
    if (familyCode && familyCode.trim()) {
      const families = await this.familyModel.findAll({
        where: {
          familyCode: { [Op.iLike]: `${familyCode.trim()}%` },
        },
      });
      for (const fam of families) {
        familiesMap.set(fam.familyCode, fam);
      }
    }

    // Search by admin phone
    if (adminPhone && adminPhone.trim()) {
      const admins = await this.userModel.findAll({
        where: {
          mobile: { [Op.iLike]: `${adminPhone.trim()}%` },
          role: { [Op.in]: [2, 3] },
        },
        include: [
          {
            model: this.userModel.sequelize.models.FamilyMember,
            as: 'familyMemberships',
            required: false,
            where: { approveStatus: 'approved' },
          },
          {
            model: UserProfile,
            as: 'userProfile',
            required: false,
          },
        ],
      } as any);

      for (const admin of admins as any[]) {
        const memberships = admin.familyMemberships || [];
        for (const membership of memberships) {
          const code = membership.familyCode;
          if (!familiesMap.has(code)) {
            const fam = await this.familyModel.findOne({ where: { familyCode: code } });
            if (fam) {
              familiesMap.set(code, fam);
            }
          }
        }
      }
    }

    const families = Array.from(familiesMap.values());

    // For each family, load admin users
    const result = [];
    for (const fam of families) {
      const adminIds = await this.notificationService.getAdminsForFamily(fam.familyCode);
      let admins = [];
      if (adminIds.length > 0) {
        const adminUsers = await this.userModel.findAll({
          where: { id: adminIds },
          include: [
            {
              model: UserProfile,
              as: 'userProfile',
              required: false,
            },
          ],
        });
        admins = adminUsers.map((u: any) => ({
          userId: u.id,
          fullName: u.userProfile
            ? `${u.userProfile.firstName || ''} ${u.userProfile.lastName || ''}`.trim()
            : null,
          mobile: u.mobile,
          email: u.email,
          isAppUser: u.isAppUser,
        }));
      }

      result.push({
        familyCode: fam.familyCode,
        familyName: (fam as any).familyName || null,
        admins,
      });
    }

    return {
      message: `${result.length} families found`,
      data: result,
    };
  }

  async createMergeRequest(
    primaryFamilyCode: string,
    secondaryFamilyCode: string,
    adminUserId: number,
    anchorConfig?: any,
  ) {
    if (!adminUserId) {
      throw new ForbiddenException('Missing user context');
    }
    if (!primaryFamilyCode || !secondaryFamilyCode) {
      throw new BadRequestException('Both primaryFamilyCode and secondaryFamilyCode are required');
    }
    if (primaryFamilyCode === secondaryFamilyCode) {
      throw new BadRequestException('Primary and secondary families must be different');
    }

    const [primaryFamily, secondaryFamily] = await Promise.all([
      this.familyModel.findOne({ where: { familyCode: primaryFamilyCode } }),
      this.familyModel.findOne({ where: { familyCode: secondaryFamilyCode } }),
    ]);

    if (!primaryFamily) {
      throw new NotFoundException('Primary family not found');
    }
    if (!secondaryFamily) {
      throw new NotFoundException('Secondary family not found');
    }

    // In this flow, the logged-in admin belongs to the secondary family (requestor),
    // and they are requesting to merge into the primary family (target).
    await this.assertUserIsAdminOfFamily(adminUserId, secondaryFamilyCode);

    // Prevent duplicate open/accepted requests for the same pair
    const existing = await this.familyMergeModel.findOne({
      where: {
        primaryFamilyCode,
        secondaryFamilyCode,
        primaryStatus: { [Op.in]: ['open', 'accepted'] },
      },
    });

    if (existing) {
      throw new BadRequestException('A merge request between these families is already open or accepted');
    }

    const mergeRequest = await this.familyMergeModel.create({
      primaryFamilyCode,
      secondaryFamilyCode,
      requestedByAdminId: adminUserId,
      primaryStatus: 'open',
      secondaryStatus: 'pending',
      anchorConfig: anchorConfig || null,
    });

    // Notify admins of the primary family (decision makers)
    const primaryAdmins = await this.notificationService.getAdminsForFamily(primaryFamilyCode);
    const secondaryAdmins = await this.notificationService.getAdminsForFamily(secondaryFamilyCode);
    const recipients = Array.from(new Set([...primaryAdmins, ...secondaryAdmins]));

    if (recipients.length > 0) {
      await this.notificationService.createNotification(
        {
          type: 'FAMILY_MERGE_REQUEST',
          title: 'Family Merge Request',
          message: `Merge request created between ${primaryFamilyCode} (primary) and ${secondaryFamilyCode} (secondary).`,
          familyCode: primaryFamilyCode,
          referenceId: mergeRequest.id,
          userIds: recipients,
        } as any,
        adminUserId,
      );
    }

    return {
      message: 'Merge request created successfully',
      data: mergeRequest,
    };
  }

  async getRequestsForAdmin(adminUserId: number, status?: string) {
    if (!adminUserId) {
      throw new ForbiddenException('Missing user context');
    }

    const user = await this.userModel.findByPk(adminUserId);
    if (!user || (user.role !== 2 && user.role !== 3)) {
      throw new ForbiddenException('Only admins can view merge requests');
    }

    const memberships = await this.familyMemberModel.findAll({
      where: {
        memberId: adminUserId,
        approveStatus: 'approved',
      },
      attributes: ['familyCode'],
    });

    const adminFamilyCodes = memberships.map((m) => m.familyCode);
    if (adminFamilyCodes.length === 0) {
      return { message: 'No families found for admin', data: [] };
    }

    // Show requests where this admin belongs to either the primary or secondary family
    const where: any = {
      [Op.or]: [
        { primaryFamilyCode: { [Op.in]: adminFamilyCodes } },
        { secondaryFamilyCode: { [Op.in]: adminFamilyCodes } },
      ],
    };
    if (status) {
      where.primaryStatus = status;
    }

    const requests = await this.familyMergeModel.findAll({ where });

    return {
      message: `${requests.length} merge request(s) found`,
      data: requests,
    };
  }

  private async updateRequestStatus(
    requestId: number,
    adminUserId: number,
    newStatus: 'accepted' | 'rejected',
  ) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);

    // Only primary family admins are allowed to change the status
    await this.assertUserIsAdminOfFamily(adminUserId, request.primaryFamilyCode);

    if (request.primaryStatus !== 'open') {
      throw new BadRequestException('Only open requests can be updated');
    }

    request.primaryStatus = newStatus;
    await request.save();

    const primaryAdmins = await this.notificationService.getAdminsForFamily(request.primaryFamilyCode);
    const secondaryAdmins = await this.notificationService.getAdminsForFamily(request.secondaryFamilyCode);
    const recipients = Array.from(new Set([...primaryAdmins, ...secondaryAdmins]));

    if (recipients.length > 0) {
      await this.notificationService.createNotification(
        {
          type: 'FAMILY_MERGE_STATUS_UPDATE',
          title: 'Family Merge Request Updated',
          message: `Merge request between ${request.primaryFamilyCode} (primary) and ${request.secondaryFamilyCode} (secondary) has been ${newStatus}.`,
          familyCode: request.primaryFamilyCode,
          referenceId: request.id,
          userIds: recipients,
        } as any,
        adminUserId,
      );
    }

    return {
      message: `Merge request ${newStatus} successfully`,
      data: request,
    };
  }

  async acceptRequest(requestId: number, adminUserId: number) {
    return this.updateRequestStatus(requestId, adminUserId, 'accepted');
  }

  async rejectRequest(requestId: number, adminUserId: number) {
    return this.updateRequestStatus(requestId, adminUserId, 'rejected');
  }

  private normalizeName(name: string | null | undefined): string {
    if (!name) return '';
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private async getMergeRequestForAdmin(requestId: number, adminUserId: number): Promise<FamilyMergeRequest> {
    if (!adminUserId) {
      throw new ForbiddenException('Missing user context');
    }

    const request = await this.familyMergeModel.findByPk(requestId);
    if (!request) {
      throw new NotFoundException('Merge request not found');
    }

    // Allow admins of either the primary or the secondary family to access this request
    const user = await this.userModel.findByPk(adminUserId);
    if (!user || (user.role !== 2 && user.role !== 3)) {
      throw new ForbiddenException('Only admins can manage family merge requests');
    }

    const membership = await this.familyMemberModel.findOne({
      where: {
        memberId: adminUserId,
        familyCode: { [Op.in]: [request.primaryFamilyCode, request.secondaryFamilyCode] },
        approveStatus: 'approved',
      },
    });

    if (!membership) {
      throw new ForbiddenException('Admin must belong to the primary or secondary family');
    }

    return request;
  }

  private async buildFamilyPreview(familyCode: string, adminUserId: number) {
    const tree = await this.familyService.getFamilyTree(familyCode, adminUserId, true);
    const people = Array.isArray((tree as any).people) ? (tree as any).people : [];

    const userIds = Array.from(
      new Set(
        people
          .map((p: any) => p.memberId)
          .filter((id: any) => id !== null && id !== undefined),
      ),
    );

    const usersById = new Map<number, any>();

    if (userIds.length > 0) {
      const users = await this.userModel.findAll({
        where: { id: userIds },
        include: [
          {
            model: UserProfile,
            as: 'userProfile',
            required: false,
          },
          {
            model: (this.userModel.sequelize as any).models.FamilyMember,
            as: 'familyMemberships',
            required: false,
            where: { familyCode },
          },
        ],
      } as any);

      for (const u of users as any[]) {
        usersById.set(u.id, u);
      }
    }

    const preview = people.map((person: any) => {
      const userId = person.memberId || null;
      const user: any = userId ? usersById.get(userId) : null;
      const profile: any = user?.userProfile || null;
      const memberships: any[] = (user as any)?.familyMemberships || [];
      const membership = memberships.find((m: any) => m.familyCode === familyCode) || null;

      const name = person.name || (profile
        ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Unknown'
        : 'Unknown');

      return {
        personId: person.id,
        userId,
        name,
        age: profile?.age ?? person.age ?? null,
        gender: person.gender || profile?.gender || null,
        generation: person.generation ?? null,
        phone: user?.mobile || null,
        email: user?.email || null,
        relationship: null,
        associatedFamilyCodes: Array.isArray(profile?.associatedFamilyCodes)
          ? profile.associatedFamilyCodes
          : [],
        isAppUser: user?.isAppUser ?? false,
        isBlocked: membership?.isBlocked ?? false,
        isAdmin: user ? user.role === 2 || user.role === 3 : false,
        familyCode: familyCode,
        parents: Array.isArray(person.parents) ? person.parents : [],
        children: Array.isArray(person.children) ? person.children : [],
        spouses: Array.isArray(person.spouses) ? person.spouses : [],
        siblings: Array.isArray(person.siblings) ? person.siblings : [],
      };
    });

    return {
      message: 'Family preview built',
      data: preview,
    };
  }

  async getFamilyAPreview(requestId: number, adminUserId: number) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);
    const preview = await this.buildFamilyPreview(request.primaryFamilyCode, adminUserId);
    return {
      familyCode: request.primaryFamilyCode,
      ...preview,
    };
  }

  async getFamilyBPreview(requestId: number, adminUserId: number) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);
    const preview = await this.buildFamilyPreview(request.secondaryFamilyCode, adminUserId);
    return {
      familyCode: request.secondaryFamilyCode,
      ...preview,
    };
  }

  // Lightweight preview for an arbitrary familyCode, used by secondary admin popup
  async getFamilyPreviewForAnchor(familyCode: string, adminUserId: number) {
    if (!familyCode) {
      throw new BadRequestException('familyCode is required');
    }
    // Ensure caller is an admin somewhere (basic guard)
    const user = await this.userModel.findByPk(adminUserId);
    if (!user || (user.role !== 2 && user.role !== 3)) {
      throw new ForbiddenException('Only admins can preview families for merge');
    }
    const fam = await this.familyModel.findOne({ where: { familyCode } });
    if (!fam) {
      throw new NotFoundException('Family not found');
    }
    const preview = await this.buildFamilyPreview(familyCode, adminUserId);
    return {
      familyCode,
      ...preview,
    };
  }

  async getMergeAnalysis(requestId: number, adminUserId: number) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);

    const primary = await this.buildFamilyPreview(request.primaryFamilyCode, adminUserId);
    const secondary = await this.buildFamilyPreview(request.secondaryFamilyCode, adminUserId);

    const familyA = primary.data as any[];
    const familyB = secondary.data as any[];

    const bByUserId = new Map<number, any[]>();
    const bByEmail = new Map<string, any[]>();
    const bByPhone = new Map<string, any[]>();

    familyB.forEach((p) => {
      if (p.userId) {
        const list = bByUserId.get(p.userId) || [];
        list.push(p);
        bByUserId.set(p.userId, list);
      }
      if (p.email) {
        const key = p.email.toLowerCase();
        const list = bByEmail.get(key) || [];
        list.push(p);
        bByEmail.set(key, list);
      }
      if (p.phone) {
        const key = p.phone;
        const list = bByPhone.get(key) || [];
        list.push(p);
        bByPhone.set(key, list);
      }
    });

    const matchedBPersonIds = new Set<number>();
    const matches: any[] = [];
    const hardConflicts: any[] = [];
    const softConflicts: any[] = [];

    const offsetCounts = new Map<number, number>();

    familyA.forEach((a) => {
      let bestMatch: any = null;
      let bestScore = 0;

      const candidates: any[] = [];

      if (a.userId && bByUserId.has(a.userId)) {
        candidates.push(...(bByUserId.get(a.userId) || []));
      }

      if (a.email) {
        const list = bByEmail.get(a.email.toLowerCase()) || [];
        candidates.push(...list);
      }

      if (a.phone) {
        const list = bByPhone.get(a.phone) || [];
        candidates.push(...list);
      }

      if (!candidates.length) {
        const aName = this.normalizeName(a.name);
        const aGen = typeof a.generation === 'number' ? a.generation : null;
        const aAge = typeof a.age === 'number' ? a.age : null;

        familyB.forEach((b) => {
          const bName = this.normalizeName(b.name);
          if (!aName || !bName) return;

          if (aName === bName) {
            candidates.push(b);
          } else if (aName.length > 2 && bName.includes(aName)) {
            candidates.push(b);
          } else if (bName.length > 2 && aName.includes(bName)) {
            candidates.push(b);
          }
        });
      }

      const seen = new Set<number>();
      for (const b of candidates) {
        if (!b || seen.has(b.personId)) continue;
        seen.add(b.personId);

        let score = 0;
        const matchingFields: string[] = [];
        const differingFields: string[] = [];

        if (a.userId && b.userId && a.userId === b.userId) {
          score += 60;
          matchingFields.push('userId');
        }

        if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
          score += 25;
          matchingFields.push('email');
        }

        if (a.phone && b.phone && a.phone === b.phone) {
          score += 25;
          matchingFields.push('phone');
        }

        const aNameNorm = this.normalizeName(a.name);
        const bNameNorm = this.normalizeName(b.name);
        if (aNameNorm && bNameNorm && aNameNorm === bNameNorm) {
          score += 15;
          matchingFields.push('name');
        } else if (aNameNorm && bNameNorm && (aNameNorm.includes(bNameNorm) || bNameNorm.includes(aNameNorm))) {
          score += 8;
        } else {
          differingFields.push('name');
        }

        const aGen = typeof a.generation === 'number' ? a.generation : null;
        const bGen = typeof b.generation === 'number' ? b.generation : null;
        if (aGen !== null && bGen !== null) {
          const diff = Math.abs(aGen - bGen);
          if (diff === 0) {
            score += 10;
            matchingFields.push('generation');
          } else if (diff === 1) {
            score += 5;
          } else {
            differingFields.push('generation');
          }
        }

        const aAge = typeof a.age === 'number' ? a.age : null;
        const bAge = typeof b.age === 'number' ? b.age : null;
        if (aAge !== null && bAge !== null) {
          const diff = Math.abs(aAge - bAge);
          if (diff <= 1) {
            score += 10;
            matchingFields.push('age');
          } else if (diff <= 5) {
            score += 5;
          } else {
            differingFields.push('age');
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = { candidate: b, matchingFields, differingFields };
        }
      }

      if (bestMatch && bestScore >= 20) {
        const b = bestMatch.candidate;

        // Strict demographic gate: require exact match on name, gender, age, and generation
        const aNameStrict = this.normalizeName(a.name);
        const bNameStrict = this.normalizeName(b.name);
        const hasValidName = !!aNameStrict && !!bNameStrict;
        const sameName = hasValidName && aNameStrict === bNameStrict;

        const aGender = a.gender ?? null;
        const bGender = b.gender ?? null;
        const sameGender = aGender !== null && bGender !== null && aGender === bGender;

        const aAgeStrict = typeof a.age === 'number' ? a.age : null;
        const bAgeStrict = typeof b.age === 'number' ? b.age : null;
        const sameAge = aAgeStrict !== null && bAgeStrict !== null && aAgeStrict === bAgeStrict;

        const aGenStrict = typeof a.generation === 'number' ? a.generation : null;
        const bGenStrict = typeof b.generation === 'number' ? b.generation : null;
        const sameGeneration = aGenStrict !== null && bGenStrict !== null && aGenStrict === bGenStrict;

        if (!(sameName && sameGender && sameAge && sameGeneration)) {
          // Does not satisfy strict match criteria -> treat as no-match for this secondary person
          return;
        }

        matchedBPersonIds.add(b.personId);

        let level: 'exact' | 'probable' | 'possible';
        if (bestScore >= 80) level = 'exact';
        else if (bestScore >= 50) level = 'probable';
        else level = 'possible';

        if (typeof a.generation === 'number' && typeof b.generation === 'number') {
          const offset = a.generation - b.generation;
          offsetCounts.set(offset, (offsetCounts.get(offset) || 0) + 1);
        }

        matches.push({
          primary: a,
          secondary: b,
          confidence: bestScore,
          level,
          matchingFields: bestMatch.matchingFields,
          differingFields: bestMatch.differingFields,
        });

        const aParentNames = new Set(
          (a.parents || []).map((pid: number) => {
            const p = familyA.find((x) => x.personId === pid);
            return this.normalizeName(p?.name);
          }).filter(Boolean),
        );
        const bParentNames = new Set(
          (b.parents || []).map((pid: number) => {
            const p = familyB.find((x) => x.personId === pid);
            return this.normalizeName(p?.name);
          }).filter(Boolean),
        );

        if (aParentNames.size > 0 && bParentNames.size > 0) {
          let hasIntersection = false;
          aParentNames.forEach((n) => {
            if (bParentNames.has(n)) hasIntersection = true;
          });
          if (!hasIntersection) {
            hardConflicts.push({
              type: 'PARENTS_MISMATCH',
              primaryPersonId: a.personId,
              secondaryPersonId: b.personId,
              description: 'Parents differ with no overlap between families.',
            });
          }
        }

        const aAge = typeof a.age === 'number' ? a.age : null;
        const bAge = typeof b.age === 'number' ? b.age : null;
        if (aAge !== null && bAge !== null) {
          const diff = Math.abs(aAge - bAge);
          if (diff > 5 && diff <= 15) {
            softConflicts.push({
              type: 'AGE_MISMATCH',
              primaryPersonId: a.personId,
              secondaryPersonId: b.personId,
              description: `Age differs by ${diff} years.`,
            });
          } else if (diff > 15) {
            hardConflicts.push({
              type: 'AGE_CONFLICT',
              primaryPersonId: a.personId,
              secondaryPersonId: b.personId,
              description: `Age differs by ${diff} years.`,
            });
          }
        }
      }
    });

    const newPersons = familyB.filter((p) => !matchedBPersonIds.has(p.personId));

    let suggestedOffset: number | null = null;
    if (offsetCounts.size > 0) {
      let bestOffset = 0;
      let bestCount = -1;
      offsetCounts.forEach((count, offset) => {
        if (count > bestCount) {
          bestCount = count;
          bestOffset = offset;
        }
      });
      suggestedOffset = bestOffset;
    }

    // Categorize matches by scenario (duplicate persons)
    const duplicatePersons = matches.map((match) => ({
      primaryPersonId: match.primary.personId,
      secondaryPersonId: match.secondary.personId,
      primaryName: match.primary.name,
      secondaryName: match.secondary.name,
      primaryUserId: match.primary.userId,
      secondaryUserId: match.secondary.userId,
      primaryIsAppUser: match.primary.isAppUser,
      secondaryIsAppUser: match.secondary.isAppUser,
      scenario: this.determineScenario(match.primary, match.secondary),
      confidence: match.confidence,
      level: match.level,
      matchingFields: match.matchingFields,
      differingFields: match.differingFields,
    }));

    // Save duplicate persons info to the request for tracking
    if (duplicatePersons.length > 0) {
      request.duplicatePersonsInfo = JSON.stringify(duplicatePersons);
      request.conflictSummary = JSON.stringify({
        totalDuplicates: duplicatePersons.length,
        hardConflicts: hardConflicts.length,
        softConflicts: softConflicts.length,
        newPersons: newPersons.length,
        scenarios: this.summarizeScenarios(duplicatePersons),
      });
      await request.save();
    }

    // Mark required chain: direct parents of the secondary admin must be carried into the merge
    const secondaryAdmin = familyB.find((p) => p && p.isAdmin && p.personId != null);
    const requiredSecondaryParentIds = new Set<number>();

    if (secondaryAdmin && Array.isArray(secondaryAdmin.parents) && secondaryAdmin.parents.length > 0) {
      for (const pid of secondaryAdmin.parents as number[]) {
        if (typeof pid === 'number') {
          requiredSecondaryParentIds.add(pid);
        }
      }
    }

    if (requiredSecondaryParentIds.size > 0) {
      // Tag matches where the secondary person is one of the required parents
      matches.forEach((m: any) => {
        const secId = m?.secondary?.personId;
        if (secId && requiredSecondaryParentIds.has(secId)) {
          m.requiredChain = 'secondaryAdminParent';
          if (m.secondary) {
            m.secondary.requiredChain = 'secondaryAdminParent';
          }
        }
      });

      // Tag newPersons entries that are required parents in Family B
      newPersons.forEach((p: any) => {
        if (p && requiredSecondaryParentIds.has(p.personId)) {
          p.requiredChain = 'secondaryAdminParent';
        }
      });
    }

    const crisisAnalysis = await this.detectCrisisScenarios(request.id, familyA, familyB, matches);

    return {
      message: 'Merge analysis completed',
      data: {
        primaryFamilyCode: request.primaryFamilyCode,
        secondaryFamilyCode: request.secondaryFamilyCode,
        anchorConfig: (request as any).anchorConfig || null,
        generationOffset: {
          suggestedOffset,
          counts: Array.from(offsetCounts.entries()).map(([offset, count]) => ({ offset, count })),
        },
        matches,
        duplicatePersons,
        hardConflicts,
        softConflicts,
        newPersons,
        crisisAnalysis,
      },
    };
  }

  private determineScenario(primaryPerson: any, secondaryPerson: any): string {
    // Scenario 1: Both are app users with same userId
    if (primaryPerson.isAppUser && secondaryPerson.isAppUser && primaryPerson.userId === secondaryPerson.userId) {
      return 'SAME_APP_USER';
    }

    // Scenario 2: Primary is app user, secondary is non-app user (same person, different registration status)
    if (primaryPerson.isAppUser && !secondaryPerson.isAppUser) {
      return 'APP_USER_VS_NON_APP_USER';
    }

    // Scenario 3: Primary is non-app user, secondary is app user
    if (!primaryPerson.isAppUser && secondaryPerson.isAppUser) {
      return 'NON_APP_USER_VS_APP_USER';
    }

    // Scenario 4: Both are non-app users (same person, not registered in either family)
    if (!primaryPerson.isAppUser && !secondaryPerson.isAppUser) {
      return 'BOTH_NON_APP_USERS';
    }

    // Scenario 5: Different app users (should not happen, but handle it)
    if (primaryPerson.isAppUser && secondaryPerson.isAppUser && primaryPerson.userId !== secondaryPerson.userId) {
      return 'DIFFERENT_APP_USERS';
    }

    return 'UNKNOWN';
  }

  private summarizeScenarios(duplicatePersons: any[]): any {
    const scenarios = new Map<string, number>();
    duplicatePersons.forEach((dup) => {
      scenarios.set(dup.scenario, (scenarios.get(dup.scenario) || 0) + 1);
    });
    return Object.fromEntries(scenarios);
  }

  async getMergeState(requestId: number, adminUserId: number) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);

    const existing = await this.familyMergeStateModel.findOne({
      where: { mergeRequestId: requestId },
    });

    if (!existing) {
      return {
        message: 'No merge state saved yet',
        data: {
          mergeRequestId: requestId,
          primaryFamilyCode: request.primaryFamilyCode,
          secondaryFamilyCode: request.secondaryFamilyCode,
          state: null,
        },
      };
    }

    return {
      message: 'Merge state loaded',
      data: existing,
    };
  }

  async saveMergeState(requestId: number, adminUserId: number, statePayload: any) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);

    // Only the primary family admin is allowed to modify merge state/decisions
    await this.assertUserIsAdminOfFamily(adminUserId, request.primaryFamilyCode);

    let state = await this.familyMergeStateModel.findOne({
      where: { mergeRequestId: requestId },
    });

    const enrichedState = {
      ...(statePayload || {}),
      meta: {
        ...(statePayload && statePayload.meta ? statePayload.meta : {}),
        lastUpdatedBy: adminUserId,
        lastUpdatedAt: new Date().toISOString(),
      },
    };

    if (!state) {
      state = await this.familyMergeStateModel.create({
        mergeRequestId: requestId,
        primaryFamilyCode: request.primaryFamilyCode,
        secondaryFamilyCode: request.secondaryFamilyCode,
        state: enrichedState,
      });
    } else {
      state.state = enrichedState;
      await state.save();
    }

    // If an anchorConfig was provided in meta, persist it to the merge request for future analysis loads
    const anchorConfig = enrichedState?.meta?.anchorConfig;
    if (anchorConfig !== undefined) {
      (request as any).anchorConfig = anchorConfig;
      await request.save();
    }

    return {
      message: 'Merge state saved',
      data: state,
    };
  }

  async executeMerge(requestId: number, adminUserId: number) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);

    // Only primary family admins can execute the merge
    await this.assertUserIsAdminOfFamily(adminUserId, request.primaryFamilyCode);

    if (request.primaryStatus === 'merged') {
      throw new BadRequestException('Merge has already been executed for this request');
    }

    if (request.primaryStatus !== 'accepted') {
      throw new BadRequestException('Only accepted merge requests can be executed');
    }

    const mergeState = await this.familyMergeStateModel.findOne({
      where: { mergeRequestId: requestId },
    });

    if (!mergeState || !mergeState.state) {
      throw new BadRequestException('No merge state/cache found. Save merge decisions before executing.');
    }

    const rawState: any = mergeState.state || {};
    const finalTree = rawState.finalTree || {};
    const membersInput = Array.isArray(finalTree.members) ? finalTree.members : [];

    if (!membersInput.length) {
      throw new BadRequestException('Final merged tree is empty. Cannot execute merge.');
    }

    const normalizeIdsArray = (arr: any): number[] => {
      if (!Array.isArray(arr)) return [];
      return Array.from(
        new Set(
          arr
            .map((id: any) => (typeof id === 'string' ? parseInt(id, 10) : id))
            .filter((id: any) => typeof id === 'number' && !isNaN(id)),
        ),
      );
    };

    const members: FamilyTreeMemberDto[] = membersInput.map((m: any, index: number) => {
      const id = typeof m.id === 'number' && !isNaN(m.id) ? m.id : index + 1;
      return {
        id,
        name: m.name || 'Unknown',
        gender: m.gender || 'unknown',
        age: m.age,
        img: m.img,
        lifeStatus: m.lifeStatus ?? 'living',
        generation: typeof m.generation === 'number' ? m.generation : undefined,
        parents: normalizeIdsArray(m.parents),
        children: normalizeIdsArray(m.children),
        spouses: normalizeIdsArray(m.spouses),
        siblings: normalizeIdsArray(m.siblings),
        userId: m.userId,
        memberId: m.memberId,
        relationshipCode: m.relationshipCode,
      };
    });

    const dto: CreateFamilyTreeDto = {
      familyCode: request.primaryFamilyCode,
      members,
    };

    const treeResult = await this.familyService.createFamilyTree(dto, adminUserId);

    const promoteAdmins: number[] = Array.isArray(rawState.adminDecisions?.promoteToAdmin)
      ? rawState.adminDecisions.promoteToAdmin.filter(
          (id: any) => typeof id === 'number' && !isNaN(id),
        )
      : [];

    if (promoteAdmins.length > 0) {
      await this.userModel.update(
        { role: 2 },
        {
          where: {
            id: { [Op.in]: promoteAdmins },
            role: { [Op.ne]: 3 },
          },
        },
      );
    }

    request.primaryStatus = 'merged';
    request.secondaryStatus = 'merged';
    await request.save();

    const primaryAdmins = await this.notificationService.getAdminsForFamily(request.primaryFamilyCode);
    const secondaryAdmins = await this.notificationService.getAdminsForFamily(request.secondaryFamilyCode);
    const recipients = Array.from(new Set([...primaryAdmins, ...secondaryAdmins]));

    if (recipients.length > 0) {
      await this.notificationService.createNotification(
        {
          type: 'FAMILY_MERGE_STATUS_UPDATE',
          title: 'Family Merge Completed',
          message: `Merge between ${request.primaryFamilyCode} (primary) and ${request.secondaryFamilyCode} (secondary) has been completed.`,
          familyCode: request.primaryFamilyCode,
          referenceId: request.id,
          data: {
            primaryFamilyCode: request.primaryFamilyCode,
            secondaryFamilyCode: request.secondaryFamilyCode,
            mergeStateId: mergeState.id,
          },
          userIds: recipients,
        } as any,
        adminUserId,
      );
    }

    return {
      message: 'Family merge executed successfully',
      data: {
        request,
        treeResult,
      },
    };
  }

  // ============ SECONDARY FAMILY TRACKING ============

  async getSecondaryFamilyTracking(requestId: number, adminUserId: number) {
    const request = await this.familyMergeModel.findByPk(requestId);
    if (!request) {
      throw new NotFoundException('Merge request not found');
    }

    // Verify user is admin of secondary family
    await this.assertUserIsAdminOfFamily(adminUserId, request.secondaryFamilyCode);

    // Get secondary family members
    const secondaryMembers = await this.buildFamilyPreview(
      request.secondaryFamilyCode,
      adminUserId
    );

    return {
      message: 'Secondary family tracking',
      data: {
        mergeRequestId: request.id,
        primaryFamilyCode: request.primaryFamilyCode,
        secondaryFamilyCode: request.secondaryFamilyCode,
        primaryStatus: request.primaryStatus,
        secondaryStatus: request.secondaryStatus,
        createdAt: request.createdAt,
        acceptedAt: request.updatedAt,
        secondaryMembers: secondaryMembers.data,
        totalMembers: secondaryMembers.data.length,
        trackingStatus: this.getSecondaryTrackingStatus(request),
        canViewDetails: true,
        canDownloadReport: true,
        canViewFullTree: true,
      },
    };
  }

  private getSecondaryTrackingStatus(request: any): string {
    if (request.primaryStatus === 'open') {
      return 'PENDING_PRIMARY_DECISION';
    }
    if (request.primaryStatus === 'rejected') {
      return 'REJECTED_BY_PRIMARY';
    }
    if (request.primaryStatus === 'accepted' && request.secondaryStatus === 'pending') {
      return 'ACCEPTED_WAITING_EXECUTION';
    }
    if (request.primaryStatus === 'merged') {
      return 'MERGED_COMPLETED';
    }
    return 'UNKNOWN';
  }

  // ============ GENERATION ADJUSTMENT ============

  async adjustGenerationOffset(
    requestId: number,
    adminUserId: number,
    offset: number,
    reason?: string,
  ) {
    const request = await this.familyMergeModel.findByPk(requestId);
    if (!request) {
      throw new NotFoundException('Merge request not found');
    }

    // Verify user is admin of primary family
    await this.assertUserIsAdminOfFamily(adminUserId, request.primaryFamilyCode);

    // Verify request is accepted
    if (request.primaryStatus !== 'accepted') {
      throw new BadRequestException('Can only adjust generation offset for accepted requests');
    }

    // Save offset
    request.appliedGenerationOffset = offset;
    await request.save();



    return {
      message: 'Generation offset adjusted successfully',
      data: {
        offset,
        appliedAt: new Date(),
        validation: {
          status: 'VALID',
        },
      },
    };
  }

  private applyGenerationOffset(family: any[], offset: number): any[] {
    return family.map((person) => ({
      ...person,
      generation: (person.generation || 0) + offset,
    }));
  }

  // ============ EDIT & REVERT ============

  async editMergeState(requestId: number, adminUserId: number, edits: any) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);

    let state = await this.familyMergeStateModel.findOne({
      where: { mergeRequestId: requestId },
    });

    if (!state) {
      throw new NotFoundException('No merge state found. Save state first.');
    }

    // Store previous state in history
    const previousState = JSON.parse(JSON.stringify(state.state || {}));

    // Apply edits
    const updatedState = {
      ...state.state,
      ...edits.changes,
      meta: {
        ...(state.state?.meta || {}),
        lastUpdatedBy: adminUserId,
        lastUpdatedAt: new Date().toISOString(),
      },
    };

    state.state = updatedState;
    await state.save();


    return {
      message: 'Merge state edited successfully',
      data: state,
    };
  }

  async getMergeStateHistory(requestId: number, adminUserId: number) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);



    return {
      message: 'Merge state history retrieved',
      data: history,
    };
  }

  async revertMergeState(requestId: number, adminUserId: number, targetVersion: number) {
    const request = await this.getMergeRequestForAdmin(requestId, adminUserId);

    if (targetVersion < 0 || targetVersion >= history.length) {
      throw new BadRequestException('Invalid target version');
    }

    return {
      message: 'Merge state reverted successfully',
      data: {
        revertedTo: targetVersion,
        timestamp: new Date(),
      },
    };
  }

  

  // ============ CRISIS DETECTION (PLACEHOLDER) ============

  private async detectCrisisScenarios(
    requestId: number,
    familyA: any[],
    familyB: any[],
    matches: any[]
  ) {
    // Placeholder for crisis detection
    // This will be implemented in Phase 6
    const isNoMatchMerge = matches.length === 0;

    // Persist high-level flag on the merge request for tracking/reporting
    const request = await this.familyMergeModel.findByPk(requestId);
    if (request) {
      request.isNoMatchMerge = isNoMatchMerge;
      await request.save();
    }

    // Load latest merge state (to read meta like relationshipLabel)
    const mergeState = await this.familyMergeStateModel.findOne({ where: { mergeRequestId: requestId } });
    const rawState: any = mergeState?.state || {};
    const meta: any = rawState.meta || {};
    const relationshipLabel: string | null = typeof meta.relationshipLabel === 'string' ? meta.relationshipLabel : null;

    // Run generation and relationship level analysis in parallel
    const [generationAnalysis, relationshipAnalysis] = await Promise.all([
      this.analyzeGenerationAlignmentParallel(familyA, familyB, matches, relationshipLabel),
      this.analyzeRelationshipsParallel(familyA, familyB),
    ]);

    // Detect structural issues such as missing parents and cycles
    const orphanedPersons = this.detectOrphanedPersons(familyA, familyB);
    const circularRelationships = this.detectCircularRelationships(familyA, familyB);

    const crisisAnalysis: any = {
      isNoMatchMerge,
      generationAnalysis,
      relationshipAnalysis,
      orphanedPersons,
      circularRelationships,
      recommendations: [],
    };

    // Enrich with human-readable recommendation codes/messages
    this.generateCrisisRecommendations(crisisAnalysis);

    return crisisAnalysis;
  }

  private async analyzeGenerationAlignmentParallel(
    familyA: any[],
    familyB: any[],
    matches: any[],
    relationshipLabel: string | null,
  ) {
    // Placeholder for generation analysis
    // This will be implemented in Phase 6
    const extractStats = (family: any[]) => {
      const gens: number[] = [];
      family.forEach((person) => {
        if (person && typeof person.generation === 'number') {
          gens.push(person.generation);
        }
      });

      if (!gens.length) {
        return {
          hasGenerationData: false,
          minGeneration: null,
          maxGeneration: null,
        };
      }

      let minGeneration = gens[0];
      let maxGeneration = gens[0];
      for (const g of gens) {
        if (g < minGeneration) {
          minGeneration = g;
        }
        if (g > maxGeneration) {
          maxGeneration = g;
        }
      }

      return {
        hasGenerationData: true,
        minGeneration,
        maxGeneration,
      };
    };

    const primaryStats = extractStats(familyA);
    const secondaryStats = extractStats(familyB);

    const offsetCounts = new Map<number, number>();
    matches.forEach((m: any) => {
      const aGen = typeof m.primary?.generation === 'number' ? m.primary.generation : null;
      const bGen = typeof m.secondary?.generation === 'number' ? m.secondary.generation : null;
      if (aGen !== null && bGen !== null) {
        const offset = aGen - bGen;
        offsetCounts.set(offset, (offsetCounts.get(offset) || 0) + 1);
      }
    });

    let suggestedOffset: number | null = null;
    let bestCount = 0;
    offsetCounts.forEach((count, offset) => {
      if (count > bestCount) {
        bestCount = count;
        suggestedOffset = offset;
      }
    });

    const issues: string[] = [];
    if (!primaryStats.hasGenerationData || !secondaryStats.hasGenerationData) {
      issues.push('MISSING_GENERATION_DATA');
    }
    if (offsetCounts.size > 1) {
      issues.push('INCONSISTENT_GENERATION_OFFSETS');
    }

    // Interpret relationshipLabel into an expected offset (admin B relative to admin A)
    // Positive means B is in a younger generation than A, negative means older.
    let labelExpectedOffset: number | null = null;
    let labelNotes: string | null = null;
    if (relationshipLabel) {
      switch (relationshipLabel) {
        case 'SELF':
          labelExpectedOffset = 0;
          break;
        case 'F':
        case 'M':
          labelExpectedOffset = -1;
          break;
        case 'SS': // son's son
        case 'SD': // son's daughter
        case 'DS': // daughter's son
        case 'DD': // daughter's daughter
          labelExpectedOffset = 2;
          break;
        case 'H':
        case 'W':
          labelExpectedOffset = 0;
          labelNotes = 'Spouse relationship assumed to be same generation.';
          break;
        case 'B+':
        case 'B-':
        case 'Z+':
        case 'Z-':
          labelExpectedOffset = 0;
          labelNotes = 'Sibling relationship assumed to be same generation.';
          break;
        case 'FB+S':
        case 'FB-S':
        case 'FZ+S':
        case 'FZ-S':
          labelExpectedOffset = 0;
          labelNotes = 'Paternal cousin assumed in same generation as admin.';
          break;
        default:
          labelExpectedOffset = null;
          labelNotes = 'Relationship label not mapped to explicit generation offset yet.';
      }
    }

    // Compare labelExpectedOffset with suggestedOffset from matches
    let labelOffsetConsistency: 'UNKNOWN' | 'CONSISTENT' | 'INCONSISTENT' = 'UNKNOWN';
    if (labelExpectedOffset !== null && suggestedOffset !== null) {
      if (labelExpectedOffset === suggestedOffset) {
        labelOffsetConsistency = 'CONSISTENT';
      } else {
        labelOffsetConsistency = 'INCONSISTENT';
        issues.push('RELATIONSHIP_LABEL_OFFSET_CONFLICT');
      }
    }

    return {
      primary: {
        totalPersons: familyA.length,
        ...primaryStats,
      },
      secondary: {
        totalPersons: familyB.length,
        ...secondaryStats,
      },
      offsetsFromMatches: {
        suggestedOffset,
        counts: Array.from(offsetCounts.entries()).map(([offset, count]) => ({ offset, count })),
      },
      relationshipLabelInfo: {
        label: relationshipLabel,
        labelExpectedOffset,
        labelOffsetConsistency,
        labelNotes,
      },
      issues,
    };
  }

  private async analyzeRelationshipsParallel(familyA: any[], familyB: any[]) {
    // Placeholder for relationship analysis
    // This will be implemented in Phase 6
    const analysisA = this.analyzeRelationshipsForFamily(familyA, 'PRIMARY');
    const analysisB = this.analyzeRelationshipsForFamily(familyB, 'SECONDARY');

    const issues: string[] = [];
    if (analysisA.components.count > 1) {
      issues.push('PRIMARY_FAMILY_HAS_DISCONNECTED_COMPONENTS');
    }
    if (analysisB.components.count > 1) {
      issues.push('SECONDARY_FAMILY_HAS_DISCONNECTED_COMPONENTS');
    }

    return {
      familyA: analysisA,
      familyB: analysisB,
      issues,
    };
  }

  private detectOrphanedPersons(familyA: any[], familyB: any[]): any[] {
    // Placeholder for orphaned person detection
    // This will be implemented in Phase 6
    const results: any[] = [];

    const detectForFamily = (family: any[], familyLabel: 'PRIMARY' | 'SECONDARY') => {
      const index = this.buildPersonIndex(family);
      index.forEach((person, id) => {
        const parents = Array.isArray(person.parents) ? person.parents : [];
        if (!parents.length) {
          return;
        }
        const missingParents: number[] = [];
        parents.forEach((rawId: any) => {
          const parentId = typeof rawId === 'number' ? rawId : parseInt(String(rawId), 10);
          if (!Number.isFinite(parentId)) {
            return;
          }
          if (!index.has(parentId)) {
            missingParents.push(parentId);
          }
        });
        if (missingParents.length > 0) {
          results.push({
            family: familyLabel,
            personId: id,
            missingParentIds: missingParents,
          });
        }
      });
    };

    detectForFamily(familyA, 'PRIMARY');
    detectForFamily(familyB, 'SECONDARY');

    return results;
  }

  private detectCircularRelationships(familyA: any[], familyB: any[]): any[] {
    // Placeholder for circular relationship detection
    // This will be implemented in Phase 6
    const cycles: any[] = [];

    const detectForFamily = (family: any[], familyLabel: 'PRIMARY' | 'SECONDARY') => {
      const index = this.buildPersonIndex(family);
      const adjacency = new Map<number, number[]>();

      index.forEach((person, id) => {
        const parents = Array.isArray(person.parents) ? person.parents : [];
        const parentIds: number[] = [];
        parents.forEach((rawId: any) => {
          const parentId = typeof rawId === 'number' ? rawId : parseInt(String(rawId), 10);
          if (!Number.isFinite(parentId)) {
            return;
          }
          if (index.has(parentId)) {
            parentIds.push(parentId);
          }
        });
        adjacency.set(id, parentIds);
      });

      const visited = new Set<number>();
      const stack = new Set<number>();
      const path: number[] = [];

      const dfs = (nodeId: number) => {
        if (stack.has(nodeId)) {
          const cycleStartIndex = path.indexOf(nodeId);
          if (cycleStartIndex !== -1) {
            const cyclePath = path.slice(cycleStartIndex).concat(nodeId);
            cycles.push({
              family: familyLabel,
              personIdsInCycle: cyclePath,
            });
          }
          return;
        }
        if (visited.has(nodeId)) {
          return;
        }
        visited.add(nodeId);
        stack.add(nodeId);
        path.push(nodeId);

        const neighbors = adjacency.get(nodeId) || [];
        neighbors.forEach((nextId) => {
          dfs(nextId);
        });

        stack.delete(nodeId);
        path.pop();
      };

      index.forEach((_person, id) => {
        if (!visited.has(id)) {
          dfs(id);
        }
      });
    };

    detectForFamily(familyA, 'PRIMARY');
    detectForFamily(familyB, 'SECONDARY');

    return cycles;
  }

  private generateCrisisRecommendations(crisisAnalysis: any): void {
    // Placeholder for crisis recommendations
    // This will be implemented in Phase 6
    const recommendations: any[] = Array.isArray(crisisAnalysis.recommendations)
      ? crisisAnalysis.recommendations
      : [];

    if (crisisAnalysis.isNoMatchMerge) {
      recommendations.push({
        code: 'NO_MATCH_MERGE',
        severity: 'HIGH',
        message:
          'No automatic matches detected between families. Use relationship path and generation offset carefully before merging.',
      });
    }

    const genIssues: string[] = Array.isArray(crisisAnalysis.generationAnalysis?.issues)
      ? crisisAnalysis.generationAnalysis.issues
      : [];
    genIssues.forEach((issue) => {
      recommendations.push({
        code: `GEN_${issue}`,
        severity: issue === 'INCONSISTENT_GENERATION_OFFSETS' ? 'HIGH' : 'MEDIUM',
        message: `Generation analysis issue: ${issue}.`,
      });
    });

    const relLabelInfo = crisisAnalysis.generationAnalysis?.relationshipLabelInfo || null;
    if (relLabelInfo && relLabelInfo.label) {
      recommendations.push({
        code: 'REL_LABEL_USED',
        severity: 'LOW',
        message: `Relationship label '${relLabelInfo.label}' provided${
          relLabelInfo.labelExpectedOffset !== null
            ? ` (expected offset ${relLabelInfo.labelExpectedOffset})`
            : ''
        }.`,
      });

      if (relLabelInfo.labelOffsetConsistency === 'INCONSISTENT') {
        recommendations.push({
          code: 'REL_LABEL_OFFSET_CONFLICT',
          severity: 'HIGH',
          message:
            'Declared relationship label suggests a different generation offset than what is inferred from matches. Please verify admin relationship and generation numbers.',
        });
      }

      if (relLabelInfo.labelNotes) {
        recommendations.push({
          code: 'REL_LABEL_NOTE',
          severity: 'LOW',
          message: relLabelInfo.labelNotes,
        });
      }
    }

    const relIssues: string[] = Array.isArray(crisisAnalysis.relationshipAnalysis?.issues)
      ? crisisAnalysis.relationshipAnalysis.issues
      : [];
    relIssues.forEach((issue) => {
      recommendations.push({
        code: `REL_${issue}`,
        severity: 'MEDIUM',
        message: `Relationship analysis issue: ${issue}.`,
      });
    });

    if (Array.isArray(crisisAnalysis.orphanedPersons) && crisisAnalysis.orphanedPersons.length > 0) {
      recommendations.push({
        code: 'ORPHANED_PERSONS',
        severity: 'MEDIUM',
        message: 'Some persons reference parents that do not exist in the same family tree.',
      });
    }

    if (Array.isArray(crisisAnalysis.circularRelationships) && crisisAnalysis.circularRelationships.length > 0) {
      recommendations.push({
        code: 'CIRCULAR_RELATIONSHIPS',
        severity: 'HIGH',
        message: 'Circular parent-child relationships detected. Please fix before executing merge.',
      });
    }

    crisisAnalysis.recommendations = recommendations;
  }

  private buildPersonIndex(family: any[]): Map<number, any> {
    const index = new Map<number, any>();
    family.forEach((person) => {
      if (!person) {
        return;
      }
      const id = typeof person.personId === 'number' ? person.personId : parseInt(String(person.personId), 10);
      if (!Number.isFinite(id)) {
        return;
      }
      if (!index.has(id)) {
        index.set(id, person);
      }
    });
    return index;
  }

  private getConnectedComponentsForFamily(index: Map<number, any>): number[][] {
    const adjacency = new Map<number, Set<number>>();

    index.forEach((person, id) => {
      if (!adjacency.has(id)) {
        adjacency.set(id, new Set());
      }
      const neighbors: number[] = [];

      const parents = Array.isArray(person.parents) ? person.parents : [];
      const children = Array.isArray(person.children) ? person.children : [];
      const spouses = Array.isArray(person.spouses) ? person.spouses : [];
      const siblings = Array.isArray(person.siblings) ? person.siblings : [];

      [parents, children, spouses, siblings].forEach((list) => {
        list.forEach((rawId: any) => {
          const neighborId = typeof rawId === 'number' ? rawId : parseInt(String(rawId), 10);
          if (!Number.isFinite(neighborId)) {
            return;
          }
          if (!index.has(neighborId)) {
            return;
          }
          neighbors.push(neighborId);
        });
      });

      const set = adjacency.get(id)!;
      neighbors.forEach((neighborId) => {
        set.add(neighborId);
        if (!adjacency.has(neighborId)) {
          adjacency.set(neighborId, new Set());
        }
        adjacency.get(neighborId)!.add(id);
      });
    });

    const visited = new Set<number>();
    const components: number[][] = [];

    adjacency.forEach((_neighbors, id) => {
      if (visited.has(id)) {
        return;
      }
      const queue: number[] = [id];
      const component: number[] = [];
      visited.add(id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);
        const neighbors = adjacency.get(current);
        if (!neighbors) {
          continue;
        }
        neighbors.forEach((neighborId) => {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push(neighborId);
          }
        });
      }

      components.push(component);
    });

    index.forEach((_person, id) => {
      if (!adjacency.has(id) && !visited.has(id)) {
        components.push([id]);
        visited.add(id);
      }
    });

    return components;
  }

  private analyzeRelationshipsForFamily(family: any[], familyLabel: 'PRIMARY' | 'SECONDARY') {
    const index = this.buildPersonIndex(family);
    const components = this.getConnectedComponentsForFamily(index);

    const orphanCandidates: number[] = [];
    index.forEach((person, id) => {
      const parents = Array.isArray(person.parents) ? person.parents : [];
      if (!parents.length) {
        return;
      }
      const missingParents = parents.filter((rawId: any) => {
        const parentId = typeof rawId === 'number' ? rawId : parseInt(String(rawId), 10);
        if (!Number.isFinite(parentId)) {
          return false;
        }
        return !index.has(parentId);
      });
      if (missingParents.length > 0) {
        orphanCandidates.push(id);
      }
    });

    const issues: string[] = [];
    if (components.length > 1) {
      issues.push(
        familyLabel === 'PRIMARY'
          ? 'PRIMARY_FAMILY_HAS_DISCONNECTED_COMPONENTS'
          : 'SECONDARY_FAMILY_HAS_DISCONNECTED_COMPONENTS',
      );
    }

    return {
      totalPersons: family.length,
      components: {
        count: components.length,
        sizes: components.map((component) => component.length),
      },
      orphanCandidates,
      issues,
    };
  }
}
