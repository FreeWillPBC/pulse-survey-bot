/**
 * Block Kit UI builders for Slack modals and messages.
 *
 * Slack's Block Kit is a JSON-based UI framework. Every modal, message, and
 * interactive element is defined as a tree of "block" objects. These helpers
 * generate those JSON trees so the rest of the code stays readable.
 */

// ─── Survey Creation Modal ────────────────────────────────────────────────────
// This is the modal ERG leads see when they run /pulse create.
// It collects: title, questions (as a text blob, one per line), question type,
// and settings toggles.

export function buildCreateSurveyModal(channelId) {
  return {
    type: "modal",
    callback_id: "create_survey_submit",
    private_metadata: channelId || "",
    title: { type: "plain_text", text: "Create Pulse Survey" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "survey_title",
        label: { type: "plain_text", text: "Survey Title" },
        element: {
          type: "plain_text_input",
          action_id: "title_input",
          placeholder: {
            type: "plain_text",
            text: "e.g. Q1 Team Pulse Check",
          },
        },
      },
      {
        type: "input",
        block_id: "survey_questions",
        label: { type: "plain_text", text: "Questions (one per line)" },
        element: {
          type: "plain_text_input",
          action_id: "questions_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "How satisfied are you with team communication?\nWhich initiatives would you like to see? (multi-select)\nAny additional feedback? (free-text)",
          },
        },
        hint: {
          type: "plain_text",
          text: 'Add (multi-select) or (free-text) after a question to set its type. Default is a 1-5 rating scale.',
        },
      },
      {
        type: "input",
        block_id: "multiselect_options",
        label: {
          type: "plain_text",
          text: "Multi-select options (comma-separated, per question)",
        },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "options_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Q2: Social events, Mentorship program, Speaker series, Ally training",
          },
        },
        hint: {
          type: "plain_text",
          text: "Format: Q2: Option A, Option B, Option C (use the question number)",
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Settings*" },
      },
      {
        type: "actions",
        block_id: "survey_settings",
        elements: [
          {
            type: "checkboxes",
            action_id: "settings_checkboxes",
            options: [
              {
                text: {
                  type: "mrkdwn",
                  text: "*Show results after completing*",
                },
                description: {
                  type: "plain_text",
                  text: "Respondents see aggregated results after submitting",
                },
                value: "show_results",
              },
              {
                text: {
                  type: "mrkdwn",
                  text: "*Include free-text in shared results*",
                },
                description: {
                  type: "plain_text",
                  text: "By default, free-text answers are only visible to you",
                },
                value: "share_freetext",
              },
            ],
          },
        ],
      },
    ],
  };
}

// ─── Survey Response Modal ────────────────────────────────────────────────────
// Dynamically built from the survey's questions. Each question type gets a
// different Block Kit element.

export function buildResponseModal(survey) {
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${survey.title}*\n:lock: Your responses are completely anonymous. No identifying information is stored.`,
      },
    },
    { type: "divider" },
  ];

  survey.questions.forEach((q, i) => {
    const blockId = `q_${i}`;

    if (q.type === "scale") {
      blocks.push({
        type: "input",
        block_id: blockId,
        label: { type: "plain_text", text: q.label },
        element: {
          type: "static_select",
          action_id: `answer_${i}`,
          placeholder: { type: "plain_text", text: "Select a rating" },
          options: [1, 2, 3, 4, 5].map((n) => ({
            text: {
              type: "plain_text",
              text: `${"★".repeat(n)}${"☆".repeat(5 - n)} (${n})`,
            },
            value: String(n),
          })),
        },
      });
    } else if (q.type === "multi-select") {
      blocks.push({
        type: "input",
        block_id: blockId,
        label: { type: "plain_text", text: q.label },
        element: {
          type: "multi_static_select",
          action_id: `answer_${i}`,
          placeholder: { type: "plain_text", text: "Select all that apply" },
          options: (q.options || []).map((opt) => ({
            text: { type: "plain_text", text: opt },
            value: opt,
          })),
        },
      });
    } else if (q.type === "free-text") {
      blocks.push({
        type: "input",
        block_id: blockId,
        label: { type: "plain_text", text: q.label },
        element: {
          type: "plain_text_input",
          action_id: `answer_${i}`,
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Your response is anonymous...",
          },
        },
        optional: true,
      });
    }
  });

  return {
    type: "modal",
    callback_id: "survey_response_submit",
    private_metadata: survey.id,
    title: { type: "plain_text", text: "Pulse Survey" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

// ─── Survey Posted to Channel ─────────────────────────────────────────────────

export function buildSurveyMessage(survey) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:clipboard: *${survey.title}*\n\n:lock: All responses are *completely anonymous*. Your identity is never stored.\n:bar_chart: ${survey.questions.length} question${survey.questions.length === 1 ? "" : "s"} · Takes about 1 minute`,
      },
    },
    { type: "divider" },
    {
      type: "actions",
      block_id: `survey_actions_${survey.id}`,
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Take Survey" },
          action_id: "take_survey",
          value: survey.id,
          style: "primary",
        },
      ],
    },
  ];
}

