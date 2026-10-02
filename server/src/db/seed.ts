import { DatabaseSync } from 'node:sqlite';
import { TraceRepository } from '../repositories/trace.repository.js';
import { TraceService } from '../services/trace.service.js';
import { SimulatorService } from '../services/simulator.service.js';

export function seedDatabase(db: DatabaseSync): void {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM traces').get() as { count: number };
  if (countRow && countRow.count > 0) {
    return; // Already seeded
  }

  console.log('[TracePulse Seed] Seeding initial distributed microservice traces...');
  const traceRepo = new TraceRepository(db);
  const traceService = new TraceService(traceRepo);
  const simulator = new SimulatorService(traceService);

  // Generate a diverse batch of 15 traces
  simulator.simulateBatch(15);
  console.log('[TracePulse Seed] Initialized 15 sample traces.');
}
