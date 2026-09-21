export type CoffeeSettlement={price:number;total:number;buyer:string|null;finalizedAt:number;progress?:{userId:string;days:number;withdrawn:boolean}[];shares:{userId:string;amount:number;sent:boolean;received:boolean}[];cups:{userId:string;bought:boolean;received:boolean}[]};
export function coffeeSettlement(progress:{userId:string;days:number;withdrawn:boolean}[],target:number,price:number,now:number):CoffeeSettlement{
 const winners=progress.filter(p=>!p.withdrawn&&p.days>=target).map(p=>p.userId).sort();
 const losers=progress.filter(p=>!p.withdrawn&&p.days<target).map(p=>p.userId).sort();
 const total=winners.length&&losers.length?winners.length*price:0;
 return {price,total,progress:progress.map(p=>({...p})),buyer:total?losers[0]:null,finalizedAt:now,shares:total?losers.map((id,i)=>({userId:id,amount:Math.floor(total/losers.length)+(i<total%losers.length?1:0),sent:i===0,received:i===0})):[],cups:total?winners.map(id=>({userId:id,bought:false,received:false})):[]};
}
