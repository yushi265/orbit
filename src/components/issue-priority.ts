import type { Priority } from "../shared/contracts";
import { priorityValues } from "../shared/contracts";

export type PriorityIcon = {
  name: "none" | "low" | "medium" | "high" | "urgent";
  label: string;
  paths: { d: string; dash?: string }[];
};

const priorityIcons: Record<Priority, PriorityIcon> = {
  no_priority: { name: "none", label: "No priority", paths: [{ d: "M3.5 8h9", dash: "1 3" }] },
  low: { name: "low", label: "Low", paths: [{ d: "M4 6l4 4 4-4" }] },
  medium: { name: "medium", label: "Medium", paths: [{ d: "M4 6.5h8" }, { d: "M4 9.5h8" }] },
  high: { name: "high", label: "High", paths: [{ d: "M4 10 8 6l4 4" }] },
  urgent: {
    name: "urgent",
    label: "Urgent",
    paths: [{ d: "M4 8.5 8 4.5l4 4" }, { d: "M4 12.5 8 8.5l4 4" }],
  },
};

export function priorityFromSelection(value: string): Priority {
  return priorityValues.includes(value as Priority) ? (value as Priority) : "no_priority";
}

export function priorityIconFor(priority: Priority): PriorityIcon {
  return priorityIcons[priority];
}
