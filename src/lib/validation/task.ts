import { z } from 'zod';
import { TASK_PRIORITIES } from '@/lib/tasks';

/**
 * Task validation — ADRAH Farms
 *
 * Shape only. Whether a person may act on a particular task is decided by the
 * service, not here.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'That date is not valid.');

export const taskSchema = z.object({
  title: z.string().trim().min(3, 'Say what needs doing, in a few words at least.').max(120),
  detail: optionalText(1000),
  siteId: z.string().trim().min(1, 'Choose which farm.'),
  priority: z.enum(TASK_PRIORITIES).default('NORMAL'),
  /**
   * BLANK MEANS ANYONE WHO IS FREE — a real answer, not an unfinished form.
   * On a farm of three most jobs are not somebody's in particular.
   */
  assigneeId: optionalText(40),
  /**
   * Blank means "when you can". A task with no date is never overdue, so this
   * is not a field to fill in for the sake of it: a made-up date turns into a
   * red flag next week and trains everybody to ignore red flags.
   *
   * MAY BE IN THE PAST. Somebody writing down a job that should have been done
   * yesterday is recording the truth, and refusing it just loses the task.
   */
  dueOn: z
    .union([isoDate, z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : (v as Date))),
});

export type TaskInput = z.infer<typeof taskSchema>;

export const completionSchema = z.object({
  completionNote: optionalText(500),
});

export const cancelTaskSchema = z.object({
  cancelReason: z
    .string()
    .trim()
    .min(3, 'Say why it is not being done. That is the only record of it.')
    .max(200),
});
