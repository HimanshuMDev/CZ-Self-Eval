import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../common/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const SANDBOX_FILE = path.join(DATA_DIR, 'sandbox.json');

const logger = createLogger('SandboxService');

export interface CustomScenario {
  id: string;
  title: string;
  description: string;
  scenarioContext: string; // The text to act as evidenceContext
  createdAt: string;
}

class SandboxService {
  private async ensureDataFile() {
    try {
      await fs.access(DATA_DIR);
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
    
    try {
      await fs.access(SANDBOX_FILE);
    } catch {
      await fs.writeFile(SANDBOX_FILE, JSON.stringify([], null, 2));
    }
  }

  async getScenarios(): Promise<CustomScenario[]> {
    try {
      await this.ensureDataFile();
      const content = await fs.readFile(SANDBOX_FILE, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error({ error }, '[SandboxService] Failed to read sandbox scenarios');
      return [];
    }
  }

  async saveScenario(scenario: Omit<CustomScenario, 'id' | 'createdAt'>): Promise<CustomScenario> {
    try {
      const scenarios = await this.getScenarios();
      const newScenario: CustomScenario = {
        ...scenario,
        id: `sandbox_${Date.now()}`,
        createdAt: new Date().toISOString()
      };
      
      scenarios.push(newScenario);
      await fs.writeFile(SANDBOX_FILE, JSON.stringify(scenarios, null, 2));
      return newScenario;
    } catch (error) {
      logger.error({ error }, '[SandboxService] Failed to save scenario');
      throw error;
    }
  }

  async deleteScenario(id: string): Promise<void> {
    try {
      let scenarios = await this.getScenarios();
      scenarios = scenarios.filter(s => s.id !== id);
      await fs.writeFile(SANDBOX_FILE, JSON.stringify(scenarios, null, 2));
    } catch (error) {
      logger.error({ error, id }, '[SandboxService] Failed to delete scenario');
      throw error;
    }
  }
}

export const sandboxService = new SandboxService();
