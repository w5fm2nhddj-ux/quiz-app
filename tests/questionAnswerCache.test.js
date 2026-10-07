import assert from "node:assert/strict";
import {
  createQuestionAnswerCacheRepository,
  createQuestionHash,
  normalizeQuestionForCache,
  solveQuestionsWithCloudCache,
} from "../server/questionAnswerCache.js";

function question(id, patch = {}) {
  return {
    id,
    question: "1. Which option is correct?",
    type: "single",
    options: [{ id: "A", text: "First" }, { id: "B", text: "Second" }],
    answer: null,
    explanation: "",
    knowledgePoints: [],
    optionExplanations: [],
    relatedQuestions: [],
    source: "fixture",
    difficulty: null,
    answerSource: "missing",
    confidence: null,
    needsReview: true,
    parseWarnings: [],
    ...patch,
  };
}

const normalized = normalizeQuestionForCache(question("normalize", {
  question: "  12、Which   option is correct?\r\n\r\n  Keep Meaning  ",
}));
assert.equal(normalized.question, "Which option is correct?\n\nKeep Meaning");
assert.equal(createQuestionHash(question("one")), createQuestionHash(question("two", {
  question: "Which option is correct?",
})), "question number and inconsequential spacing should not change the hash");
assert.notEqual(createQuestionHash(question("case-a")), createQuestionHash(question("case-b", {
  question: "which option is correct?",
})), "case-sensitive content should not be rewritten");
assert.notEqual(createQuestionHash(question("type-a")), createQuestionHash(question("type-b", {
  type: "multiple",
})), "question type participates in the identity hash");

const rows = new Map();
let aiCalls = 0;
let usageCount = 0;
const cacheEvents = [];
const repository = {
  isConfigured: () => true,
  async lookupQuestions(questions) {
    const hits = new Map();
    for (const item of questions) {
      const hash = createQuestionHash(item);
      if (rows.has(hash)) {
        usageCount += 1;
        hits.set(hash, rows.get(hash));
      }
    }
    return { enabled: true, hits };
  },
  async saveQuestion(item, source) {
    if (item.answer == null || item.answer === "") return false;
    const hash = createQuestionHash(item);
    if (source === "ai" && rows.has(hash)) return false;
    rows.set(hash, {
      question_hash: hash,
      answer: item.answer,
      explanation: item.explanation,
      knowledge_points: item.knowledgePoints,
      option_explanations: item.optionExplanations,
      related_questions: item.relatedQuestions,
      answer_source: source === "source" ? "original" : source,
      confidence: item.confidence,
      needs_review: item.needsReview,
    });
    return true;
  },
};

const firstQuestion = question("first");
const first = await solveQuestionsWithCloudCache([firstQuestion], {
  repository,
  onCacheEvent: (event, hash) => cacheEvents.push([event, hash]),
  async solveMisses(misses) {
    aiCalls += 1;
    assert.equal(misses.length, 1);
    return {
      questions: misses.map((item) => ({
        ...item,
        answer: "B",
        answerSource: "ai",
        explanation: "The second option is correct.",
        knowledgePoints: ["cache-test"],
        confidence: 0.95,
        needsReview: false,
      })),
      errors: [],
      usage: { promptTokens: 14, completionTokens: 8, totalTokens: 22 },
      stats: { attempted: 1, aiFailures: 0 },
    };
  },
});
assert.equal(aiCalls, 1, "first cache miss should invoke AI once");
assert.equal(first.questions[0].answer, "B");
assert.equal(rows.size, 1, "successful AI answers should be saved");
assert.deepEqual(first.usage, { promptTokens: 14, completionTokens: 8, totalTokens: 22 });
assert.equal(cacheEvents[0][0], "MISS");

const second = await solveQuestionsWithCloudCache([question("different-id", {
  question: "Which option is correct?",
})], {
  repository,
  onCacheEvent: (event, hash) => cacheEvents.push([event, hash]),
  async solveMisses() {
    aiCalls += 1;
    throw new Error("cache hit must not call AI");
  },
});
assert.equal(second.questions[0].answer, "B");
assert.equal(second.questions[0].explanation, "The second option is correct.");
assert.deepEqual(second.questions[0].knowledgePoints, ["cache-test"]);
assert.equal(second.questions[0].answerSource, "ai");
assert.equal(second.usage.totalTokens, 0, "cache hits have no new AI token usage");
assert.equal(second.billing, undefined, "cache helper does not perform or claim billing");
assert.equal(aiCalls, 1, "second identical question should not invoke AI again");
assert.equal(usageCount, 1, "cache hit should increment usage count");
assert.equal(cacheEvents[1][0], "HIT");
assert.equal(cacheEvents[0][1], cacheEvents[1][1]);

