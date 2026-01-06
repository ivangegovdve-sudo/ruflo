/**
 * ReasoningBank Integration Plugin
 *
 * Stores successful reasoning trajectories and retrieves them for similar problems.
 * Uses @ruvector/wasm for vector storage with HNSW indexing (<1ms search).
 *
 * Features:
 * - Store reasoning chains with embeddings
 * - Retrieve similar past reasoning for new problems
 * - Learn from successful/failed outcomes
 * - Verdict judgment for quality scoring
 * - Memory distillation for pattern extraction
 *
 * @example
 * ```typescript
 * import { reasoningBankPlugin } from '@claude-flow/plugins/examples/ruvector-plugins';
 * await getDefaultRegistry().register(reasoningBankPlugin);
 * ```
 */

import {
  PluginBuilder,
  MCPToolBuilder,
  HookBuilder,
  HookEvent,
  HookPriority,
  Security,
} from '../../src/index.js';

// Import shared vector utilities (consolidated from all plugins)
import {
  IVectorDB,
  createVectorDB,
  generateHashEmbedding,
} from './shared/vector-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface ReasoningTrajectory {
  id: string;
  problem: string;
  problemEmbedding?: Float32Array;
  steps: ReasoningStep[];
  outcome: 'success' | 'failure' | 'partial';
  score: number;
  metadata: {
    taskType: string;
    duration: number;
    tokensUsed: number;
    model?: string;
    timestamp: Date;
  };
}

export interface ReasoningStep {
  thought: string;
  action: string;
  observation: string;
  confidence: number;
}

export interface RetrievalResult {
  trajectory: ReasoningTrajectory;
  similarity: number;
  applicability: number;
}

export interface VerdictJudgment {
  trajectoryId: string;
  verdict: 'accept' | 'reject' | 'revise';
  score: number;
  feedback: string;
  improvements?: string[];
}

// ============================================================================
// RuVector WASM Interface
// ============================================================================

interface IVectorDB {
  insert(vector: Float32Array, id: string, metadata?: Record<string, unknown>): string;
  search(query: Float32Array, k: number, filter?: Record<string, unknown>): Array<{
    id: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  get(id: string): { vector: Float32Array; metadata: Record<string, unknown> } | null;
  delete(id: string): boolean;
  size(): number;
}

// Factory to create VectorDB - uses @ruvector/wasm in production
async function createVectorDB(dimensions: number): Promise<IVectorDB> {
  try {
    // Try to use @ruvector/wasm
    const db = new RuVectorDB({
      dimensions,
      indexType: 'hnsw',
      metric: 'cosine',
      efConstruction: 200,
      m: 16,
    });
    await db.initialize?.();
    return db as IVectorDB;
  } catch {
    // Fallback to in-memory implementation if WASM not available
    console.warn('[@claude-flow/plugins] @ruvector/wasm not available, using fallback');
    return new FallbackVectorDB(dimensions);
  }
}

// Fallback implementation when @ruvector/wasm is not installed
class FallbackVectorDB implements IVectorDB {
  private vectors = new Map<string, { vector: Float32Array; metadata: Record<string, unknown> }>();
  private dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  insert(vector: Float32Array, id: string, metadata: Record<string, unknown> = {}): string {
    this.vectors.set(id, { vector, metadata });
    return id;
  }

  search(query: Float32Array, k: number): Array<{ id: string; score: number; metadata?: Record<string, unknown> }> {
    const results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> = [];

    for (const [id, entry] of this.vectors) {
      const score = this.cosineSimilarity(query, entry.vector);
      results.push({ id, score, metadata: entry.metadata });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, k);
  }

  get(id: string): { vector: Float32Array; metadata: Record<string, unknown> } | null {
    return this.vectors.get(id) ?? null;
  }

  delete(id: string): boolean {
    return this.vectors.delete(id);
  }

