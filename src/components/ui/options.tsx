import type { CycleViewModel as Cycle, IssueViewModel as Issue } from "../../shared/view-models";

export const priorityLabel: Record<Issue["priority"], string> = {
  no_priority: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const priorityTone: Record<Issue["priority"], string> = {
  no_priority: "neutral",
  low: "low",
  medium: "medium",
  high: "high",
  urgent: "urgent",
};

/** priority の選択肢（表示順は priorityLabel の定義順）。 */
export const priorityOptionList = Object.entries(priorityLabel).map(([value, label]) => ({
  value,
  label,
}));

export function PriorityOptions() {
  return (
    <>
      {priorityOptionList.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}

function cycleSelectOptions(cycles: Cycle[], currentId: string) {
  const suffix = {
    active: "Current",
    upcoming: "Upcoming",
    completed: "Completed",
  } as const;
  return cycles
    .filter((cycle) => cycle.status !== "completed" || cycle.id === currentId)
    .sort((left, right) => left.number - right.number)
    .map((cycle) => ({
      id: cycle.id,
      label: `${cycle.nameOverride ?? cycle.name}（${suffix[cycle.status]}）`,
    }));
}

export function CycleSelectOptions({ cycles, currentId }: { cycles: Cycle[]; currentId: string }) {
  return (
    <>
      <option value="">なし</option>
      {cycleSelectOptions([...cycles], currentId).map((option) => (
        <option value={option.id} key={option.id}>
          {option.label}
        </option>
      ))}
    </>
  );
}
