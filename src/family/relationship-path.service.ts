import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UserProfile } from '../user/model/user-profile.model';
import { RelationshipEdgeService } from './relationship-edge.service';

interface PathStep {
  type: 'spouse';
  targetGender: 'male' | 'female' | 'unknown';
}

@Injectable()
export class RelationshipPathService {
  constructor(
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
    private readonly relationshipEdgeService: RelationshipEdgeService,
  ) {}

  /**
   * Traverse all spouse-connected users starting from root user and
   * return each distinct main family code with a relationship prefix.
   * Currently considers only spouse edges; this already enables navigation
   * to every in-law family while returning gender-aware codes like `SW` / `SH`.
   */
  async getAssociatedFamilyPrefixes(rootUserId: number): Promise<Array<{ familyCode: string; prefix: string }>> {
    const rootProfile = await this.userProfileModel.findOne({ where: { userId: rootUserId } });
    if (!rootProfile) throw new NotFoundException('Root user profile not found');

    const rootFamilyCode = rootProfile.familyCode;
    if (!rootFamilyCode) return [];

    const result: Array<{ familyCode: string; prefix: string }> = [];
    const visitedUsers = new Set<number>();
    const discoveredCodes = new Set<string>();

    // BFS queue initialised with root
    const queue: Array<{ userId: number; path: PathStep[] }> = [
      { userId: rootUserId, path: [] },
    ];

    while (queue.length) {
      const { userId, path } = queue.shift()!;
      if (visitedUsers.has(userId)) continue;
      visitedUsers.add(userId);

      // Load spouse relationships for this user
      const relationships = await this.relationshipEdgeService.getUserRelationships(userId);
      for (const rel of relationships) {
        if (rel.relationshipType !== 'spouse') continue;

        const nextUserId = rel.user1Id === userId ? rel.user2Id : rel.user1Id;
        if (visitedUsers.has(nextUserId)) continue;

        const nextProfile = await this.userProfileModel.findOne({ where: { userId: nextUserId } });
        if (!nextProfile) continue;

        const nextPath: PathStep[] = [
          ...path,
          {
            type: 'spouse',
            targetGender: nextProfile.gender as 'male' | 'female' | 'unknown',
          },
        ];

        // If this spouse belongs to a different main family, record it.
        if (nextProfile.familyCode && nextProfile.familyCode !== rootFamilyCode && !discoveredCodes.has(nextProfile.familyCode)) {
          const prefix = this.generatePrefix(nextPath);
          result.push({ familyCode: nextProfile.familyCode, prefix });
          discoveredCodes.add(nextProfile.familyCode);
        }

        // Continue traversal deeper through spouse edges
        queue.push({ userId: nextUserId, path: nextPath });
      }
    }

    // ALSO CHECK associatedFamilyCodes from user profile
    // This handles cases where associations were created via notification system
    if (rootProfile.associatedFamilyCodes && Array.isArray(rootProfile.associatedFamilyCodes)) {
      for (const familyCode of rootProfile.associatedFamilyCodes) {
        if (familyCode && familyCode !== rootFamilyCode && !discoveredCodes.has(familyCode)) {
          // Use a generic prefix for profile-based associations
          result.push({ familyCode, prefix: 'Associated' });
          discoveredCodes.add(familyCode);
        }
      }
    }

    return result;
  }

  private generatePrefix(path: PathStep[]): string {
    if (path.length === 0) return '';

    // Per convention, prepend 'S' to indicate spouse branch.
    const codes: string[] = [];
    for (const step of path) {
      if (step.type === 'spouse') {
        codes.push(step.targetGender === 'male' ? 'H' : 'W');
      }
    }

    return 'S' + codes.join('');
  }
}
