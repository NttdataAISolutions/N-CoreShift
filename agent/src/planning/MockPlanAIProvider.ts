/**
 * N-CoreShift – Phase 8: Mock Plan AI Provider
 *
 * Deterministic mock for unit testing the ModernizationPlanningService.
 * Returns a full 18-section plan by default; can be configured to fail.
 */

import type { AIProvider } from '../providers/AIProvider.js';
import type { AICompletionRequest, AICompletionResponse } from '../types/index.js';
import { PLAN_SECTION_KEYS, PLAN_SECTION_TITLES } from './types.js';

export interface MockPlanProviderOptions {
  /** Simulate unconfigured provider (isConfigured returns false) */
  unconfigured?: boolean;
  /** Simulate a provider network error */
  throwError?: string;
  /** Override the raw response string returned */
  rawResponse?: string;
  /** Return malformed JSON */
  malformedJson?: boolean;
  /** Return JSON missing some sections */
  missingSections?: string[];
  /** Return sections with invalid step fields */
  invalidSteps?: boolean;
}

function buildMockPlanJson(opts: MockPlanProviderOptions): string {
  if (opts.malformedJson) return '{ not valid json at all :::';

  const sections = PLAN_SECTION_KEYS.filter(k =>
    !(opts.missingSections ?? []).includes(k)
  ).map(k => {
    if (k === 'IMPLEMENTATION_STEPS') {
      return {
        key: k,
        title: PLAN_SECTION_TITLES[k],
        content: 'Implement using the clean core extension approach.',
        steps: opts.invalidSteps
          ? [{ sequence: 1 }] // missing required fields
          : [
              {
                sequence: 1,
                title: 'Solution Architecture Review',
                description:
                  'Solution architect reviews the recommended target pattern and confirms approach.',
                responsibleRole: 'SOLUTION_ARCHITECT',
                prerequisites: [],
                verification: 'Architecture decision document signed off.',
                status: 'PENDING',
              },
              {
                sequence: 2,
                title: 'Identify Released BAdI / API',
                description:
                  'ABAP developer identifies the applicable released BAdI or API from the SAP Business Accelerator Hub.',
                responsibleRole: 'ABAP_DEVELOPER',
                prerequisites: ['Step 1 complete'],
                verification:
                  'Released object confirmed and listed in SAP_OBJECTS_TO_VERIFY.',
                status: 'PENDING',
              },
              {
                sequence: 3,
                title: 'Implement BTP Side-by-Side Extension',
                description:
                  'BTP developer scaffolds the CAP-based side-by-side extension project.',
                responsibleRole: 'BTP_DEVELOPER',
                prerequisites: ['Step 2 complete'],
                verification: 'Extension project compiles and connects to S/4 API.',
                status: 'PENDING',
              },
              {
                sequence: 4,
                title: 'Security and Authorization Setup',
                description:
                  'Security consultant defines PFCG roles and API access scopes for the extension.',
                responsibleRole: 'SECURITY_CONSULTANT',
                prerequisites: ['Step 3 complete'],
                verification: 'Authorization check passes in DEV client.',
                status: 'PENDING',
              },
              {
                sequence: 5,
                title: 'Business Process Owner Sign-off',
                description:
                  'Business process owner validates functional behaviour matches the documented requirement.',
                responsibleRole: 'BUSINESS_PROCESS_OWNER',
                prerequisites: ['Step 4 complete'],
                verification: 'Sign-off document recorded in project tracker.',
                status: 'PENDING',
              },
            ],
      };
    }
    return {
      key: k,
      title: PLAN_SECTION_TITLES[k],
      content: `Mock content for section ${PLAN_SECTION_TITLES[k]}.`,
    };
  });

  return JSON.stringify({
    summary:
      'Replace the classic ABAP enhancement with a released BAdI implementation ' +
      'on S/4HANA Cloud Private Edition, following the clean core extension principle.',
    estimatedComplexity: 'MEDIUM',
    keyRisks: [
      'Released BAdI may not cover all required enhancement spots.',
      'Integration points with legacy IDocs may require re-engineering.',
    ],
    assumptions: [
      'SAP Business Accelerator Hub has been consulted for released objects.',
      'Target system is S/4HANA Cloud Private Edition 2023.',
    ],
    sections,
  });
}

export class MockPlanAIProvider implements AIProvider {
  readonly providerId = 'mock-plan';
  readonly providerName = 'Mock Plan Provider';

  private readonly opts: MockPlanProviderOptions;

  constructor(opts: MockPlanProviderOptions = {}) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return !(this.opts.unconfigured ?? false);
  }

  async listModels() {
    return [{ id: 'mock-plan-v1', name: 'Mock Plan Provider v1' }];
  }

  async healthCheck() {
    return {
      configured: this.isConfigured(),
      available: true,
      provider: 'mock-plan',
      model: 'mock-plan-v1',
      checkedAt: new Date().toISOString(),
    };
  }

  async generate(_req: AICompletionRequest): Promise<AICompletionResponse> {
    if (this.opts.throwError) throw new Error(this.opts.throwError);
    const content =
      this.opts.rawResponse !== undefined
        ? this.opts.rawResponse
        : buildMockPlanJson(this.opts);
    return {
      content,
      model: 'mock-plan-v1',
      provider: 'mock-plan',
      usage: { inputTokens: 400, outputTokens: 900, totalTokens: 1300 },
    };
  }
}
