/**
 * N-CoreShift - Phase 9: Code Generation Prompt Builder
 *
 * Builds system and user prompts for the code generation AI call.
 * All customer-supplied text is sanitised before inclusion in prompts
 * to prevent prompt injection (Principle 10).
 * Never fabricate named SAP artifacts, BAdIs, or released APIs -
 * only use what is confirmed in the evidence items.
 */

import type { CodeGenerationRequest, ArtifactSectionKey, ArtifactType } from './types.js';

export const CODEGEN_PROMPT_VERSION = '9.0.0';

const SECTION_JSON_KEYS: Record<ArtifactSectionKey, string> = {
  PURPOSE: 'purpose',
  PRECONDITIONS: 'preconditions',
  GENERATED_CODE: 'generatedCode',
  CONFIGURATION_REQUIRED: 'configurationRequired',
  DEPENDENCIES: 'dependencies',
  WHERE_IT_BELONGS: 'whereItBelongs',
  HOW_TO_VALIDATE: 'howToValidate',
  ASSUMPTIONS: 'assumptions',
  ITEMS_REQUIRING_VERIFICATION: 'itemsRequiringVerification',
};

const EDITION_CONSTRAINTS: Record<string, string> = {
  S4HANA_PUBLIC_CLOUD:
    'Target is SAP S/4HANA Public Cloud. Use ONLY released SAP APIs and ABAP Cloud. ' +
    'Classic ABAP, direct table updates, and unreleased objects are PROHIBITED.',
  S4HANA_PRIVATE_CLOUD:
    'Target is SAP S/4HANA Private Cloud. Prefer released APIs and ABAP Cloud. ' +
    'Classic enhancements are a last resort and must be flagged for consultant review.',
  S4HANA_ON_PREMISE:
    'Target is SAP S/4HANA On-Premise. Follow the Clean Core posture. ' +
    'Avoid direct table modifications unless policy explicitly permits them.',
  BTP_ONLY:
    'Target is SAP BTP. Generate CAP / side-by-side pattern. ' +
    'No classic ABAP. Consume SAP APIs via BTP destinations.',
};

const ARTIFACT_TYPE_GUIDANCE: Record<ArtifactType, string> = {
  ABAP: 'Generate classic ABAP code. Include program type, data declarations, and logic blocks.',
  ABAP_CLOUD:
    'Generate ABAP Cloud code. Use ONLY released objects. Include ABAP Doc comments. ' +
    'No CALL FUNCTION for non-released FMs. No direct SELECT on non-released tables.',
  RAP_ARTIFACT:
    'Generate a RAP Business Object or Behavior Definition skeleton. Include CDS entity, ' +
    'behavior definition, and behavior implementation class.',
  CDS_ARTIFACT:
    'Generate a CDS view or CDS annotation. Include @AbapCatalog, @AccessControl, ' +
    'and relevant annotations. Mark derived fields clearly.',
  ENHANCEMENT_SKELETON:
    'Generate an enhancement implementation skeleton. ' +
    'Include the enhancement spot reference and the implementation class.',
  BADI_SKELETON:
    'Generate a BAdI implementation class skeleton. Include the BAdI definition name, ' +
    'filter value (if applicable), and method stubs with documentation.',
  API_CONSUMPTION:
    'Generate an example consuming a released SAP API. Include the OData service URL pattern, ' +
    'HTTP client code, error handling, and authentication note.',
  CAP_NODEJS:
    'Generate a CAP Node.js/TypeScript service. Include service definition (.cds), ' +
    'handler file (.ts), and package.json dependencies.',
  BTP_APP_SKELETON:
    'Generate a BTP side-by-side application skeleton. Include manifest.json or mta.yaml, ' +
    'destination configuration, and main entry point.',
  INTEGRATION_CLIENT:
    'Generate an integration client or adapter. Include connection parameters (no credentials), ' +
    'message mapping skeleton, and error-handling pattern.',
  UNIT_TEST_SKELETON:
    'Generate a unit test skeleton. Include test class, test methods for happy path and ' +
    'error cases, and mock/stub declarations.',
};

