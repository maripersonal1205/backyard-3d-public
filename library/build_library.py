#!/usr/bin/env python3
"""Build the Backyard model library without Blender, a web server, or network access.

  python3 library/build_library.py --list
  python3 library/build_library.py --check
  python3 library/build_library.py --item teak-lounge-chair
  python3 library/build_library.py --all
  python3 library/build_library.py --hammock-cloth

No arguments prints help and does not modify assets. See BUILDER.md for details.
"""
import argparse
import importlib.util
import os
import pathlib
import re
import shutil
import sys
import tempfile

sys.dont_write_bytecode = True
LIBRARY_DIR = pathlib.Path(__file__).resolve().parent
ROOT = LIBRARY_DIR

# Use the already-installed Codex runtime if system Python lacks dependencies.
# No packages are installed and no server is started.
_missing = [name for name in ('PIL', 'numpy') if importlib.util.find_spec(name) is None]
if _missing:
    _bundled = pathlib.Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
    if __name__ == '__main__' and _bundled.is_file() and _bundled.resolve() != pathlib.Path(sys.executable).resolve():
        os.execv(str(_bundled), [str(_bundled), '-B', str(pathlib.Path(__file__).resolve()), *sys.argv[1:]])
    raise SystemExit('This builder requires Pillow and NumPy. Use a Python environment with both installed.')

# ---- Mesh primitives, textures, plants, and teak bench ----
import math, random, json, struct, pathlib, io, itertools
from collections import defaultdict
from PIL import Image, ImageDraw, ImageFilter

PI = math.pi
def add(a,b): return tuple(x+y for x,y in zip(a,b))
def sub(a,b): return tuple(x-y for x,y in zip(a,b))
def mul(a,s): return tuple(x*s for x in a)
def dot(a,b): return sum(x*y for x,y in zip(a,b))
def cross(a,b): return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def unit(a): return mul(a,1/max(1e-12,math.sqrt(dot(a,a))))
def mix(a,b,t): return add(mul(a,1-t),mul(b,t))
def linear(x): return ((x+.055)/1.055)**2.4 if x>.04045 else x/12.92
def rgb(c): return [linear(x/255) for x in c]
def basis(axis):
    a=unit(axis); u=unit(cross(a,(0,1,0) if abs(a[1])<.95 else (1,0,0)));return u,unit(cross(a,u))

class Mesh:
    def __init__(self):self.p=[];self.n=[];self.uv=[];self.c=[];self.i=[]
    def face(self,points,uv=None,color=(1,1,1),normals=None):
        n=unit(cross(sub(points[1],points[0]),sub(points[2],points[0])))
        if dot(n,n)<.5:return
        base=len(self.p);self.p.extend(points);self.n.extend(normals or [n]*len(points));self.uv.extend(uv or [(0,0)]*len(points));self.c.extend([tuple(max(0,min(1,v)) for v in color)]*len(points))
        for j in range(1,len(points)-1):self.i.extend((base,base+j,base+j+1))

class Model:
    def __init__(self,id):self.id=id;self.materials=[];self.meshes={};self.images=[]
    def material(self,name,color=(255,255,255),rough=.7,texture=None,alpha=False,double=False):
        m={'name':name,'pbrMetallicRoughness':{'baseColorFactor':rgb(color)+[1],'metallicFactor':0,'roughnessFactor':rough},'alphaMode':'MASK' if alpha else 'OPAQUE','doubleSided':double}
        if alpha:m['alphaCutoff']=.4
        if texture is not None:
            data,mime=texture;m['pbrMetallicRoughness']['baseColorTexture']={'index':len(self.images)};self.images.append((data,mime))
        self.materials.append(m);self.meshes[len(self.materials)-1]=Mesh();return len(self.materials)-1
    def fit(self,width=None,height=None,depth=None):
        pts=[p for mesh in self.meshes.values() for p in mesh.p];lo=[min(p[k] for p in pts) for k in range(3)];hi=[max(p[k] for p in pts) for k in range(3)]
        s=[(width/(hi[0]-lo[0])) if width else 1,(height/(hi[1]-lo[1])) if height else 1,(depth/(hi[2]-lo[2])) if depth else ((width/(hi[0]-lo[0])) if width else 1)]
        center=((hi[0]+lo[0])/2,lo[1],(hi[2]+lo[2])/2)
        for mesh in self.meshes.values():
            mesh.p=[tuple((p[k]-center[k])*s[k] for k in range(3)) for p in mesh.p];mesh.n=[unit(tuple(n[k]/s[k] for k in range(3))) for n in mesh.n]
    def save(self):
        blob=bytearray();views=[];acc=[]
        def chunk(data,target=None):
            while len(blob)%4:blob.append(0)
            start=len(blob);blob.extend(data);v={'buffer':0,'byteOffset':start,'byteLength':len(data)}
            if target:v['target']=target
            views.append(v);return len(views)-1
        def accessor(data,typ,component):
            num={'SCALAR':1,'VEC2':2,'VEC3':3}[typ];flat=data if num==1 else [v for row in data for v in row];fmt={5126:'f',5123:'H',5125:'I'}[component]
            v=chunk(struct.pack('<'+fmt*len(flat),*flat),34963 if num==1 else 34962);a={'bufferView':v,'componentType':component,'count':len(data),'type':typ}
            if num==3:a.update(min=[min(p[k] for p in data) for k in range(3)],max=[max(p[k] for p in data) for k in range(3)])
            acc.append(a);return len(acc)-1
        meshes=[]
        for mi,mesh in self.meshes.items():
            if not mesh.i:continue
            attrs={'POSITION':accessor(mesh.p,'VEC3',5126),'NORMAL':accessor(mesh.n,'VEC3',5126),'TEXCOORD_0':accessor(mesh.uv,'VEC2',5126),'COLOR_0':accessor(mesh.c,'VEC3',5126)}
            meshes.append({'name':self.materials[mi]['name'],'primitives':[{'attributes':attrs,'indices':accessor(mesh.i,'SCALAR',5123 if len(mesh.p)<65536 else 5125),'material':mi,'mode':4}]})
        images=[{'bufferView':chunk(data),'mimeType':mime} for data,mime in self.images]
        while len(blob)%4:blob.append(0)
        g={'asset':{'version':'2.0','generator':'Backyard botanical library builder'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':self.id,'children':list(range(1,len(meshes)+1))}]+[{'name':m['name'],'mesh':i} for i,m in enumerate(meshes)],'meshes':meshes,'materials':self.materials,'accessors':acc,'bufferViews':views,'buffers':[{'byteLength':len(blob)}]}
        extensions=sorted({name for material in self.materials for name in material.get('extensions',{})})
        if extensions:g['extensionsUsed']=extensions
        if images:g.update(images=images,textures=[{'source':i,'sampler':0} for i in range(len(images))],samplers=[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}])
        j=json.dumps(g,separators=(',',':')).encode();j+=b' '*((-len(j))%4);out=struct.pack('<III',0x46546c67,2,28+len(j)+len(blob))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(blob),0x004e4942)+blob;(ROOT/'models'/f'{self.id}.glb').write_bytes(out)
        pts=[p for m in self.meshes.values() for p in m.p];lo=[min(p[k] for p in pts) for k in range(3)];hi=[max(p[k] for p in pts) for k in range(3)]
        return {'id':self.id,'dimensions':[round(hi[k]-lo[k],4) for k in range(3)],'bounds':[lo,hi],'triangles':sum(len(m.i)//3 for m in self.meshes.values()),'bytes':len(out)}

def image_bytes(im,alpha=False):
    out=io.BytesIO();im.save(out,format='PNG' if alpha else 'JPEG',**({} if alpha else {'quality':91}));return out.getvalue(),'image/png' if alpha else 'image/jpeg'

def leaf_texture(kind):
    N=512;im=Image.new('RGBA',(N,N));px=im.load();rng=random.Random(32 if kind=='avocado' else 33)
    for y in range(N):
        t=y/(N-1);half=.42*math.sin(PI*t)**(.7 if kind=='avocado' else .85)
        for x in range(N):
            u=x/(N-1)-.5
            if abs(u)>half:continue
            noise=rng.uniform(-4,4);light=1-.18*abs(u)/max(.01,half)+.055*math.sin(t*30+abs(u)*24);base=(45,91,33) if kind=='avocado' else (63,111,34)
            vein=abs(u)<.0035 or abs((t-abs(u)*.60)*10-round((t-abs(u)*.60)*10))<.014
            px[x,y]=tuple(max(0,min(255,int(v*light+noise+(9 if vein else 0)))) for v in base)+(255,)
    return image_bytes(im,True)

def lavender_texture(flower=False):
    S=2;W,H=256,512;im=Image.new('RGBA',(W*S,H*S));d=ImageDraw.Draw(im);r=random.Random(304 if flower else 303)
    def line(ps,fill,w):d.line([(int(x*S),int(y*S)) for x,y in ps],fill=fill,width=max(1,int(w*S)))
    line([(128,H),(128,20)],(111,139,95,255),2.5 if flower else 3)
    if flower:
        for k in range(13):
            yy=460-k*32;spread=38*(.4+.6*math.sin(PI*(k+1)/15))
            for j in range(8):
                a=j*2*PI/8+r.uniform(-.35,.35);xx=128+math.cos(a)*spread;cy=yy+math.sin(a)*10;rad=r.uniform(8,13);col=r.choice([(116,74,162,255),(134,89,184,255),(149,103,192,255),(103,62,147,255)])
                d.ellipse(((xx-rad)*S,(cy-rad*1.3)*S,(xx+rad)*S,(cy+rad*1.3)*S),fill=col)
                d.ellipse(((xx-rad*.35)*S,(cy-rad)*S,(xx+rad*.4)*S,(cy-rad*.1)*S),fill=(166,123,203,255))
    else:
        for k in range(9):
            yy=465-k*47
            for sign in [-1,1]:
                endx=128+sign*r.uniform(60,112)*(1-.035*k);endy=yy-r.uniform(50,85);dx=endx-128;dy=endy-yy;perp=unit((-dy,dx,0));w=r.uniform(5,9)
                pts=[(128,yy),(128+dx*.35+perp[0]*w,yy+dy*.35+perp[1]*w),(endx,endy),(128+dx*.45-perp[0]*w,yy+dy*.45-perp[1]*w)]
                d.polygon([(x*S,y*S) for x,y in pts],fill=r.choice([(127,151,128,255),(139,161,140,255),(109,139,119,255),(147,166,144,255)]));line([(128,yy),(endx,endy)],(159,174,146,255),.7)
    return image_bytes(im.resize((W,H),Image.Resampling.LANCZOS),True)

def wood_texture(teak=False):
    N=512;im=Image.new('RGB',(N,N));p=im.load();r=random.Random(55 if teak else 56)
    for y in range(N):
        for x in range(N):
            v=math.sin(y*.42+math.sin(x*.019)*1.4)+.4*math.sin(y*1.75+x*.015)+.3*math.sin(y*.08+math.sin(x*.009)*2);v=v*7+r.uniform(-3,3)
            base=(166,115,64) if teak else (98,90,66)
            p[x,y]=tuple(int(max(0,min(255,a+v*s))) for a,s in zip(base,(1,.85,.62)))
    return image_bytes(im)

def tube(mesh,points,radii,sides=7,color=(1,1,1)):
    rings=[];norms=[];previous_u=None
    for i,p in enumerate(points):
        axis=unit(sub(points[min(i+1,len(points)-1)],points[max(0,i-1)]))
        if previous_u is None:u,v=basis(axis)
        else:
            projected=sub(previous_u,mul(axis,dot(previous_u,axis)));u=unit(projected) if dot(projected,projected)>.001 else basis(axis)[0];v=unit(cross(axis,u))
        previous_u=u;ns=[add(mul(u,math.cos(a*2*PI/sides)),mul(v,math.sin(a*2*PI/sides))) for a in range(sides)];rings.append([add(p,mul(n,radii[i])) for n in ns]);norms.append(ns)
    for i in range(len(points)-1):
        for j in range(sides):
            k=(j+1)%sides;ps=[rings[i][j],rings[i][k],rings[i+1][k],rings[i+1][j]];ns=[norms[i][j],norms[i][k],norms[i+1][k],norms[i+1][j]]
            if dot(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])),ns[0])<0:ps.reverse();ns.reverse()
            mesh.face(ps,[(i*.7,j/sides),(i*.7,k/sides),((i+1)*.7,k/sides),((i+1)*.7,j/sides)],color,ns)
    for idx in [0,len(points)-1]:
        ps=rings[idx][:];n=unit(sub(points[idx],points[1 if idx==0 else -2]));actual=cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]))
        if dot(actual,n)<0:ps.reverse()
        mesh.face(ps,color=color)

