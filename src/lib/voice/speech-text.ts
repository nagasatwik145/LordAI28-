const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function decodeHtmlEntities(text: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: " ",
    lt: " ",
    nbsp: " ",
    quot: '"',
  };
  return text
    .replace(/&lt;([\p{L}\d_.-]+)&gt;/giu, "$1")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] === "#") {
        const codePoint =
          name[1]?.toLowerCase() === "x"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : " ";
      }
      return named[name.toLowerCase()] ?? entity;
    });
}

function describeJson(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => describeJson(item, depth + 1))
      .filter(Boolean)
      .join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${describeJson(item, depth + 1)}`)
      .join(depth > 0 ? ", " : ". ");
  }
  return "";
}

function verbalizeJsonIfComplete(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return describeJson(JSON.parse(trimmed));
  } catch {
    return text;
  }
}

function speakUrl(url: string) {
  const trailing = url.match(/[.,!?;:]+$/)?.[0] ?? "";
  const clean = trailing ? url.slice(0, -trailing.length) : url;
  const spoken = clean
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "www ")
    .replace(/%([\da-f]{2})/gi, (_, hex: string) => {
      try {
        return decodeURIComponent(`%${hex}`);
      } catch {
        return " ";
      }
    })
    .replace(/\./g, " dot ")
    .replace(/\//g, " slash ")
    .replace(/\?/g, ", query ")
    .replace(/&/g, ", and ")
    .replace(/=/g, " equals ")
    .replace(/#/g, ", section ");
  return `${spoken}${trailing}`;
}

function speakDate(match: string, year: string, month: string, day: string) {
  const monthIndex = Number(month) - 1;
  const dayNumber = Number(day);
  if (monthIndex < 0 || monthIndex > 11 || dayNumber < 1 || dayNumber > 31) return match;
  return `${MONTHS[monthIndex]} ${dayNumber}, ${year}`;
}

/**
 * Produces speech-only text from a response. Keep the stored/displayed answer
 * intact; call this only at TTS boundaries.
 */
export function normalizeSpeechText(input: string): string {
  if (!input) return "";

  let text = input.normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");

  // Turn machine-formatted JSON into key/value phrases instead of reading its punctuation.
  text = text.replace(/```\s*(?:json|jsonc)\s*\n?([\s\S]*?)```/gi, (block, json: string) => {
    try {
      return describeJson(JSON.parse(json));
    } catch {
      return block;
    }
  });

  // Keep link labels and destinations, but never send Markdown delimiters to speech.
  text = text.replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
    const linkText = label.trim() || "image";
    return `${linkText} (link: ${url})`;
  });

  // Protect addresses and URLs while punctuation and Markdown are normalized.
  const protectedItems: string[] = [];
  const protect = (spoken: string) => {
    const token = `\uE000${protectedItems.length}\uE001`;
    protectedItems.push(spoken);
    return token;
  };
  // Remove HTML tags but retain their readable contents.
  text = text.replace(
    /<\/?(?:a|abbr|article|b|blockquote|br|button|caption|code|div|em|figcaption|footer|h[1-6]|header|hr|i|img|li|ol|p|pre|section|small|span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul|video|audio|source)\b(?:\s[^<>]*?)?\s*\/?>/gi,
    " ",
  );
  text = decodeHtmlEntities(text);
  text = verbalizeJsonIfComplete(text);
  text = text.replace(
    /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+\b/gi,
    (email) =>
      protect(
        email
          .replace(/@/g, " at ")
          .replace(/\./g, " dot ")
          .replace(/\+/g, " plus ")
          .replace(/_/g, " underscore "),
      ),
  );
  text = text.replace(/\b(?:https?:\/\/|www\.)[^\s<>()[\]{}]+/gi, (url) => protect(speakUrl(url)));

  // Retain code contents while removing fences and language labels. JSON not inside a
  // fenced block is handled conservatively so prose and technical terms remain readable.
  text = text.replace(
    /```([^\n`]*)\n?([\s\S]*?)```/g,
    (_block, _language: string, code: string) => ` ${code} `,
  );

  // Markdown structure is presentation, not spoken content.
  text = text.replace(/^\s*\|([^\n]+)\|\s*$/gm, (_line, body: string) => {
    const cells = body.split("|").map((cell) => cell.trim());
    if (cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return "";
    return `${cells.filter(Boolean).join(", ")}.`;
  });
  text = text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, " ")
    .replace(/^\s*[-*+]\s+(?=\S)/gm, "")
    .replace(/^\s*\d+[.)]\s+(?=\S)/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, " ")
    .replace(/\|/g, ", ")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`/g, " ");

  // Common abbreviations and dates are clearer when expanded before sentence chunking.
  text = text
    .replace(/\b(?:e\.g\.)/gi, "for example")
    .replace(/\b(?:i\.e\.)/gi, "that is")
    .replace(/\bDr\./g, "Doctor")
    .replace(/\bMr\./g, "Mister")
    .replace(/\bMrs\./g, "Missus")
    .replace(/\bMs\./g, "Miss")
    .replace(/\bProf\./g, "Professor")
    .replace(/\bvs\./gi, "versus")
    .replace(/\bU\.S\.(?:A\.)?/g, "United States")
    .replace(/\bU\.K\./g, "United Kingdom")
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, speakDate);

  // Mathematical and programming operators are translated only when they join operands.
  text = text
    .replace(/\bC\+\+/g, "C plus plus")
    .replace(/\bC#/g, "C sharp")
    .replace(/\bF#/g, "F sharp")
    .replace(
      /\b(Array|Promise|Set|Map|Record|Partial|Readonly|Pick|Omit|Result|Option|Observable|Future|List)<([^<>]+)>/g,
      "$1 of $2",
    )
    .replace(/!==/g, " is not strictly equal to ")
    .replace(/===/g, " is strictly equal to ")
    .replace(/!=/g, " is not equal to ")
    .replace(/==/g, " equals ")
    .replace(/=>/g, " maps to ")
    .replace(/->/g, " to ")
    .replace(/>=/g, " is greater than or equal to ")
    .replace(/<=/g, " is less than or equal to ")
    .replace(/&&/g, " and ")
    .replace(/\|\|/g, " or ")
    .replace(/([\p{L}\d)\]])\s+%\s+([\p{L}\d(])/gu, "$1 modulo $2")
    .replace(/([\p{L}\d)\]])\s*\^\s*([\p{L}\d([])/gu, "$1 to the power of $2")
    .replace(/([\p{L}\d)\]])\s*\+\s*([\p{L}\d([])/gu, "$1 plus $2")
    .replace(/([\p{L}\d)\]])\s*\*\s*([\p{L}\d([])/gu, "$1 times $2")
    .replace(/([\p{L}\d)\]])\s*\/\s*([\p{L}\d([])/gu, "$1 divided by $2")
    .replace(/([\p{L}\d)\]])\s*=\s*([\p{L}\d([])/gu, "$1 equals $2")
    .replace(/([\p{L}\d)\]])\s*>\s*([\p{L}\d([])/gu, "$1 is greater than $2")
    .replace(/([\p{L}\d)\]])\s*<\s*([\p{L}\d([])/gu, "$1 is less than $2")
    .replace(/(?<=[\p{L}\d])!(?=[\p{L}_])/gu, "not ")
    .replace(/([\p{L}\d])\s*&\s*([\p{L}\d])/gu, "$1 and $2")
    .replace(/(?<=\w)\.(?=[A-Za-z_$])/g, " dot ")
    .replace(/\b([a-z]+)([A-Z][a-z\d]*)\b/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*%/g, "$1 percent")
    .replace(/([$€£¥])\s*(\d+(?:,\d{3})*(?:\.\d+)?)/g, (_match, symbol: string, amount: string) => {
      const unit = { $: "dollars", "€": "euros", "£": "pounds", "¥": "yen" }[symbol] ?? "";
      return `${amount} ${unit}`;
    })
    .replace(/([\p{L}\d])@(?=[\p{L}\d_])/gu, "$1 at ")
    .replace(/(^|\s)@(?=[\p{L}\d_])/gu, "$1at ")
    .replace(/\bC\s*#\b/g, "C sharp");

  // A standalone symbol is noise; punctuation that shapes speech remains as punctuation.
  text = text
    .replace(/[#$%^&*+=|~@<>\\"“”]+/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    // Control characters are transport/formatting artifacts, not speakable content.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s*([,;:.?])\s*/g, "$1 ")
    .replace(/!+/g, ".")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .replace(/\s+([,;:.?])/g, "$1")
    .replace(/([,;:.?])(?=[^\s])/g, "$1 ")
    .replace(/[\u2012-\u2015\u2212]/g, ", ")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();

  if (!/[\p{L}\p{N}]/u.test(text)) return "";

  text = text.replace(
    /\uE000(\d+)\uE001/g,
    (_token, index: string) => protectedItems[Number(index)] ?? "",
  );
  return text
    .replace(/\s+([,;:.?])/g, "$1")
    .replace(/([,;:.?])(?=[^\s])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}
