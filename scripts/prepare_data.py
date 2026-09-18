"""Convert the supplied FH6 package. Runtime does not need Python. Usage: python prepare_data.py /path/to/data"""
from pathlib import Path
import sys, json, shutil
import numpy as np
from PIL import Image
root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
def write(path, data):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
z=np.load(source/'graph.npz')
edge_lookup={}
for (a,b),r,o in zip(z['edges'],z['edge_road'],z['edge_oneway']):
 edge_lookup[(int(a),int(b))]=int(r)
 if not o: edge_lookup[(int(b),int(a))]=int(r)
edge_roads=[]
for a in range(len(z['positions'])):
 for k in range(z['indptr'][a],z['indptr'][a+1]): edge_roads.append(edge_lookup.get((a,int(z['indices'][k])),-1))
write(root/'data/graph.json',{'positions':z['positions'][:,[0,2,1]].round(3).tolist(),'indptr':z['indptr'].tolist(),'indices':z['indices'].tolist(),'weights':z['weights'].round(3).tolist(),'edgeRoads':edge_roads})
for name in ['meta.json','transforms.json']:
 shutil.copy(source/name,root/'public'/name)
roads=json.loads((source/'geojson/roads.geojson').read_text())
write(root/'public/roads.json',roads)
write(root/'data/roads.json',{str(f['properties']['id']):f['properties'] for f in roads['features']})
regions=json.loads((source/'geojson/regions.geojson').read_text())['features']
def inside(x,z,poly):
 result=False;j=len(poly)-1
 for i in range(len(poly)):
  a,b=poly[i],poly[j]
  if ((a[1]>z)!=(b[1]>z)) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]: result=not result
  j=i
 return result
places=[]
for f in json.loads((source/'geojson/landmarks.geojson').read_text())['features']:
 p=f['properties']; x,z,y=f['geometry']['coordinates']; name=p['name']
 category='parking' if '停车' in name else 'racing' if any(s in name for s in ['赛道','环道','嘉年华','体育场']) else 'scenic'
 region=next((r['properties']['name'] for r in regions if inside(x,z,r['geometry']['coordinates'][0])),'Brio')
 places.append({'id':p['key'],'name':name,'en':p['name_en'],'position':[x,z,y],'category':category,'region':region})
write(root/'public/places.json',places)
write(root/'public/regions.json',[dict(r['properties']) for r in regions])
for name,file in [('standard','amap_base.jpg'),('satellite','sat.jpg')]:
 Image.open(source/'maps'/file).convert('RGB').save(root/'public/maps'/f'{name}.webp',quality=86,method=6)
shutil.copy(source/'README.md',root/'docs/SOURCE-DATA.md')
print(f'Prepared {len(places)} places, {len(edge_lookup)} arcs checked, {len(edge_roads)} directed arcs.')