def leaf(mesh,base,direction,length,width,roll,rng,tint=(1,1,1)):
    axis=unit(direction);u,v=basis(axis);side=add(mul(u,math.cos(roll)),mul(v,math.sin(roll)));normal=unit(cross(side,axis));rows=[];normals=[]
    for j in range(5):
        t=j/4;center=add(base,add(mul(axis,length*t),mul(normal,length*.12*math.sin(PI*t))))
        rows.append([add(center,add(mul(side,width*(k-1)/2),mul(normal,-width*.12*abs(k-1)))) for k in range(3)])
        tangent=add(axis,mul(normal,.12*PI*math.cos(PI*t)));normals.append([unit(cross(sub(side,mul(normal,.24*(k-1))),tangent)) for k in range(3)])
    for j in range(4):
        for k in range(2):mesh.face([rows[j][k],rows[j][k+1],rows[j+1][k+1],rows[j+1][k]],[(k/2,1-j/4),((k+1)/2,1-j/4),((k+1)/2,1-(j+1)/4),(k/2,1-(j+1)/4)],tint,[normals[j][k],normals[j][k+1],normals[j+1][k+1],normals[j+1][k]])

def card(mesh,base,axis,length,width,angle=0,color=(1,1,1)):
    axis=unit(axis);u,v=basis(axis);side=add(mul(u,math.cos(angle)),mul(v,math.sin(angle)));top=add(base,mul(axis,length));mesh.face([add(base,mul(side,-width/2)),add(base,mul(side,width/2)),add(top,mul(side,width/2)),add(top,mul(side,-width/2))],[(0,1),(1,1),(1,0),(0,0)],color)

def fruit(mesh,center,size,kind,rng):
    lat,lon=12,14
    rings=[];normals=[]
    for j in range(lat+1):
        t=PI*j/lat;y=math.cos(t);rad=math.sin(t)
        if kind=='avocado':rad*=.83-.28*y
        if kind=='lemon':rad*=1-.12*abs(y)**3
        ring=[];ns=[]
        for k in range(lon):
            a=k*2*PI/lon;v=(rad*math.cos(a),y,rad*math.sin(a));ring.append(add(center,tuple(v[i]*size[i] for i in range(3))));ns.append(unit(tuple(v[i]/size[i] for i in range(3))))
        rings.append(ring);normals.append(ns)
    for j in range(lat):
        for k in range(lon):
            n=(k+1)%lon;ps=[rings[j][k],rings[j+1][k],rings[j+1][n],rings[j][n]];ns=[normals[j][k],normals[j+1][k],normals[j+1][n],normals[j][n]]
            if j==0:ps=ps[1:];ns=ns[1:]
            elif j==lat-1:ps=[ps[0],ps[1],ps[3]];ns=[ns[0],ns[1],ns[3]]
            if dot(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])),sub(ps[0],center))<0:ps.reverse();ns.reverse()
            c=rng.uniform(.90,1.03);mesh.face(ps,color=(c,c,c),normals=ns)

def lavender():
    r=random.Random(101);m=Model('lavender-bush');wood=m.material('lavender_woody_base',(111,98,68),.96);green=m.material('lavender_stems',(104,132,92),.9);fol=m.material('lavender_foliage',texture=lavender_texture(),alpha=True,double=True,rough=.92);bloom=m.material('lavender_flowers',texture=lavender_texture(True),alpha=True,double=True,rough=.93)
    for i in range(22):
        a=i*2.39996;rad=r.uniform(.08,.22);tip=(math.cos(a)*rad,r.uniform(.12,.21),math.sin(a)*rad);tube(m.meshes[wood],[(0,0,0),mul(tip,.48),tip],[.005,.003,.0015],5)
    for i in range(260):
        a=r.uniform(0,2*PI);rad=.34*math.sqrt(r.random());y=.06+.15*(1-rad/.4)+r.uniform(0,.08);base=(math.cos(a)*rad,y,math.sin(a)*rad);axis=unit((math.cos(a)*r.uniform(.25,.7),1,math.sin(a)*r.uniform(.25,.7)));length=r.uniform(.12,.23)
        card(m.meshes[fol],base,axis,length,r.uniform(.075,.115),r.uniform(0,PI));card(m.meshes[fol],base,axis,length,.09,r.uniform(0,PI))
    for i in range(155):
        a=i*2.39996;rad=.335*math.sqrt(r.random());base=(math.cos(a)*rad*.65,.10,math.sin(a)*rad*.65);top=(math.cos(a)*rad,.40+.17*(1-(rad/.4)**2)+r.uniform(-.04,.025),math.sin(a)*rad);spike=r.uniform(.045,.077);flowerbase=sub(top,(0,spike,0));tube(m.meshes[green],[base,mix(base,flowerbase,.6),flowerbase],[.0018,.0012,.0007],5)
        for angle in [a,a+PI/2]:card(m.meshes[bloom],flowerbase,(.02*math.cos(a),1,.02*math.sin(a)),spike,r.uniform(.014,.019),angle)
    m.fit(.8,.6,.8);return m

def lemongrass():
    r=random.Random(202);m=Model('lemongrass-clump');leafm=m.material('lemongrass_blades',(133,164,66),.78,double=True);stalk=m.material('lemongrass_pale_stalks',(196,198,134),.9);dry=m.material('lemongrass_outer_sheaths',(172,166,104),.95,double=True)
    for i in range(38):
        a=i*2.39996;rad=.095*math.sqrt(r.random());p=(rad*math.cos(a),0,rad*math.sin(a));top=add(p,(.012*math.cos(a),r.uniform(.16,.28),.012*math.sin(a)));tube(m.meshes[stalk],[p,mix(p,top,.55),top],[.008,.009,.004],7)
    for i in range(220):
        a=i*2.39996+r.uniform(-.2,.2);spread=r.uniform(.10,.57);H=r.uniform(.95,1.42)*(1-.25*spread);base=r.uniform(.015,.095);width=r.uniform(.012,.028);rows=[];segments=16
        for j in range(segments+1):
            t=j/segments;radius=base+spread*t**1.9;angle=a+.12*math.sin(PI*t);y=.025+H*(1.95*t-.8*t*t-(.12+.45*spread)*t**5);c=(math.cos(angle)*radius,y,math.sin(angle)*radius);w=width*math.sin(PI*(t*.96+.02))**.65*(1-.85*t**12);side=(-math.sin(angle),0,math.cos(angle));rows.append([add(c,add(mul(side,w*(k-1)/2),(0,.0016*(1-abs(k-1))*math.sin(PI*t),0))) for k in range(3)])
        tint=r.uniform(.78,1.12)
        for j in range(segments):
            for k in range(2):m.meshes[leafm].face([rows[j][k],rows[j][k+1],rows[j+1][k+1],rows[j+1][k]],color=(tint*(1+.10*j/segments),tint,tint*(.86+.14*j/segments)))
    for i in range(12):
        a=i*2.39996;card(m.meshes[dry],(.075*math.cos(a),.005,.075*math.sin(a)),(.7*math.cos(a),1,.7*math.sin(a)),.17,.009,a)
    m.fit(1,1.2,1);return m

def tree(kind):
    avo=kind=='avocado';r=random.Random(404 if avo else 505);m=Model(kind+'-tree');bark=m.material(kind+'_bark',texture=wood_texture(),rough=.93);fol=m.material(kind+'_leaves',texture=leaf_texture(kind),rough=.32 if avo else .35,alpha=True,double=True);fr=m.material(kind+'_fruit',(43,69,29) if avo else (240,193,31),.54 if avo else .42);flower=None
    if not avo:flower=m.material('lemon_blossoms',(250,247,225),.8,double=True);pollen=m.material('lemon_blossom_centers',(219,174,44),.8)
    H=3.5 if avo else 2.4;R=1.40 if avo else .89;cy=2.22 if avo else 1.55;ry=1.08 if avo else .73;trunkr=.061 if avo else .040
    trunk=[(0,0,0),(.025,H*.18,-.015),(-.015,H*.36,.02),(.04,H*.55,.025),(.025,H*.77,0)]
    tube(m.meshes[bark],trunk,[trunkr,trunkr*.87,trunkr*.62,trunkr*.37,.006],11)
    # Low branching scaffold; the crown consists of connected terminal shoots.
    limbs=[]
    for i in range(9):
        a=i*2.39996;start=(0,H*(.22+.025*(i%4)),0);end=(R*.54*math.cos(a),cy+ry*r.uniform(-.45,.25),R*.54*math.sin(a));mid=mix(start,end,.53);mid=add(mid,(0,.10,0));tube(m.meshes[bark],[start,mid,end],[trunkr*.52,trunkr*.27,.008],8);limbs.append((a,end))
    shoots=[];count=155 if avo else 125
    for i in range(count):
        zeta=1-2*(i+.5)/count;a=i*2.39996;horizontal=math.sqrt(max(0,1-zeta*zeta));rad=R*horizontal*r.uniform(.62,1.0);target=(rad*math.cos(a),cy+ry*zeta,rad*math.sin(a));nearest=min(limbs,key=lambda q:abs(math.atan2(math.sin(a-q[0]),math.cos(a-q[0]))));anchor=nearest[1]
        if zeta>.7:anchor=trunk[-1]
        direction=unit(sub(target,anchor));L=min(.30 if avo else .22,math.sqrt(dot(sub(target,anchor),sub(target,anchor)))*.7);base=sub(target,mul(direction,L*.6));mid=mix(anchor,base,.62);tube(m.meshes[bark],[anchor,mid,base,target],[.005 if avo else .0035,.0027,.0014,.0006],5)
        shoots.append((a,target))
        leafcount=13 if avo else 15
        for k in range(leafcount):
            t=(k+.3)/leafcount;petiole=mix(base,target,t);theta=a+(PI/2 if k%2 else -PI/2)+r.uniform(-.8,.8);axis=unit((math.cos(theta),r.uniform(-.85,.95),math.sin(theta)));length=r.uniform(.22,.32) if avo else r.uniform(.125,.19);width=length*r.uniform(.46,.58);tint=r.uniform(.76,1.20);leaf(m.meshes[fol],petiole,axis,length,width,r.uniform(-1.05,1.05),r,(tint,tint,tint))
    # Fruit hangs on short pedicels within the foliage, away from the outer edge.
    for i in range(6 if avo else 13):
        a=(i*.618*2*PI)+.22;rad=R*r.uniform(.58,.83);y=cy+ry*r.uniform(-.64,.22);center=(math.cos(a)*rad,y,math.sin(a)*rad);h=.095 if avo else .058;top=add(center,(0,h*1.4,0));tube(m.meshes[bark],[add(top,(.01,.065,0)),top],[.002,.0012],5);fruit(m.meshes[fr],center,(.063,.095,.056) if avo else (.043,.058,.042),kind,r)
    if not avo:
        for i in range(12):
            a=i*2.39996+.7;center=(R*.89*math.cos(a),cy+ry*r.uniform(-.2,.65),R*.89*math.sin(a));normal=unit((math.cos(a),.6,math.sin(a)));u,v=basis(normal)
            for k in range(5):
                theta=k*2*PI/5;axis=add(mul(u,math.cos(theta)),mul(v,math.sin(theta)));side=unit(cross(normal,axis));base=center;tip=add(base,mul(axis,.023));mid=add(base,mul(axis,.013));m.meshes[flower].face([base,add(mid,mul(side,.007)),tip,sub(mid,mul(side,.007))])
            fruit(m.meshes[pollen],center,(.004,.004,.004),'round',r)
    m.fit(3 if avo else 1.9,H,3 if avo else 1.9);return m

