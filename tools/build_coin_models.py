"""Build beveled, reeded 3D coins with raised currency geometry. No packages required."""
from pathlib import Path
import json
import math
import struct
from build_f_model import normal, triangles

WEB = Path(__file__).resolve().parents[1] / "web"
TAU = math.tau
SEGMENTS = 32
MATERIALS = [
    {"name":"Coin face","color":[226,180,91],"metallic":.85,"roughness":.25},
    {"name":"Milled edge","color":[153,104,38],"metallic":.85,"roughness":.3},
    {"name":"Polished rim","color":[255,220,140],"metallic":.9,"roughness":.2},
    {"name":"Raised currency","color":[177,124,47],"metallic":.8,"roughness":.25},
    {"name":"Currency edge","color":[126,79,24],"metallic":.8,"roughness":.3},
    {"name":"Currency bevel","color":[247,210,123],"metallic":.9,"roughness":.2}
]

def add(surfaces, vertices, material, part=0):
    surfaces.append({"vertices":[[round(v,7) for v in p] for p in vertices],
                     "normal":[round(v,7) for v in normal(vertices)],
                     "material":material,"part":part})

def area(poly):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1]))/2

def bevel(poly, distance):
    result = []
    for i,b in enumerate(poly):
        a,c = poly[i-1],poly[(i+1)%len(poly)]
        u,v = (b[0]-a[0],b[1]-a[1]),(c[0]-b[0],c[1]-b[1])
        n,m = (-u[1]/math.hypot(*u),u[0]/math.hypot(*u)),(-v[1]/math.hypot(*v),v[0]/math.hypot(*v))
        denominator=max(.05,1+n[0]*m[0]+n[1]*m[1])
        result.append((b[0]+distance*(n[0]+m[0])/denominator,b[1]+distance*(n[1]+m[1])/denominator))
    return result

def raised(surfaces, poly, lift=0):
    if area(poly)<0:
        poly=poly[::-1]
    inner=bevel(poly,.008)
    base=[[x,y,.108] for x,y in poly]
    rim=[[x,y,.175+lift] for x,y in poly]
    top=[[x,y,.19+lift] for x,y in inner]
    temp=[]
    add(temp,base[::-1],4)
    add(temp,top,3)
    for i in range(len(poly)):
        j=(i+1)%len(poly)
        add(temp,[base[i],base[j],rim[j],rim[i]],4)
        add(temp,[rim[i],rim[j],top[j],top[i]],5)
    for face in temp:
        add(surfaces,face["vertices"],face["material"],1)
        # The back is a true second face, with the symbol readable from that side.
        add(surfaces,[[-x,y,-z] for x,y,z in face["vertices"]],face["material"],2)

def rectangle(x1,y1,x2,y2):
    return [(x1,y1),(x2,y1),(x2,y2),(x1,y2)]

def bezier(a,b,c,d,count=8):
    result=[]
    for i in range(count):
        t=i/count
        q=1-t
        result.append(tuple(q**3*a[k]+3*q*q*t*b[k]+3*q*t*t*c[k]+t**3*d[k] for k in (0,1)))
    return result

def dollar():
    points=bezier((.28,.34),(.10,.53),(-.32,.43),(-.30,.20))
    points+=bezier((-.30,.20),(-.28,.03),(.28,.04),(.28,-.18))
    points+=bezier((.28,-.18),(.28,-.43),(-.10,-.51),(-.30,-.31))
    points.append((-.30,-.31))
    left,right=[],[]
    for i,p in enumerate(points):
        a,b=points[max(0,i-1)],points[min(len(points)-1,i+1)]
        u=(b[0]-a[0],b[1]-a[1])
        n=(-u[1]/math.hypot(*u)*.066,u[0]/math.hypot(*u)*.066)
        left.append((p[0]+n[0],p[1]+n[1]))
        right.append((p[0]-n[0],p[1]-n[1]))
    return [left+right[::-1],rectangle(-.032,-.55,.032,.55)]

def euro():
    angles=[math.radians(50+260*i/18) for i in range(19)]
    arc=[(.50*math.cos(a),.50*math.sin(a)) for a in angles]
    arc+=[(.34*math.cos(a),.34*math.sin(a)) for a in angles[::-1]]
    return [arc,rectangle(-.53,.07,.23,.17),rectangle(-.53,-.17,.23,-.07)]

