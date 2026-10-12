# N-CoreShift – Architecture Document

**Product:** N-CoreShift  
**Version:** 0.1.0 (Phase 0 foundation)  
**Tagline:** From custom code to Clean Core – with a path to implementation.

---

## 1. Product Purpose

N-CoreShift is a standalone AI-powered SAP Clean Core Modernization Agent. It analyzes existing SAP custom developments, understands their functional purpose and technical dependencies, evaluates them against SAP standard capabilities and Clean Core principles, and recommends whether each object should be:

- **Retired** – functionality is obsolete, unused, or no longer required
- **Replaced** – business need met by applicable SAP standard functionality
- **Refactored** – redesigned using a supported Clean Core extensibility mechanism
- **Replatformed** – decoupled side-by-side extension on SAP BTP
- **Requires Review** – insufficient evidence or human judgment required

When the target pattern is sufficiently verified, N-CoreShift produces a step-by-step modernization plan and consultant-ready implementation drafts.

N-CoreShift is **not** an automatic deployment engine, not a code-remediation bot, and not a replacement for SAP architecture approval or Fit-to-Standard workshops.

---

## 2. The 4R Outcome Model

Every analyzed custom object receives one of these dispositions:

| Disposition | Meaning |
|---|---|
| RETIRE | Obsolete, unused, or no longer required |
| REPLACE | Business need met by SAP standard/configuration |
| REFACTOR | Redesign using supported Clean Core extensibility |
| REPLATFORM | Better as a decoupled BTP side-by-side extension |
| REQUIRES_REVIEW | Insufficient evidence or human judgment needed |

N-CoreShift never forces all objects into RETIRE/REPLACE/REFACTOR/REPLATFORM. `REQUIRES_REVIEW` is a valid and often correct outcome.

---

## 3. Mandatory Landscape Readiness Gate

Assessment and code generation are gated behind a customer/project landscape profile. This is a foundational product requirement, not a UX convenience.

### Readiness States

```
DRAFT → INCOMPLETE → READY_FOR_ASSESSMENT → APPROVED_FOR_ASSESSMENT → APPROVED_FOR_CODE_GENERATION
```

### Gate Rules

- **Source upload** may proceed before readiness is complete.
- **Assessment** is blocked until `assessmentAllowed = true`.
- **Code generation** is blocked until `codeGenerationAllowed = true`.
- If target deployment model, target release, or Clean Core policy changes after assessments exist, affected assessments are flagged for revalidation.

### Required Profile Sections

1. **Project/Customer Context** – customer name, project, transformation scenario, industry, modules in scope, governance contacts
2. **Source System Profile** – ERP product (ECC/S/4HANA), version, deployment model, available evidence (ATC, SCMON, usage data, etc.)
3. **Target System Profile** – target deployment model (On-Premise / Cloud Private Edition / Cloud Public Edition), target release, extensibility capabilities allowed
4. **Clean Core Policy** – posture (Strict/Balanced/Transitional/Custom), extension preference order, policy controls (modifications, classic exits, unreleased objects, etc.)
5. **Governance Policy** – architecture review required, approver roles, evidence and confidence thresholds for automated recommendations and code generation

---

## 4. Edition and Release Awareness

N-CoreShift supports these target deployment models independently:

- SAP S/4HANA On-Premise
- SAP S/4HANA Cloud Private Edition
- SAP S/4HANA Cloud Public Edition

**Rules:**
- A capability, API, extension point, or development technique valid for one edition/release is **never assumed valid** for another.
- No SAP APIs, BAdIs, enhancement spots, CDS views, business objects, scope items, released objects, or configuration capabilities are invented.
- Every recommendation must carry edition/release applicability context.
- Evidence must distinguish: VERIFIED / LIKELY / REQUIRES_VERIFICATION / INSUFFICIENT_EVIDENCE.

---

## 5. Local Development Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Developer Workstation                                       │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ React + TS   │   │ CAP Node.js  │   │ Analysis Agent │  │
│  │ Vite Dev     │──▶│ + Express    │──▶│ TypeScript     │  │
│  │ Port 5173    │   │ Port 4004    │   │ Services       │  │
│  └──────────────┘   └──────┬───────┘   └────────────────┘  │
│                            │                                │
│                     ┌──────▼───────┐                        │
│                     │ SQLite DB    │                        │
│                     │ (local dev)  │                        │
│                     └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

