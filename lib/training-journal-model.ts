import {z} from 'zod';
export const journalDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>{const t=new Date(d+'T00:00:00Z');return !Number.isNaN(+t)&&t.toISOString().slice(0,10)===d;});
const optionalNumber=(max:number)=>z.number().finite().min(0).max(max).nullable();
export const journalContent=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('body'),weight:optionalNumber(500),fat:optionalNumber(100),muscle:optionalNumber(200),note:z.string().max(500)}),
 z.object({kind:z.literal('meal'),name:z.string().trim().min(1).max(120),meal:z.enum(['breakfast','lunch','dinner','snack']),calories:optionalNumber(10000),protein:optionalNumber(1000),carbs:optionalNumber(2000),fat:optionalNumber(1000),note:z.string().max(500)}),
 z.object({kind:z.literal('cardio'),name:z.string().trim().min(1).max(120),minutes:z.number().positive().max(1440),distance:optionalNumber(1000),note:z.string().max(500)}),
 z.object({kind:z.literal('recovery'),sleep:optionalNumber(24),energy:z.number().int().min(1).max(5).nullable(),soreness:z.number().int().min(0).max(5).nullable(),note:z.string().max(500)}),
]);
export const journalEntry=z.object({id:z.string().uuid(),date:journalDate,content:journalContent,revision:z.number().int().min(0)}).refine(e=>e.content.kind!=='body'||e.content.weight!==null||e.content.fat!==null||e.content.muscle!==null,{message:'신체 측정값을 하나 이상 입력하세요.'});
export type JournalEntry=z.infer<typeof journalEntry>;
