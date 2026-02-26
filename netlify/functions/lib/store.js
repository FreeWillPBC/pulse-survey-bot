import { getStore } from "@netlify/blobs";
import crypto from "crypto";

const SURVEYS_STORE = "pulse-surveys";
const RESPONSES_STORE = "pulse-responses";
const TRACKING_STORE = "pulse-tracking";

function getSurveyStore() {
  return getStore(SURVEYS_STORE);
}

function getResponseStore() {
  return getStore(RESPONSES_STORE);
}

function getTrackingStore() {
  return getStore(TRACKING_STORE);
}

// --- Survey CRUD ---

export async function createSurvey(survey) {
  const id = crypto.randomUUID().slice(0, 8);
  const record = {
    id,
    ...survey,
    status: "open",
    responseCount: 0,
    createdAt: new Date().toISOString(),
  };
  const store = getSurveyStore();
  await store.setJSON(id, record);
  return record;
}

export async function getSurvey(id) {
  const store = getSurveyStore();
  return store.get(id, { type: "json" });
}

export async function updateSurvey(id, updates) {
  const store = getSurveyStore();
  const survey = await store.get(id, { type: "json" });
  if (!survey) return null;
  const updated = { ...survey, ...updates };
  await store.setJSON(id, updated);
  return updated;
}

export async function closeSurvey(id) {
  return updateSurvey(id, { status: "closed" });
}

// --- Response storage (fully anonymous) ---

export async function addResponse(surveyId, answers) {
  const store = getResponseStore();
  const existing = (await store.get(surveyId, { type: "json" })) || [];
  existing.push(answers);
  await store.setJSON(surveyId, existing);

  // Increment response count on the survey
  const surveyStore = getSurveyStore();
  const survey = await surveyStore.get(surveyId, { type: "json" });
  if (survey) {
    survey.responseCount = existing.length;
    await surveyStore.setJSON(surveyId, survey);
  }

  return existing.length;
}

export async function getResponses(surveyId) {
  const store = getResponseStore();
  return (await store.get(surveyId, { type: "json" })) || [];
}

// --- Anonymous tracking (prevent double-submit without storing identity) ---

export async function hasUserResponded(surveyId, userId) {
  const hash = crypto
    .createHash("sha256")
    .update(`${surveyId}:${userId}`)
    .digest("hex");
  const store = getTrackingStore();
  const set = (await store.get(surveyId, { type: "json" })) || [];
  return set.includes(hash);
}

export async function markUserResponded(surveyId, userId) {
  const hash = crypto
    .createHash("sha256")
    .update(`${surveyId}:${userId}`)
    .digest("hex");
  const store = getTrackingStore();
  const set = (await store.get(surveyId, { type: "json" })) || [];
  if (!set.includes(hash)) {
    set.push(hash);
    await store.setJSON(surveyId, set);
  }
}

// --- Per-user survey index (tracks which surveys a user created) ---

export async function addSurveyToUserIndex(userId, surveyId) {
  const store = getSurveyStore();
  const key = `user_${userId}`;
  const index = (await store.get(key, { type: "json" })) || [];
  index.push(surveyId);
  await store.setJSON(key, index);
}

export async function getUserSurveys(userId) {
  const store = getSurveyStore();
  const key = `user_${userId}`;
  const ids = (await store.get(key, { type: "json" })) || [];

  // Fetch all surveys in parallel
  const surveys = await Promise.all(
    ids.map((id) => store.get(id, { type: "json" }))
  );

  // Filter out any that were deleted or missing, newest first
  return surveys
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