const mixed = await solveQuestionsWithCloudCache([
  question("cached-with-miss", { question: "Which option is correct?" }),
  question("uncached-low-balance", { question: "A different miss that needs billing?" }),
], {
  repository,
  async solveMisses(misses) {
    assert.equal(misses.length, 1, "only the cache miss should enter authorization/billing");
    return {
      questions: misses,
      errors: [{ id: misses[0].id, code: "INSUFFICIENT_BALANCE", reason: "no balance" }],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      stats: { attempted: 0, aiFailures: 1 },
    };
  },
});
assert.equal(mixed.questions[0].answer, "B", "cache hits remain available when uncached misses are blocked");
assert.equal(mixed.questions[1].answer, null);
assert.equal(mixed.errors[0].code, "INSUFFICIENT_BALANCE");
assert.equal(mixed.usage.totalTokens, 0);

let aiCalledDuringCacheFailure = false;
const unavailable = await solveQuestionsWithCloudCache([question("unavailable", { question: "Cache service outage?" })], {
  repository: {
    isConfigured: () => true,
    async lookupQuestions() { throw new Error("database unavailable"); },
  },
  async solveMisses() {
    aiCalledDuringCacheFailure = true;
    throw new Error("AI must not start while cache status is unknown");
  },
});
assert.equal(aiCalledDuringCacheFailure, false, "configured cache failures must not trigger unbudgeted AI costs");
assert.equal(unavailable.errors[0].code, "QUESTION_CACHE_UNAVAILABLE");
assert.equal(unavailable.cacheStatus, "unavailable");

await solveQuestionsWithCloudCache([question("failed", { question: "A distinct unanswered question?" })], {
  repository,
  async solveMisses(misses) {
    aiCalls += 1;
    return {
      questions: misses.map((item) => ({ ...item, answer: null, answerSource: "missing" })),
      errors: [{ id: "failed", code: "NO_RELIABLE_ANSWER" }],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      stats: { attempted: 1, aiFailures: 1 },
    };
  },
});
assert.equal(rows.size, 1, "failed/empty AI results must never be persisted");

const duplicateHash = createQuestionHash(question("duplicate-a", { question: "Duplicate miss?" }));
let duplicateAiCalls = 0;
const duplicates = await solveQuestionsWithCloudCache([
  question("duplicate-a", { question: "Duplicate miss?" }),
  question("duplicate-b", { question: "Duplicate miss?" }),
], {
  repository,
  async solveMisses(misses) {
    duplicateAiCalls += 1;
    assert.equal(misses.length, 1, "same-request duplicates should share one AI call");
    return {
      questions: [{ ...misses[0], answer: false, answerSource: "ai", explanation: "False is a valid answer." }],
      errors: [],
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      stats: { attempted: 1 },
    };
  },
});
assert.equal(duplicateAiCalls, 1);
assert.equal(duplicates.questions[0].answer, false);
assert.equal(duplicates.questions[1].answer, false);
assert.equal(duplicates.questions[1].id, "duplicate-b");
assert.equal(rows.has(duplicateHash), true);

const databaseRows = new Map();
let databaseUsage = 0;
const databaseRepository = createQuestionAnswerCacheRepository({
  env: { SUPABASE_URL: "https://unit-test.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "unit-test-placeholder" },
  clientFactory(url, key) {
    assert.equal(url, "https://unit-test.example.invalid");
    assert.equal(key, "unit-test-placeholder");
    return {
      from(table) {
        assert.equal(table, "question_answer_cache");
        return {
          select() {
            return {
              async in(column, hashes) {
                assert.equal(column, "question_hash");
                return { data: hashes.map((hash) => databaseRows.get(hash)).filter(Boolean), error: null };
              },
            };
          },
          async upsert(record, options) {
            if (!options.ignoreDuplicates || !databaseRows.has(record.question_hash)) {
              databaseRows.set(record.question_hash, { ...record, usage_count: databaseRows.get(record.question_hash)?.usage_count ?? 0 });
            }
            return { data: null, error: null };
          },
        };
      },
      async rpc(functionName, args) {
        assert.equal(functionName, "increment_question_cache_usage");
        const row = databaseRows.get(args.p_question_hash);
        row.usage_count += 1;
        databaseUsage += 1;
        return { data: [row], error: null };
      },
    };
  },
});
const savedOriginal = question("original", {
  question: "Original answer is available?",
  answer: "A",
  answerSource: "source",
  explanation: "Imported explanation",
});
assert.equal(await databaseRepository.saveQuestion(savedOriginal, "source"), true);
const originalLookup = await databaseRepository.lookupQuestions([savedOriginal]);
assert.equal(originalLookup.hits.get(createQuestionHash(savedOriginal)).answer_source, "original");
assert.equal(databaseUsage, 1);
await databaseRepository.lookupQuestions([savedOriginal, savedOriginal]);
assert.equal(databaseUsage, 3, "each returned cache hit must increment usage, including repeats in one request");

console.log("Question answer cloud-cache tests passed: miss->AI->save, repeat hit->no AI, stable hash and usage increments verified.");
