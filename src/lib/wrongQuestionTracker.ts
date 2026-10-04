import type { Question } from "@/types/quiz";

export type WrongQuestionRecord = {
  bankId: string;
  questionId: string;
  questionText: string;
  questionType: Question["type"];
  selectedOptions: string[];
  correctAnswer: string[];
  source: string;
  createdAt: string;
  lastAttemptedAt: string;
};

const STORAGE_KEY = "zhidian.wrong-questions.v1";
const memoryStore = new Map<string, WrongQuestionRecord[]>();

function readRecords(): WrongQuestionRecord[] {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as WrongQuestionRecord[]) : [];
    } catch {
      return memoryStore.get(STORAGE_KEY) ?? [];
    }
  }
  return memoryStore.get(STORAGE_KEY) ?? [];
}

function writeRecords(records: WrongQuestionRecord[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return;
  }
  memoryStore.set(STORAGE_KEY, records);
}

export function getWrongQuestions(bankId: string): WrongQuestionRecord[] {
  return readRecords()
    .filter((record) => record.bankId === bankId)
    .sort((a, b) => b.lastAttemptedAt.localeCompare(a.lastAttemptedAt));
}

export function recordWrongQuestion(
  bankId: string,
  question: Pick<Question, "id" | "question" | "type" | "answer" | "source">,
  selectedOptions: string[],
) {
  const now = new Date().toISOString();
  const records = readRecords();
  const index = records.findIndex(
    (record) => record.bankId === bankId && record.questionId === question.id,
  );

  const nextRecord: WrongQuestionRecord = {
    bankId,
    questionId: question.id,
    questionText: question.question,
    questionType: question.type,
    selectedOptions: [...selectedOptions],
    correctAnswer: [...question.answer],
    source: question.source || "未知来源",
    createdAt: index >= 0 ? records[index].createdAt : now,
    lastAttemptedAt: now,
  };

  if (index >= 0) {
    records[index] = nextRecord;
  } else {
    records.push(nextRecord);
  }

  writeRecords(records);
}

export function removeWrongQuestion(bankId: string, questionId: string) {
  const nextRecords = readRecords().filter(
    (record) => !(record.bankId === bankId && record.questionId === questionId),
  );
  writeRecords(nextRecords);
}

export function clearWrongQuestions(bankId: string) {
  writeRecords(readRecords().filter((record) => record.bankId !== bankId));
}