def beveled_box(mesh,center,size,bevel=.003,lean=0,color=(1,1,1)):
    h=[s/2 for s in size];polys=[]
    def p(sig,axis):return [sig[i]*(h[i]-(0 if i==axis else bevel)) for i in range(3)]
    for axis in range(3):
        other=[i for i in range(3) if i!=axis]
        for side in [-1,1]:
            face=[]
            for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]:
                sig=[0,0,0];sig[axis]=side;sig[other[0]]=a;sig[other[1]]=b;face.append(p(sig,axis))
            polys.append(face)
    for a,b in itertools.combinations(range(3),2):
        c=3-a-b
        for sa,sb in itertools.product([-1,1],repeat=2):
            sig=[0,0,0];sig[a]=sa;sig[b]=sb;sig[c]=-1;sm=sig.copy();sig[c]=1;sp=sig.copy();polys.append([p(sm,a),p(sm,b),p(sp,b),p(sp,a)])
    for sig in itertools.product([-1,1],repeat=3):polys.append([p(sig,i) for i in range(3)])
    longest=max(range(3),key=lambda i:size[i])
    for poly in polys:
        centroid=tuple(sum(p[i] for p in poly)/len(poly) for i in range(3));n=cross(sub(poly[1],poly[0]),sub(poly[2],poly[0]))
        if dot(n,centroid)<0:poly.reverse()
        other=max([i for i in range(3) if i!=longest],key=lambda i:max(p[i] for p in poly)-min(p[i] for p in poly));uv=[(p[longest]*1.5+center[longest]*2,p[other]*5+center[other]*5) for p in poly];ps=[(p[0]+center[0],p[1]+center[1],p[2]+center[2]+p[1]*lean) for p in poly];mesh.face(ps,uv,color)

def bench():
    m=Model('teak-bench');wood=m.material('natural_teak',texture=wood_texture(True),rough=.57);end=m.material('teak_joinery',(135,86,43),.65);mesh=m.meshes[wood]
    # Six long seat slats: upper surface exactly 0.45 m.
    for i in range(6):beveled_box(mesh,(0,.4325,-.2275+i*.089),(1.38,.035,.076),.004,color=(1+.015*i,1+.01*i,1))
    for x in [-.691,.691]:
        beveled_box(mesh,(x,.2225,.24),(.066,.445,.066),.003)
        beveled_box(mesh,(x,.425,-.229),(.066,.85,.066),.003,lean=-.0894)
        beveled_box(mesh,(x,.398,0),(.065,.075,.55),.003)
        beveled_box(mesh,(x,.5425,.239),(.046,.185,.046),.003)
        beveled_box(mesh,(x,.632,0),(.118,.036,.60),.008)
        beveled_box(mesh,(x,.205,0),(.045,.045,.48),.0025)
    for z in [-.235,.235]:beveled_box(mesh,(0,.388,z),(1.385,.077,.047),.003)
    # Gently reclined back, with four broad horizontal slats and real gaps.
    for y in [.515,.610,.705,.800]:
        z=-.231-(y-.45)*.0894;beveled_box(mesh,(0,y,z),(1.37,.071,.028),.003,lean=-.0894)
    for x in [-.69,.69]:
        for y in [.385,.635]:
            for z in [-.248,.265]:tube(m.meshes[end],[(x,y,z),(x,y,z+.0015)],[.0045,.0045],10)
    # The requested maximum width is at the arms; depth includes their tips.
    m.fit(1.5,None,.6);return m

# ---- Cushioned chair, coffee table, and concrete fire pit ----
import math,random,json,pathlib,io
from PIL import Image,ImageDraw

PI=math.pi

def rotate(p,theta):
    c,s=math.cos(theta),math.sin(theta);return (p[0],c*p[1]-s*p[2],s*p[1]+c*p[2])

def weave_normal():
    im=Image.new('RGB',(512,512));px=im.load()
    for y in range(512):
        for x in range(512):
            px[x,y]=(128+round(9*math.sin(x*PI/2)),128+round(9*math.sin(y*PI/2)),254)
    return image_bytes(im)

def rounded_box(mesh,center,size,radius,theta=0):
    h=[x/2 for x in size]
    def samples(v):return [-v,-v+radius*.20,-v+radius*.50,-v+radius*.8,-v+radius,0,v-radius,v-radius*.8,v-radius*.50,v-radius*.20,v]
    for axis in range(3):
        other=[i for i in range(3) if i!=axis];aa=samples(h[other[0]]);bb=samples(h[other[1]])
        for sign in [-1,1]:
            grid=[];normals=[]
            for a in aa:
                row=[];nr=[]
                for b in bb:
                    p=[0,0,0];p[axis]=sign*h[axis];p[other[0]]=a;p[other[1]]=b;q=[max(-h[i]+radius,min(h[i]-radius,p[i])) for i in range(3)];normal=unit(sub(p,q));point=add(q,mul(normal,radius));row.append(add(center,rotate(point,theta)));nr.append(rotate(normal,theta))
                grid.append(row);normals.append(nr)
            for i in range(len(aa)-1):
                for j in range(len(bb)-1):
                    ps=[grid[i][j],grid[i+1][j],grid[i+1][j+1],grid[i][j+1]];ns=[normals[i][j],normals[i+1][j],normals[i+1][j+1],normals[i][j+1]];uv=[(aa[i]*4,bb[j]*4),(aa[i+1]*4,bb[j]*4),(aa[i+1]*4,bb[j+1]*4),(aa[i]*4,bb[j+1]*4)]
                    if dot(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])),ns[0])<0:ps.reverse();ns.reverse();uv.reverse()
                    mesh.face(ps,uv,normals=ns)

def rounded_rect(half_u,half_v,r,segments=8):
    result=[]
    for cx,cz,start in [(half_u-r,half_v-r,0),(-half_u+r,half_v-r,90),(-half_u+r,-half_v+r,180),(half_u-r,-half_v+r,270)]:
        for i in range(segments+1):
            a=(start+90*i/segments)*PI/180;result.append((cx+r*math.cos(a),cz+r*math.sin(a)))
    return result

def piping(mesh,center,size,r,plane,offset,theta=0):
    # Follow the actual rounded cushion's cross section, not a floating trim.
    fixed=1 if plane=='xz' else 2;axes=[i for i in range(3) if i!=fixed];normal_offset=max(0,abs(offset)-(size[fixed]/2-r));rr=math.sqrt(max(0,r*r-normal_offset*normal_offset));half_u=size[axes[0]]/2-r+rr;half_v=size[axes[1]]/2-r+rr;points=[]
    for a,b in rounded_rect(half_u,half_v,rr,10):
        p=[0,0,0];p[fixed]=offset;p[axes[0]]=a;p[axes[1]]=b;points.append(add(center,rotate(p,theta)))
    points.append(points[0]);tube(mesh,points,[.0012]*len(points),6)

def chair():
    m=Model('teak-lounge-chair');wood=m.material('natural_teak',texture=wood_texture(True),rough=.57);cushion=m.material('off_white_upholstery',(238,233,221),.92);seam=m.material('upholstery_piping',(221,216,203),.94);joinery=m.material('teak_joinery',(135,86,43),.65)
    m.images.append(weave_normal());m.materials[cushion]['normalTexture']={'index':len(m.images)-1,'scale':.27}
    wm=m.meshes[wood]
    for x in [-.313,.313]:
        beveled_box(wm,(x,.261,.315),(.058,.522,.058),.004)
        beveled_box(wm,(x,.355,-.266),(.058,.71,.058),.004,lean=-.23)
        beveled_box(wm,(x,.304,.028),(.050,.067,.662),.004)
        beveled_box(wm,(x,.541,.006),(.074,.036,.72),.006)
        beveled_box(wm,(x,.162,.025),(.036,.037,.600),.0025)
    for z in [-.239,.309]:beveled_box(wm,(0,.301,z),(.63,.065,.045),.003)
    for i in range(6):beveled_box(wm,(0,.327,-.206+i*.10),(.606,.027,.082),.003)
    for y in [.44,.56,.68]:
        beveled_box(wm,(0,y,-.276-(y-.4)*.23),(.605,.077,.025),.003,lean=-.23)
    seat_center=(0,.380,.060);seat_size=(.590,.079,.558)
    rounded_box(m.meshes[cushion],seat_center,seat_size,.026)
    piping(m.meshes[seam],seat_center,seat_size,.026,'xz',.028)
    # The visible seat is the +Z side. Cushion top reaches exactly 0.75 m.
    theta=-.24;back_size=(.585,.365,.097);r=.032
    half_y,half_z=back_size[1]/2,back_size[2]/2
    top_extent=(half_y-r)*math.cos(theta)+(half_z-r)*abs(math.sin(theta))+r
    back_center=(0,.75-top_extent,-.239)
    rounded_box(m.meshes[cushion],back_center,back_size,r,theta)
    piping(m.meshes[seam],back_center,back_size,r,'xy',.033,theta)
    for x in [-.313,.313]:
        for y in [.285,.51]:tube(m.meshes[joinery],[(x,y,.344),(x,y,.346)],[.004,.004],10)
    m.fit(.7,.75,.8);return m

def coffee_table():
    m=Model('teak-coffee-table');wood=m.material('natural_teak',texture=wood_texture(True),rough=.57);joinery=m.material('teak_joinery',(135,86,43),.65);wm=m.meshes[wood]
    for i in range(6):beveled_box(wm,(0,.3825,-.2575+i*.103),(1.1,.035,.085),.004)
    for x in [-.467,.467]:
        for z in [-.223,.223]:beveled_box(wm,(x,.1825,z),(.057,.365,.057),.004)
        beveled_box(wm,(x,.330,0),(.046,.063,.47),.003)
    for z in [-.223,.223]:beveled_box(wm,(0,.330,z),(.965,.063,.043),.003)
    for x in [-.443,.443]:
        for z in [-.247,.247]:tube(m.meshes[joinery],[(x,.330,z),(x,.330,z+(.0015 if z>0 else -.0015))],[.004,.004],10)
    m.fit(1.1,.4,.6);return m

def concrete_texture():
    r=random.Random(721);N=512;im=Image.new('RGB',(N,N));px=im.load()
    for y in range(N):
        for x in range(N):
            cloud=1.8*math.sin(x*.044)*math.sin(y*.037)+1.0*math.sin((x+y)*.11);noise=r.gauss(0,2.2);px[x,y]=tuple(round(max(0,min(255,c+cloud+noise))) for c in (195,192,184))
    d=ImageDraw.Draw(im)
    for i in range(580):
        x=r.randrange(N);y=r.randrange(N);rad=r.choice([.3,.5,.75,1]);v=r.randrange(164,190);d.ellipse((x-rad,y-rad,x+rad,y+rad),fill=(v,v-2,v-7))
    return image_bytes(im)