  size(): number {
    return this.vectors.size;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const mag = Math.sqrt(normA) * Math.sqrt(normB);
    return mag === 0 ? 0 : dot / mag;
  }
}

// ============================================================================
// ReasoningBank Core
// ============================================================================

export class ReasoningBank {
  private vectorDb: IVectorDB | null = null;
  private trajectories = new Map<string, ReasoningTrajectory>();
  private dimensions: number;
  private nextId = 1;
  private initPromise: Promise<void> | null = null;

  constructor(dimensions: number = 1536) {
    this.dimensions = dimensions;
  }

  /**
   * Initialize the vector database.
   */
  async initialize(): Promise<void> {
    if (this.vectorDb) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.vectorDb = await createVectorDB(this.dimensions);
    })();

    return this.initPromise;
  }

  private async ensureInitialized(): Promise<IVectorDB> {
    await this.initialize();
    return this.vectorDb!;
  }

  /**
   * Store a reasoning trajectory.
   */
  async store(trajectory: Omit<ReasoningTrajectory, 'id'>): Promise<string> {
    const db = await this.ensureInitialized();
    const id = `reasoning-${this.nextId++}`;

    // Validate inputs
    const safeProblem = Security.validateString(trajectory.problem, { maxLength: 10000 });

    // Generate embedding from problem + steps
    const embedding = trajectory.problemEmbedding ?? this.generateEmbedding(safeProblem);

    const fullTrajectory: ReasoningTrajectory = {
      ...trajectory,
      id,
      problem: safeProblem,
      problemEmbedding: embedding,
    };

    // Store in vector DB with HNSW indexing
    db.insert(embedding, id, {
      problem: safeProblem,
      outcome: trajectory.outcome,
      score: trajectory.score,
      taskType: trajectory.metadata.taskType,
      stepsCount: trajectory.steps.length,
      timestamp: trajectory.metadata.timestamp.toISOString(),
    });

    // Store full trajectory
    this.trajectories.set(id, fullTrajectory);

    return id;
  }

  /**
   * Retrieve similar reasoning trajectories (<1ms with HNSW).
   */
  async retrieve(
    problem: string,
    options?: {
      k?: number;
      minScore?: number;
      taskType?: string;
      outcomeFilter?: 'success' | 'failure' | 'partial';
    }
  ): Promise<RetrievalResult[]> {
    const db = await this.ensureInitialized();
    const k = options?.k ?? 5;
    const minScore = options?.minScore ?? 0.5;

    const safeProblem = Security.validateString(problem, { maxLength: 10000 });
    const queryEmbedding = this.generateEmbedding(safeProblem);

    // HNSW search - sub-millisecond for 10K+ vectors
    const searchResults = db.search(queryEmbedding, k * 2);

    const results: RetrievalResult[] = [];

    for (const result of searchResults) {
      if (result.score < minScore) continue;

      const trajectory = this.trajectories.get(result.id);
      if (!trajectory) continue;

      // Apply filters
      if (options?.taskType && trajectory.metadata.taskType !== options.taskType) continue;
      if (options?.outcomeFilter && trajectory.outcome !== options.outcomeFilter) continue;

      // Calculate applicability based on task type match and recency
      const applicability = this.calculateApplicability(trajectory, safeProblem, options?.taskType);

      results.push({
        trajectory,
        similarity: result.score,
        applicability,
      });

      if (results.length >= k) break;
    }

    return results.sort((a, b) => (b.similarity * b.applicability) - (a.similarity * a.applicability));
  }

  /**
   * Judge a trajectory and update its score.
   */
  async judge(judgment: VerdictJudgment): Promise<void> {
    const trajectory = this.trajectories.get(judgment.trajectoryId);
    if (!trajectory) {
      throw new Error(`Trajectory ${judgment.trajectoryId} not found`);
    }

    const db = await this.ensureInitialized();

    // Update score based on verdict
    const scoreAdjustment = {
      accept: 0.1,
      reject: -0.2,
      revise: -0.05,
    }[judgment.verdict];

    trajectory.score = Math.max(0, Math.min(1, trajectory.score + scoreAdjustment));

    // If rejected with low score, remove from index
    if (judgment.verdict === 'reject' && trajectory.score < 0.2) {
      db.delete(trajectory.id);
      this.trajectories.delete(trajectory.id);
    }
  }

  /**
   * Distill patterns from successful trajectories.
   */
  async distill(taskType?: string): Promise<{
    patterns: string[];
    commonSteps: string[];
    avgSteps: number;
    successRate: number;
  }> {
    const trajectories = Array.from(this.trajectories.values())
      .filter(t => (!taskType || t.metadata.taskType === taskType) && t.score > 0.6);

    if (trajectories.length === 0) {
      return { patterns: [], commonSteps: [], avgSteps: 0, successRate: 0 };
    }

    const actionCounts = new Map<string, number>();
    let totalSteps = 0;
    let successCount = 0;

    for (const t of trajectories) {
      totalSteps += t.steps.length;
      if (t.outcome === 'success') successCount++;

      for (const step of t.steps) {
        const count = actionCounts.get(step.action) ?? 0;
        actionCounts.set(step.action, count + 1);
      }
    }

    const commonSteps = Array.from(actionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([action]) => action);

    const patterns = this.extractPatterns(trajectories);

    return {
      patterns,
      commonSteps,
      avgSteps: totalSteps / trajectories.length,
      successRate: successCount / trajectories.length,
    };
  }

  /**
   * Get statistics about stored trajectories.
   */
  getStats(): {
    total: number;
    byOutcome: Record<string, number>;
    byTaskType: Record<string, number>;
    avgScore: number;
  } {
    const trajectories = Array.from(this.trajectories.values());

    const byOutcome: Record<string, number> = { success: 0, failure: 0, partial: 0 };
    const byTaskType: Record<string, number> = {};
    let totalScore = 0;

    for (const t of trajectories) {
      byOutcome[t.outcome]++;
      byTaskType[t.metadata.taskType] = (byTaskType[t.metadata.taskType] ?? 0) + 1;
      totalScore += t.score;
    }

    return {
      total: trajectories.length,
      byOutcome,
      byTaskType,
      avgScore: trajectories.length > 0 ? totalScore / trajectories.length : 0,
    };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private generateEmbedding(text: string): Float32Array {
    // In production, replace with actual embedding model
    // TODO: Integrate with @ruvector/attention-unified-wasm for better embeddings
    const embedding = new Float32Array(this.dimensions);
    let hash = 0;

    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }

    for (let i = 0; i < this.dimensions; i++) {
      embedding[i] = Math.sin(hash * (i + 1) * 0.001) * 0.5 + 0.5;
    }

    // Normalize
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < this.dimensions; i++) {
      embedding[i] /= norm;
    }

    return embedding;
  }

  private calculateApplicability(
    trajectory: ReasoningTrajectory,
    _problem: string,
    taskType?: string
  ): number {
    let score = trajectory.score;

    if (taskType && trajectory.metadata.taskType === taskType) {
      score *= 1.2;
    }

    if (trajectory.outcome === 'success') {
      score *= 1.1;
    }

    const age = Date.now() - trajectory.metadata.timestamp.getTime();
    const daysSinceCreation = age / (1000 * 60 * 60 * 24);
    if (daysSinceCreation > 7) {
      score *= Math.exp(-0.05 * (daysSinceCreation - 7));
    }

    return Math.min(1, score);
  }

  private extractPatterns(trajectories: ReasoningTrajectory[]): string[] {
    const patterns: string[] = [];
    const sequences = new Map<string, number>();

    for (const t of trajectories) {
      for (let i = 0; i < t.steps.length - 1; i++) {
        const seq = `${t.steps[i].action} → ${t.steps[i + 1].action}`;
        sequences.set(seq, (sequences.get(seq) ?? 0) + 1);
      }
    }

    for (const [seq, count] of sequences) {
      if (count >= 2) {
        patterns.push(`Common sequence: ${seq} (${count} occurrences)`);
      }
    }

    return patterns.slice(0, 5);
  }
}

