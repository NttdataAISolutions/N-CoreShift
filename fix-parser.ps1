$tail = @'
  {
    re: /\bCLIENT\s*=\s*'[0-9]{3}'/gi,
    signal: 'HARD_CODED_CLIENT',
    note: 'Hard-coded client number detected',
    conf: 'HIGH',
  },
  {
    re: /\bSY-SYSID\b|\bSY-HOST\b/gi,
    signal: 'HARD_CODED_SYSTEM',
    note: 'System ID or host reference - system assumption',
    conf: 'MEDIUM',
  },
  {
    re: /\bSELECT\s+\*?\s+FROM\s+[A-Z_]\w+\s+(?:WHERE|INTO)/gi,
    signal: 'DIRECT_TABLE_ACCESS',
    note: 'Direct table SELECT - dependency on SAP internal table structure',
    conf: 'LOW',
  },
];

// ── Main Parse Function ────────────────────────────────────────────────────

/**
 * Parse a single source file and return structured findings.
 * Comments are stripped before any pattern matching (security boundary).
 * All findings store confidence and provenance - never silently assume HIGH confidence.
 */
export function parseSourceFile(input: SourceFileInput): ParsedSourceFile {
  const rawLines = input.content.split('\n');
  const cleanLines = rawLines.map(stripAbapComments).filter((l) => l.length > 0);

  // Classify from filename first
  const fileClass = classifyFromFilename(input.fileName);

  // Refine from content (operates only on comment-stripped lines)
  const contentClass = refineObjectTypeFromContent(cleanLines, fileClass.objectType);

  const finalObjectType = contentClass.objectType;
  const finalConfidence: FindingConfidence =
    contentClass.confidence === 'HIGH' ? 'HIGH' : fileClass.confidence;

  // Extract dependencies (only on clean lines)
  const cleanCode = cleanLines.join('\n');
  const dependencies: ParsedSourceFile['dependencies'] = [];
  const seenDeps = new Set<string>();

  for (const pat of DEP_PATTERNS) {
    pat.re.lastIndex = 0;
    let m: RegExpMatchArray | null;
    while ((m = pat.re.exec(cleanCode)) !== null) {
      const target = pat.extract(m).toUpperCase();
      if (!target || target.length < 2) continue;
      const key = `${pat.type}:${target}`;
      if (seenDeps.has(key)) continue;
      seenDeps.add(key);
      // Find line number in original (not clean) content
      const lineIdx = rawLines.findIndex((l) => stripAbapComments(l).includes(m![0].split('\n')[0]));
      const evidenceLocation = lineIdx >= 0 ? `${input.fileName}:${lineIdx + 1}` : input.fileName;
      dependencies.push({
        sourceObject: fileClass.objectName,
        targetObject: target,
        dependencyType: pat.type,
        evidenceLocation,
        confidence: pat.conf,
        provenance: 'REGEX_HEURISTIC',
      });
    }
  }

  // Detect risk signals (only on clean lines)
  const riskSignals: RiskSignalOccurrence[] = [];
  const seenRisks = new Set<string>();

  for (const pat of RISK_PATTERNS) {
    pat.re.lastIndex = 0;
    let m: RegExpMatchArray | null;
    while ((m = pat.re.exec(cleanCode)) !== null) {
      const key = `${pat.signal}:${m[0].substring(0, 40)}`;
      if (seenRisks.has(key)) continue;
      seenRisks.add(key);
      const lineIdx = rawLines.findIndex((l) => stripAbapComments(l).includes(m![0].split('\n')[0].trim()));
      const evidenceLocation = lineIdx >= 0 ? `${input.fileName}:${lineIdx + 1}` : input.fileName;
      riskSignals.push({
        signal: pat.signal,
        note: pat.note,
        evidenceLocation,
        confidence: pat.conf,
        snippet: m[0].substring(0, 80),
      });
    }
  }

  return {
    objectName: fileClass.objectName,
    objectType: finalObjectType,
    fileName: input.fileName,
    objectTypeConfidence: finalConfidence,
    objectTypeProvenance: contentClass.provenance,
    objectTypeKeywords: contentClass.keywords,
    dependencies,
    riskSignals,
    lineCount: rawLines.length,
    cleanLineCount: cleanLines.length,
  };
}
'@

$file = 'C:\N-CoreShift\agent\src\inventory\AbapSourceParser.ts'
Add-Content -Path $file -Value $tail
Write-Host "Done appending to $file"
