import type { QuestionBank } from "@/types/quiz";

const STORAGE_KEY = "zhidian.question-banks.v1";

// 页面只依赖这个接口。以后接入 Supabase 时，可以提供另一个实现。
export interface QuestionBankRepository {
  list(): QuestionBank[];
  getById(id: string): QuestionBank | undefined;
  save(bank: QuestionBank): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  seedIfEmpty(bank: QuestionBank): QuestionBank[];
}

function readBanks(): QuestionBank[] {
  if (typeof window === "undefined") return [];

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as QuestionBank[]) : [];
  } catch {
    // localStorage 内容损坏时返回空数组，避免整个页面崩溃。
    return [];
  }
}

function writeBanks(banks: QuestionBank[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(banks));
}

export const questionBankRepository: QuestionBankRepository = {
  list() {
    return readBanks().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  getById(id) {
    return readBanks().find((bank) => bank.id === id);
  },

  save(bank) {
    const banks = readBanks();
    const index = banks.findIndex((item) => item.id === bank.id);
    if (index >= 0) banks[index] = bank;
    else banks.push(bank);
    writeBanks(banks);
  },

  remove(id) {
    writeBanks(readBanks().filter((bank) => bank.id !== id));
  },

  rename(id, name) {
    const now = new Date().toISOString();
    writeBanks(
      readBanks().map((bank) =>
        bank.id === id ? { ...bank, name, updatedAt: now } : bank,
      ),
    );
  },

  seedIfEmpty(bank) {
    const banks = readBanks();
    // 只有第一次访问时写入示例题库；用户主动删空后保持为空。
    if (window.localStorage.getItem(STORAGE_KEY) !== null) return banks;
    writeBanks([bank]);
    return [bank];
  },
};
