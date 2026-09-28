/**
 * tests/unit/goals-progress.test.ts
 *
 * Implements Unit Tests for Goals progress computation and milestone percentage math.
 */

import { describe, it, expect } from 'vitest';
import { calculateGoalProgress } from '../../src/features/goals/goals.dto.js';
import type { GoalEntity, MilestoneEntity } from '../../src/features/goals/goals.types.js';

describe('Goals Progress Calculation Unit Tests', () => {
  const baseGoal: GoalEntity = {
    id: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    title: 'Test Goal',
    description: null,
    status: 'active',
    progressType: 'numeric',
    targetValue: '100.0000',
    currentValue: '0.0000',
    unit: 'km',
    startDate: '2026-01-01',
    targetDate: '2026-12-31',
    achievedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1
  };

  describe('Numeric Goals Progress', () => {
    it('Calculates 0% when currentValue is 0', () => {
      const goal: GoalEntity = { ...baseGoal, currentValue: '0.0000', targetValue: '100.0000' };
      const { progressPercentage } = calculateGoalProgress(goal);
      expect(progressPercentage).toBe(0);
    });

    it('Calculates 50% when currentValue is half of target', () => {
      const goal: GoalEntity = { ...baseGoal, currentValue: '50.0000', targetValue: '100.0000' };
      const { progressPercentage } = calculateGoalProgress(goal);
      expect(progressPercentage).toBe(50);
    });

    it('Calculates fractional percentage correctly (e.g. 33.33%)', () => {
      const goal: GoalEntity = { ...baseGoal, currentValue: '1.0000', targetValue: '3.0000' };
      const { progressPercentage } = calculateGoalProgress(goal);
      expect(progressPercentage).toBe(33.33);
    });

    it('Caps progress percentage at 100% when currentValue exceeds targetValue', () => {
      const goal: GoalEntity = { ...baseGoal, currentValue: '150.0000', targetValue: '100.0000' };
      const { progressPercentage } = calculateGoalProgress(goal);
      expect(progressPercentage).toBe(100);
    });

    it('Safely returns 0% when targetValue is null or zero', () => {
      const goal: GoalEntity = { ...baseGoal, targetValue: null };
      expect(calculateGoalProgress(goal).progressPercentage).toBe(0);

      const zeroTargetGoal: GoalEntity = { ...baseGoal, targetValue: '0' };
      expect(calculateGoalProgress(zeroTargetGoal).progressPercentage).toBe(0);
    });
  });

  describe('Milestones Goals Progress', () => {
    const milestoneBaseGoal: GoalEntity = {
      ...baseGoal,
      progressType: 'milestones',
      targetValue: null,
      currentValue: null,
      unit: null
    };

    function createMilestone(id: string, completed: boolean): MilestoneEntity {
      return {
        id,
        userId: baseGoal.userId,
        goalId: baseGoal.id,
        title: `Milestone ${id}`,
        dueDate: null,
        completedAt: completed ? new Date() : null,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      };
    }

    it('Returns 0% when goal has no milestones', () => {
      const result = calculateGoalProgress(milestoneBaseGoal, []);
      expect(result.progressPercentage).toBe(0);
      expect(result.totalMilestones).toBe(0);
      expect(result.completedMilestones).toBe(0);
    });

    it('Calculates 33.33% when 1 of 3 milestones is completed', () => {
      const milestones: MilestoneEntity[] = [
        createMilestone('m1', true),
        createMilestone('m2', false),
        createMilestone('m3', false)
      ];
      const result = calculateGoalProgress(milestoneBaseGoal, milestones);
      expect(result.progressPercentage).toBe(33.33);
      expect(result.totalMilestones).toBe(3);
      expect(result.completedMilestones).toBe(1);
    });

    it('Calculates 50% when 2 of 4 milestones are completed', () => {
      const milestones: MilestoneEntity[] = [
        createMilestone('m1', true),
        createMilestone('m2', true),
        createMilestone('m3', false),
        createMilestone('m4', false)
      ];
      const result = calculateGoalProgress(milestoneBaseGoal, milestones);
      expect(result.progressPercentage).toBe(50);
      expect(result.totalMilestones).toBe(4);
      expect(result.completedMilestones).toBe(2);
    });

    it('Calculates 100% when all milestones are completed', () => {
      const milestones: MilestoneEntity[] = [
        createMilestone('m1', true),
        createMilestone('m2', true),
        createMilestone('m3', true)
      ];
      const result = calculateGoalProgress(milestoneBaseGoal, milestones);
      expect(result.progressPercentage).toBe(100);
      expect(result.totalMilestones).toBe(3);
      expect(result.completedMilestones).toBe(3);
    });
  });
});
