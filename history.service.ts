import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../common/utils/logger.js';
import { type SimulationResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const LOCK_FILE = HISTORY_FILE + '.lock';
const logger = createLogger('HistoryService');

// ─── File-lock mechanism for concurrency safety ──────────────────────────────
async function withFileLock<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Try to create the lock file exclusively
      const fd = await fs.open(LOCK_FILE, 'wx');
      await fd.close();

      try {
        // Lock acquired, execute the operation
        return await fn();
      } finally {
        // Always delete the lock file
        try {
          await fs.unlink(LOCK_FILE);
        } catch {
          // Ignore if lock file already deleted
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If lock file exists, wait and retry
      if (lastError.message.includes('EEXIST')) {
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
      } else {
        // Not a lock contention error, fail immediately
        throw lastError;
      }
    }
  }

  throw new Error(`Failed to acquire file lock after ${maxRetries} attempts: ${lastError?.message}`);
}

export class HistoryService {
  private async ensureDataFile(): Promise<void> {
    try {
      await fs.access(HISTORY_FILE);
    } catch {
      await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
      await fs.writeFile(HISTORY_FILE, JSON.stringify([]));
    }
  }

  async saveResult(result: SimulationResult): Promise<void> {
    try {
      await withFileLock(async () => {
        await this.ensureDataFile();
        const content = await fs.readFile(HISTORY_FILE, 'utf-8');
        const history: SimulationResult[] = JSON.parse(content);

        // Save full result
        history.unshift({
          ...result,
          // Ensure timestamp is added for sorting on the frontend if not part of simulationId somehow
        });

        // Keep only last 100 history items to prevent unbounded growth
        await fs.writeFile(HISTORY_FILE, JSON.stringify(history.slice(0, 100), null, 2));
        logger.info({ simulationId: result.simulationId }, '[HistoryService] Saved simulation result to history');
      });
    } catch (error) {
      logger.error({ error }, '[HistoryService] Failed to save simulation history');
    }
  }

  async getHistory(): Promise<SimulationResult[]> {
    try {
      await this.ensureDataFile();
      const content = await fs.readFile(HISTORY_FILE, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error({ error }, '[HistoryService] Failed to read simulation history');
      return [];
    }
  }

  async addComment(simulationId: string, text: string): Promise<void> {
    try {
      await withFileLock(async () => {
        await this.ensureDataFile();
        const content = await fs.readFile(HISTORY_FILE, 'utf-8');
        const history: SimulationResult[] = JSON.parse(content);
        const index = history.findIndex(h => h.simulationId === simulationId);
        if (index === -1) return;

        const record = history[index];
        if (!record.comments) record.comments = [];
        record.comments.push({ timestamp: new Date().toISOString(), text });

        await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
      });
    } catch (error) {
      logger.error({ error, simulationId }, '[HistoryService] Failed to add comment');
    }
  }

  async saveReport(simulationId: string, reportMarkdown: string): Promise<void> {
    try {
      await withFileLock(async () => {
        await this.ensureDataFile();
        const content = await fs.readFile(HISTORY_FILE, 'utf-8');
        const history: SimulationResult[] = JSON.parse(content);
        const index = history.findIndex(h => h.simulationId === simulationId);
        if (index === -1) return;

        history[index].reportMarkdown = reportMarkdown;

        await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
      });
    } catch (error) {
      logger.error({ error, simulationId }, '[HistoryService] Failed to save report');
    }
  }
}

export const historyService = new HistoryService();
