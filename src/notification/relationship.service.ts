import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FamilyTree } from '../family/model/family-tree.model';

/**
 * RelationshipService — extracted from NotificationService.
 *
 * Owns: gender normalization, relationship-type helpers, generation calculation.
 * Zero side-effects — pure lookups and arithmetic.
 */
@Injectable()
export class RelationshipService {
    private readonly logger = new Logger(RelationshipService.name);

    constructor(
        @InjectModel(FamilyTree)
        private readonly familyTreeModel: typeof FamilyTree,
    ) { }

    // ─── Relationship type helpers ──────────────────────────────────────

    invertRelationshipType(t: string): string {
        if (t === 'parent') return 'child';
        if (t === 'child') return 'parent';
        return 'sibling';
    }

    /**
     * Given a base generation and a relationship direction, return the other
     * person's generation.  Generations increase downward (parent = -1 from child).
     */
    getOtherGeneration(baseGen: number, rel: string): number {
        const g = Number.isFinite(baseGen as any) ? Number(baseGen) : 0;
        if (rel === 'parent') return g - 1;
        if (rel === 'child') return g + 1;
        return g;
    }

    // ─── Gender helpers ─────────────────────────────────────────────────

    normalizeGenderValue(g: any): string {
        const s = String(g || '').toLowerCase().trim();
        if (s === 'male' || s === 'm' || s === 'man') return 'male';
        if (s === 'female' || s === 'f' || s === 'woman') return 'female';
        return '';
    }

    /**
     * Safely parse age value to prevent NaN issues.
     */
    parseAge(age: any): number {
        if (age === null || age === undefined) {
            return 0;
        }
        const parsedAge = typeof age === 'number' ? age : parseInt(age, 10);
        return isNaN(parsedAge) ? 0 : parsedAge;
    }

    // ─── Relationship detection ─────────────────────────────────────────

    /**
     * Simplified relationship detection — always returns 'spouse' for association
     * requests so cross-family navigation works consistently.
     */
    detectRelationshipType(user1Profile: any, user2Profile: any): string {
        this.logger.log(`Simplified relationship detection — forcing spouse relationship`);
        this.logger.log(`  User 1: ${user1Profile?.gender || 'unknown'}`);
        this.logger.log(`  User 2: ${user2Profile?.gender || 'unknown'}`);
        return 'spouse';
    }

    // ─── Generation calculation ─────────────────────────────────────────

    /**
     * Calculate the appropriate generation for any relationship type in a family tree.
     * Considers both users' existing generations and relationship type.
     */
    async calculateGeneration(
        familyCode: string,
        userId: number,
        partnerUserId: number,
        relationshipType: string,
        transaction: any,
    ): Promise<number> {
        // Check if the user already has a card in this family
        const existingCard = await this.familyTreeModel.findOne({
            where: { familyCode, userId },
            transaction,
        });

        if (existingCard) {
            this.logger.log(
                `User ${userId} already exists in family ${familyCode} with generation ${existingCard.generation}`,
            );
            return existingCard.generation;
        }

        // Check if the partner already has a card in this family
        const partnerCard = await this.familyTreeModel.findOne({
            where: { familyCode, userId: partnerUserId },
            transaction,
        });

        if (partnerCard) {
            const partnerGeneration = partnerCard.generation || 0;
            let calculatedGeneration: number;

            switch (relationshipType) {
                case 'spouse':
                case 'sibling':
                    calculatedGeneration = partnerGeneration;
                    break;
                case 'parent-child':
                    calculatedGeneration = partnerGeneration - 1;
                    break;
                default:
                    calculatedGeneration = partnerGeneration;
            }
            this.logger.log(
                `${relationshipType} relationship: calculated generation ${calculatedGeneration}`,
            );
            return calculatedGeneration;
        }

        // Find all existing family members to determine the appropriate generation
        const familyMembers = await this.familyTreeModel.findAll({
            where: { familyCode },
            transaction,
        });

        if (familyMembers.length === 0) {
            this.logger.log(`No existing members in family ${familyCode}, using generation 0`);
            return 0;
        }

        // Calculate generation based on most common (mode) among existing members
        const generationCounts: Record<string, number> = {};
        familyMembers.forEach((member) => {
            const gen = member.generation || 0;
            generationCounts[gen] = (generationCounts[gen] || 0) + 1;
        });

        const mostCommonGeneration = Object.keys(generationCounts).reduce((a, b) =>
            generationCounts[a] > generationCounts[b] ? a : b,
        );

        let calculatedGeneration = parseInt(mostCommonGeneration);

        switch (relationshipType) {
            case 'parent-child':
                calculatedGeneration = calculatedGeneration - 1;
                break;
            case 'spouse':
            case 'sibling':
                break;
            default:
                break;
        }

        this.logger.log(`Calculated generation ${calculatedGeneration} for ${relationshipType}`);
        return calculatedGeneration;
    }
}
