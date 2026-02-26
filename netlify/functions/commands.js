import { WebClient } from "@slack/web-api";
import { verifySlackRequest } from "./lib/verify.js";
import {
  buildCreateSurveyModal,
  buildResultsBlocks,
  buildCsvExport,
  buildHelpBlocks,
} from "./lib/blocks.js";
import { getSurvey, getResponses, closeSurvey } from "./lib/store.js";

/**
 * Handles all /pulse slash commands.
 *
 * Slack sends slash commands as URL-encoded POST bodies. We parse the
 * subcommand from the `text` field and route accordingly.
 */
export default async function handler(req) {
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());

  if (!verifySlackRequest(headers, rawBody)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const command = params.get("text")?.trim() || "";
  const triggerId = params.get("trigger_id");
  const userId = params.get("user_id");
  const channelId = params.get("channel_id");

  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  // Route subcommands
  const [subcommand, ...args] = command.split(/\s+/);
  const surveyId = args[0];

  try {
    switch (subcommand?.toLowerCase()) {
      case "create":
        return await handleCreate(slack, triggerId, channelId);

      case "results":
        return await handleResults(slack, channelId, userId, surveyId);

      case "share":
        return await handleShare(slack, channelId, surveyId);

      case "export":
        return await handleExport(slack, channelId, userId, surveyId);

      case "close":
        return await handleClose(slack, channelId, userId, surveyId);

      case "help":
      case "":
      case undefined:
        return await handleHelp();

      default:
        return slackResponse(
          `Unknown command: \`${subcommand}\`. Try \`/pulse help\` for a list of commands.`
        );
    }
  } catch (err) {
    console.error("Command error:", err);
    return slackResponse(
      `:warning: Something went wrong. Please try again or contact your admin.`
    );
  }
}

// ─── Subcommand Handlers ──────────────────────────────────────────────────────

async function handleCreate(slack, triggerId, channelId) {
  await slack.views.open({
    trigger_id: triggerId,
    view: buildCreateSurveyModal(channelId),
  });

  // Return empty 200 - the modal takes over
  return new Response("", { status: 200 });
}

async function handleResults(slack, channelId, userId, surveyId) {
  if (!surveyId)
    return slackResponse(
      "Usage: `/pulse results <survey-id>`\nYou can find the survey ID at the bottom of any survey post."
    );

  const survey = await getSurvey(surveyId);
  if (!survey)
    return slackResponse(`:x: Survey \`${surveyId}\` not found.`);

  const responses = await getResponses(surveyId);
  const isAdmin = userId === survey.createdBy;

  const blocks = buildResultsBlocks(survey, responses, {
    isAdmin,
    isShare: false,
  });

  // Send as ephemeral message (only visible to the requesting user)
  await slack.chat.postEphemeral({
    channel: channelId,
    user: userId,
    blocks,
    text: `Results for ${survey.title}`,
  });

  return new Response("", { status: 200 });
}

async function handleShare(slack, channelId, surveyId) {
  if (!surveyId)
    return slackResponse("Usage: `/pulse share <survey-id>`");

  const survey = await getSurvey(surveyId);
  if (!survey)
    return slackResponse(`:x: Survey \`${surveyId}\` not found.`);

  const responses = await getResponses(surveyId);

  const blocks = buildResultsBlocks(survey, responses, {
    isAdmin: false,
    isShare: true,
  });

  // Post publicly to the channel
  await slack.chat.postMessage({
    channel: channelId,
    blocks,
    text: `Survey results: ${survey.title}`,
  });

  return new Response("", { status: 200 });
}

async function handleExport(slack, channelId, userId, surveyId) {
  if (!surveyId)
    return slackResponse("Usage: `/pulse export <survey-id>`");

  const survey = await getSurvey(surveyId);
  if (!survey)
    return slackResponse(`:x: Survey \`${surveyId}\` not found.`);

  if (userId !== survey.createdBy)
    return slackResponse(
      `:lock: Only the survey creator can export results.`
    );

  const responses = await getResponses(surveyId);
  const csv = buildCsvExport(survey, responses);

  // Upload CSV as a file snippet to the user via DM
  await slack.filesUploadV2({
    channel_id: channelId,
    content: csv,
    filename: `pulse-survey-${surveyId}-results.csv`,
    title: `${survey.title} - Export`,
    initial_comment: `:bar_chart: CSV export for *${survey.title}* (${responses.length} responses)`,
  });

  return new Response("", { status: 200 });
}

async function handleClose(slack, channelId, userId, surveyId) {
  if (!surveyId)
    return slackResponse("Usage: `/pulse close <survey-id>`");

  const survey = await getSurvey(surveyId);
  if (!survey)
    return slackResponse(`:x: Survey \`${surveyId}\` not found.`);

  if (userId !== survey.createdBy)
    return slackResponse(
      `:lock: Only the survey creator can close a survey.`
    );

  if (survey.status === "closed")
    return slackResponse(
      `:information_source: Survey \`${surveyId}\` is already closed.`
    );

  await closeSurvey(surveyId);

  await slack.chat.postMessage({
    channel: channelId,
    text: `:checkered_flag: *${survey.title}* is now closed. ${survey.responseCount} total responses. Use \`/pulse results ${surveyId}\` to view results.`,
  });

  return new Response("", { status: 200 });
}

async function handleHelp() {
  const docsUrl = process.env.DOCS_URL || null;
  const blocks = buildHelpBlocks(docsUrl);

  // Return help directly as the slash command response - faster and no API call needed
  return new Response(
    JSON.stringify({ response_type: "ephemeral", blocks, text: "Pulse Survey Bot - Help" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slackResponse(text) {
  return new Response(JSON.stringify({ response_type: "ephemeral", text }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
