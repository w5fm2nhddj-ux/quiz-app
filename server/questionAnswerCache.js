import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const QUESTION_CACHE_TABLE = "question_answer_cache";
const AI_MODEL_NAME = () => process.env.DEEPSEEK_MODEL || "deepseek-flash";

function normalizeText(value, stripQuestionNumber = false) {
  let normalized = String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");

  if (stripQuestionNumber) {
    normalized = normalized.replace(
      /^\s*(?:(?:第\s*)?\d+\s*题(?:[、.．:：]?\s*)?|\d+\s*[、．)）]\s*|\d+[.)]\s+|[（(]\d+[）)]\s*)/u,
      "",
    );
  }

  return normalized
    .split("\n")
    .map((line) => line.replace(/[\t \u00A0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeQuestionForCache(question) {
  return {
    version: 1,
    question: normalizeText(question?.question, true),
    options: (Array.isArray(question?.options) ? question.options : []).map((option) => ({
      id: normalizeText(option?.id),
      text: normalizeText(option?.text),
    })),
    questionType: String(question?.type ?? "").trim().toLowerCase(),
  };
}

export function createQuestionHash(question) {
  const normalized = normalizeQuestionForCache(question);
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

function hasUsableAnswer(answer) {
  if (answer == null) return false;
  if (typeof answer === "string") return answer.trim().length > 0;
  if (Array.isArray(answer)) return answer.some((item) => String(item).trim().length > 0);
  return typeof answer === "boolean";
}

function toStoredAnswerSource(source) {
  if (source === "source" || source === "original") return "original";
  if (source === "manual") return "manual";
  return "ai";
}

function toImportedAnswerSource(source) {
  if (source === "original") return "source";
  return source === "manual" ? "manual" : "ai";
}

function makeCacheRecord(question, hash, source) {
  const normalized = normalizeQuestionForCache(question);
  return {
    question_hash: hash,
    question_text: normalized.question,
    options: normalized.options,
    question_type: normalized.questionType,
    answer: question.answer,
    explanation: String(question.explanation ?? ""),
    knowledge_points: Array.isArray(question.knowledgePoints) ? question.knowledgePoints : [],
    option_explanations: Array.isArray(question.optionExplanations) ? question.optionExplanations : [],
    related_questions: Array.isArray(question.relatedQuestions) ? question.relatedQuestions : [],
    answer_source: toStoredAnswerSource(source),
    ai_model: source === "ai" ? AI_MODEL_NAME() : null,
    confidence: typeof question.confidence === "number" ? question.confidence : null,
    needs_review: Boolean(question.needsReview),
    updated_at: new Date().toISOString(),
  };
}

function resultData(result, operation) {
  if (result?.error) {
    const error = new Error(`QUESTION_CACHE_${operation.toUpperCase()}_FAILED`);
    error.code = result.error.code || "QUESTION_CACHE_ERROR";
    throw error;
  }
  return result?.data;
}

export function createQuestionAnswerCacheRepository({
  env = process.env,
  clientFactory = createClient,
} = {}) {
  let cachedClient = null;
  let cachedCredentials = "";

  function getClient() {
    const url = String(env.SUPABASE_URL ?? "").trim();
    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    if (!url || !serviceRoleKey) return null;

    const credentials = `${url}\n${serviceRoleKey}`;
    if (!cachedClient || credentials !== cachedCredentials) {
      cachedClient = clientFactory(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      cachedCredentials = credentials;
    }
    return cachedClient;
  }

  return {
    isConfigured() {
      return Boolean(String(env.SUPABASE_URL ?? "").trim() && String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim());
    },

    async lookupQuestions(questions) {
      const client = getClient();
      if (!client) return { enabled: false, hits: new Map() };
      const unique = new Map();
      for (const question of questions) {
        const hash = createQuestionHash(question);
        if (!unique.has(hash)) unique.set(hash, question);
      }
      if (unique.size === 0) return { enabled: true, hits: new Map() };

      const result = await client
        .from(QUESTION_CACHE_TABLE)
        .select("question_hash, answer, explanation, knowledge_points, option_explanations, related_questions, answer_source, ai_model, confidence, needs_review")
        .in("question_hash", [...unique.keys()]);
      const rows = resultData(result, "lookup") ?? [];
      const hits = new Map(rows.map((row) => [row.question_hash, row]));

      for (const question of questions) {
        const hash = createQuestionHash(question);
        if (!hits.has(hash)) continue;
        const increment = await client.rpc("increment_question_cache_usage", { p_question_hash: hash });
        resultData(increment, "usage_increment");
      }
      return { enabled: true, hits };
    },

    async saveQuestion(question, source = question?.answerSource) {
      const client = getClient();
      if (!client || !hasUsableAnswer(question?.answer)) return false;
      const hash = createQuestionHash(question);
      const record = makeCacheRecord(question, hash, source);
      const result = await client
        .from(QUESTION_CACHE_TABLE)
        .upsert(record, {
          onConflict: "question_hash",
          ignoreDuplicates: record.answer_source === "ai",
        });
      resultData(result, "save");
      return true;
    },
  };
}

function blankSolverResult(questions) {
  return {
    questions: questions.map((question) => ({ ...question })),
    errors: [],
    halted: null,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    stats: { total: questions.length, attempted: 0, sourceAnswers: 0, aiAnswers: 0, aiFailures: 0, missingAnswers: 0, needsReview: 0 },
  };
}

export async function solveQuestionsWithCloudCache(questions, {
  repository,
  solveMisses,
  onCacheEvent = () => {},
  onCacheError = () => {},
} = {}) {
  const output = questions.map((question) => ({ ...question }));
  const questionHashes = questions.map(createQuestionHash);
  let cacheEnabled = false;
  let cacheUnavailable = false;
  let hits = new Map();

  try {
    const lookup = await repository?.lookupQuestions(questions.filter((question) => !hasUsableAnswer(question.answer)));
    cacheEnabled = Boolean(lookup?.enabled);
    hits = lookup?.hits ?? hits;
  } catch {
    cacheUnavailable = Boolean(repository?.isConfigured?.());
    onCacheError("lookup");
  }

  if (cacheUnavailable) {
    const errors = questions
      .filter((question) => !hasUsableAnswer(question.answer))
      .map((question) => ({
        id: question.id,
        code: "QUESTION_CACHE_UNAVAILABLE",
        reason: "云端题库暂时不可用；为避免未确认缓存状态时产生 AI 费用，本次没有调用 AI",
        retryable: true,
        diagnostic: null,
      }));
    return {
      ...blankSolverResult(questions),
      cacheStatus: "unavailable",
      errors,
      stats: {
        total: questions.length,
        attempted: 0,
        sourceAnswers: questions.filter((question) => question.answerSource === "source").length,
        aiAnswers: questions.filter((question) => question.answerSource === "ai").length,
        aiFailures: errors.length,
        missingAnswers: questions.filter((question) => !hasUsableAnswer(question.answer)).length,
        needsReview: questions.filter((question) => question.needsReview).length,
      },
    };
  }

  const missQuestions = [];
  const missGroups = [];
  const missGroupByHash = new Map();
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (hasUsableAnswer(question.answer)) {
      if (cacheEnabled && ["source", "original", "manual", "ai"].includes(question.answerSource)) {
        try {
          await repository.saveQuestion(question, question.answerSource);
        } catch {
          onCacheError("save_source_answer");
        }
      }
      continue;
    }

    const hash = questionHashes[index];
    const cached = cacheEnabled ? hits.get(hash) : null;
    if (cached && hasUsableAnswer(cached.answer)) {
      output[index] = {
        ...question,
        answer: cached.answer,
        explanation: cached.explanation ?? "",
        knowledgePoints: cached.knowledge_points ?? [],
        optionExplanations: cached.option_explanations ?? [],
        relatedQuestions: cached.related_questions ?? [],
        answerSource: toImportedAnswerSource(cached.answer_source),
        confidence: cached.confidence ?? null,
        needsReview: Boolean(cached.needs_review),
      };
      onCacheEvent("HIT", hash);
    } else {
      const existingGroup = missGroupByHash.get(hash);
      if (existingGroup) {
        existingGroup.push(index);
      } else {
        if (cacheEnabled) onCacheEvent("MISS", hash);
        missQuestions.push(question);
        const group = [index];
        missGroups.push(group);
        missGroupByHash.set(hash, group);
      }
    }
  }

  let solvedMisses = blankSolverResult(missQuestions);
  if (missQuestions.length > 0) {
    solvedMisses = await solveMisses(missQuestions);
    for (let offset = 0; offset < missGroups.length; offset += 1) {
      const group = missGroups[offset];
      const solved = solvedMisses.questions[offset] ?? output[group[0]];
      for (const index of group) {
        output[index] = { ...solved, id: questions[index].id };
      }
      if (cacheEnabled && hasUsableAnswer(solved.answer) && solved.answerSource === "ai") {
        try {
          await repository.saveQuestion(solved, "ai");
        } catch {
          onCacheError("save_ai_answer");
        }
      }
    }
  }

  const errors = solvedMisses.errors ?? [];
  return {
    ...solvedMisses,
    cacheStatus: cacheEnabled ? "available" : "disabled",
    questions: output,
    errors,
    usage: solvedMisses.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    stats: {
      ...(solvedMisses.stats ?? {}),
      total: questions.length,
      attempted: solvedMisses.stats?.attempted ?? missQuestions.length,
      sourceAnswers: output.filter((question) => question.answerSource === "source").length,
      aiAnswers: output.filter((question) => question.answerSource === "ai").length,
      aiFailures: errors.length,
      missingAnswers: output.filter((question) => !hasUsableAnswer(question.answer)).length,
      needsReview: output.filter((question) => question.needsReview).length,
    },
  };
}