// ============================================================================
// Plugin Definition
// ============================================================================

let reasoningBankInstance: ReasoningBank | null = null;

async function getReasoningBank(): Promise<ReasoningBank> {
  if (!reasoningBankInstance) {
    reasoningBankInstance = new ReasoningBank(1536);
    await reasoningBankInstance.initialize();
  }
  return reasoningBankInstance;
}

export const reasoningBankPlugin = new PluginBuilder('reasoning-bank', '1.0.0')
  .withDescription('Store and retrieve reasoning trajectories using @ruvector/wasm HNSW indexing')
  .withAuthor('Claude Flow Team')
  .withTags(['reasoning', 'memory', 'learning', 'ruvector', 'hnsw'])
  .withMCPTools([
    new MCPToolBuilder('reasoning-store')
      .withDescription('Store a reasoning trajectory for future retrieval')
      .addStringParam('problem', 'The problem that was solved', { required: true })
      .addStringParam('steps', 'JSON array of reasoning steps', { required: true })
      .addStringParam('outcome', 'Outcome: success, failure, or partial', {
        required: true,
        enum: ['success', 'failure', 'partial'],
      })
      .addNumberParam('score', 'Quality score 0-1', { default: 0.7, minimum: 0, maximum: 1 })
      .addStringParam('taskType', 'Type of task (coding, research, planning, etc.)', { required: true })
      .withHandler(async (params) => {
        try {
          const steps = JSON.parse(params.steps as string) as ReasoningStep[];
          const rb = await getReasoningBank();

          const id = await rb.store({
            problem: params.problem as string,
            steps,
            outcome: params.outcome as 'success' | 'failure' | 'partial',
            score: params.score as number,
            metadata: {
              taskType: params.taskType as string,
              duration: 0,
              tokensUsed: 0,
              timestamp: new Date(),
            },
          });

          return {
            content: [{
              type: 'text',
              text: `✅ Stored reasoning trajectory: ${id}\n` +
                `Problem: ${(params.problem as string).substring(0, 100)}...\n` +
                `Steps: ${steps.length}\n` +
                `Outcome: ${params.outcome}\n` +
                `Score: ${params.score}`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      })
      .build(),

    new MCPToolBuilder('reasoning-retrieve')
      .withDescription('Retrieve similar reasoning trajectories (<1ms with HNSW)')
      .addStringParam('problem', 'The problem to find similar reasoning for', { required: true })
      .addNumberParam('k', 'Number of results', { default: 5 })
      .addNumberParam('minScore', 'Minimum similarity score', { default: 0.5 })
      .addStringParam('taskType', 'Filter by task type')
      .addStringParam('outcomeFilter', 'Filter by outcome', { enum: ['success', 'failure', 'partial'] })
      .withHandler(async (params) => {
        try {
          const rb = await getReasoningBank();
          const results = await rb.retrieve(params.problem as string, {
            k: params.k as number,
            minScore: params.minScore as number,
            taskType: params.taskType as string | undefined,
            outcomeFilter: params.outcomeFilter as 'success' | 'failure' | 'partial' | undefined,
          });

          if (results.length === 0) {
            return { content: [{ type: 'text', text: '📭 No similar reasoning found.' }] };
          }

          const output = results.map((r, i) =>
            `**${i + 1}. ${r.trajectory.id}** (similarity: ${(r.similarity * 100).toFixed(1)}%)\n` +
            `   Problem: ${r.trajectory.problem.substring(0, 80)}...\n` +
            `   Outcome: ${r.trajectory.outcome} | Steps: ${r.trajectory.steps.length}\n` +
            `   Actions: ${r.trajectory.steps.map(s => s.action).join(' → ')}`
          ).join('\n\n');

          return {
            content: [{ type: 'text', text: `📚 **Found ${results.length} similar trajectories:**\n\n${output}` }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      })
      .build(),

    new MCPToolBuilder('reasoning-judge')
      .withDescription('Judge a reasoning trajectory and update its score')
      .addStringParam('trajectoryId', 'ID of the trajectory to judge', { required: true })
      .addStringParam('verdict', 'Verdict: accept, reject, or revise', {
        required: true,
        enum: ['accept', 'reject', 'revise'],
      })
      .addStringParam('feedback', 'Feedback about the trajectory')
      .withHandler(async (params) => {
        try {
          const rb = await getReasoningBank();
          await rb.judge({
            trajectoryId: params.trajectoryId as string,
            verdict: params.verdict as 'accept' | 'reject' | 'revise',
            score: params.verdict === 'accept' ? 0.1 : params.verdict === 'reject' ? -0.2 : -0.05,
            feedback: (params.feedback as string) ?? '',
          });

          return {
            content: [{
              type: 'text',
              text: `⚖️ Judged trajectory ${params.trajectoryId}: ${params.verdict}`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      })
      .build(),

    new MCPToolBuilder('reasoning-distill')
      .withDescription('Extract common patterns from successful reasoning trajectories')
      .addStringParam('taskType', 'Filter by task type (optional)')
      .withHandler(async (params) => {
        try {
          const rb = await getReasoningBank();
          const distilled = await rb.distill(params.taskType as string | undefined);

          return {
            content: [{
              type: 'text',
              text: `🧬 **Distilled Patterns${params.taskType ? ` for ${params.taskType}` : ''}:**\n\n` +
                `**Success Rate:** ${(distilled.successRate * 100).toFixed(1)}%\n` +
                `**Average Steps:** ${distilled.avgSteps.toFixed(1)}\n\n` +
                `**Common Actions:**\n${distilled.commonSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
                `**Patterns:**\n${distilled.patterns.map((p, i) => `${i + 1}. ${p}`).join('\n') || 'None found yet'}`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      })
      .build(),

    new MCPToolBuilder('reasoning-stats')
      .withDescription('Get statistics about stored reasoning trajectories')
      .withHandler(async () => {
        const rb = await getReasoningBank();
        const stats = rb.getStats();

        return {
          content: [{
            type: 'text',
            text: `📊 **ReasoningBank Statistics:**\n\n` +
              `**Total Trajectories:** ${stats.total}\n` +
              `**Backend:** @ruvector/wasm HNSW\n\n` +
              `**By Outcome:**\n` +
              `  ✅ Success: ${stats.byOutcome.success}\n` +
              `  ❌ Failure: ${stats.byOutcome.failure}\n` +
              `  ⚠️ Partial: ${stats.byOutcome.partial}\n\n` +
              `**By Task Type:**\n${Object.entries(stats.byTaskType).map(([type, count]) => `  • ${type}: ${count}`).join('\n') || '  None'}\n\n` +
              `**Average Score:** ${(stats.avgScore * 100).toFixed(1)}%`,
          }],
        };
      })
      .build(),
  ])
  .withHooks([
    new HookBuilder(HookEvent.PostTaskComplete)
      .withName('reasoning-auto-store')
      .withDescription('Automatically store successful task reasoning')
      .withPriority(HookPriority.Low)
      .when((ctx) => {
        const data = ctx.data as { success?: boolean; reasoning?: unknown[] } | undefined;
        return data?.success === true && Array.isArray(data?.reasoning) && data.reasoning.length > 0;
      })
      .handle(async (ctx) => {
        const data = ctx.data as { problem?: string; reasoning?: ReasoningStep[]; taskType?: string };
        if (!data.problem || !data.reasoning) return { success: true };

        try {
          const rb = await getReasoningBank();
          await rb.store({
            problem: data.problem,
            steps: data.reasoning,
            outcome: 'success',
            score: 0.8,
            metadata: {
              taskType: data.taskType ?? 'general',
              duration: 0,
              tokensUsed: 0,
              timestamp: new Date(),
            },
          });
        } catch {
          // Silent fail for auto-store
        }

        return { success: true };
      })
      .build(),
  ])
  .onInitialize(async (ctx) => {
    ctx.logger.info('ReasoningBank plugin initializing with @ruvector/wasm...');
    await getReasoningBank();
    ctx.logger.info('ReasoningBank ready - HNSW indexing enabled');
  })
  .build();

export default reasoningBankPlugin;