def surface(mesh,points):
    n=unit(cross(sub(points[1],points[0]),sub(points[2],points[0])));axis=max(range(3),key=lambda k:abs(n[k]));other=[k for k in range(3) if k!=axis];mesh.face(points,[(p[other[0]]*2,p[other[1]]*2) for p in points])

def stone(mesh,center,size,rng):
    nlat,nlon=8,12;phase=rng.uniform(0,2*PI);angle=rng.uniform(0,2*PI);rings=[];normals=[]
    def turn(p):return (p[0]*math.cos(angle)-p[2]*math.sin(angle),p[1],p[0]*math.sin(angle)+p[2]*math.cos(angle))
    for j in range(nlat+1):
        p=PI*j/nlat;row=[];ns=[]
        for k in range(nlon):
            a=2*PI*k/nlon;v=(math.sin(p)*math.cos(a),math.cos(p),math.sin(p)*math.sin(a));bump=1+.09*math.sin(3*a+phase)*math.sin(p)**2+.035*math.sin(5*p+phase);q=tuple(v[i]*size[i]*bump for i in range(3));row.append(add(center,turn(q)));ns.append(unit(turn(tuple(v[i]/size[i] for i in range(3)))))
        rings.append(row);normals.append(ns)
    for j in range(nlat):
        for k in range(nlon):
            kk=(k+1)%nlon;ps=[rings[j][k],rings[j+1][k],rings[j+1][kk],rings[j][kk]];ns=[normals[j][k],normals[j+1][k],normals[j+1][kk],normals[j][kk]]
            if j==0:ps=ps[1:];ns=ns[1:]
            elif j==nlat-1:ps=[ps[0],ps[1],ps[3]];ns=[ns[0],ns[1],ns[3]]
            if dot(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])),sub(ps[0],center))<0:ps.reverse();ns.reverse()
            tint=rng.uniform(.92,1);mesh.face(ps,color=(tint,tint,tint),normals=ns)

def fire_pit():
    r=random.Random(723);m=Model('concrete-fire-pit');concrete=m.material('light_cast_concrete',texture=concrete_texture(),rough=.95);bed=m.material('recessed_stone_bed',(55,53,48),.98);rocks=[m.material('charcoal_stones',(78,76,68),.93),m.material('warm_grey_stones',(108,104,94),.95),m.material('ash_grey_stones',(131,128,119),.94)]
    # A continuous, closed bowl, with a bevelled outer edge and recessed centre.
    sections=[(.481,.018,0),(.5,.025,.018),(.5,.025,.386),(.486,.020,.4),(.344,.031,.4),(.33,.021,.386),(.33,.021,.241),(.318,.021,.228)]
    rings=[[(x,y,z) for x,z in rounded_rect(h,h,radius,8)] for h,radius,y in sections]
    cm=m.meshes[concrete]
    for j in range(len(rings)-1):
        for i in range(len(rings[j])):
            k=(i+1)%len(rings[j]);surface(cm,[rings[j][i],rings[j+1][i],rings[j+1][k],rings[j][k]])
    for i in range(len(rings[0])):
        k=(i+1)%len(rings[0]);surface(cm,[rings[0][i],rings[0][k],(0,0,0)]);surface(m.meshes[bed],[rings[-1][i],(0,.228,0),rings[-1][k]])
    for row in range(8):
        for col in range(8):
            x=(col-3.5)*.077+r.uniform(-.006,.006);z=(row-3.5)*.077+r.uniform(-.006,.006);y=r.uniform(.288,.315);size=(r.uniform(.037,.045),r.uniform(.027,.040),r.uniform(.035,.043));stone(m.meshes[r.choice(rocks)],(x,y,z),size,r)
    for i in range(27):
        x=r.uniform(-.27,.27);z=r.uniform(-.27,.27);stone(m.meshes[r.choice(rocks)],(x,r.uniform(.277,.304),z),(r.uniform(.012,.023),r.uniform(.016,.023),r.uniform(.014,.024)),r)
    m.fit(1,.4,1);return m

# ---- Offline CPU renderer (same 70 mm / 35° / 20° camera and daylight) ----
import pathlib,json,struct,io,math,sys,time
import numpy as np
from PIL import Image

N=1024
def render_unit(x):return x/np.maximum(np.linalg.norm(x,axis=-1,keepdims=True),1e-10)
def render_linear(x):return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def render_srgb(x):return np.where(x<=.0031308,x*12.92,1.055*np.maximum(x,0)**(1/2.4)-.055)
def render_tone(x):
    A=np.array([[.59719,.35458,.04823],[.076,.90834,.01566],[.02840,.13383,.83777]])
    B=np.array([[1.60475,-.53108,-.07367],[-.10208,1.10813,-.00605],[-.00327,-.07276,1.07602]])
    v=(x/.6)@A.T;a=v*(v+.0245786)-.000090537;b=v*(.983729*v+.432951)+.238081;return np.clip((a/b)@B.T,0,1)

def render_thumbnail(id,azimuth=35,elevation=20,save=None,source=None,size=512):
    N=max(1024,size*2)  # Supersample fine cords/weave in larger accessory previews.
    raw=(source or ROOT/'models'/f'{id}.glb').read_bytes();jl=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+jl]);binary=raw[28+jl:]
    def accessor(i):
        a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']];dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[a['componentType']];return np.frombuffer(binary,dtype=dtype,count=a['count']*n,offset=v['byteOffset']+a.get('byteOffset',0)).reshape(-1,n)
    textures=[]
    for tex in g.get('textures',[]):
        im=g['images'][tex['source']];v=g['bufferViews'][im['bufferView']];textures.append(np.asarray(Image.open(io.BytesIO(binary[v['byteOffset']:v['byteOffset']+v['byteLength']])).convert('RGBA')).astype(float)/255)
    def sample(ti,uv):
        tex=textures[ti];h,w=tex.shape[:2];q=(uv%1)*[w,h]-.5;floor=np.floor(q).astype(int);frac=q-floor;x=floor[:,0]%w;y=floor[:,1]%h;x1=(x+1)%w;y1=(y+1)%h;u=frac[:,0,None];v=frac[:,1,None];return tex[y,x]*(1-u)*(1-v)+tex[y,x1]*u*(1-v)+tex[y1,x]*(1-u)*v+tex[y1,x1]*u*v
    meshes=[]
    for mesh in g['meshes']:
        for pr in mesh['primitives']:
            a=pr['attributes'];pos=accessor(a['POSITION']).astype(float);uv=accessor(a['TEXCOORD_0']).astype(float) if 'TEXCOORD_0' in a else np.zeros((len(pos),2));color=accessor(a['COLOR_0']).astype(float) if 'COLOR_0' in a else np.ones((len(pos),3));meshes.append((pos,accessor(a['NORMAL']).astype(float),uv,color,accessor(pr['indices']).reshape(-1,3),g['materials'][pr['material']]))
    # Draw opaque filaments before glass shells, even when they share a material.
    opaque, glass = [], []
    for positions,normals,uvs,colors,indices,material in meshes:
        transmission=material.get('extensions',{}).get('KHR_materials_transmission',{})
        if transmission:
            values=np.full(len(indices),transmission.get('transmissionFactor',0.))
            if 'transmissionTexture' in transmission:values*=sample(transmission['transmissionTexture']['index'],uvs[indices].mean(axis=1))[:,0]
            for mask,destination in ((values<=.01,opaque),(values>.01,glass)):
                if mask.any():destination.append((positions,normals,uvs,colors,indices[mask],material))
        else:opaque.append((positions,normals,uvs,colors,indices,material))
    meshes=opaque+glass
    pts=np.concatenate([m[0] for m in meshes]);lo=pts.min(axis=0);hi=pts.max(axis=0);center=(lo+hi)/2
    az,el=np.deg2rad([azimuth,elevation]);direction=np.array([math.sin(az)*math.cos(el),math.sin(el),math.cos(az)*math.cos(el)]);right=render_unit(np.cross([0,1,0],direction));up=np.cross(direction,right);focal=70/(35/2)
    distance=np.linalg.norm(hi-lo)*3
    def project(points,distance):
        q=points-center;z=distance-q@direction;return np.stack([q@right/z*focal,q@up/z*focal,z],axis=1)
    for i in range(10):
        q=project(pts,distance);extent=np.ptp(q[:,:2],axis=0);distance*=extent.max()/1.6
    q=project(pts,distance);shift=(q[:,:2].min(axis=0)+q[:,:2].max(axis=0))/2;camera=center+direction*distance
    output=np.zeros((N,N,4),dtype=np.float32);depth=np.full((N,N),np.inf)
    lights=[(render_unit(np.array([-4.,7.,5.])),2.7),(render_unit(np.array([5.,4.,-3.])),1.8)];ground=render_linear(np.array([218,218,218])/255)
    for positions,normals,uvs,colors,indices,material in meshes:
        p=project(positions,distance);screen=np.stack([(p[:,0]-shift[0]+1)*N/2,(1-p[:,1]+shift[1])*N/2],axis=1);pbr=material['pbrMetallicRoughness'];base_factor=np.array(pbr['baseColorFactor'][:3]);rough=pbr['roughnessFactor'];a2=rough**4;k=(rough+1)**2/8
        transmission=material.get('extensions',{}).get('KHR_materials_transmission',{})
        if transmission:indices=indices[np.argsort(-p[indices,2].mean(axis=1))]
        for tri in indices:
            world=positions[tri];face=np.cross(world[1]-world[0],world[2]-world[0])
            if not material.get('doubleSided',False) and np.dot(face,camera-world[0])<=0:continue
            sc=screen[tri];x0=max(0,int(np.floor(sc[:,0].min())));x1=min(N,int(np.ceil(sc[:,0].max())));y0=max(0,int(np.floor(sc[:,1].min())));y1=min(N,int(np.ceil(sc[:,1].max())))
            if x1<=x0 or y1<=y0:continue
            ax,ay=sc[0];bx,by=sc[1];cx,cy=sc[2];den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
            if abs(den)<1e-9:continue
            yy,xx=np.mgrid[y0:y1,x0:x1];px=xx+.5;py=yy+.5;wa=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/den;wb=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/den;wc=1-wa-wb;iz=wa/p[tri[0],2]+wb/p[tri[1],2]+wc/p[tri[2],2];dz=1/iz;mask=(wa>=-1e-8)&(wb>=-1e-8)&(wc>=-1e-8)&(dz<depth[y0:y1,x0:x1])
            if not mask.any():continue
            ypix=yy[mask];xpix=xx[mask];zpix=dz[mask];weights=np.stack([wa[mask]/p[tri[0],2],wb[mask]/p[tri[1],2],wc[mask]/p[tri[2],2]],axis=1)*zpix[:,None]
            normal=render_unit(weights@normals[tri]);uv=weights@uvs[tri];color=(weights@colors[tri])*base_factor
            if 'baseColorTexture' in pbr:
                tex=sample(pbr['baseColorTexture']['index'],uv)
                if material.get('alphaMode')=='MASK':
                    keep=tex[:,3]*pbr.get('baseColorFactor',[1,1,1,1])[3]>=material.get('alphaCutoff',.5)
                    if not keep.any():continue
                    ypix=ypix[keep];xpix=xpix[keep];zpix=zpix[keep];weights=weights[keep];normal=normal[keep];uv=uv[keep];color=color[keep];tex=tex[keep]
                color*=render_linear(tex[:,:3])
            if material.get('doubleSided',False) and np.dot(face,camera-world[0])<0:normal=-normal
            if 'normalTexture' in material:
                nm=material['normalTexture'];s=sample(nm['index'],uv)[:,:3]*2-1;s[:,:2]*=nm.get('scale',1);duv=uvs[tri[1:]]-uvs[tri[0]];dp=world[1:]-world[0];det=duv[0,0]*duv[1,1]-duv[0,1]*duv[1,0]
                if abs(det)>1e-12:
                    tangent=render_unit((dp[0]*duv[1,1]-dp[1]*duv[0,1])/det);bitangent=render_unit((dp[1]*duv[0,0]-dp[0]*duv[1,0])/det);normal=render_unit(tangent*s[:,0,None]+bitangent*s[:,1,None]+normal*s[:,2,None])
            view=render_unit(camera-weights@world);nv=np.maximum((normal*view).sum(axis=1),1e-5);ambient=(ground+(1-ground)*(normal[:,1,None]*.5+.5))*2/math.pi;radiance=color*ambient
            for light,intensity in lights:
                nl=np.maximum(normal@light,0);half=render_unit(view+light);nh=np.maximum((normal*half).sum(axis=1),0);vh=np.maximum((view*half).sum(axis=1),0);D=a2/(math.pi*(nh*nh*(a2-1)+1)**2);G=nv/(nv*(1-k)+k)*nl/np.maximum(nl*(1-k)+k,1e-6);F=.04+.96*(1-vh)**5;spec=D*G*F/np.maximum(4*nv*nl,1e-6);radiance+=(color/math.pi+spec[:,None])*nl[:,None]*intensity
            if 'emissiveFactor' in material:
                emitted=np.broadcast_to(np.array(material['emissiveFactor']),radiance.shape).copy()
                if 'emissiveTexture' in material:emitted*=render_linear(sample(material['emissiveTexture']['index'],uv)[:,:3])
                radiance+=emitted
            shaded=np.clip(render_srgb(render_tone(radiance)),0,1)
            trans=np.full(len(uv),transmission.get('transmissionFactor',0.))
            if 'transmissionTexture' in transmission:trans*=sample(transmission['transmissionTexture']['index'],uv)[:,0]
            if np.any(trans>.01):
                # Thin-glass thumbnail approximation: Fresnel silhouette plus
                # transmitted background/filaments. The GLB uses real PBR transmission.
                alpha=np.clip(1-trans+trans*(.04+.96*(1-nv)**5),0,1)
                old=output[ypix,xpix];combined=alpha+old[:,3]*(1-alpha)
                output[ypix,xpix,:3]=(shaded*alpha[:,None]+old[:,:3]*old[:,3,None]*(1-alpha[:,None]))/np.maximum(combined[:,None],1e-8)
                output[ypix,xpix,3]=combined
            else:
                output[ypix,xpix,:3]=shaded;output[ypix,xpix,3]=1;depth[ypix,xpix]=zpix
    im=Image.fromarray(np.uint8(np.clip(output,0,1)*255),'RGBA').resize((size,size),Image.Resampling.LANCZOS);path=save or ROOT/'thumbs'/f'{id}.png';im.save(path);print(json.dumps({'id':id,'preview' if source else 'thumbnail':str(path),'alpha_bounds':im.getchannel('A').getbbox(),'camera':'70 mm, azimuth '+str(azimuth)+'°, elevation '+str(elevation)+'°'}),flush=True,file=sys.stderr)

