"""Build an extruded, bevelled F shield from the supplied vector paths."""
from pathlib import Path
import json
import math
import re
import struct
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

def path_points(path):
    tokens = re.findall(r"[MmLlHhVvCcZz]|[-+]?(?:\d*\.\d+|\d+)", path)
    points, current, start = [], (0.0, 0.0), None
    index, command = 0, None
    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
        key = command.upper()
        relative = command.islower()
        if key == "Z":
            current = start
            continue
        count = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6}[key]
        values = list(map(float, tokens[index:index + count]))
        index += count
        ox, oy = current if relative else (0, 0)
        if key in ("M", "L"):
            current = (values[0] + ox, values[1] + oy)
            points.append(current)
            if key == "M":
                start = current
                command = "l" if relative else "L"
        elif key == "H":
            current = (values[0] + ox, current[1])
            points.append(current)
        elif key == "V":
            current = (current[0], values[0] + oy)
            points.append(current)
        elif key == "C":
            a = current
            b, c, d = [(values[j] + ox, values[j + 1] + oy) for j in (0, 2, 4)]
            for step in range(1, 10):
                t = step / 9
                q = 1 - t
                points.append(tuple(q**3 * a[k] + 3*q*q*t*b[k] + 3*q*t*t*c[k] + t**3*d[k] for k in (0, 1)))
            current = d
    cleaned = []
    for p in points:
        if not cleaned or math.dist(cleaned[-1], p) > 1e-7:
            cleaned.append(p)
    if math.dist(cleaned[0], cleaned[-1]) < 1e-7:
        cleaned.pop()
    return cleaned

def area(poly):
    return sum(a[0]*b[1] - b[0]*a[1] for a,b in zip(poly, poly[1:]+poly[:1])) / 2

def inset(poly, amount):
    result = []
    for i, b in enumerate(poly):
        a, c = poly[i - 1], poly[(i + 1) % len(poly)]
        u = (b[0]-a[0], b[1]-a[1])
        v = (c[0]-b[0], c[1]-b[1])
        lu, lv = math.hypot(*u), math.hypot(*v)
        n = (-u[1]/lu, u[0]/lu)
        m = (-v[1]/lv, v[0]/lv)
        denominator = max(.05, 1 + n[0]*m[0] + n[1]*m[1])
        result.append((b[0] + amount*(n[0]+m[0])/denominator,
                       b[1] + amount*(n[1]+m[1])/denominator))
    return result

def normal(points):
    a, b, c = points[:3]
    u, v = [b[i]-a[i] for i in range(3)], [c[i]-a[i] for i in range(3)]
    n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
    length = math.sqrt(sum(x*x for x in n))
    return [x / length for x in n]

surfaces = []
def add(points, material):
    surfaces.append({"vertices": [[round(v, 7) for v in p] for p in points],
                     "normal": [round(v, 7) for v in normal(points)], "material": material})

def extrude(outline, back, rim, front, bevel, face_material, side_material, rim_material):
    poly = [((x - 80)/152, (96 - y)/152) for x,y in outline]
    if area(poly) < 0:
        poly.reverse()
    inner = inset(poly, bevel/152)
    base = [[x,y,back] for x,y in poly]
    outer = [[x,y,rim] for x,y in poly]
    top = [[x,y,front] for x,y in inner]
    add(base[::-1], side_material)
    add(top, face_material)
    for i in range(len(poly)):
        j = (i + 1) % len(poly)
        add([base[i], base[j], outer[j], outer[i]], side_material)
        add([outer[i], outer[j], top[j], top[i]], rim_material)

svg = ET.parse(WEB / "f-mark.svg").getroot()
paths = [item.attrib["d"] for item in svg if item.tag.endswith("path") and item.attrib.get("fill", "").startswith("url")]
extrude(path_points(paths[0]), -.105, .025, .050, 1.8, 0, 1, 2)
extrude(path_points(paths[1]), .048, .105, .120, .75, 3, 4, 5)
materials = [
    {"name": "Shield front", "color": [14, 102, 63], "metallic": .62, "roughness": .28},
    {"name": "Shield edge", "color": [11, 65, 49], "metallic": .68, "roughness": .25},
    {"name": "Shield bevel", "color": [56, 143, 81], "metallic": .70, "roughness": .22},
    {"name": "Raised F", "color": [74, 170, 49], "metallic": .50, "roughness": .25},
    {"name": "F edge", "color": [30, 100, 40], "metallic": .62, "roughness": .25},
    {"name": "F bevel", "color": [117, 201, 75], "metallic": .65, "roughness": .22},
]
model = {"name": "F shield", "units": "normalized", "surfaces": surfaces, "materials": materials}
(WEB / "f-model.json").write_text(json.dumps(model, separators=(",",":")) + "\n", encoding="utf-8")

