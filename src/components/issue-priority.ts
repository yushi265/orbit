import type { Priority } from "../shared/contracts";
import { priorityValues } from "../shared/contracts";

export function priorityFromSelection(value: string): Priority {
  return priorityValues.includes(value as Priority) ? (value as Priority) : "no_priority";
}