# ---------------------------------------------------------------------------
# Revised fabric-only canopy, item registry, validation, and command-line entry.
# ---------------------------------------------------------------------------
def canopy():
    """The current mounted sheet: retain real mounting heights, never ground it."""
    model = Model('house-canopy')
    material = model.material('canopy_fabric', (239, 234, 220), .9)
    mesh = model.meshes[material]
    slope = 1 / 3.65
    vertical_thickness = .01 * math.sqrt(1 + slope * slope)
    vertices = []
    for x in (-3, 3):
        for z in (-1.825, 1.825):
            for bottom in (True, False):
                vertices.append((x, 2.3 - slope * z - (vertical_thickness if bottom else 0), z))
    # Outward-facing closed faces; upper edges are at 2.8 and 1.8 metres.
    for face in ((2, 3, 1, 0), (5, 7, 6, 4), (1, 5, 4, 0),
                 (6, 7, 3, 2), (4, 6, 2, 0), (3, 7, 5, 1)):
        mesh.face([vertices[i] for i in face])
    return model


def read_local_glb_mesh(path, node_name):
    """Read a named mesh in its OWN coordinates, deliberately ignoring yard placement."""
    raw = path.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20 + length])
    binary = raw[28 + length:]
    nodes = [n for n in document['nodes'] if n.get('name') == node_name]
    require(len(nodes) == 1, 'Expected one node named ' + node_name)
    primitives = document['meshes'][nodes[0]['mesh']]['primitives']
    require(len(primitives) == 1, node_name + ': expected one primitive')
    primitive = primitives[0]

    def data(index):
        a = document['accessors'][index]
        v = document['bufferViews'][a['bufferView']]
        count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        dtype = np.dtype({5126: '<f4', 5123: '<u2', 5125: '<u4'}[a['componentType']])
        return np.ndarray((a['count'], count), dtype=dtype, buffer=binary,
                          offset=v.get('byteOffset', 0) + a.get('byteOffset', 0),
                          strides=(v.get('byteStride', count * dtype.itemsize), dtype.itemsize)).copy()

    attrs = primitive['attributes']
    mesh = Mesh()
    mesh.p = data(attrs['POSITION']).tolist()
    mesh.n = data(attrs['NORMAL']).tolist()
    mesh.uv = data(attrs['TEXCOORD_0']).tolist() if 'TEXCOORD_0' in attrs else [(0, 0)] * len(mesh.p)
    mesh.c = data(attrs['COLOR_0'])[:, :3].tolist() if 'COLOR_0' in attrs else [(1, 1, 1)] * len(mesh.p)
    mesh.i = data(primitive['indices']).ravel().tolist()
    return mesh, document['materials'][primitive['material']]


def hammock_frame_geometry():
    frame, material = read_local_glb_mesh(LIBRARY_DIR.parent / 'backyard.glb', 'hammock_frame')
    require(material['name'] == 'hammock_frame_finish', 'Unexpected hammock frame material')
    points = np.asarray(frame.p)
    lo, hi = points.min(axis=0), points.max(axis=0)
    tips = []
    for sign in (-1, 1):
        # The outermost 30 mm contain the end cap, not the adjoining upright.
        cap = np.unique(points[(points[:, 0] * sign > (points[:, 0] * sign).max() - .03)
                               & (points[:, 1] > hi[1] - .04)], axis=0)
        require(len(cap) >= 9, 'Cannot identify hammock arm end cap')
        tips.append(cap.mean(axis=0))
    require(np.allclose(lo, [-1.457195, -.025, -.6296], atol=.005)
            and np.allclose(hi, [1.457195, 1.315032, .6296], atol=.005),
            'Frame geometry changed; inspect the suspension fit before rebuilding')
    return frame, material, lo, hi, tips


