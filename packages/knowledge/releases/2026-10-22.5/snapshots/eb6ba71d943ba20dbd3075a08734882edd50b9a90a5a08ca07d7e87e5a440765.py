"""Finite SVG-to-PNG adapter using already installed librsvg/Cairo. No installs.
Unlike the earlier MuPDF SVG path, this backend preserves stroke-dasharray.
"""
from pathlib import Path
import ctypes as C,json,hashlib
r=Path(__file__).resolve().parent
c=C.CDLL('libcairo.so.2');s=C.CDLL('librsvg-2.so.2');g=C.CDLL('libgobject-2.0.so.0')
def bind(lib,name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
ptr=C.c_void_p
surface_new=bind(c,'cairo_image_surface_create',[C.c_int,C.c_int,C.c_int],ptr)
context_new=bind(c,'cairo_create',[ptr],ptr)
scale=bind(c,'cairo_scale',[ptr,C.c_double,C.c_double],None)
save=bind(c,'cairo_surface_write_to_png',[ptr,C.c_char_p],C.c_int)
destroy=bind(c,'cairo_destroy',[ptr],None);destroy_surface=bind(c,'cairo_surface_destroy',[ptr],None)
new=bind(s,'rsvg_handle_new_from_data',[C.c_char_p,C.c_size_t,C.POINTER(ptr)],ptr)
render=bind(s,'rsvg_handle_render_cairo',[ptr,ptr],C.c_int)
unref=bind(g,'g_object_unref',[ptr],None)
records=[]
for f in json.loads((r/'figures/manifest.json').read_text()):
 p=r/f"figures/q{f['id']}.svg";b=p.read_bytes();err=ptr();handle=new(b,len(b),C.byref(err));assert handle and not err
 surf=surface_new(0,f['width']*3,f['height']*3);ctx=context_new(surf);scale(ctx,3,3)
 assert render(handle,ctx);out=p.with_suffix('.png');assert save(surf,str(out).encode())==0
 destroy(ctx);destroy_surface(surf);unref(handle)
 records.append({'questionId':f['id'],'svgSha256':hashlib.sha256(b).hexdigest(),'pngSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'backend':'installed librsvg/Cairo','scale':3})
(r/'figure-render.actual.json').write_text(json.dumps(records,indent=2))
print('Rendered',len(records),'figures with native dashed-stroke support')