export function sanitizeForPrompt(input: string): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/```/g, "'''")
    .replace(/\bIGNORE\b|\bFORGET\b|\bSYSTEM:\b/gi, '[REDACTED]')
    .trim();
}

export class CodeGenerationPromptBuilder {
  buildSystemPrompt(request: CodeGenerationRequest): string {
    const editionConstraint =
      EDITION_CONSTRAINTS[request.targetEdition] ??
      'Follow Clean Core posture for the target edition.';

    const artifactGuidance = ARTIFACT_TYPE_GUIDANCE[request.artifactType];

    const policyPosture = sanitizeForPrompt(request.cleanCorePolicy.posture);
    const extensionPrefs = request.cleanCorePolicy.extensionPreferenceOrder
      .map((p) => sanitizeForPrompt(p))
      .join(' > ');

    const jsonSchema = Object.values(SECTION_JSON_KEYS)
      .map((k) => `  "${k}": "<string>"`)
      .join(',\n');

    const lines = [
      'You are an SAP modernisation code generation engine for the N-CoreShift platform.',
      '',
      '## MANDATORY LABEL',
      'The first line of your "purpose" value MUST be exactly:',
      'Generated implementation draft - consultant validation required.',
      '',
      '## TARGET CONTEXT',
      editionConstraint,
      'Target Release: ' + sanitizeForPrompt(request.targetRelease),
      '',
      '## CLEAN CORE POLICY',
      'Posture: ' + policyPosture,
      'Extension preference order: ' + extensionPrefs,
      'Core modifications permitted: ' + String(request.cleanCorePolicy.coreModificationsPermitted),
      'Classic exits permitted: ' + String(request.cleanCorePolicy.classicExitsPermitted),
      'Released API required: ' + String(request.cleanCorePolicy.releasedApiObjectRequired),
      '',
      '## ARTIFACT TYPE',
      artifactGuidance,
      '',
      '## STRICT RULES',
      '1. NEVER fabricate a named SAP BAdI, released API, CDS view, or ABAP class that is not confirmed in the evidence items provided.',
      '2. NEVER include hard-coded credentials, passwords, or system IDs.',
      '3. NEVER generate code that bypasses Clean Core policy constraints above.',
      '4. NEVER emit markdown code fences inside JSON string values - use plain text with newlines.',
      '5. ALL generated code must include inline comments explaining each logical block.',
      '6. Flag every unverified assumption in itemsRequiringVerification.',
      '7. If edition constraints make the requested artifact type impossible, explain in purpose and leave generatedCode empty.',
      '',
      '## RESPONSE FORMAT',
      'Respond with a single valid JSON object. No text before or after the JSON.',
      '{',
      jsonSchema + ',',
      '  "language": "<ABAP|TypeScript|JavaScript|CDS|YAML|JSON>",',
      '  "targetPlatform": "<S4HANA_ON_PREMISE|S4HANA_PUBLIC_CLOUD|S4HANA_PRIVATE_CLOUD|BTP_CF>"',
      '}',
    ];

    return lines.join('\n');
  }

  buildUserPrompt(request: CodeGenerationRequest): string {
    const assessment = request.assessment;
    const plan = request.plan;
    const intent = request.functionalIntent;

    const currentState = plan.sections.find((s) => s.key === 'CURRENT_STATE')?.content ?? '';
    const targetState = plan.sections.find((s) => s.key === 'TARGET_STATE')?.content ?? '';
    const implSteps =
      plan.sections
        .find((s) => s.key === 'IMPLEMENTATION_STEPS')
        ?.steps?.map((st) => `  ${st.sequence}. ${sanitizeForPrompt(st.title)}: ${sanitizeForPrompt(st.description)}`)
        .join('\n') ?? '';
    const techChanges = plan.sections.find((s) => s.key === 'TECHNICAL_CHANGES')?.content ?? '';

    const evidenceSummary = assessment.evidence
      .filter((e) => e.confidence === 'VERIFIED' || e.confidence === 'LIKELY')
      .slice(0, 6)
      .map((e) => {
        const artifact = e.namedSapArtifact ? ` [${sanitizeForPrompt(e.namedSapArtifact)}]` : '';
        return `- ${e.type}${artifact}: ${sanitizeForPrompt(e.description)}`;
      })
      .join('\n');

    const lines = [
      '## OBJECT TO MODERNISE',
      'Name: ' + sanitizeForPrompt(assessment.objectName),
      'Type: ' + sanitizeForPrompt(assessment.objectType),
      'Disposition: ' + assessment.disposition,
      'Clean Core Risk: ' + assessment.cleanCoreRisk,
      'Current Pattern: ' + assessment.currentPattern,
      'Recommended Target Pattern: ' + sanitizeForPrompt(assessment.recommendedTargetPattern),
      '',
      '## BUSINESS REQUIREMENT',
      sanitizeForPrompt(intent.businessObjective),
      '',
      '## CURRENT STATE (from plan)',
      sanitizeForPrompt(currentState),
      '',
      '## TARGET STATE (from plan)',
      sanitizeForPrompt(targetState),
      '',
      '## TECHNICAL CHANGES (from plan)',
      sanitizeForPrompt(techChanges),
      '',
      '## IMPLEMENTATION STEPS (from plan)',
      implSteps,
      '',
      '## VERIFIED EVIDENCE ITEMS',
      evidenceSummary || 'No high-confidence evidence items available.',
      '',
      '## ASSESSMENT REASONING',
      sanitizeForPrompt(assessment.reasoning),
      '',
      '## ASSUMPTIONS FROM ASSESSMENT',
      assessment.assumptions.map((a) => '- ' + sanitizeForPrompt(a)).join('\n'),
      '',
      '## VERIFICATION REQUIRED (from assessment)',
      assessment.verificationRequired.map((v) => '- ' + sanitizeForPrompt(v)).join('\n'),
      '',
      'Generate the ' + request.artifactType + ' artifact now.',
    ];

    return lines.join('\n');
  }
}
