/**
 * N-CoreShift – Phase 5: CodeInventoryService
 * Orchestrates parsing of source files into inventory entries and dependency edges.
 * All records scoped by tenantId and projectId (Principle 18).
 */
import { randomUUID } from 'crypto';
import { parseSourceFile } from './AbapSourceParser.js';
import type {
  DependencyEdge,
  InventoryResult,
  ObjectInventoryEntry,
  SourceFileInput,
} from './types.js';

export class CodeInventoryService {
  buildInventory(
    files: SourceFileInput[],
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): {
    entries: ObjectInventoryEntry[];
    edges: DependencyEdge[];
    result: InventoryResult;
  } {
    const entries: ObjectInventoryEntry[] = [];
    const edges: DependencyEdge[] = [];
    const warnings: string[] = [];
    const objectsByType: Record<string, number> = {};
    const riskSignalsByType: Record<string, number> = {};
    let riskSignalCount = 0;
    let objectsWithHighRisk = 0;
    let unresolvedDependencies = 0;
    const now = new Date();

    for (const file of files) {
      try {
        const parsed = parseSourceFile(file);

        const entry: ObjectInventoryEntry = {
          id: randomUUID(),
          tenantId,
          projectId,
          analysisId,
          sourceFileId: file.id,
          objectName: parsed.objectName,
          objectType: parsed.objectType,
          packageName: parsed.packageName,
          programName: parsed.programName,
          parentObject: parsed.parentObject,
          confidence: parsed.confidence,
          provenance: parsed.provenance,
          evidenceLocation: `file:${file.fileName}`,
          rawKeywordMatches: parsed.rawKeywordMatches,
          detectedDescription: parsed.detectedDescription,
          technicalRiskSignals: [...new Set(parsed.riskSignals.map((r) => r.signal))],
          lineCount: parsed.lineCount,
          codeLineCount: parsed.codeLineCount,
          createdAt: now,
        };
        entries.push(entry);

        objectsByType[entry.objectType] = (objectsByType[entry.objectType] ?? 0) + 1;

        for (const signal of entry.technicalRiskSignals) {
          riskSignalsByType[signal] = (riskSignalsByType[signal] ?? 0) + 1;
          riskSignalCount++;
        }
        if (entry.technicalRiskSignals.length > 2) objectsWithHighRisk++;

        for (const dep of parsed.dependencies) {
          edges.push({
            id: randomUUID(),
            tenantId,
            projectId,
            analysisId,
            ...dep,
          });
          if (dep.confidence === 'UNCERTAIN' || dep.confidence === 'LOW') {
            unresolvedDependencies++;
          }
        }
      } catch (err) {
        warnings.push(`Failed to parse ${file.fileName}: ${String(err)}`);
      }
    }

    const result: InventoryResult = {
      analysisId,
      tenantId,
      projectId,
      objectCount: entries.length,
      dependencyCount: edges.length,
      riskSignalCount,
      objectsByType,
      riskSignalsByType,
      objectsWithHighRisk,
      unresolvedDependencies,
      parsingWarnings: warnings,
      completedAt: now,
    };

    return { entries, edges, result };
  }
}