def body():
    surfaces=[]
    levels=[(.94,-.14),(1,-.10),(1,.10),(.94,.14),(.82,.14),(.79,.11)]
    rows=[]
    for row,(radius,z) in enumerate(levels):
        rows.append([[math.cos(i/SEGMENTS*TAU)*(radius+(.008 if i%2 else -.008) if row in (1,2) else radius),
                      math.sin(i/SEGMENTS*TAU)*(radius+(.008 if i%2 else -.008) if row in (1,2) else radius),z] for i in range(SEGMENTS)])
    add(surfaces,rows[0][::-1],0)
    add(surfaces,rows[-1],0)
    for k in range(len(rows)-1):
        for i in range(SEGMENTS):
            j=(i+1)%SEGMENTS
            add(surfaces,[rows[k][i],rows[k][j],rows[k+1][j],rows[k+1][i]],1 if k==1 else 2)
    return surfaces

def export_glb(model,path):
    blob=bytearray()
    views,accessors,primitives=[],[],[]
    def accessor(values,kind,component,dimensions,target,bounds=False):
        blob.extend(b"\0"*(-len(blob)%4))
        offset=len(blob)
        flat=[v for row in values for v in row] if dimensions>1 else values
        blob.extend(struct.pack("<"+("f" if component==5126 else "H")*len(flat),*flat))
        views.append({"buffer":0,"byteOffset":offset,"byteLength":len(blob)-offset,"target":target})
        entry={"bufferView":len(views)-1,"componentType":component,"count":len(values),"type":kind}
        if bounds:
            entry["min"]=[min(p[k] for p in values) for k in range(dimensions)]
            entry["max"]=[max(p[k] for p in values) for k in range(dimensions)]
        accessors.append(entry)
        return len(accessors)-1
    total_triangles=0
    for material in range(len(MATERIALS)):
        positions,normals,indices=[],[],[]
        for face in model["surfaces"]:
            if face["material"]!=material:
                continue
            offset=len(positions)
            positions.extend(face["vertices"])
            normals.extend([face["normal"]]*len(face["vertices"]))
            for triangle in triangles(face["vertices"]):
                indices.extend(offset+i for i in triangle)
                total_triangles+=1
        primitives.append({"attributes":{"POSITION":accessor(positions,"VEC3",5126,3,34962,True),"NORMAL":accessor(normals,"VEC3",5126,3,34962)},
                           "indices":accessor(indices,"SCALAR",5123,1,34963),"material":material})
    gltf={"asset":{"version":"2.0","generator":"CQA coin mesh builder"},"scene":0,"scenes":[{"nodes":[0]}],
          "nodes":[{"mesh":0,"name":model["name"]}],"meshes":[{"primitives":primitives}],
          "buffers":[{"byteLength":len(blob)}],"bufferViews":views,"accessors":accessors,
          "materials":[{"name":m["name"],"pbrMetallicRoughness":{"baseColorFactor":[v/255 for v in m["color"]]+[1],"metallicFactor":m["metallic"],"roughnessFactor":m["roughness"]}} for m in MATERIALS]}
    document=json.dumps(gltf,separators=(",",":")).encode()
    document+=b" "*(-len(document)%4)
    blob+=b"\0"*(-len(blob)%4)
    length=12+8+len(document)+8+len(blob)
    path.write_bytes(struct.pack("<4sII",b"glTF",2,length)+struct.pack("<I4s",len(document),b"JSON")+document+struct.pack("<I4s",len(blob),b"BIN\0")+blob)
    return total_triangles

models=[]
shapes=[
    ("tenge",[rectangle(-.38,.34,.38,.45),rectangle(-.38,.15,.38,.25),rectangle(-.065,-.48,.065,.15)]),
    ("dollar",dollar()),
    ("euro",euro())
]
for name,glyphs in shapes:
    surfaces=body()
    for index,glyph in enumerate(glyphs):
        raised(surfaces,glyph,index*.003)
    model={"name":name,"materials":MATERIALS,"surfaces":surfaces}
    count=export_glb(model,WEB/("coin-"+name+".glb"))
    models.append(model)
    print(json.dumps({"coin":name,"surfaces":len(surfaces),"triangles":count,"bytes":(WEB/("coin-"+name+".glb")).stat().st_size}))
(WEB/"coin-models.json").write_text(json.dumps({"models":models},separators=(",",":"))+"\n",encoding="utf-8")
