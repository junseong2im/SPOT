import {z} from 'zod';
import {workoutStateSchema,trainingProfileSchema} from './training-model';
import {journalEntry} from './training-journal-model';
export const backupWorkout=z.object({id:z.string().uuid(),routine_name:z.string().trim().min(1).max(100),state:workoutStateSchema,started_at:z.number().int().nonnegative(),finished_at:z.number().int().positive()}).refine(w=>w.finished_at>=w.started_at&&w.finished_at<=Date.now()&&w.state.exercises.some(e=>e.sets.some(s=>s.done)));
export const backupBatch=z.object({format:z.literal('spot-training-v1'),workouts:z.array(backupWorkout).max(10),journal:z.array(journalEntry).max(50),profile:trainingProfileSchema.nullable().optional()});
