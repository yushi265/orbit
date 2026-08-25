import type { Priority } from "../shared/contracts";
import { priorityValues } from "../shared/contracts";

export type PriorityIcon = {
  name: "none" | "low" | "medium" | "high" | "urgent";
  label: string;
};

const priorityIcons: Record<Priority, PriorityIcon> = {
  no_priority: { name: "none", label: "No priority" },
  low: { name: "low", label: "Low" },
  medium: { name: "medium", label: "Medium" },
  high: { name: "high", label: "High" },
  urgent: { name: "urgent", label: "Urgent" },
};

export function priorityFromSelection(value: string): Priority {
  return priorityValues.includes(value as Priority) ? (value as Priority) : "no_priority";
}

export function priorityIconFor(priority: Priority): PriorityIcon {
  return priorityIcons[priority];
}
