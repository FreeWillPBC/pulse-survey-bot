import crypto from "crypto";

/**
 * Verify that a request actually came from Slack using their signing secret.
 * Returns true if valid, false if the request is forged or tampered with.
 */
export function verifySlackRequest(headers, body) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = headers["x-slack-request-timestamp"];
  const slackSignature = headers["x-slack-signature"];

  if (!timestamp || !slackSignature || !signingSecret) return false;

  // Reject requests older than 5 minutes to prevent replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBasestring)
      .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(slackSignature)
  );
}
