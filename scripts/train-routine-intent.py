"""Train a tiny CPU intent classifier. Synthetic development data, not user data.
Holdout phrases and exercise names are not used for gradient updates.
No external Python packages or GPU required.
"""
import json, math, hashlib, unicodedata, random
from pathlib import Path
LABELS=['sets','reps','remove','replace','unknown']
DIM=1024
templates={
 'sets':['{e} 세트를 {n}세트로 바꿔줘','{e} {n}세트로 설정','{e} 세트 수 {n}으로 수정','모든 운동을 {n}세트로','{e} 세트 하나 줄여줘','{e} 한 세트 더 추가해줘'],
 'reps':['{e} 횟수를 {n}회로 바꿔줘','{e} {n}회로 설정','{e} 반복 {n}회로 수정','전체 운동 횟수 {n}회로','{e} 반복 횟수 하나 줄여줘','{e} 두 회 더 늘려줘'],
 'remove':['{e} 빼줘','{e} 삭제해줘','{e} 운동 없애줘','{e} 제외해줘','루틴에서 {e} 지워줘','{e} 종목을 제거해줘'],
 'replace':['{e} 대신 {b}로 바꿔줘','{e}를 {b}로 교체해줘','{e} 말고 {b}로','{e} 운동을 {b}로 변경','{e} 대신에 {b} 넣어줘','{e} 종목을 {b}로 대체해줘'],
 'unknown':['오늘 날씨 알려줘','{e} 하면 어디 아파','{e} 자세 알려줘','{e} {n}키로','{e} 삭제하지 마','친구에게 메시지 보내줘','{e} 쉬는 시간 알려줘','좀 더 쉽게 해줘','{n}분만 운동할래','{e} 루틴 추천해줘'],
}
heldout={
 'sets':['{e} 세트 수를 {n}세트로 변경해','{e}를 {n}세트로 맞춰줘'],
 'reps':['{e} 반복을 {n}회로 맞춰','{e} 횟수는 {n}회로 변경해'],
 'remove':['{e}는 루틴에서 제외','{e} 종목 삭제 부탁해'],
 'replace':['{e} 대신 {b} 운동으로 대체','{e}를 {b}로 교체 부탁해'],
 'unknown':['{e} 하는 법이 궁금해','내일 몇 시에 갈까','{e} 무게는 {n}kg이야','수정하지 말고 설명해'],
}
def features(text):
 text=unicodedata.normalize('NFKC',text).lower().replace(' ','')
 features={}
 for n in [1,2,3]:
  for i in range(len(text)-n+1):
   h=2166136261
   for c in text[i:i+n]:h=((h^ord(c))*16777619)&0xffffffff
   k=h%DIM;features[k]=features.get(k,0)+1
 norm=math.sqrt(sum(v*v for v in features.values())) or 1
 return {k:v/norm for k,v in features.items()}
def corpus(source,names):
 rows=[{'text':phrase.format(e=e,b='레그 프레스',n=n),'label':label} for label,phrases in source.items() for phrase in phrases for e in names for n in [3,4,12]]
 return list({(row['text'],row['label']):row for row in rows}.values())
train=corpus(templates,['벤치','랫풀','스쿼트','사레레']);test=corpus(heldout,['숄더 프레스','시티드 로우'])
assert not set(x['text'] for x in train)&set(x['text'] for x in test)
w=[[0.0]*DIM for _ in LABELS];bias=[0.0]*len(LABELS)
prepared=[(features(x['text']),LABELS.index(x['label'])) for x in train]
rng=random.Random(17)
for epoch in range(100):
 rng.shuffle(prepared)
 for f,target in prepared:
  scores=[bias[j]+sum(w[j][k]*v for k,v in f.items()) for j in range(len(LABELS))]
  exps=[math.exp(s-max(scores)) for s in scores];total=sum(exps)
  for j in range(len(LABELS)):
   delta=.12*((1 if j==target else 0)-exps[j]/total)
   bias[j]+=delta
   for k,v in f.items():w[j][k]+=delta*v
def predict(text):
 f=features(text);scores=[bias[j]+sum(w[j][k]*v for k,v in f.items()) for j in range(len(LABELS))]
 return LABELS[max(range(len(LABELS)),key=lambda j:scores[j])]
results=[dict(x,predicted=predict(x['text'])) for x in test]
model={'version':1,'algorithm':'hashed-character-ngram-softmax','dimensions':DIM,'labels':LABELS,'weights':[[round(v,6) for v in row] for row in w],'bias':[round(v,6) for v in bias]}
root=Path(__file__).resolve().parents[1];dest=root/'lib/routine-assistant';dest.mkdir(parents=True,exist_ok=True)
(dest/'intent-model.json').write_text(json.dumps(model,separators=(',',':')),encoding='utf-8')
data=root/'data/routine-assistant';data.mkdir(parents=True,exist_ok=True)
for name,rows in [('train',train),('heldout',test)]:
 (data/f'{name}.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
report={'training_examples':len(train),'heldout_examples':len(test),'correct':sum(x['label']==x['predicted'] for x in results),'limitations':'Synthetic phrase/name holdout, not independent real-user accuracy. Deterministic validation gates every edit.','model_sha256':hashlib.sha256((dest/'intent-model.json').read_bytes()).hexdigest(),'errors':[x for x in results if x['label']!=x['predicted']]}
(data/'evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='errors'},ensure_ascii=False))
