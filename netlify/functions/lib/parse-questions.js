/**
 * Parses the raw question text from the creation modal into structured
 * question objects.
 *
 * Input format (one question per line):
 *   How supported do you feel?
 *   Which events? (multi-select)
 *   Any other feedback? (free-text)
 *
 * Multi-select options come from a separate field:
 *   Q2: Social events, Mentorship, Speaker series
 */
export function parseQuestions(rawQuestions, rawOptions) {
  const lines = rawQuestions
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Parse multi-select options: "Q2: opt1, opt2, opt3"
  const optionsMap = {};
  if (rawOptions) {
    rawOptions
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const match = line.match(/^Q(\d+)\s*:\s*(.+)$/i);
        if (match) {
          const qNum = parseInt(match[1]);
          optionsMap[qNum] = match[2].split(",").map((o) => o.trim());
        }
      });
  }

  return lines.map((line, i) => {
    const qNum = i + 1;

    if (/\(multi-select\)/i.test(line)) {
      return {
        label: line.replace(/\s*\(multi-select\)/i, "").trim(),
        type: "multi-select",
        options: optionsMap[qNum] || ["Option A", "Option B", "Option C"],
      };
    }

    if (/\(free-text\)/i.test(line)) {
      return {
        label: line.replace(/\s*\(free-text\)/i, "").trim(),
        type: "free-text",
      };
    }

    return {
      label: line.trim(),
      type: "scale",
    };
  });
}
