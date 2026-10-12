/**
 * N-CoreShift - Phase 9: Mock Code Generation AI Provider
 *
 * Used exclusively in tests and offline development.
 * Supports multiple simulation modes to exercise all service branches.
 */

import type { AIProvider } from '../providers/AIProvider.js';
import type { AICompletionRequest, AICompletionResponse, AIHealthStatus } from '../types/index.js';

export type MockCodeGenMode =
  | 'VALID'
  | 'VALID_ABAP_CLOUD'
  | 'VALID_CAP_NODEJS'
  | 'MALFORMED_JSON'
  | 'MISSING_SECTIONS'
  | 'PROVIDER_ERROR'
  | 'EMPTY_GENERATED_CODE';

export interface MockCodeGenProviderOptions {
  mode?: MockCodeGenMode;
  model?: string;
  provider?: string;
  latencyMs?: number;
}

const MANDATORY_LABEL = 'Generated implementation draft - consultant validation required.';

function makeValidAbapResponse(): string {
  return JSON.stringify({
    purpose: `${MANDATORY_LABEL}\nThis ABAP_CLOUD artifact modernises a custom pricing exit (EXIT_PRICING_001) to use the released BAdI SD_PRICING_BADI via ABAP Cloud APIs. The implementation removes direct table access to KONH/KONP and replaces it with the released API CL_SD_PRICING=>GET_CONDITIONS.`,
    preconditions:
      '1. Target system: SAP S/4HANA 2023 or later.\n2. BAdI SD_PRICING_BADI must be available in the target release.\n3. Released API CL_SD_PRICING must be accessible.\n4. Developer extensibility enabled in tenant configuration.\n5. ABAP Cloud version ABAP_CLOUD_VERSION must be activated.',
    generatedCode: [
      'CLASS zcl_ncs_pricing_badi_impl DEFINITION',
      '  PUBLIC',
      '  FINAL',
      '  CREATE PUBLIC.',
      '',
      '  PUBLIC SECTION.',
      '    "! @testing ABAP-Unit',
      '    INTERFACES if_sd_badi_pricing.',
      '',
      '  PRIVATE SECTION.',
      '    "! Released pricing API reference',
      '    DATA mv_pricing_api TYPE REF TO cl_sd_pricing.',
      '',
      'ENDCLASS.',
      '',
      'CLASS zcl_ncs_pricing_badi_impl IMPLEMENTATION.',
      '',
      '  METHOD if_sd_badi_pricing~determine_price.',
      '    "! Retrieve conditions via released API - no direct table access',
      '    DATA(lo_pricing) = cl_sd_pricing=>get_instance( ).',
      '    "! Delegate to released pricing determination logic',
      '    lo_pricing->determine_conditions(',
      '      EXPORTING iv_knumh = iv_condition_record_no',
      '      IMPORTING et_conditions = et_conditions ).',
      '  ENDMETHOD.',
      '',
      'ENDCLASS.',
    ].join('\n'),
    configurationRequired:
      'Create BAdI implementation in transaction SE19 or use ADT.\nAssign filter value: SD_PRICING_EXIT_001.\nActivate implementation after consultant review.',
    dependencies:
      'Released object: CL_SD_PRICING (class)\nReleased interface: IF_SD_BADI_PRICING\nBAdI definition: SD_PRICING_BADI',
    whereItBelongs:
      'Package: ZNCS_PRICING\nObject type: CLAS (ABAP Class)\nTransport: Assigned to project transport request.',
    howToValidate:
      '1. Run ABAP Unit tests included in zcl_ncs_pricing_badi_impl.\n2. Execute pricing determination in VA01 test scenario.\n3. Compare condition results against baseline ECC output.\n4. Verify no direct database access in SQL trace (ST05).',
    assumptions:
      '- BAdI SD_PRICING_BADI is available in target release 2023.\n- Released API CL_SD_PRICING covers all pricing condition types used by the legacy exit.\n- Single filter value is sufficient (multi-filter scenario not in scope).',
    itemsRequiringVerification:
      '- Confirm BAdI SD_PRICING_BADI availability in target release with SAP Note search.\n- Verify CL_SD_PRICING=>GET_CONDITIONS covers all KONH condition types accessed by the legacy exit.\n- Validate filter assignment does not conflict with existing BAdI implementations.',
    language: 'ABAP',
    targetPlatform: 'S4HANA_PUBLIC_CLOUD',
  });
}

