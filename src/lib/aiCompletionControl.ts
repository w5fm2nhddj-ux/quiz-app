export type AiCompletionMode = "trial" | "batch";

export const AI_TRIAL_SIZE = 5;
export const AI_REQUEST_BATCH_SIZE = 10;

export function canStartAiCompletion(
  mode: AiCompletionMode,
  batchConfirmed: boolean,
  trialSucceeded: boolean,
) {
  return mode === "trial" || batchConfirmed && trialSucceeded;
}

export function createAiRunLock() {
  let running = false;
  return {
    tryStart() {
      if (running) return false;
      running = true;
      return true;
    },
    release() {
      running = false;
    },
    isRunning() {
      return running;
    },
  };
}
