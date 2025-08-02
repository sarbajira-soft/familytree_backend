import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UserRelationship } from './model/user-relationship.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyTree } from './model/family-tree.model';
import { Transaction } from 'sequelize';
import { Op } from 'sequelize';

@Injectable()
export class RelationshipEdgeService {
  private readonly logger = new Logger(RelationshipEdgeService.name);

  constructor(
    @InjectModel(UserRelationship)
    private userRelationshipModel: typeof UserRelationship,
    @InjectModel(UserProfile)
    private userProfileModel: typeof UserProfile,
    @InjectModel(Family)
    private familyModel: typeof Family,
    @InjectModel(FamilyTree)
    private familyTreeModel: typeof FamilyTree,
  ) {}

  /**
   * Create a bidirectional relationship between two users
   */
  async createRelationshipEdge(
    user1Id: number,
    user2Id: number,
    relationshipType: string,
    transaction?: Transaction,
  ): Promise<{ relationship: UserRelationship; generatedFamilyCode: string }> {
    // Generate unique family code for this relationship
    const generatedFamilyCode = this.generateUniqueFamilyCode();

    // Create the relationship edge
    const relationship = await this.userRelationshipModel.create(
      {
        user1Id,
        user2Id,
        relationshipType,
        generatedFamilyCode,
        isBidirectional: true,
      },
      { transaction },
    );

    // Update associated family codes for both users
    await this.updateAssociatedFamilyCodes(user1Id, generatedFamilyCode, transaction);
    await this.updateAssociatedFamilyCodes(user2Id, generatedFamilyCode, transaction);

    this.logger.log(
      `Created relationship edge: ${user1Id} -> ${user2Id} (${relationshipType}) with family code: ${generatedFamilyCode}`,
    );

    return { relationship, generatedFamilyCode };
  }

  /**
   * Update associated family codes for a user
   */
  async updateAssociatedFamilyCodes(
    userId: number,
    familyCode: string,
    transaction?: Transaction,
  ): Promise<void> {
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
      transaction,
    });

    if (!userProfile) {
      this.logger.warn(`User profile not found for userId: ${userId}`);
      return;
    }

    // Initialize associatedFamilyCodes if it doesn't exist
    const currentAssociatedCodes = userProfile.associatedFamilyCodes || [];
    
    // Add the new family code if it's not already present
    if (!currentAssociatedCodes.includes(familyCode)) {
      const updatedCodes = [...currentAssociatedCodes, familyCode];
      
      await this.userProfileModel.update(
        { associatedFamilyCodes: updatedCodes },
        { where: { userId }, transaction },
      );

      this.logger.log(`Updated associated family codes for user ${userId}: ${updatedCodes.join(', ')}`);
    }
  }

  /**
   * Get all family codes a user is associated with
   */
  async getUserFamilyCodes(userId: number): Promise<{
    mainFamilyCode: string | null;
    associatedFamilyCodes: string[];
  }> {
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
    });

    if (!userProfile) {
      return { mainFamilyCode: null, associatedFamilyCodes: [] };
    }

    return {
      mainFamilyCode: userProfile.familyCode,
      associatedFamilyCodes: userProfile.associatedFamilyCodes || [],
    };
  }

  /**
   * Get all relationships for a user
   */
  async getUserRelationships(userId: number): Promise<UserRelationship[]> {
    return this.userRelationshipModel.findAll({
      where: {
        [Op.or]: [
          { user1Id: userId },
          { user2Id: userId },
        ],
      },
      include: [
        { model: this.userRelationshipModel.sequelize.models.User, as: 'user1' },
        { model: this.userRelationshipModel.sequelize.models.User, as: 'user2' },
      ],
    });
  }

  /**
   * Find all users in a specific family code (including relationships)
   */
  async getUsersInFamilyCode(familyCode: string): Promise<number[]> {
    // Get users from family tree
    const familyTreeUsers = await this.familyTreeModel.findAll({
      where: { familyCode },
      attributes: ['userId'],
    });

    // Get users from relationships
    const relationshipUsers = await this.userRelationshipModel.findAll({
      where: { generatedFamilyCode: familyCode },
      attributes: ['user1Id', 'user2Id'],
    });

    const userIds = new Set<number>();

    // Add family tree users
    familyTreeUsers.forEach(entry => {
      if (entry.userId) userIds.add(entry.userId);
    });

    // Add relationship users
    relationshipUsers.forEach(entry => {
      userIds.add(entry.user1Id);
      userIds.add(entry.user2Id);
    });

    return Array.from(userIds);
  }

  /**
   * Get all relationships for a specific family code
   */
  async getRelationshipsByFamilyCode(familyCode: string): Promise<UserRelationship[]> {
    return this.userRelationshipModel.findAll({
      where: { generatedFamilyCode: familyCode },
      include: [
        { model: this.userRelationshipModel.sequelize.models.User, as: 'user1' },
        { model: this.userRelationshipModel.sequelize.models.User, as: 'user2' },
      ],
    });
  }

  /**
   * Generate a unique family code for relationships
   */
  private generateUniqueFamilyCode(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `REL_${timestamp}_${random}`.toUpperCase();
  }

  /**
   * Get reverse relationship type
   */
  getReverseRelationship(relationshipType: string): string {
    const reverseMap: { [key: string]: string } = {
      'spouse': 'spouse',
      'parent-child': 'child-parent',
      'child-parent': 'parent-child',
      'sibling': 'sibling',
      'in-law': 'in-law',
    };

    return reverseMap[relationshipType] || relationshipType;
  }

  /**
   * Remove a relationship and update associated family codes
   */
  async removeRelationship(
    user1Id: number,
    user2Id: number,
    relationshipType: string,
    transaction?: Transaction,
  ): Promise<void> {
    const relationship = await this.userRelationshipModel.findOne({
      where: {
        user1Id,
        user2Id,
        relationshipType,
      },
      transaction,
    });

    if (relationship) {
      const familyCode = relationship.generatedFamilyCode;
      
      // Remove the relationship
      await relationship.destroy({ transaction });

      // Update associated family codes for both users
      await this.removeAssociatedFamilyCode(user1Id, familyCode, transaction);
      await this.removeAssociatedFamilyCode(user2Id, familyCode, transaction);

      this.logger.log(`Removed relationship: ${user1Id} -> ${user2Id} (${relationshipType})`);
    }
  }

  /**
   * Remove a family code from user's associated codes
   */
  private async removeAssociatedFamilyCode(
    userId: number,
    familyCode: string,
    transaction?: Transaction,
  ): Promise<void> {
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
      transaction,
    });

    if (userProfile && userProfile.associatedFamilyCodes) {
      const updatedCodes = userProfile.associatedFamilyCodes.filter(
        code => code !== familyCode,
      );

      await this.userProfileModel.update(
        { associatedFamilyCodes: updatedCodes },
        { where: { userId }, transaction },
      );
    }
  }
} 