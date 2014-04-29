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
	
	function codeView(g){

		// background
		var b = ui.rect({f:'t.codeBg'})
		
		// scrollbars
		b._v_ = ct.vScroll({h:'p.h - 10'})
		b._h_ = ct.hScroll({w:'p.w - 10'})

		b.set(g)
		b.font = ft1

		//|  rendering
		//\____________________________________________/   

		// shaders+-
		b.sh = {
			text: ui.gl.getShader(ts.codeText), // text
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

		// rendering
		b.l = function(){
			ui.view(b, b.vps.o)

			if(!b._v_.pg) b.size()
			// update line numbers
			b.linesUpdate(ui.t.codeLine)
			b.drawLineMarks()
			b.drawLines()

			ui.clip(b.vps.o.x + b.vps.gx, b.vps.o.y, b.vps.o.w - b.vps.gx, b.vps.o.h)

			// draw if/else markers

			b.drawSelection()
			if(b.text){
				b.drawText()
			}
			b.drawCursors()

			ui.clip(b.vps.o.x, b.vps.o.y, b.vps.o.w, b.vps.o.h)
			b.drawShadows()
		}

		return b
	}

	return codeView
})
