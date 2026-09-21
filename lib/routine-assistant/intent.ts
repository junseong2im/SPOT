import model from './intent-model.json';
export function classifyIntent(text:string){
 const value=text.normalize('NFKC').toLowerCase().replaceAll(' ','');const f=new Map<number,number>();
 for(const n of [1,2,3])for(let i=0;i<=value.length-n;i++){
  let h=2166136261;for(const c of value.slice(i,i+n))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
  const k=h%model.dimensions;f.set(k,(f.get(k)??0)+1);
 }
 const norm=Math.sqrt([...f.values()].reduce((s,v)=>s+v*v,0))||1;
 const scores=model.labels.map((label,j)=>({label,score:model.bias[j]+[...f].reduce((s,[k,v])=>s+model.weights[j][k]*v/norm,0)})).sort((a,b)=>b.score-a.score);
 return {label:scores[0].label,margin:scores[0].score-scores[1].score};
}