Local authentication uses a development adapter. XSUAA/enterprise identity is preserved for BTP deployment.

---

## 6. Shared-VM / Docker Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Compose (shared VM / CI)                            │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ app          │   │ srv          │   │ agent          │  │
│  │ (React SPA)  │   │ (CAP srv)    │   │ (analysis)     │  │
│  └──────┬───────┘   └──────┬───────┘   └────────┬───────┘  │
│         └──────────────────┴──────────────────────┘        │
│                            │                                │
│                     ┌──────▼───────┐                        │
│                     │ PostgreSQL   │                        │
│                     │ (shared dev) │                        │
│                     └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. BTP Cloud Foundry Production Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  SAP BTP Cloud Foundry                                             │
│                                                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────────────┐  │
│  │ HTML5 App    │    │ App Router   │    │ N-CoreShift CF App  │  │
│  │ Repository   │───▶│ (XSUAA)      │───▶│ (CAP + Agent)       │  │
│  └──────────────┘    └──────────────┘    └──────────┬──────────┘  │
│                                                     │             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────▼──────────┐  │
│  │ SAP AI Core  │    │ Destination  │    │ SAP HANA Cloud      │  │
│  │ / Gen AI Hub │    │ Service      │    │ (+ Vector Engine)   │  │
│  └──────────────┘    └──────────────┘    └─────────────────────┘  │
│                                                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────────────┐  │
│  │ XSUAA        │    │ Connectivity │    │ Object Store        │  │
│  │ Service      │    │ Service      │    │ Service             │  │
│  └──────────────┘    └──────────────┘    └─────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
         │ Cloud Connector
