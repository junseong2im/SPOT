/** Local typed decisions inspired by atomic-question architectures.
 * Scores describe the local model distribution, NOT calibrated correctness.
 * No network, TypeSafe SDK, teacher API, or external model is used.
 */
export type Operation='sets'|'reps'|'remove'|'replace';
export type Decision<T>={question:string;status:'resolved'|'review';value:T|null;evidence:string[];source:'rule'|'local-model'|'user'};
export type Clarification={id:'operation'|'target'|'amount'|'replacement';question:string;options?:{value:string;label:string}[];min?:number;max?:number};
export type Answers=Partial<Record<Clarification['id'],string>>;
export type EditPlan={operation:Decision<Operation>;target:Decision<string[]>;amount:Decision<number>;replacement:Decision<string>;checks:{id:string;passed:boolean;reason:string}[];model:{probabilities:Record<string,number>;concentration:number;calibrated:false};requiresConfirmation:true};
export class DecisionReview extends Error{
 constructor(public clarification:Clarification){super(clarification.question);}
}
export function resolveChoice<T extends string>(question:string,candidates:{value:T;label:string}[],answer?:string):Decision<T>{
 const allowed=[...new Set(candidates.map(c=>c.value))];
 if(answer!==undefined){if(!allowed.includes(answer as T))throw Error('선택 항목이 변경됐어요. 다시 확인해주세요.');return {question,status:'resolved',value:answer as T,evidence:[answer],source:'user'};}
 return {question,status:allowed.length===1?'resolved':'review',value:allowed.length===1?allowed[0]:null,evidence:allowed,source:'rule'};
}
export function requireDecision<T>(answer:Decision<T>,clarification:Clarification):T{
 if(answer.status!=='resolved'||answer.value===null)throw new DecisionReview(clarification);
 return answer.value;
}
export function numericAnswer(raw:string|undefined,min:number,max:number){
 if(raw===undefined)return null;
 if(!/^\d+$/.test(raw)||Number(raw)<min||Number(raw)>max)throw Error(`${min}~${max} 사이 정수로 확인해주세요.`);
 return Number(raw);
}