// ─── Results Formatting ───────────────────────────────────────────────────────

export function buildResultsBlocks(survey, responses, { isAdmin = false, isShare = false } = {}) {
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:bar_chart: *Results: ${survey.title}*\n${responses.length} response${responses.length === 1 ? "" : "s"} · Status: ${survey.status}`,
      },
    },
    { type: "divider" },
  ];

  if (responses.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No responses yet._" },
    });
    return blocks;
  }

  survey.questions.forEach((q, i) => {
    const key = `q_${i}`;

    if (q.type === "scale") {
      const values = responses.map((r) => parseFloat(r[key])).filter(Boolean);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const rounded = Math.round(avg * 10) / 10;
      const filledBars = Math.round(avg);
      const bar = "█".repeat(filledBars) + "░".repeat(5 - filledBars);

      // Distribution
      const dist = [1, 2, 3, 4, 5].map(
        (n) => values.filter((v) => v === n).length
      );

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${q.label}*\n${bar} *${rounded}/5* (${values.length} responses)\n${dist.map((count, idx) => `${idx + 1}★: ${count}`).join(" · ")}`,
        },
      });
    } else if (q.type === "multi-select") {
      const allSelections = responses.flatMap((r) => r[key] || []);
      const counts = {};
      allSelections.forEach((opt) => {
        counts[opt] = (counts[opt] || 0) + 1;
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const total = responses.length;
      const lines = sorted.map(([opt, count]) => {
        const pct = Math.round((count / total) * 100);
        const barLen = Math.round(pct / 10);
        return `${opt}: ${"█".repeat(barLen)}${"░".repeat(10 - barLen)} ${pct}% (${count})`;
      });

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${q.label}*\n${lines.join("\n")}`,
        },
      });
    } else if (q.type === "free-text") {
      const texts = responses.map((r) => r[key]).filter(Boolean);
      // Free-text: only show to admin, or if share_freetext is enabled
      const showFreeText =
        isAdmin || (!isShare && survey.settings?.shareFreetext);

      if (showFreeText && texts.length > 0) {
        const textList = texts.map((t) => `> _${t}_`).join("\n");
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${q.label}* (${texts.length} responses)\n${textList}`,
          },
        });
      } else if (isShare) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${q.label}*\n_${texts.length} free-text responses (visible to survey creator only)_`,
          },
        });
      } else {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${q.label}*\n_${texts.length} responses · Free-text answers are only visible to the survey creator_`,
          },
        });
      }
    }

    blocks.push({ type: "divider" });
  });

  return blocks;
}

// ─── CSV Export ────────────────────────────────────────────────────────────────

export function buildCsvExport(survey, responses) {
  const headers = survey.questions.map((q) => q.label);
  const rows = responses.map((r) =>
    survey.questions.map((q, i) => {
      const val = r[`q_${i}`];
      if (Array.isArray(val)) return `"${val.join(", ")}"`;
      if (typeof val === "string" && (val.includes(",") || val.includes('"')))
        return `"${val.replace(/"/g, '""')}"`;
      return val || "";
    })
  );

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// ─── Help Message ─────────────────────────────────────────────────────────────

export function buildHelpBlocks(docsUrl) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:clipboard: *Pulse Survey Bot - Help*`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Getting Started*\nPulse Survey Bot lets you run anonymous surveys right in Slack. Perfect for ERG feedback, team pulse checks, and more.\n\n:lock: *Privacy First:* All responses are completely anonymous. We never store who responded - only a one-way hash to prevent duplicate submissions.`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Commands*\n" +
          "• `/pulse create` - Create a new survey\n" +
          "• `/pulse results <id>` - View survey results\n" +
          "• `/pulse share <id>` - Post results to the channel\n" +
          "• `/pulse export <id>` - Download results as CSV\n" +
          "• `/pulse close <id>` - Close a survey\n" +
          "• `/pulse help` - Show this help message",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Quick Start*\n" +
          "1️⃣ Type `/pulse create` in any channel\n" +
          "2️⃣ Fill in your survey title and questions\n" +
          "3️⃣ The bot posts a survey card with a *Take Survey* button\n" +
          "4️⃣ Team members click the button and respond anonymously\n" +
          "5️⃣ Use `/pulse results <id>` to check responses anytime",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Question Types*\n" +
          "• *Rating scale (default)* - 1-5 star rating\n" +
          "• *(multi-select)* - Multiple choice, select all that apply\n" +
          "• *(free-text)* - Open-ended text response (admin-only by default)",
      },
    },
    ...(docsUrl
      ? [
          { type: "divider" },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:book: *Full documentation:* <${docsUrl}|Pulse Survey User Guide>`,
            },
          },
        ]
      : []),
  ];
}
