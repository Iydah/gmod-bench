import type { AdapterId } from "../adapters/types";
import { attemptNumericScore } from "./attempt-meta";
import type {
  AttemptRecord,
  AttemptStatus,
  GroupScore,
  RunSummary,
  StatusCounts,
} from "./types";
import { SCORED_STATUSES } from "./types";

const emptyCounts = (): StatusCounts => ({
  pass: 0,
  partial: 0,
  incorrect: 0,
  protocol_error: 0,
  policy_violation: 0,
  timeout: 0,
  unavailable: 0,
  unsupported: 0,
  trace_error: 0,
  scored: 0,
});

const statusRank: Record<AttemptStatus, number> = {
  pass: 0,
  partial: 1,
  incorrect: 2,
  protocol_error: 3,
  policy_violation: 4,
  timeout: 5,
  trace_error: 6,
  unsupported: 7,
  unavailable: 8,
};

function groupKey(attempt: AttemptRecord): string {
  return `${attempt.fixtureId}\u0000${attempt.adapterId}\u0000${attempt.model ?? ""}`;
}

function emptyGroup(attempt: AttemptRecord): GroupScore {
  const score = attemptNumericScore(attempt.status);
  const scored = score !== null ? 1 : 0;
  return {
    fixtureId: attempt.fixtureId,
    adapterId: attempt.adapterId,
    model: attempt.model,
    attempts: 1,
    passCount: attempt.status === "pass" ? 1 : 0,
    passAtK: attempt.status === "pass",
    bestStatus: attempt.status,
    meanScore: score,
    scoredAttempts: scored,
  };
}

export function summarizeAttempts(
  attempts: readonly AttemptRecord[],
): RunSummary {
  const statusCounts = emptyCounts();
  for (const attempt of attempts) {
    statusCounts[attempt.status] += 1;
    if ((SCORED_STATUSES as readonly string[]).includes(attempt.status)) {
      statusCounts.scored += 1;
    }
  }

  const groups = new Map<string, GroupScore & { scoreSum: number }>();
  for (const attempt of attempts) {
    const key = groupKey(attempt);
    const existing = groups.get(key);
    const score = attemptNumericScore(attempt.status);
    if (!existing) {
      const base = emptyGroup(attempt);
      groups.set(key, {
        ...base,
        scoreSum: score ?? 0,
      });
      continue;
    }

    existing.attempts += 1;
    if (attempt.status === "pass") {
      existing.passCount += 1;
      existing.passAtK = true;
    }
    if (score !== null) {
      existing.scoredAttempts += 1;
      existing.scoreSum += score;
      existing.meanScore = existing.scoreSum / existing.scoredAttempts;
    }
    if (statusRank[attempt.status] < statusRank[existing.bestStatus]) {
      existing.bestStatus = attempt.status;
    }
  }

  const groupList: GroupScore[] = [...groups.values()]
    .map(({ scoreSum: _scoreSum, ...group }) => group)
    .sort((left, right) => {
      const fixtureCmp = left.fixtureId.localeCompare(right.fixtureId);
      if (fixtureCmp !== 0) {
        return fixtureCmp;
      }
      const adapterCmp = left.adapterId.localeCompare(right.adapterId);
      if (adapterCmp !== 0) {
        return adapterCmp;
      }
      return (left.model ?? "").localeCompare(right.model ?? "");
    });

  const scoredGroups = groupList.filter((group) => group.scoredAttempts > 0);
  const passGroups = scoredGroups.filter((group) => group.passAtK).length;
  const meanScores = scoredGroups
    .map((g) => g.meanScore)
    .filter((v): v is number => v !== null);
  const overallMeanScore =
    meanScores.length > 0
      ? meanScores.reduce((a, b) => a + b, 0) / meanScores.length
      : null;

  return {
    statusCounts,
    groups: groupList,
    passAtKRate: `${passGroups}/${scoredGroups.length}`,
    overallMeanScore,
  };
}

export function formatModelLabel(
  adapterId: AdapterId,
  model: string | null,
): string {
  if (!model) return adapterId;
  // Avoid opencode/opencode/… when the model id already includes the provider prefix.
  if (
    model === adapterId ||
    model.startsWith(`${adapterId}/`) ||
    model.startsWith(`${adapterId}@`)
  ) {
    return model;
  }
  return `${adapterId}/${model}`;
}
