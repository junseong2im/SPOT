import {exerciseGuides} from '../exercise-guides';
export const normalizeName=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s·_()-]/g,'');
const aliases:Record<string,string>={
 '벤치':'벤치프레스','벤치프레스':'벤치프레스','benchpress':'벤치프레스',
 '인클라인덤벨프레스':'인클라인 덤벨 프레스','inclinedumbbellpress':'인클라인 덤벨 프레스',
 '랫풀':'랫 풀다운','랫풀다운':'랫 풀다운','latpulldown':'랫 풀다운',
 '사레레':'사이드 레터럴 레이즈','사이드레터럴레이즈':'사이드 레터럴 레이즈','lateralraise':'사이드 레터럴 레이즈',
 '레그익스':'레그 익스텐션','레그익스텐션':'레그 익스텐션','legextension':'레그 익스텐션',
 '레그컬':'레그 컬','legcurl':'레그 컬','레그프레스':'레그 프레스','legpress':'레그 프레스',
 '스쿼트':'스쿼트','squat':'스쿼트','바벨스쿼트':'바벨 스쿼트',
 '시티드로우':'시티드 로우','seatedrow':'시티드 로우','케이블로우':'케이블 로우','덤벨로우':'덤벨 로우',
 '숄더프레스':'숄더 프레스','shoulderpress':'숄더 프레스','체스트프레스':'체스트 프레스',
 '루마니안데드리프트':'루마니안 데드리프트','rdl':'루마니안 데드리프트','딥스':'딥스',
 '덤벨컬':'덤벨 컬','바벨컬':'바벨 컬','이지바컬':'이지바 컬','해머컬':'해머 컬',
 '펙덱':'펙덱 플라이','펙덱플라이':'펙덱 플라이','케이블푸시다운':'케이블 푸시다운',
 '케이블크런치':'케이블 크런치','행잉레그레이즈':'행잉 레그 레이즈','슈러그':'슈러그',
};
export function resolveName(raw:string){
 const normalized=normalizeName(raw);
 const canonical=aliases[normalized]??exerciseGuides.find(g=>normalizeName(g.name)===normalized)?.name;
 // Never replace a specific movement with a broader family by substring matching.
 return {name:canonical??raw.trim(),known:!!canonical};
}
export function sameExercise(a:string,b:string){return normalizeName(resolveName(a).name)===normalizeName(resolveName(b).name);}
