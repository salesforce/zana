import { availableModelSchema, type AvailableModel } from "@zana-ai/zcc-domain/thread-runtime";
import { z } from "zod";

const modelListResultSchema = z.object({
  models: z.array(availableModelSchema),
  selectedOnlyModels: z.array(availableModelSchema),
  acpMode: z.object({
    currentValue: z.string().optional(),
    options: z.array(z.object({ value: z.string(), name: z.string().optional() })),
  }).optional(),
});

export interface ParsedModelListResult {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  acpMode?: { currentValue?: string; options: Array<{ value: string; name?: string }> };
}

export function parseAvailableModelList(
  result: unknown,
): ParsedModelListResult {
  return modelListResultSchema.parse(result);
}
