/**
 * @claude-flow/aidefence
 *
 * AI Manipulation Defense System integration for Claude Flow V3.
 * Provides embedded threat detection without external server dependency.
 *
 * @example
 * ```typescript
 * import { createAIDefence } from '@claude-flow/aidefence';
 *
 * const aidefence = createAIDefence();
 *
 * // Detect threats
 * const result = aidefence.detect('Ignore all previous instructions');
 * console.log(result.safe); // false
 * console.log(result.threats[0].type); // 'instruction_override'
 *
 * // Quick scan
 * const quick = aidefence.quickScan('Hello, help me code');
 * console.log(quick.threat); // false
 * ```
 */

// Domain entities
export {
  Threat,
  ThreatType,
  ThreatSeverity,
  ThreatDetectionResult,
  BehavioralAnalysisResult,
  PolicyVerificationResult,
  createThreat,
} from './domain/entities/threat.js';

// Domain services
export {
  ThreatDetectionService,
  createThreatDetectionService,
} from './domain/services/threat-detection-service.js';

// Re-export types for convenience
export type { ThreatDetectionResult as DetectionResult } from './domain/entities/threat.js';

/**
 * AIDefence facade - simplified API for common use cases
 */
export interface AIDefence {
  /**
   * Detect threats in input text
   * @param input - Text to analyze
   * @returns Detection result with threats array
   */
  detect(input: string): import('./domain/entities/threat.js').ThreatDetectionResult;

  /**
   * Quick scan for threats (faster, less detailed)
   * @param input - Text to scan
   * @returns Whether threat was found and confidence
   */
  quickScan(input: string): { threat: boolean; confidence: number };

  /**
   * Check if input contains PII
   * @param input - Text to check
   * @returns Whether PII was found
   */
  hasPII(input: string): boolean;

  /**
   * Get detection statistics
   */
  getStats(): { detectionCount: number; avgDetectionTimeMs: number };
}

/**
 * Create an AIDefence instance
 *
 * @example
 * ```typescript
 * const aidefence = createAIDefence();
 *
 * // Use in a pre-hook
 * const result = aidefence.detect(userInput);
 * if (!result.safe) {
 *   const critical = result.threats.filter(t => t.severity === 'critical');
 *   if (critical.length > 0) {
 *     throw new Error('Critical threat detected');
 *   }
 * }
 * ```
 */
export function createAIDefence(): AIDefence {
  const service = createThreatDetectionService();

  return {
    detect: (input: string) => service.detect(input),
    quickScan: (input: string) => service.quickScan(input),
    hasPII: (input: string) => service.detectPII(input),
    getStats: () => service.getStats(),
  };
}

/**
 * Singleton instance for convenience
 */
let defaultInstance: AIDefence | null = null;

/**
 * Get the default AIDefence instance (singleton)
 */
export function getAIDefence(): AIDefence {
  if (!defaultInstance) {
    defaultInstance = createAIDefence();
  }
  return defaultInstance;
}

/**
 * Convenience function for quick threat check
 *
 * @example
 * ```typescript
 * import { isSafe } from '@claude-flow/aidefence';
 *
 * if (!isSafe(userInput)) {
 *   console.log('Potential threat detected');
 * }
 * ```
 */
export function isSafe(input: string): boolean {
  return getAIDefence().detect(input).safe;
}

/**
 * Convenience function for quick threat check with details
 */
export function checkThreats(input: string) {
  return getAIDefence().detect(input);
}