def cotton_weave():
    """A tile of uncoloured cotton: light grey albedo and a small weave normal."""
    y, x = np.mgrid[:512, :512].astype(float)
    pitch = 16  # 32 threads per 96 mm UV tile: 3 mm thread spacing.
    u, v = (x % pitch) / pitch, (y % pitch) / pitch
    over = ((x // pitch + y // pitch) % 2) == 0
    warp, weft = np.sin(PI * u) ** .55, np.sin(PI * v) ** .55
    height = np.where(over, warp * (.7 + .3 * weft), weft * (.7 + .3 * warp))
    fibers = .7 * np.sin(x * PI / 2) + .7 * np.sin(y * PI / 2)
    grey = np.uint8(np.clip(218 + 35 * height + fibers, 0, 255))
    albedo = image_bytes(Image.fromarray(np.repeat(grey[:, :, None], 3, axis=2), 'RGB'))
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * .65
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * .65
    normal = render_unit(np.stack([-dx, -dy, np.ones_like(dx)], axis=2))
    bump = image_bytes(Image.fromarray(np.uint8((normal * .5 + .5) * 255), 'RGB'))
    return albedo, bump


def hammock_rope(mesh, points, radius, sides=5, closed=False):
    """Indexed round cord; real gaps between cords, with no transparent cards."""
    points = [tuple(p) for p in points]
    count = len(points)
    base = len(mesh.p)
    length = 0
    previous_u = None
    for i, p in enumerate(points):
        before = points[(i - 1) % count] if closed else points[max(0, i - 1)]
        after = points[(i + 1) % count] if closed else points[min(count - 1, i + 1)]
        axis = unit(sub(after, before))
        u = basis(axis)[0] if previous_u is None else unit(sub(previous_u, mul(axis, dot(previous_u, axis))))
        v = unit(cross(axis, u))
        previous_u = u
        if i:
            length += math.dist(points[i - 1], p)
        for k in range(sides + 1):
            normal = add(mul(u, math.cos(2 * PI * k / sides)), mul(v, math.sin(2 * PI * k / sides)))
            mesh.p.append(add(p, mul(normal, radius)))
            mesh.n.append(normal)
            mesh.uv.append((length / .096, k / sides * 2 * PI * radius / .096))
            mesh.c.append((1, 1, 1))
    for i in range(count if closed else count - 1):
        for k in range(sides):
            a = base + i * (sides + 1) + k
            b = base + ((i + 1) % count) * (sides + 1) + k
            mesh.i.extend((a, a + 1, b + 1, a, b + 1, b))
    if not closed:
        for i, other in ((0, 1), (count - 1, count - 2)):
            ring = [mesh.p[base + i * (sides + 1) + k] for k in range(sides)]
            normal = unit(sub(points[i], points[other]))
            if dot(cross(sub(ring[1], ring[0]), sub(ring[2], ring[0])), normal) < 0:
                ring.reverse()
            mesh.face(ring, normals=[normal] * sides)


def hammock_cloth(frame_info):
    """Mounted accessory, never Model.fit(): all vertices remain frame-local."""
    _, _, lo, _, tips = frame_info
    model = Model('hammock-cloth')
    albedo, normal = cotton_weave()
    cloth = model.material('hammock_cloth', (216, 195, 155), 1, texture=albedo, double=True)
    model.materials[cloth]['normalTexture'] = {'index': len(model.images), 'scale': .65}
    model.images.append(normal)
    hooks = model.material('hammock_hooks', (51, 48, 43), .85)
    mesh = model.meshes[cloth]
    sag = float(lo[1]) + .6
    half_length = float((tips[1][0] - tips[0][0]) / 2) - .4878
    center_x = float((tips[1][0] + tips[0][0]) / 2)
    center_z = float((tips[1][2] + tips[0][2]) / 2)

    def body(u, v):
        # The centre has 1.19 m of developed width; the ends gather to 0.49 m.
        width = .53 * (1 - .53 * abs(u) ** 2.3)
        x = center_x + u * (half_length + .03 * v * v * abs(u) ** 3)
        y = sag + (.92 - sag) * u * u + (.16 - .105 * u * u) * v * v
        y += .007 * abs(u) ** 3 * (math.cos(v * 8 * PI) - 1)
        return (x, y, center_z + width * v)

    nu, nv = 64, 40
    for i in range(nu + 1):
        u = 2 * i / nu - 1
        for j in range(nv + 1):
            v = 2 * j / nv - 1
            du = sub(body(u + .0001, v), body(u - .0001, v))
            dv = sub(body(u, v + .0001), body(u, v - .0001))
            mesh.p.append(body(u, v))
            mesh.n.append(unit(cross(dv, du)))
            mesh.uv.append(((u + 1) * half_length / .096, (v + 1) * .595 / .096))
            mesh.c.append((1, 1, 1))
    for i in range(nu):
        for j in range(nv):
            a = i * (nv + 1) + j
            b = a + nv + 1
            mesh.i.extend((a, a + 1, b + 1, a, b + 1, b))
    body_vertices = len(mesh.p)
    # Rolled cotton selvedges on the two long sides and both gathered ends.
    for v in (-1, 1):
        hammock_rope(mesh, [body(2 * i / nu - 1, v) for i in range(nu + 1)], .0032)
    for u in (-1, 1):
        hammock_rope(mesh, [body(u, 2 * j / nv - 1) for j in range(nv + 1)], .0035)

    string_lengths = []
    for sign, tip in zip((-1, 1), tips):
        def local(x, y, z=0):
            return (float(tip[0]) + sign * x, float(tip[1]) + y, float(tip[2]) + z)

        # A collar surrounds the existing 18 mm end tube. Its inside radius is
        # 19.5 mm, preserving a small clearance; the J hook reaches inward.
        axis = unit((sign * .08, .05, 0))
        radial = (-sign * axis[1], abs(axis[0]), 0)
        collar_center = sub(tuple(tip), mul(axis, .013))
        collar = [add(collar_center, add(mul(radial, .023 * math.cos(a)), (0, 0, .023 * math.sin(a))))
                  for a in np.linspace(0, 2 * PI, 24, endpoint=False)]
        hammock_rope(model.meshes[hooks], collar, .0035, 6, closed=True)
        hook = [collar[0], local(-.0578, .027), local(-.0978, .015), local(-.1428, -.008),
                local(-.1628, -.039), local(-.1628, -.060), local(-.1498, -.070),
                local(-.1348, -.060), local(-.1318, -.043)]
        hammock_rope(model.meshes[hooks], hook, .004, 8)
        # Eye lies in the tension/Z plane, interlocking with the hook in X/Y.
        loop = [local(-.1628 + .013 * math.cos(a), -.087 + .020 * math.cos(a), .010 * math.sin(a))
                for a in np.linspace(0, 2 * PI, 24, endpoint=False)]
        hammock_rope(mesh, loop, .003, 6, closed=True)
        gather = local(-.1778, -.110)
        for j in range(36):
            v = 2 * j / 35 - 1
            start = add(gather, (0, .0015 * v * v, .008 * v))
            end = body(sign, v)
            points = [add(mix(start, end, t), (0, -.006 * math.sin(PI * t), 0))
                      for t in np.linspace(0, 1, 6)]
            hammock_rope(mesh, points, .00125, 5)
            string_lengths.append(sum(math.dist(a, b) for a, b in zip(points, points[1:])))
        # Short binding where the fan meets its reinforced eye.
        hammock_rope(mesh, [local(-.1778, -.110), local(-.1698, -.099)], .0055, 8)
    return model, dict(sag_y_m=sag, sag_above_feet_m=.6, body_vertices=body_vertices,
                       string_count=72, string_length_m=[min(string_lengths), max(string_lengths)])


def hammock_frame_clearance(cloth, frame):
    """Exact surface triangle clearance (vertex/face, edge/edge, and crossings).

    Only pairs within 10 cm AABBs need narrow-phase testing. Hook collars are
    included: enclosing a tube is allowed, but intersecting its surface is not.
    """
    def faces(mesh):
        return np.asarray(mesh.p)[np.asarray(mesh.i).reshape(-1, 3)]

    def segment_triangle(p, q, triangles):
        edge1, edge2 = triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]
        direction = q - p
        h = np.cross(direction, edge2)
        determinant = np.einsum('ij,ij->i', edge1, h)
        valid = abs(determinant) > 1e-12
        inv = np.divide(1., determinant, out=np.zeros_like(determinant), where=valid)
        s = p - triangles[:, 0]
        u = inv * np.einsum('ij,ij->i', s, h)
        cross_s = np.cross(s, edge1)
        v = inv * np.einsum('ij,ij->i', np.broadcast_to(direction, cross_s.shape), cross_s)
        t = inv * np.einsum('ij,ij->i', edge2, cross_s)
        return valid & (u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9) & (t >= 0) & (t <= 1)

    def vertex_face(p, triangles):
        a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
        ab, ac = b - a, c - a
        normal = render_unit(np.cross(ab, ac))
        distance = np.sum((p - a) * normal, axis=1)
        projected = p - distance[:, None] * normal
        inside = np.ones(len(triangles), dtype=bool)
        for start, end in ((a, b), (b, c), (c, a)):
            inside &= np.sum(np.cross(end - start, projected - start) * normal, axis=1) >= -1e-12
        return np.where(inside, abs(distance), np.inf)

    def edge_edge(p, q, a, b):
        # Closest pair between finite segments, including parallel/end cases.
        u, v, w = q - p, b - a, p - a
        aa, bb = np.sum(u * u, axis=-1), np.sum(u * v, axis=-1)
        cc, dd, ee = np.sum(v * v, axis=-1), np.sum(u * w, axis=-1), np.sum(v * w, axis=-1)
        det = aa * cc - bb * bb
        s = np.clip(np.divide(bb * ee - cc * dd, det, out=np.zeros_like(det), where=abs(det) > 1e-20), 0, 1)
        t = (bb * s + ee) / cc
        s = np.where(t < 0, np.clip(-dd / aa, 0, 1), s)
        s = np.where(t > 1, np.clip((bb - dd) / aa, 0, 1), s)
        t = np.clip(t, 0, 1)
        return np.linalg.norm(w + s[:, None] * u - t[:, None] * v, axis=1)

    result = {}
    for mi, mesh in cloth.meshes.items():
        triangles = faces(mesh)
        lo, hi = triangles.min(axis=1), triangles.max(axis=1)
        closest = .1
        for f in faces(frame):
            nearby = triangles[np.all(hi + closest >= f.min(axis=0), axis=1)
                               & np.all(lo - closest <= f.max(axis=0), axis=1)]
            if not len(nearby):
                continue
            repeated = np.broadcast_to(f, nearby.shape)
            for j in range(3):
                k = (j + 1) % 3
                hits = segment_triangle(f[j], f[k], nearby) | segment_triangle(nearby[:, j], nearby[:, k], repeated)
                if hits.any():
                    raise ValueError(cloth.materials[mi]['name'] + ' intersects hammock_frame near '
                                     + str(nearby[hits][0].mean(axis=0).round(5).tolist()))
                closest = min(closest, float(vertex_face(f[j], nearby).min()),
                              float(vertex_face(nearby[:, j], repeated).min()))
                for h in range(3):
                    closest = min(closest, float(edge_edge(f[j], f[k], nearby[:, h], nearby[:, (h + 1) % 3]).min()))
        require(closest > .00005, 'Hammock surface clearance is too small')
        result[cloth.materials[mi]['name']] = round(closest, 6)
    return result


def build_hammock_cloth(output):
    """Separate accessory command: never touches the registry, items, or thumbs."""
    global ROOT
    frame_info = hammock_frame_geometry()
    model, measurements = hammock_cloth(frame_info)
    clearance = hammock_frame_clearance(model, frame_info[0])
    output.mkdir(parents=True, exist_ok=True)
    previous_root = ROOT
    with tempfile.TemporaryDirectory(prefix='.hammock-', dir=output) as folder:
        stage = pathlib.Path(folder)
        (stage / 'models').mkdir()
        try:
            ROOT = stage
            saved = model.save()
            report = validate_item(stage, dict(id=model.id, file='models/hammock-cloth.glb',
                                               category='Seating', keepHeight=True))
            require(saved['triangles'] < 15000 and saved['bytes'] < 1_000_000, 'Hammock exceeds budget')
            require([m['name'] for m in model.materials] == ['hammock_cloth', 'hammock_hooks'],
                    'Unexpected hammock material')
            for data, _ in model.images:
                require(max(Image.open(io.BytesIO(data)).size) <= 512, 'Hammock texture exceeds 512 px')
            grey = np.asarray(Image.open(io.BytesIO(model.images[0][0])))
            require(np.array_equal(grey[:, :, 0], grey[:, :, 1]) and np.array_equal(grey[:, :, 1], grey[:, :, 2]),
                    'Cotton albedo must be neutral for recolouring')
            require(np.allclose(model.materials[0]['pbrMetallicRoughness']['baseColorFactor'], rgb((216, 195, 155)) + [1]),
                    'Cotton base colour must be #d8c39b')
            require(.4 <= measurements['string_length_m'][0] <= measurements['string_length_m'][1] <= .5,
                    'Suspension strings must be 0.4–0.5 metres')
            report.update(bounds_xyz_m=saved['bounds'], frame_bounds_xyz_m=[frame_info[2].tolist(), frame_info[3].tolist()],
                          frame_tip_centres_xyz_m=[p.tolist() for p in frame_info[4]],
                          frame_clearance_m=clearance, **measurements)
            # Preview-only assembly: copy actual frame geometry/material, omit
            # the frame node's yard transform so both parts share its origin.
            combined = Model('hammock-preview')
            combined.materials = model.materials + [frame_info[1]]
            combined.images = model.images
            combined.meshes = {**model.meshes, len(model.materials): frame_info[0]}
            combined.save()
            render_thumbnail('hammock-preview', azimuth=28, elevation=22,
                             source=stage / 'models/hammock-preview.glb', save=stage / 'hammock-preview.png', size=1024)
            (stage / 'hammock-report.json').write_text(json.dumps(report, indent=2) + '\n')
            (output / 'models').mkdir(exist_ok=True)
            check = output / '.builder-check'
            check.mkdir(exist_ok=True)
            os.replace(stage / 'models/hammock-cloth.glb', output / 'models/hammock-cloth.glb')
            for name in ('hammock-preview.png', 'hammock-report.json'):
                os.replace(stage / name, check / name)
            return [report]
        finally:
            ROOT = previous_root


def string_light_curve():
    """Catenary between the hook eyes, 250 mm below their chord at midspan."""
    span, high, low = 3.614, 2.632, 1.782

    def parameters(a):
        b = math.asinh((low - high) / (2 * a * math.sinh(span / (2 * a))))
        c = high - a * math.cosh(-span / (2 * a) + b)
        return b, c

    left, right = .5, 100.
    for _ in range(60):
        a = (left + right) / 2
        b, c = parameters(a)
        sag = (high + low) / 2 - (a * math.cosh(b) + c)
        if sag > .25:
            left = a
        else:
            right = a
    a = (left + right) / 2
    b, c = parameters(a)

    def point(x, t):
        return (x, a * math.cosh((t - .5) * span / a + b) + c, (t - .5) * span)

    # Invert exact catenary arc length: the bulb interval is measured ON cable.
    start = math.sinh(-span / (2 * a) + b)
    length = a * (math.sinh(span / (2 * a) + b) - start)
    stations = [.5 + a / span * (math.asinh(start + ((length - 3.5) / 2 + i * .5) / a) - b)
                for i in range(8)]
    return point, stations, length


def string_light_envelope(mesh, top):
    """24-sided frosted ST bulb, 60 mm diameter × 110 mm high, smooth normals."""
    profile = [(0, .008), (.014, .008), (.026, .010), (.038, .017),
               (.052, .025), (.066, .029), (.076, .030), (.088, .027),
               (.099, .020), (.107, .010), (.110, 0)]
    rings, normals = [], []
    sides = 24
    for j, (drop, radius) in enumerate(profile):
        before, after = profile[max(0, j - 1)], profile[min(len(profile) - 1, j + 1)]
        dr = (after[1] - before[1]) / (after[0] - before[0])
        rings.append([add(top, (radius * math.cos(k * 2 * PI / sides), -drop,
                               radius * math.sin(k * 2 * PI / sides))) for k in range(sides)])
        normals.append([unit((math.cos(k * 2 * PI / sides), dr, math.sin(k * 2 * PI / sides)))
                        if radius else (0, -1, 0) for k in range(sides)])
    for j in range(len(profile) - 1):
        for k in range(sides):
            n = (k + 1) % sides
            ps = [rings[j][k], rings[j + 1][k], rings[j + 1][n], rings[j][n]]
            ns = [normals[j][k], normals[j + 1][k], normals[j + 1][n], normals[j][n]]
            if j == len(profile) - 2:
                ps, ns = [ps[0], ps[1], ps[3]], [ns[0], ns[1], ns[3]]
            if dot(cross(sub(ps[1], ps[0]), sub(ps[2], ps[0])), ns[0]) < 0:
                ps.reverse()
                ns.reverse()
            mesh.face(ps, uv=[(.5, .25)] * len(ps), normals=ns)


def house_string_lights():
    """Four independently mounted strands; retain real heights, never call fit."""
    model = Model('house-string-lights')
    cable = model.material('string_light_cable', (18, 18, 17), .94)
    hardware = model.material('string_light_hardware', (55, 54, 50), .52)
    model.materials[hardware]['pbrMetallicRoughness']['metallicFactor'] = .65
    bulb = model.material('string_light_bulb', (255, 244, 225), .65)
    # The entire opaque, frosted envelope emits at strength 1. No transmission
    # pass, texture modulation, or subpixel filament geometry is needed.
    model.materials[bulb]['emissiveFactor'] = rgb((255, 217, 160))
    curve, stations, _ = string_light_curve()
    for x in (-2.25, -.75, .75, 2.25):
        tube(model.meshes[cable], [curve(x, i / 64) for i in range(65)], [.004] * 65, 6)
        # House screw eye: screw terminates at the wall plane z=-1.825.
        tube(model.meshes[hardware], [(x, 2.641, -1.825), (x, 2.641, -1.807)], [.002] * 2, 6)
        eye = [(x + .0075 * math.cos(a), 2.641 + .0075 * math.sin(a), -1.807)
               for a in np.linspace(0, 2 * PI, 25)]
        tube(model.meshes[hardware], eye, [.0015] * len(eye), 6)
        # A tiny bent cap clip rests at y=1.80; its return lip grips the wall edge.
        clip = [(x, 1.755, 1.8235), (x, 1.7985, 1.8235),
                (x, 1.7985, 1.794), (x, 1.782, 1.794), (x, 1.782, 1.807)]
        for a, b in zip(clip, clip[1:]):
            tube(model.meshes[hardware], [a, b], [.0015] * 2, 6)
        for t in stations:
            p = curve(x, t)
            tube(model.meshes[cable], [p, add(p, (0, -.031, 0))], [.003] * 2, 6)
            socket = [add(p, (0, -d, 0)) for d in (.027, .033, .054, .060)]
            tube(model.meshes[cable], socket, [.006, .010, .010, .008], 8)
            top = add(p, (0, -.060, 0))
            string_light_envelope(model.meshes[bulb], top)
    # Preserve smooth/hard edges and UV regions while sharing identical corners.
    for key, mesh in model.meshes.items():
        compact, lookup = Mesh(), {}
        for index in mesh.i:
            vertex = tuple(tuple(attr[index]) for attr in (mesh.p, mesh.n, mesh.uv, mesh.c))
            if vertex not in lookup:
                lookup[vertex] = len(compact.p)
                for dst, value in zip((compact.p, compact.n, compact.uv, compact.c), vertex):
                    dst.append(value)
            compact.i.append(lookup[vertex])
        model.meshes[key] = compact
    return model


ITEMS = {
    'house-string-lights': dict(make=house_string_lights, label='Patio string lights', category='Lighting',
        tags=['lights', 'string lights', 'bistro', 'café', 'patio', 'evening'],
        dimensions=(4.56, 1.04138, 3.65), triangles=25000, keepHeight=True),
    'house-canopy': dict(make=canopy, label='Patio canopy', category='Shade',
        tags=['awning', 'pergola', 'shade', 'cover', 'fabric'],
        dimensions=(6, 1 + .01 * math.sqrt(1 + (1 / 3.65) ** 2), 3.65),
        triangles=2000, keepHeight=True),
    'lavender-bush': dict(make=lavender, label='Lavender bush', category='Plants',
        tags=['lavender', 'herb', 'flowers', 'purple', 'shrub'],
        dimensions=(.8, .6, .8), triangles=30000),
    'lemongrass-clump': dict(make=lemongrass, label='Lemongrass', category='Plants',
        tags=['lemongrass', 'herb', 'grass', 'ornamental grass'],
        dimensions=(1, 1.2, 1), triangles=30000),
    'avocado-tree': dict(make=lambda: tree('avocado'), label='Avocado tree', category='Plants',
        tags=['avocado', 'fruit tree', 'tree'], dimensions=(3, 3.5, 3), triangles=100000),
    'lemon-tree': dict(make=lambda: tree('lemon'), label='Lemon tree', category='Plants',
        tags=['lemon', 'citrus', 'fruit tree', 'tree'], dimensions=(1.9, 2.4, 1.9), triangles=100000),
    'teak-bench': dict(make=bench, label='Teak bench', category='Seating',
        tags=['bench', 'seat', 'teak', 'wood'], dimensions=(1.5, .85, .6), triangles=50000),
    'teak-lounge-chair': dict(make=chair, label='Teak lounge chair', category='Seating',
        tags=['chair', 'lounge', 'teak', 'wood', 'cushions', 'outdoor'],
        dimensions=(.7, .75, .8), triangles=50000),
    'teak-coffee-table': dict(make=coffee_table, label='Teak coffee table', category='Tables',
        tags=['coffee table', 'teak', 'wood', 'slatted', 'outdoor'],
        dimensions=(1.1, .4, .6), triangles=50000),
    'concrete-fire-pit': dict(make=fire_pit, label='Square fire pit', category='Decor',
        tags=['fire pit', 'concrete', 'square', 'stone', 'outdoor'],
        dimensions=(1, .4, 1), triangles=50000),
}
CATEGORIES = {'Seating', 'Tables', 'Loungers', 'Shade', 'Lighting', 'Plants',
              'Planters', 'Decor', 'Play', 'Utility'}


def require(condition, message):
    """Keep validation active even when Python is invoked with -O."""
    if not condition:
        raise ValueError(message)


def library_path(root, relative):
    require(isinstance(relative, str) and relative, 'Empty or non-string asset path')
    require(not pathlib.Path(relative).is_absolute(), 'Manifest paths must be relative')
    result = (root / relative).resolve()
    require(result.is_relative_to(root.resolve()), 'Asset path escapes the library: ' + relative)
    return result


def read_manifest(root):
    path = root / 'library.json'
    data = json.loads(path.read_text()) if path.exists() else {'items': []}
    require(isinstance(data, dict) and isinstance(data.get('items'), list), 'Invalid library.json')
    ids = [entry.get('id') for entry in data['items']]
    require(all(isinstance(id, str) and re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', id)
                for id in ids), 'Invalid item id')
    require(len(ids) == len(set(ids)), 'Duplicate item ids in library.json')
    return data


def validate_item(root, entry):
    """Read the exported GLB and PNG independently of the mesh generator."""
    id = entry['id']
    spec = ITEMS.get(id, {})
    require(entry.get('category') in CATEGORIES, id + ': invalid category')
    path = library_path(root, entry['file'])
    raw = path.read_bytes()
    require(len(raw) >= 28, id + ': truncated GLB')
    require(struct.unpack_from('<III', raw) == (0x46546c67, 2, len(raw)), id + ': invalid GLB header')
    jl, jt = struct.unpack_from('<II', raw, 12)
    require(jt == 0x4e4f534a and jl % 4 == 0 and 28 + jl <= len(raw), id + ': invalid JSON chunk')
    g = json.loads(raw[20:20 + jl])
    bl, bt = struct.unpack_from('<II', raw, 20 + jl)
    binary = raw[28 + jl:]
    require(bt == 0x004e4942 and len(binary) == bl, id + ': invalid binary chunk')
    require(g['asset']['version'] == '2.0', id + ': expected glTF 2.0')
    require(len(g['buffers']) == 1 and 'uri' not in g['buffers'][0]
            and g['buffers'][0]['byteLength'] == bl, id + ': external or invalid buffer')
    roots = g['scenes'][g.get('scene', 0)]['nodes']
    require(len(roots) == 1 and g['nodes'][roots[0]]['name'] == id, id + ': root must match id')
    require(not any(key in g for key in ('animations', 'cameras', 'extensionsRequired', 'extensionsUsed')),
            id + ': unexpected animation, camera, or extension/compression')
    for node in g['nodes']:
        require(node.get('translation', [0, 0, 0]) == [0, 0, 0]
                and node.get('rotation', [0, 0, 0, 1]) == [0, 0, 0, 1]
                and node.get('scale', [1, 1, 1]) == [1, 1, 1]
                and 'matrix' not in node and 'camera' not in node and 'extensions' not in node,
                id + ': unapplied transform or extra scene object')
    for view in g['bufferViews']:
        require(view.get('buffer', 0) == 0 and view.get('byteOffset', 0) >= 0
                and view.get('byteOffset', 0) + view['byteLength'] <= bl, id + ': invalid buffer view')
    for image in g.get('images', []):
        require('uri' not in image and image.get('mimeType') in ('image/jpeg', 'image/png'),
                id + ': texture must be embedded JPEG/PNG')
        view = g['bufferViews'][image['bufferView']]
        offset = view.get('byteOffset', 0)
        im = Image.open(io.BytesIO(binary[offset:offset + view['byteLength']]))
        require(max(im.size) <= (2048 if id in ('avocado-tree', 'lemon-tree') else 1024),
                id + ': texture exceeds size budget')
        if image['mimeType'] == 'image/png':
            require('A' in im.getbands() and im.getchannel('A').getextrema()[0] < 255,
                    id + ': use JPEG for textures without alpha')
    for material in g['materials']:
        pbr = material.get('pbrMetallicRoughness')
        require(pbr is not None and 'extensions' not in material, id + ': expected standard PBR material')
        require(0 <= pbr.get('roughnessFactor', 1) <= 1 and 0 <= pbr.get('metallicFactor', 1) <= 1,
                id + ': invalid PBR values')
        require(all(0 <= v <= 1 for v in pbr.get('baseColorFactor', [1, 1, 1, 1])), id + ': invalid colour')
        require(material.get('alphaMode', 'OPAQUE') in ('OPAQUE', 'MASK'), id + ': alpha blend is not allowed')
        if material.get('alphaMode') == 'MASK':
            require(material.get('doubleSided') and 0 < material.get('alphaCutoff', .5) <= 1,
                    id + ': cutout cards must be double-sided and clipped')

    def data(index):
        a = g['accessors'][index]
        view = g['bufferViews'][a['bufferView']]
        count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        dtype = np.dtype({5126: '<f4', 5123: '<u2', 5125: '<u4'}[a['componentType']])
        offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', count * dtype.itemsize)
        require(stride >= count * dtype.itemsize and offset % dtype.itemsize == 0,
                id + ': invalid accessor alignment')
        end = offset + max(0, a['count'] - 1) * stride + count * dtype.itemsize
        require(end <= view.get('byteOffset', 0) + view['byteLength'], id + ': accessor exceeds buffer view')
        values = np.ndarray((a['count'], count), dtype=dtype, buffer=binary,
                            offset=offset, strides=(stride, dtype.itemsize))
        require(np.isfinite(values).all(), id + ': non-finite attribute')
        for key, fn in (('min', np.min), ('max', np.max)):
            if key in a:
                require(np.allclose(fn(values, axis=0), a[key], atol=1e-5), id + ': accessor bounds mismatch')
        return values

    points = []
    triangles = 0
    for mesh in g['meshes']:
        for primitive in mesh['primitives']:
            require(primitive.get('mode', 4) == 4, id + ': expected triangles')
            attrs = primitive['attributes']
            positions = data(attrs['POSITION']).astype(float)
            normals = data(attrs['NORMAL']).astype(float)
            indices = data(primitive['indices']).ravel()
            require(len(positions) == len(normals) and len(indices) % 3 == 0
                    and len(indices) > 0 and indices.max() < len(positions), id + ': invalid mesh indices')
            require(np.allclose(np.linalg.norm(normals, axis=1), 1, atol=1e-5), id + ': invalid normals')
            for name in ('TEXCOORD_0', 'COLOR_0'):
                if name in attrs:
                    values = data(attrs[name])
                    require(len(values) == len(positions), id + ': attribute count mismatch')
                    if name == 'COLOR_0':
                        require(((values >= 0) & (values <= 1)).all(), id + ': vertex colours out of range')
            index = indices.reshape(-1, 3)
            faces = positions[index]
            face_normals = np.cross(faces[:, 1] - faces[:, 0], faces[:, 2] - faces[:, 0])
            require((np.linalg.norm(face_normals, axis=1) > 1e-12).all(), id + ': degenerate triangles')
            require((np.sum(face_normals * normals[index[:, 0]], axis=1) >= -1e-10).all(),
                    id + ': normals oppose triangle winding')
            triangles += len(index)
            points.append(positions)
    points = np.concatenate(points)
    lo, hi = points.min(axis=0), points.max(axis=0)
    dims = hi - lo
    require(abs(lo[0] + hi[0]) <= .002 and abs(lo[2] + hi[2]) <= .002, id + ': origin not centred on X/Z')
    if entry.get('keepHeight'):
        require(lo[1] > 0, id + ': mounted item must preserve height')
    else:
        require(abs(lo[1]) <= .001, id + ': lowest point must touch y=0')
    if spec:
        require(np.allclose(dims, spec['dimensions'], atol=.001), id + ': unexpected real-world dimensions')
        require(bool(entry.get('keepHeight')) == bool(spec.get('keepHeight')), id + ': incorrect keepHeight')
    require(triangles <= spec.get('triangles', 50000), id + ': triangle budget exceeded')
    require(len(raw) <= (10_000_000 if id in ('avocado-tree', 'lemon-tree') else 5_000_000),
            id + ': file-size budget exceeded')
    if id == 'house-canopy':
        require(len(g['materials']) == 1 and g['materials'][0]['name'] == 'canopy_fabric'
                and 'baseColorTexture' not in g['materials'][0]['pbrMetallicRoughness'],
                id + ': expected one recolourable fabric material')
        require(abs(hi[1] - 2.8) < .001 and abs(lo[1] - (1.8 - .01 * math.sqrt(1 + (1 / 3.65) ** 2))) < .001,
                id + ': incorrect mounting height')
        for z, height in ((-1.825, 2.8), (1.825, 1.8)):
            ys = points[np.isclose(points[:, 2], z, atol=1e-5), 1]
            require(len(ys) > 0 and abs(ys.max() - height) < .001, id + ': front/high-edge orientation incorrect')
            require(abs((ys.max() - ys.min()) / math.sqrt(1 + (1 / 3.65) ** 2) - .01) < .0001,
                    id + ': sheet thickness must be 1 cm')
    if id == 'avocado-tree':
        require(max(dims[0], dims[2]) <= 3.2, id + ': canopy is too wide')
    light_report = {}
    if id == 'house-string-lights':
        require(len(raw) < 1_500_000 and triangles < 25000, id + ': light fixture budget exceeded')
        require([m['name'] for m in g['materials']] == ['string_light_cable', 'string_light_hardware', 'string_light_bulb'],
                id + ': expected exactly three named materials')
        require(entry.get('keepHeight') and abs(hi[1] - 2.65) < .001 and lo[1] > 1.5,
                id + ': mounting heights must be preserved')
        glass = g['materials'][2]
        require(glass['alphaMode'] == 'OPAQUE' and 'emissiveTexture' not in glass
                and np.allclose(glass['emissiveFactor'], rgb((255, 217, 160)))
                and glass['pbrMetallicRoughness']['roughnessFactor'] >= .5,
                id + ': expected opaque frosted bulbs with uniform full-strength warm-white emission')
        glass_pr = next(pr for mesh in g['meshes'] for pr in mesh['primitives'] if pr['material'] == 2)
        attrs = glass_pr['attributes']
        glass_points, glass_normals, glass_uv = data(attrs['POSITION']), data(attrs['NORMAL']), data(attrs['TEXCOORD_0'])
        require(np.allclose(glass_uv[:, 1], .25) and not g.get('textures'),
                id + ': unexpected filament geometry or bulb textures')
        tips = np.unique(glass_points[np.isclose(glass_uv[:, 1], .25) & (glass_normals[:, 1] < -.9999)], axis=0)
        require(len(tips) == 32 and np.allclose(np.unique(tips[:, 0]), [-2.25, -.75, .75, 2.25]),
                id + ': expected eight bulbs on each of four parallel strands, spaced 1.5 m apart')
        curve, stations, cable_length = string_light_curve()
        expected = np.array([add(curve(x, t), (0, -.17, 0)) for x in (-2.25, -.75, .75, 2.25) for t in stations])
        require(all(np.linalg.norm(tips - p, axis=1).min() < 1e-5 for p in expected),
                id + ': bulb drops or cable intervals are incorrect')
        light_report = dict(bounds_xyz_m=[lo.tolist(), hi.tolist()], lowest_bulb_y_m=float(tips[:, 1].min()),
                            bulbs=32, cable_length_per_strand_m=cable_length, midspan_sag_m=.25)
    if 'thumbnail' in entry:
        thumb = Image.open(library_path(root, entry['thumbnail']))
        require(thumb.size == (512, 512) and thumb.mode == 'RGBA', id + ': expected 512×512 RGBA thumbnail')
        alpha = thumb.getchannel('A')
        require(alpha.getextrema() == (0, 255), id + ': thumbnail requires a transparent background')
        x0, y0, x1, y1 = alpha.getbbox()
        require(.70 <= max(x1 - x0, y1 - y0) / 512 <= .85, id + ': thumbnail framing is outside the target')
        require(max(abs((x0 + x1) / 2 - 256), abs((y0 + y1) / 2 - 256)) <= 22,
                id + ': thumbnail is not centred')
    return dict(id=id, dimensions_xyz_m=[round(float(v), 6) for v in dims],
                lowest_y_m=round(float(lo[1]), 6), highest_y_m=round(float(hi[1]), 6),
                triangles=triangles, file_bytes=len(raw), status='PASS', **light_report)


def validate_library(root):
    manifest = read_manifest(root)
    for entry in manifest['items']:
        for key in ('file', 'thumbnail'):
            if key in entry:
                require(library_path(root, entry[key]).is_file(), entry['id'] + ': missing ' + key)
    return [validate_item(root, entry) for entry in manifest['items']]


def make_entry(id, previous=None):
    spec = ITEMS[id]
    entry = dict(id=id, label=spec['label'], category=spec['category'], tags=spec['tags'])
    entry.update(previous or {})  # Preserve user labels, tags, and custom metadata.
    entry.update(file=f'models/{id}.glb', thumbnail=f'thumbs/{id}.png')
    if spec.get('keepHeight'):
        entry['keepHeight'] = True
    else:
        entry.pop('keepHeight', None)
    return entry


def build(selected, output, render_only=False):
    """Stage and verify the whole batch before replacing any existing assets."""
    global ROOT
    output.mkdir(parents=True, exist_ok=True)
    manifest = read_manifest(output)
    old_entries = {entry['id']: entry for entry in manifest['items']}
    for entry in manifest['items']:
        if entry['id'] not in selected:
            for key in ('file', 'thumbnail'):
                if key in entry:
                    require(library_path(output, entry[key]).is_file(),
                            entry['id'] + ': missing existing ' + key)
    previous_root = ROOT
    with tempfile.TemporaryDirectory(prefix='.build-', dir=output) as folder:
        stage = pathlib.Path(folder)
        (stage / 'models').mkdir()
        (stage / 'thumbs').mkdir()
        entries = [make_entry(id, old_entries.get(id)) for id in selected]
        try:
            ROOT = stage
            for id in selected:
                print(('Rendering ' if render_only else 'Building ') + id + '…', file=sys.stderr)
                if render_only:
                    entry = old_entries.get(id)
                    require(entry is not None, 'Cannot render missing item: ' + id)
                    shutil.copyfile(library_path(output, entry['file']), stage / 'models' / f'{id}.glb')
                else:
                    ITEMS[id]['make']().save()
                render_thumbnail(id)
            (stage / 'library.json').write_text(json.dumps({'items': entries}, indent=2) + '\n')
            reports = validate_library(stage)
            for entry in entries:
                for key in ('file', 'thumbnail'):
                    if render_only and key == 'file':
                        # Keep existing file paths when only refreshing thumbnails.
                        entry['file'] = old_entries[entry['id']]['file']
                        continue
                    dest = library_path(output, entry[key])
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(library_path(stage, entry[key]), dest)
                index = next((i for i, old in enumerate(manifest['items']) if old['id'] == entry['id']), None)
                if index is None:
                    manifest['items'].append(entry)
                else:
                    manifest['items'][index] = entry
            manifest_file = stage / 'updated-library.json'
            manifest_file.write_text(json.dumps(manifest, indent=2) + '\n')
            os.replace(manifest_file, output / 'library.json')
            return reports
        finally:
            ROOT = previous_root


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--all', action='store_true', help='rebuild all registered models and thumbnails')
    action.add_argument('--item', action='append', choices=ITEMS, metavar='ID', help='rebuild an item (repeat for a batch)')
    action.add_argument('--check', action='store_true', help='validate the existing library without writing files')
    action.add_argument('--list', action='store_true', help='list the supported item ids without writing files')
    action.add_argument('--hammock-cloth', action='store_true',
                        help='build frame-local hammock accessory and combined preview; no Library entry or thumbnail')
    parser.add_argument('--render-only', action='store_true', help='with --all/--item, refresh thumbnails without rebuilding models')
    parser.add_argument('--output-dir', type=pathlib.Path, default=LIBRARY_DIR,
                        help='library or a subdirectory of it; default: directory containing this script')
    parser.add_argument('--json', action='store_true', help='print machine-readable results')
    args = parser.parse_args(argv)
    if not (args.all or args.item or args.check or args.list or args.hammock_cloth):
        parser.print_help()
        return 0
    if args.render_only and not (args.all or args.item):
        parser.error('--render-only requires --all or --item')
    output = args.output_dir.expanduser().resolve()
    require(output.is_relative_to(LIBRARY_DIR), '--output-dir must stay inside ' + str(LIBRARY_DIR))
    if args.list:
        rows = [dict(id=id, label=s['label'], category=s['category']) for id, s in ITEMS.items()]
        print(json.dumps(rows, indent=2) if args.json else '\n'.join(row['id'] for row in rows))
        return 0
    if args.hammock_cloth:
        reports = build_hammock_cloth(output)
    elif args.check:
        require((output / 'library.json').is_file(), 'No library.json found in ' + str(output))
        reports = validate_library(output)
    else:
        selected = list(ITEMS) if args.all else list(dict.fromkeys(args.item))
        reports = build(selected, output, args.render_only)
    if args.json:
        print(json.dumps(reports, indent=2))
    else:
        for row in reports:
            dims = ' × '.join(f'{value:g}' for value in row['dimensions_xyz_m'])
            print(f"PASS {row['id']}: {dims} m (X/Y/Z), {row['triangles']:,} triangles, {row['file_bytes']:,} bytes")
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError, struct.error) as error:
        print('Library builder: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
