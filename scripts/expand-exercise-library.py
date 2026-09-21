"""Import selected, attributed wger images without changing their pixels.
Input: a previously fetched public wger exerciseinfo snapshot and license catalog.
The selected mapping is reviewed in data/exercise-library-expansion.json.
"""
import json,hashlib,urllib.request,urllib.parse,concurrent.futures
from pathlib import Path
root=Path(__file__).resolve().parents[1]
snapshot=json.loads((root/'.data/wger-exercises.json').read_text(encoding='utf-8-sig'))
licenses={r['id']:r for r in json.loads((root/'.data/wger-licenses.json').read_text(encoding='utf-8-sig'))['results']}
records={r['id']:r for r in snapshot['results']}
selection=json.loads((root/'data/exercise-library-expansion.json').read_text(encoding='utf-8'))
catalog=json.loads((root/'lib/exercise-images.json').read_text(encoding='utf-8'))
existing={i['original']:i['src'] for item in catalog.values() for i in item['images']}
def fetch_image(image):
 url=image['image'];parsed=urllib.parse.urlparse(url)
 if parsed.scheme!='https' or parsed.hostname!='wger.de' or not parsed.path.startswith('/media/exercise-images/'):raise ValueError('Unexpected asset host')
 suffix=Path(parsed.path).suffix.lower()
 if suffix not in ['.png','.jpg','.jpeg','.jfif','.webp','.gif']:raise ValueError('Unsupported media format: '+suffix)
 if suffix=='.jfif':suffix='.jpg'
 public=existing.get(url,f"/exercise-images/wger-{image['id']}{suffix}")
 path=root/'public'/public.lstrip('/')
 if not path.exists():
  with urllib.request.urlopen(url,timeout=30) as response:
   if not response.headers.get_content_type().startswith('image/'):raise ValueError('Source did not return an image')
   content=response.read(8*1024*1024+1)
  if len(content)>8*1024*1024:raise ValueError('Oversized image')
  if not (content.startswith(b'\x89PNG') or content.startswith(b'\xff\xd8') or content.startswith(b'GIF8') or content[:4]==b'RIFF'):raise ValueError('Image signature mismatch')
  path.write_bytes(content)
 license=licenses[image['license']]
 return {'src':public,'original':url,'author':image['license_author'],'license':license['short_name'],'licenseUrl':license['url'],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
def prepare(row):
 ident,name,body,equipment,pose,start,finish,*extra=row;r=records[ident]
 translation=next(t for t in r['translations'] if t['language']==2)
 images=[i for i in r['images'] if i.get('license_author','').strip() and i['license'] in [1,2,3,4] and not i.get('is_ai_generated')]
 if not images:raise ValueError(f'{ident}: No attributed non-AI image')
 # Prefer paired illustrations when available, preserving published source order.
 paired=[i for i in images if i['license_author']=='Everkinetic'];images=(paired or images)[:2]
 media={'exerciseName':translation['name'],'source':f'https://wger.de/api/v2/exerciseinfo/{ident}/','images':[fetch_image(i) for i in images]}
 guide={'id':f'wger-{ident}','name':name,'body':body,'equipment':equipment,'pose':pose,'match':[name,translation['name']],'start':start,'finish':finish,'cues':['처음에는 가벼운 저항과 조절 가능한 범위로 익혀요.','통증이 생기면 중단하고 자세를 확인해요.'],'source':media['source'],'unit':extra[0] if extra else 'reps'}
 return guide,media
results=[];errors=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 futures={pool.submit(prepare,row):row[0] for row in selection}
 for future in concurrent.futures.as_completed(futures):
  try:results.append(future.result())
  except Exception as e:errors.append({'id':futures[future],'error':str(e)})
  if (len(results)+len(errors))%20==0:print(f'Processed {len(results)+len(errors)}/{len(selection)}',flush=True)
if errors:
 (root/'.data/exercise-import-errors.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2),encoding='utf-8')
 raise RuntimeError(f'{len(errors)} assets failed. No catalog changes written; see .data/exercise-import-errors.json')
results.sort(key=lambda pair:next(i for i,r in enumerate(selection) if f'wger-{r[0]}'==pair[0]['id']))
for guide,media in results:catalog[guide['id']]=media
(root/'lib/exercise-guides-expanded.json').write_text(json.dumps([g for g,_ in results],ensure_ascii=False,indent=2),encoding='utf-8')
(root/'lib/exercise-images.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'expanded_guides':len(results),'images':sum(len(m['images']) for _,m in results),'snapshot_sha256':hashlib.sha256((root/'.data/wger-exercises.json').read_bytes()).hexdigest()}),flush=True)