function makeValidCapNodejsResponse(): string {
  return JSON.stringify({
    purpose: `${MANDATORY_LABEL}\nThis CAP Node.js/TypeScript service implements a side-by-side extension for custom approval workflow integration. It consumes the SAP S/4HANA Workflow API via a BTP destination and exposes a CAP OData service endpoint.`,
    preconditions:
      '1. SAP BTP Cloud Foundry environment provisioned.\n2. Destination "S4H_WORKFLOW_API" configured in BTP subaccount.\n3. SAP Workflow Management service instance bound.\n4. Node.js 18+ runtime available.',
    generatedCode: [
      '// @ts-check',
      '// N-CoreShift generated - consultant validation required',
      'import cds from "@sap/cds";',
      '',
      '/** Custom approval handler - connects to S/4HANA Workflow API via BTP destination */',
      'module.exports = cds.service.impl(async function (srv) {',
      '  const { ApprovalRequests } = this.entities;',
      '',
      '  /** Submit approval request to S/4HANA workflow */',
      '  srv.on("submitForApproval", async (req) => {',
      '    const { workflowInstanceId } = req.data;',
      '    // Destination lookup - never hardcode credentials',
      '    const destination = await cds.connect.to("S4H_WORKFLOW_API");',
      '    // Delegate to S/4HANA workflow API',
      '    const result = await destination.send({',
      '      method: "POST",',
      '      path: `/sap/opu/odata/sap/SWF_TASK_HDR_SRV/TaskInstanceSet`,',
      '      data: { WorkflowInstanceID: workflowInstanceId },',
      '    });',
      '    return result;',
      '  });',
      '});',
    ].join('\n'),
    configurationRequired:
      'Configure BTP destination "S4H_WORKFLOW_API" with:\n  - URL: https://<s4h-host>/sap/opu/odata\n  - Authentication: OAuth2SAMLBearerAssertion\n  - No credentials in code - use BTP destination service.',
    dependencies:
      '"@sap/cds": "^7.0.0"\n"@sap-cloud-sdk/http-client": "^3.0.0"\nBTP destination: S4H_WORKFLOW_API\nCAP schema: ApprovalRequests entity',
    whereItBelongs:
      'BTP CF space: ncs-extensions\nApp name: ncs-approval-handler\nMTA module: approval-srv',
    howToValidate:
      '1. Deploy to BTP CF and verify health endpoint responds.\n2. Call submitForApproval action with test workflowInstanceId.\n3. Verify workflow instance created in S/4HANA SWF_TASK_HDR_SRV.\n4. Check BTP application logs for destination resolution.',
    assumptions:
      '- BTP destination S4H_WORKFLOW_API is pre-configured by Basis/BTP admin.\n- OAuth2SAMLBearerAssertion trust is established between BTP and S/4HANA.\n- Single workflow type in scope (multi-workflow routing not modelled).',
    itemsRequiringVerification:
      '- Confirm SWF_TASK_HDR_SRV is released and available in target S/4HANA release.\n- Validate OAuth2 trust configuration with Basis team.\n- Verify BTP entitlements include Workflow Management service.',
    language: 'TypeScript',
    targetPlatform: 'BTP_CF',
  });
}

function makeMissingResponse(): string {
  return JSON.stringify({
    purpose: `${MANDATORY_LABEL}\nPartial response for testing.`,
    // Missing: preconditions, generatedCode, configurationRequired, etc.
    language: 'ABAP',
    targetPlatform: 'S4HANA_ON_PREMISE',
  });
}

function makeEmptyCodeResponse(): string {
  return JSON.stringify({
    purpose: `${MANDATORY_LABEL}\nEdition constraint prevents ABAP generation for Public Cloud. The requested artifact type ABAP is not compatible with S4HANA_PUBLIC_CLOUD edition constraints. Use ABAP_CLOUD instead.`,
    preconditions: 'N/A - artifact generation blocked by edition constraint.',
    generatedCode: '',
    configurationRequired: 'N/A',
    dependencies: 'N/A',
    whereItBelongs: 'N/A',
    howToValidate: 'N/A',
    assumptions: 'N/A',
    itemsRequiringVerification:
      'Consultant must confirm whether ABAP_CLOUD artifact type is appropriate for this object.',
    language: 'ABAP',
    targetPlatform: 'S4HANA_PUBLIC_CLOUD',
  });
}

export class MockCodeGenAIProvider implements AIProvider {
  private readonly _mode: MockCodeGenMode;
  private readonly _model: string;
  private readonly _provider: string;
  private readonly _latencyMs: number;

  constructor(options: MockCodeGenProviderOptions = {}) {
    this._mode = options.mode ?? 'VALID';
    this._model = options.model ?? 'mock-codegen-gpt4o';
    this._provider = options.provider ?? 'MockCodeGenProvider';
    this._latencyMs = options.latencyMs ?? 0;
  }

  get providerId(): string {
    return this._provider;
  }

  get providerName(): string {
    return this._provider;
  }

  isConfigured(): boolean {
    return true;
  }

  async listModels(): Promise<import('../types/index.js').AIModelInfo[]> {
    return [{ id: this._model, name: this._model }];
  }

  async generate(request: AICompletionRequest): Promise<AICompletionResponse> {
    if (this._latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this._latencyMs));
    }

    if (this._mode === 'PROVIDER_ERROR') {
      throw new Error('MockCodeGenAIProvider: simulated provider error during code generation');
    }

    let content: string;

    switch (this._mode) {
      case 'VALID':
      case 'VALID_ABAP_CLOUD':
        content = makeValidAbapResponse();
        break;
      case 'VALID_CAP_NODEJS':
        content = makeValidCapNodejsResponse();
        break;
      case 'MALFORMED_JSON':
        content = '{ purpose: "broken json missing quotes on key, generatedCode: "test" }';
        break;
      case 'MISSING_SECTIONS':
        content = makeMissingResponse();
        break;
      case 'EMPTY_GENERATED_CODE':
        content = makeEmptyCodeResponse();
        break;
      default:
        content = makeValidAbapResponse();
    }

    const inputTokens = Math.ceil(
      (request.messages.reduce((acc, m) => acc + m.content.length, 0) / 4),
    );
    const outputTokens = Math.ceil(content.length / 4);

    return {
      content,
      model: this._model,
      provider: this._provider,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  }

  async healthCheck(): Promise<AIHealthStatus> {
    return {
      configured: true,
      available: this._mode !== 'PROVIDER_ERROR',
      provider: this._provider,
      model: this._model,
      checkedAt: new Date().toISOString(),
    };
  }
}
