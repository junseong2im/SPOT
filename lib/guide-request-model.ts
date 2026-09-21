export const guideRequestName=(name:string)=>name.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export type GuideRequestSummary={title:string;people:number;requests:number};
