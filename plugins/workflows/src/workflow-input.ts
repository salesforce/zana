import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk/server";
import {
  resolveWorkflowSource,
  type ResolvedWorkflowSource,
  type WorkflowSourceContext,
  type WorkflowSourceInput,
} from "./source-resolution.js";
import {
  validateWorkflowSource,
  type WorkflowValidationSummary,
} from "./workflow-validation.js";

interface PreparedWorkflowSource extends ResolvedWorkflowSource {
  validation: WorkflowValidationSummary;
}

export async function prepareWorkflowSource(
  bb: ZccPluginApi,
  context: WorkflowSourceContext,
  input: WorkflowSourceInput,
): Promise<PreparedWorkflowSource> {
  const resolved = await resolveWorkflowSource(input, context, {
    async getThreadEnvironmentId(threadId) {
      const thread = await bb.sdk.threads.get({ threadId });
      return thread?.environmentId ?? null;
    },
    async getEnvironment(environmentId) {
      const environment = await bb.sdk.environments.get({ environmentId });
      return {
        id: environment.id,
        projectId: environment.projectId,
        hostId: environment.hostId,
        path: environment.path,
      };
    },
    readFile(input) {
      return bb.sdk.files.read(input);
    },
  });
  const validation = await validateWorkflowSource(
    resolved.source,
    resolved.environmentId,
    {
      listProviders(environmentId) {
        return bb.sdk.providers.list({ environmentId });
      },
      loadModels(environmentId, providerId) {
        return bb.sdk.providers.models({ environmentId, providerId });
      },
    },
  );
  return { ...resolved, validation };
}