def cross2(a,b,c):
    return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])

def triangles(vertices):
    if len(vertices) == 4:
        return [(0,1,2), (0,2,3)]
    # Caps lie in the XY plane; ear clipping preserves concave F cut-outs.
    poly = [(p[0],p[1]) for p in vertices]
    sign = 1 if area(poly) > 0 else -1
    indices = list(range(len(poly)))
    output = []
    while len(indices) > 3:
        for i, b in enumerate(indices):
            a, c = indices[i - 1], indices[(i + 1) % len(indices)]
            if sign * cross2(poly[a],poly[b],poly[c]) <= 1e-10:
                continue
            def inside(p):
                return all(sign * cross2(x,y,p) >= -1e-10 for x,y in [(poly[a],poly[b]),(poly[b],poly[c]),(poly[c],poly[a])])
            if any(inside(poly[p]) for p in indices if p not in (a,b,c)):
                continue
            output.append((a,b,c))
            indices.pop(i)
            break
        else:
            raise ValueError("Could not triangulate F cap")
    output.append(tuple(indices))
    return output

blob = bytearray()
views, accessors, primitives = [], [], []
def accessor(values, kind, component, dimensions, target, bounds=False):
    while len(blob) % 4:
        blob.append(0)
    offset = len(blob)
    flattened = [v for row in values for v in row] if dimensions > 1 else values
    fmt = "f" if component == 5126 else "H"
    blob.extend(struct.pack("<" + fmt*len(flattened), *flattened))
    view_index = len(views)
    views.append({"buffer":0,"byteOffset":offset,"byteLength":len(blob)-offset,"target":target})
    entry = {"bufferView":view_index,"componentType":component,"count":len(values),"type":kind}
    if bounds:
        entry["min"] = [min(row[i] for row in values) for i in range(dimensions)]
        entry["max"] = [max(row[i] for row in values) for i in range(dimensions)]
    accessors.append(entry)
    return len(accessors)-1

triangle_count = 0
for material_index in range(len(materials)):
    positions, normals, indices = [], [], []
    for surface in surfaces:
        if surface["material"] != material_index:
            continue
        offset = len(positions)
        positions.extend(surface["vertices"])
        normals.extend([surface["normal"]] * len(surface["vertices"]))
        for triangle in triangles(surface["vertices"]):
            indices.extend(offset + i for i in triangle)
            triangle_count += 1
    primitives.append({"attributes":{"POSITION":accessor(positions,"VEC3",5126,3,34962,True),
                                    "NORMAL":accessor(normals,"VEC3",5126,3,34962)},
                       "indices":accessor(indices,"SCALAR",5123,1,34963),"material":material_index})
gltf = {"asset":{"version":"2.0","generator":"CQA F shield vector extrusion"},
        "scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0,"name":"F Shield"}],
        "meshes":[{"primitives":primitives}],"buffers":[{"byteLength":len(blob)}],
        "bufferViews":views,"accessors":accessors,
        "materials":[{"name":m["name"],"pbrMetallicRoughness":{
            "baseColorFactor":[c/255 for c in m["color"]]+[1],
            "metallicFactor":m["metallic"],"roughnessFactor":m["roughness"]}} for m in materials]}
document = json.dumps(gltf,separators=(",",":")).encode()
document += b" " * (-len(document)%4)
blob += b"\0" * (-len(blob)%4)
total = 12 + 8 + len(document) + 8 + len(blob)
glb = struct.pack("<4sII",b"glTF",2,total) + struct.pack("<I4s",len(document),b"JSON") + document + struct.pack("<I4s",len(blob),b"BIN\0") + blob
(WEB / "f-model.glb").write_bytes(glb)
print(json.dumps({"surfaces":len(surfaces),"triangles":triangle_count,"glb_bytes":len(glb)}))
