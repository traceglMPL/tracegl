// | Code view |______________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define(function(require){

	var fn = require("../core/fn")
	var ui = require("../core/ui")

	var ac = require("../core/acorn")

	var ct = require("../core/controls")
	var tm = require("../core/text_mix")
	var ts = require("../core/text_shaders")
	var gl = ui.gl
	
	//|  Styling
	//\____________________________________________/   

	var ft1 = ui.gl.sfont(
		navigator.platform.match(/Mac/)?
		"12px Menlo":
		"12px Lucida Console")
	
	hoverText.ft = ft1
	function hoverText(g){
		"no tracegl"
		// background
		var b = ui.rect({f:'mix(vec4(0,0,0,0),alpha(t.codeBg2,0.9),1-smoothstep(0.5,1.0,n.shape(2*(c-.5))))'})
		b.shape = function(vec2_v){
			return_float(len(vec2(pow(abs(v.x),n.w/5),pow(abs(v.y),n.h/5))))
		}
		
		// scrollbars
		//b._v_ = ct.vScroll({h:'p.h - 10'})
		//b._h_ = ct.hScroll({w:'p.w - 10'})

		b.set(g)
		b.font = ft1

		//|  rendering
		//\____________________________________________/   

		// shaders+-

		var ts1 = ts.codeText
	//	ts1.f = 'subpix(texture2D(b,vec2(e.z*0.99609375 + c.x/(512./26.), e.w*0.99609375 + c.y/(128./26.))),t.codeBg,theme(fg))'
//		ts1.f = 'subpix(texture2D(b,vec2(e.z*0.99609375 + c.x/(512./13.), e.w*0.99609375 + c.y/(512./13.))),t.codeBg,theme(fg))'
		//ts1.f = 'subpix(texture2D(b,vec2(0.219 + c.x*0.025390625, 0.191 + c.y*0.025390625)),t.codeBg,theme(fg))'
	//	ts1.f = 'fg*0.001+vec4(c.x, c.y,e.z,1)'//+subpix(texture2D(b,1.-vec2(e.z*0.99609375 + c.x/(512./26.), e.w*0.99609375 + c.y/(256./26.))),t.codeBg,theme(fg))+red'
		//ts1.dbg = 1
		b.sh = {
			text: ui.gl.getShader(ts1), // text
			select: ui.gl.getShader(ts.selectRect), // selection
			cursor: ui.rect.drawer({f:'t.codeCursor'}), // cursor
			line: ui.rect.drawer({f:'t.codeLineBg'}), // linemark
			lrShadow: ui.rect.drawer({f:'mix(vec4(0,0,0,0.2),vec4(0,0,0,0),c.x)'}), // dropshadow
			topShadow: ui.rect.drawer({f:'mix(t.codeBg,vec4(0,0,0,0),c.y)'})
		}

		// mix in behaviors
		tm.viewport(b)
		tm.cursors(b)
		tm.drawing(b)
		tm.storage(b)

		b.vps.gx = 5
		b.vps.gy = 5

		b.fit = function(x, y){
			var w = b.tw * b.vps.sx + 2*b.vps.gx
			x -= 0.5 * w
			if(x + w > ui.gl.width)
				x = fn.max(0, x + (ui.gl.width - (x + w)))
			if(x < 0) x = 0

			b.show(x, y + b.vps.sy, w,
			   b.th * b.vps.sy + 1*b.vps.gy
			)
		}

		b.show = function(x, y, w, h){
			b.l = layer
			ui.redraw(b)
			ui.redrawRect(x, y, w, h)
			b.x = x
			b.y = y
			b.w = w
			b.h = h
		}

		b.hide = function(){
			if(b.l !== -1){
				b.l = -1
				ui.redraw(b)
			}
		}

		// rendering
		function layer(){
			ui.view(b, b.vps.o)

			//if(!b._v_.pg) b.size()
			// draw if/else markers

			b.drawSelection()
			if(b.text) b.drawText()
		}
		b.l = layer
		return b
	}

	return hoverText
})
