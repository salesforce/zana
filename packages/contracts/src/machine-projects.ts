import { z } from 'zod';

export const MACHINE_PROJECT_LIMIT = 1000;
export const machineProjectPathSchema = z.string().min(1).max(4096).refine(path =>
  !/[\x00-\x1f\x7f]/.test(path) && (/^\//.test(path) || /^[A-Za-z]:[\\/]|^\\\\[^\\]+\\/.test(path)), 'Absolute machine folder required');
export const machineProjectNameSchema = z.string().min(1).max(256).refine(name => !/[\x00-\x1f\x7f]/.test(name));
export const machineProjectSchema = z.object({ id: z.string().uuid(), path: machineProjectPathSchema, name: machineProjectNameSchema }).strict();
export type MachineProject = z.infer<typeof machineProjectSchema>;
export const machineProjectPageSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/), projects: z.array(machineProjectSchema).max(100),
  nextOffset: z.number().int().min(1).max(MACHINE_PROJECT_LIMIT).nullable()
}).strict();
export type MachineProjectPage = z.infer<typeof machineProjectPageSchema>;
export const machineProjectRegisterSchema = z.object({ path: machineProjectPathSchema, name: machineProjectNameSchema.optional() }).strict();
