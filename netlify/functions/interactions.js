import { WebClient } from "@slack/web-api";
import { verifySlackRequest } from "./lib/verify.js";
import {
  buildResponseModal,
  buildSurveyMessage,
  buildResultsBlocks,
  buildCsvExport,
} from "./lib/blocks.js";
import { parseQuestions } from "./lib/parse-questions.js";
import {
  createSurvey,
  getSurvey,
  addResponse,
  getResponses,
  hasUserResponded,
  markUserResponded,
  addSurveyToUserIndex,
  closeSurvey,
} from "./lib/store.js";

/**
 * Handles all Slack interactive payloads:
 *  - Button clicks (e.g. "Take Survey")
 *  - Modal submissions (create survey, submit response)
 *
 * Slack sends these as URL-encoded bodies with a `payload` JSON field.
 */
export default async function handler(req) {
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());

  if (!verifySlackRequest(headers, rawBody)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get("payload"));

  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  try {
    switch (payload.type) {
      case "block_actions":
        return await handleBlockActions(slack, payload);

      case "view_submission":
        return await handleViewSubmission(slack, payload);

      default:
        return new Response("", { status: 200 });
    }
  } catch (err) {
    console.error("Interaction error:", err);
    return new Response(
      JSON.stringify({
        response_action: "errors",
        errors: { survey_title: "Something went wrong. Please try again." },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─── Block Actions (button clicks) ───────────────────────────────────────────

async function handleBlockActions(slack, payload) {
  const userId = payload.user.id;

  for (const action of payload.actions) {
    if (action.action_id === "take_survey") {
      const surveyId = action.value;

      const survey = await getSurvey(surveyId);
      if (!survey) {
        await slack.chat.postEphemeral({
          channel: payload.channel.id,
          user: userId,
          text: ":x: This survey could not be found.",
        });
        return new Response("", { status: 200 });
      }

      if (survey.status === "closed") {
        await slack.chat.postEphemeral({
          channel: payload.channel.id,
          user: userId,
          text: ":checkered_flag: This survey is closed and no longer accepting responses.",
        });
        return new Response("", { status: 200 });
      }

      // Check if already responded
      const alreadyResponded = await hasUserResponded(surveyId, userId);
      if (alreadyResponded) {
        await slack.chat.postEphemeral({
          channel: payload.channel.id,
          user: userId,
          text: ":white_check_mark: You've already submitted a response to this survey. Thank you!",
        });
        return new Response("", { status: 200 });
      }

      // Open the response modal
      await slack.views.open({
        trigger_id: payload.trigger_id,
        view: buildResponseModal(survey),
      });
    }

    // ─── List action buttons ──────────────────────────────────────────────
    if (action.action_id === "list_results") {
      const surveyId = action.value;
      const survey = await getSurvey(surveyId);
      if (!survey) {
        await slack.chat.postMessage({
          channel: userId,
          text: ":x: Survey not found.",
        });
        continue;
      }

      const responses = await getResponses(surveyId);
      const blocks = buildResultsBlocks(survey, responses, {
        isAdmin: true,
        isShare: false,
      });

      await slack.chat.postMessage({
        channel: userId,
        blocks,
        text: `Results for ${survey.title}`,
      });
    }

    if (action.action_id === "list_close") {
      const surveyId = action.value;
      const survey = await getSurvey(surveyId);
      if (!survey) {
        await slack.chat.postMessage({
          channel: userId,
          text: ":x: Survey not found.",
        });
        continue;
      }

      if (survey.status === "closed") {
        await slack.chat.postMessage({
          channel: userId,
          text: `:information_source: *${survey.title}* is already closed.`,
        });
        continue;
      }

      await closeSurvey(surveyId);
      await slack.chat.postMessage({
        channel: userId,
        text: `:checkered_flag: *${survey.title}* is now closed. ${survey.responseCount || 0} total responses.`,
      });
    }

    if (action.action_id === "list_export") {
      const surveyId = action.value;
      const survey = await getSurvey(surveyId);
      if (!survey) {
        await slack.chat.postMessage({
          channel: userId,
          text: ":x: Survey not found.",
        });
        continue;
      }

      const responses = await getResponses(surveyId);
      const csv = buildCsvExport(survey, responses);

      await slack.filesUploadV2({
        channel_id: userId,
        content: csv,
        filename: `pulse-survey-${surveyId}-results.csv`,
        title: `${survey.title} - Export`,
        initial_comment: `:bar_chart: CSV export for *${survey.title}* (${responses.length} responses)`,
      });
    }

    // Ignore settings_checkboxes actions (they fire on toggle but we read
    // their values on submit)
  }

  return new Response("", { status: 200 });
}

// ─── View Submissions (modal submits) ─────────────────────────────────────────

async function handleViewSubmission(slack, payload) {
  const callbackId = payload.view.callback_id;

  if (callbackId === "create_survey_submit") {
    return await handleCreateSurveySubmit(slack, payload);
  }

  if (callbackId === "survey_response_submit") {
    return await handleSurveyResponseSubmit(slack, payload);
  }

  return new Response("", { status: 200 });
}

// ─── Create Survey Submit ─────────────────────────────────────────────────────

async function handleCreateSurveySubmit(slack, payload) {
  const values = payload.view.state.values;
  const channelId = payload.view.private_metadata;

  const title = values.survey_title.title_input.value;
  const rawQuestions = values.survey_questions.questions_input.value;
  const rawOptions =
    values.multiselect_options?.options_input?.value || "";

  // Parse settings checkboxes
  const settingsActions = values.survey_settings?.settings_checkboxes;
  const selectedSettings =
    settingsActions?.selected_options?.map((o) => o.value) || [];

  const questions = parseQuestions(rawQuestions, rawOptions);
  const userId = payload.user.id;

  const survey = await createSurvey({
    title,
    questions,
    createdBy: userId,
    settings: {
      showResults: selectedSettings.includes("show_results"),
      shareFreetext: selectedSettings.includes("share_freetext"),
    },
  });

  // Add to the creator's survey index for /pulse list
  await addSurveyToUserIndex(userId, survey.id);

  // DM the creator with confirmation
  await slack.chat.postMessage({
    channel: userId,
    text: `:white_check_mark: *Survey created!*\n\nTitle: *${survey.title}*\nQuestions: ${survey.questions.length}\n\nUse \`/pulse list\` to view results, export data, or close your survey.`,
  });

  // Post the interactive survey card to the channel where /pulse create was run
  const targetChannel = channelId || userId;
  await slack.chat.postMessage({
    channel: targetChannel,
    blocks: buildSurveyMessage(survey),
    text: `${survey.title} - Take the survey!`,
  });

  return new Response(
    JSON.stringify({ response_action: "clear" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ─── Survey Response Submit ───────────────────────────────────────────────────

async function handleSurveyResponseSubmit(slack, payload) {
  const surveyId = payload.view.private_metadata;
  const userId = payload.user.id;
  const values = payload.view.state.values;

  const survey = await getSurvey(surveyId);
  if (!survey) {
    return new Response(
      JSON.stringify({
        response_action: "errors",
        errors: { q_0: "Survey not found." },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Double-check hasn't already responded
  if (await hasUserResponded(surveyId, userId)) {
    return new Response(
      JSON.stringify({
        response_action: "errors",
        errors: { q_0: "You've already submitted a response." },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Extract answers - completely anonymous, no user info stored
  const answers = {};
  survey.questions.forEach((q, i) => {
    const blockValues = values[`q_${i}`]?.[`answer_${i}`];
    if (!blockValues) return;

    if (q.type === "scale") {
      answers[`q_${i}`] = blockValues.selected_option?.value;
    } else if (q.type === "multi-select") {
      answers[`q_${i}`] = blockValues.selected_options?.map(
        (o) => o.value
      );
    } else if (q.type === "free-text") {
      answers[`q_${i}`] = blockValues.value;
    }
  });

  // Store anonymous response
  const responseCount = await addResponse(surveyId, answers);

  // Mark user as having responded (hash only, not reversible)
  await markUserResponded(surveyId, userId);

  // If show_results is enabled, show aggregated results as ephemeral
  if (survey.settings?.showResults) {
    const allResponses = await getResponses(surveyId);
    const blocks = buildResultsBlocks(survey, allResponses, {
      isAdmin: false,
      isShare: false,
    });

    // Post results as DM (modals don't support ephemeral post-close)
    await slack.chat.postMessage({
      channel: userId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:white_check_mark: *Thank you for responding!* Your response is anonymous.\n\nHere are the current results (${responseCount} responses):`,
          },
        },
        ...blocks,
      ],
      text: `Thanks for responding to ${survey.title}!`,
    });
  } else {
    await slack.chat.postMessage({
      channel: userId,
      text: `:white_check_mark: *Thank you!* Your anonymous response to *${survey.title}* has been recorded. (Response #${responseCount})`,
    });
  }

  return new Response(
    JSON.stringify({ response_action: "clear" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
