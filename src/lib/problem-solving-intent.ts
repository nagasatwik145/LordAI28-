export type ProblemSolvingIntentKind =
  "solve" | "general-education" | "hint" | "check-answer" | "none";

export type ProblemSolvingPreference = "work-together" | "show-answer" | "quiz" | "voice";

export interface ProblemSolvingIntent {
  kind: ProblemSolvingIntentKind;
  confidence: number;
  subject?: string;
  reason?: string;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function detectProblemSolvingIntent(
  input: string,
  attachmentKinds: Array<string> = [],
): ProblemSolvingIntent {
  const text = normalize(input);

  if (!text) {
    if (attachmentKinds.some((kind) => kind === "image" || kind === "pdf")) {
      return {
        kind: "solve",
        confidence: 0.68,
        reason: "Image or PDF attachment suggests an exercise or worksheet.",
      };
    }
    return { kind: "none", confidence: 0 };
  }

  const explicitHint = /\b(?:hint|clue|give me a hint|just a hint|help me with a hint)\b/i.test(
    text,
  );
  const explicitCheck =
    /\b(?:check my answer|check(?:ing)? my work|verify my solution|is my answer correct|did i solve it|check whether this is correct|answer check|is this correct)\b/i.test(
      text,
    );
  const generalExplain =
    /\b(?:explain|describe|define|what is|why is|how does|differentiate|compare|contrast|summarize|concept|theory|principle)\b/i.test(
      text,
    ) &&
    !/\b(?:solve|equation|calculate|find the value|find x|worksheet|exercise|question paper|numerical|problem|answer all|question)\b/i.test(
      text,
    );
  const translation = /\b(?:translate|translation|translat(?:e|ion)|traduce)\b/i.test(text);
  const writingTask =
    /\b(?:essay|paragraph|email|letter|story|poem|rewrite|paraphrase|proofread|improve|caption|blog|speech)\b/i.test(
      text,
    );

  if (translation || writingTask) {
    return { kind: "none", confidence: 0.96, reason: "Text-generation or translation task." };
  }

  if (explicitHint) {
    return {
      kind: "hint",
      confidence: 0.9,
      subject: detectSubject(text),
      reason: "The user asks for a hint instead of a full answer.",
    };
  }

  if (explicitCheck) {
    return {
      kind: "check-answer",
      confidence: 0.92,
      subject: detectSubject(text),
      reason: "The user is checking an existing solution.",
    };
  }

  if (generalExplain) {
    return {
      kind: "general-education",
      confidence: 0.82,
      subject: detectSubject(text),
      reason: "This is a conceptual explanation rather than a problem-solving request.",
    };
  }

  const solvePatterns =
    /\b(?:solve|solving|resuelve|resolver|calculate|calcula|compute|evaluat(?:e|ion)|determine|determina|find the (?:value|answer) of|find x|find the value of x|find the answer to this question|valor de x|answer all|answer the following|answer this question|numerical|numérico|worksheet|worksheets|exercise|ejercicio|question paper|question set|equation|ecuaci[oó]n|problem|problema|chemistry|physics|geometry|algebra|trigonometry|biology|social science|english literature|balanc(?:e|ing)|derive|differentiate|integrate|prove)\b/i;

  if (
    solvePatterns.test(text) ||
    attachmentKinds.some((kind) => kind === "image" || kind === "pdf")
  ) {
    return {
      kind: "solve",
      confidence: 0.9,
      subject: detectSubject(text),
      reason: "This looks like a genuine exercise or worksheet problem.",
    };
  }

  return { kind: "none", confidence: 0.1, reason: "No clear problem-solving request." };
}

export function detectSubject(text: string): string | undefined {
  const normalized = normalize(text);

  if (
    /\b(?:chemistry|reaction|balance|balancing|mole|organic|inorganic|stoichiometry)\b/i.test(
      normalized,
    )
  ) {
    return "chemistry";
  }

  if (
    /\b(?:algebra|equation|quadratic|linear|matrix|probability|calculus|derivative|integral|geometry|trigonometry|statistics|arithmetic|solve x|value of x|maths|math|mathematics)\b/i.test(
      normalized,
    )
  ) {
    return "mathematics";
  }

  if (
    /\b(?:physics|mechanics|numerical|force|motion|velocity|acceleration|electricity|optics)\b/i.test(
      normalized,
    )
  ) {
    return "physics";
  }

  if (/\b(?:biology|genetics|cell|ecosystem|ecology|human physiology)\b/i.test(normalized)) {
    return "biology";
  }

  if (/\b(?:history|geography|social science|economics|civics|politics|map)\b/i.test(normalized)) {
    return "social science";
  }

  if (/\b(?:english|literature|poem|novel|play|grammar|language)\b/i.test(normalized)) {
    return "english";
  }

  return undefined;
}
