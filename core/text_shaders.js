// | Shader library |____________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define(function(require, exports){
	"no tracegl"
	var gl = require("./gl")
	var ui = require("./ui")

	// code text using POINTS
	exports.codeText = ui.shader({
		u: {
			b:'sampler2D', // font texture
			sz:'vec4', //x:font width, y:font height, z:point size, w:pixel adjustment
			ps:'vec4', //x:text x offset, y:text y offset, z:pixel x offset, w:pixel y offset
		},
		a: {
			e:'ucol', // x:text x coord, y:text y coord, z:font texture x, w:font texture y
			fg:'float' // foreground color
		},
		p: 'sz.z',
		v: gl.ratio>1?
			'vec4((((ps.z+(ps.x+e.x*255)*sz.x+0.25*sz.z)+sz.w+l.x)/s.x)*2.-1.,1.-(((ps.w + (ps.y+e.y*255)*sz.y+0.25*sz.z)+sz.w+l.y)/s.y)*2.,0,1.)':
			'vec4(((floor(ps.z+(ps.x+e.x*255)*sz.x+0.5*sz.z)+sz.w+l.x)/s.x)*2.-1.,1.-((floor(ps.w + (ps.y+e.y*255)*sz.y+0.5*sz.z)+sz.w+l.y)/s.y)*2.,0,1.)',
		f: gl.ratio>1?
			'subpix(texture2D(b,vec2(e.z*0.99609375 + c.x/(512./26.), e.w*0.99609375 + c.y/(512./26.))),t.codeBg,theme(fg))':
			'subpix(texture2D(b,vec2(e.z*0.99609375 + c.x/(512./13.), e.w*0.99609375 + c.y/(128./13.))),t.codeBg,theme(fg))',
		m: ui.gl.POINTS,
		l: 1
	})

	// selection rectangle, flagged round edges
	exports.selectRect = ui.shader({
		u: {
			sz:'vec4', //x:font width, y:font height, z:shift y
			ps:'vec4', //x:text x offset, y:text y offset, z:pixel x offset, w:pixel y offset
			fg:'float' //palette foreground
		},
		a: {
			e:'vec2', //x:text coord x, y:text coord y
			r:'vec4'  //x:left text coord, y:top text coord, z:right text coord, w:flag 1 tl, 2 bl, 4 tr, 8 br
		}, 
		v: 'vec4((floor(ps.z + (e.x+ps.x)*sz.x+l.x)/s.x)*2.-1., 1.-(floor(ps.w + (e.y+ps.y)*sz.y-sz.z+l.y)/s.y)*2.,0,1.)',
		f: function(){
			vec3_v(floor(ps.z + (ps.x + r.x)* sz.x),floor(ps.w + (ps.y + r.y )* sz.y - sz.z), ps.z + (ps.x + r.z) * sz.x)
			vec4_c(theme(fg))
			if(f.x < v.x + 0.5*sz.x){
				vec2_d(f.x - (v.x + sz.x), f.y - (v.y + 0.5*sz.y))
				if(d.y<0 && mod(r.w,2) == 1) return_vec4(c)
				if(d.y>0 && mod(r.w,4) >= 2) return_vec4(c)
				return_vec4(c.xyz, sqrt(d.x*d.x+d.y*d.y)>9?0:c.w)
			} else if(f.x > v.z - 0.5*sz.x ){
				vec2_d(f.x - (v.z - sz.x), f.y - (v.y + 0.5*sz.y))
				if(d.y<0 && mod(r.w,8) >= 4) return_vec4(c)
				if(d.y>0 && mod(r.w,16) >= 8) return_vec4(c)
				return_vec4(c.xyz, sqrt(d.x*d.x+d.y*d.y)>9?0:c.w)
			}
			return_vec4(c)
		},
		m: ui.gl.TRIANGLES,
		l: 6
	})
})