┌────────▼───────────────────────┐
│  Customer SAP On-Premise System│
│  (Phase 11 – connected source) │
└────────────────────────────────┘
```

Production rules:
- Application instances are **stateless** and horizontally scalable.
- Customer source code is never persisted on ephemeral local disk.
- Credentials/secrets never stored in database or UI – environment/service bindings only.
- Hard-coded endpoints/credentials are prohibited.

---

## 8. Provider / Adapter Strategy

All cross-cutting concerns are accessed through provider abstractions. No domain service directly depends on a concrete infrastructure implementation.

| Provider Interface | Purpose | Local Adapter | Production Adapter |
|---|---|---|---|
| `AIProvider` | LLM communication | `MockAIProvider` | `SapAICoreProvider` / OpenAI |
| `VectorStore` | Semantic/vector retrieval | `MockVectorStore` | HANA Cloud Vector Engine |
| `KnowledgeProvider` | SAP knowledge retrieval | File-based mock | KnowledgeSearchService |
| `CodeSourceProvider` | Source code ingestion | `FileUploadSourceProvider` | `AbapGitSourceProvider` / `SAPSystemSourceProvider` |
| `FileStorageProvider` | File/object storage | `LocalFileStorageProvider` | BTP Object Store |
| `AuthProvider` | Authentication/authorization | Dev adapter | BTP XSUAA |
| `IntegrationProvider` | External system integration | Mock | BTP Destination + Connectivity |

**Rules:**
- Never silently fall back to a different LLM provider when the configured provider is unavailable.
- All LLM communication goes through `AIProvider`.
- All vector retrieval goes through `VectorStore`.
- All knowledge retrieval goes through `KnowledgeProvider`.
- All source ingestion goes through `CodeSourceProvider`.

---

## 9. Evidence-First Reasoning

Every recommendation must be based on evidence. Evidence has a confidence level:

| Level | Meaning |
|---|---|
| VERIFIED | Confirmed applicable to target edition/release |
| LIKELY | Strong indication but not fully confirmed |
| REQUIRES_VERIFICATION | Needs human or system verification |
| INSUFFICIENT_EVIDENCE | Cannot make a reliable recommendation |

**Rules:**
- Never recommend a named SAP API, BAdI, CDS view, or released object without evidence of applicability to the configured target edition/release.
- Never invent SAP capabilities.
- `REQUIRES_REVIEW` is the correct disposition when evidence is insufficient.
- Every recommendation exposes confidence and uncertainty.

---

## 10. Human Approval Model

Human consultant/architect approval is authoritative. The system supports but never replaces human judgment.

| Gate | What requires approval |
|---|---|
| Landscape Readiness | Project architect approves landscape profile before assessment |
| Clean Core Recommendation | Consultant reviews/edits/approves AI functional interpretation |
| Modernization Plan | Solution architect approves plan before code generation |
| Generated Code | Consultant validates, accepts, or rejects generated drafts |

Generated code always carries the label:  
> **Generated implementation draft – consultant validation required.**

N-CoreShift never automatically activates code, creates transports, or deploys anything.

---

## 11. Data Isolation

All persistent records are scoped by `tenantId` and `projectId`. No cross-tenant data access is permitted. Landscape profiles, analyses, assessments, plans, and generated artifacts are all tenant/project scoped.

---

## 12. Core Domain Boundaries

These are modeled as independent services/interfaces. Business logic must not be buried inside React components or CAP HTTP handlers.

| Service | Responsibility |
|---|---|
| `LandscapeProfileService` | Create/update/version landscape profiles |
| `LandscapeReadinessService` | Evaluate gate completion, compute readiness state |
| `CodeSourceProvider` | Ingest custom code from supported sources |
| `SourceParser` | Parse/identify SAP objects from raw source |
| `CodeInventoryService` | Maintain structured inventory of custom objects |
| `DependencyAnalyzer` | Identify dependencies between custom and standard objects |
| `FunctionalIntentAnalyzer` | AI-assisted functional purpose derivation |
| `KnowledgeProvider` | Retrieve authoritative SAP knowledge |
| `VectorStore` | Semantic similarity and evidence retrieval |
| `FitToStandardEvaluator` | Evaluate business need against SAP standard |
| `CleanCoreAssessmentEngine` | Produce 4R dispositions with evidence |
| `ExtensibilityDecisionService` | Apply policy to determine permitted extension patterns |
| `ModernizationPlanner` | Generate step-by-step modernization plans |
| `CodeGenerationService` | Generate implementation drafts (gated) |
| `AIProvider` | Abstract LLM communication |
| `FileStorageProvider` | Abstract file/object storage |
| `AuthProvider` | Abstract authentication/authorization |
| `IntegrationProvider` | Abstract external system integration |
| `AuditService` | Immutable audit trail for all significant actions |
| `BackgroundJobService` | Manage long-running package analysis jobs |

---

## 13. Generated-Code Governance

Code generation is disabled unless ALL of the following are true:

1. Landscape Readiness state is `APPROVED_FOR_CODE_GENERATION`
2. Target edition and target release are present and approved
3. Clean Core policy is present and approved
4. Modernization recommendation is approved
5. Modernization plan is approved (state: `Approved`)
6. Technical pattern is sufficiently verified
7. Required evidence threshold is met (per governance policy)

If any named SAP artifact remains uncertain, it is not fabricated.

Generated artifacts always display:  
> **Generated implementation draft – consultant validation required.**

---

## 14. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | |
| Backend | SAP CAP + Node.js + TypeScript | |
| Analysis Engine | Modular TypeScript services | Independent of CAP handlers |
| Local DB | SQLite | Development only |
| Production DB | SAP HANA Cloud | |
| Vector/Semantic | SAP HANA Cloud Vector Engine | Production |
| AI | Provider abstraction | SAP AI Core / Generative AI Hub (production) |
| Deployment | SAP BTP Cloud Foundry | MTA-compatible |
| Auth (local) | Dev adapter | |
| Auth (production) | XSUAA / enterprise identity | |
| Container | Docker / Docker Compose | Local/CI |
| Background Jobs | Job abstraction (`BackgroundJobService`) | |

---

## 15. Workspace Structure

```
n-coreshift/
├── agent/                  # Analysis engine – pure TypeScript domain services
│   ├── src/
│   │   ├── providers/      # Provider interfaces (AIProvider, VectorStore, etc.)
│   │   ├── services/       # Domain service interfaces (domain-interfaces.ts)
│   │   └── types/          # Shared domain types
│   └── package.
