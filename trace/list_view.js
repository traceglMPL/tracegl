// | List view |________________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define(function(require, exports, module){

	var fn = require("../core/fn")
	var ui = require("../core/ui")
	var ct = require("../core/controls")
	var tm = require("../core/text_mix")
	var ts = require("../core/text_shaders")
	var gl = ui.gl

	//|  Styling
	//\____________________________________________/   

	var font1 = ui.gl.sfont(
		navigator.platform.match(/Mac/)?
		"12px Menlo":
		"12px Lucida Console")
	
	function listView(g){
		var b = ui.rect({f:'t.codeBg'})
		
		b._v_ = ct.vScrollHider({h:'p.h - 10'})
		b._h_ = ct.hScrollHider({w:'p.w - 10'})

		b.set(g)
		b.font = font1
		//|  rendering
		//\____________________________________________/

		// shaders+-
		b.sh = {
			lrShadow: ui.rect.drawer({f:'mix(vec4(0,0,0,0.3),vec4(0,0,0,0),c.x)'}), // dropshadow
			topShadow: ui.rect.drawer({f:'mix(vec4(0,0,0,0.3),vec4(0,0,0,0),c.y)'}),
			text:   ui.gl.getShader(ts.codeText), // text
			select: ui.gl.getShader(ts.selectRect), // selection
			cursor: ui.rect.drawer({f:'t.codeCursor'}), // cursor
			line:   ui.rect.drawer({f:'t.codeLine'}), // linemark
			hover:  ui.rect.drawer({f:'t.codeHover'}),
			mark:   ui.rect.drawer({f:'t.codeMark'})
		}
		// mix in behaviors
		tm.viewport(b)
		tm.cursors(b, {singleCursor:1, noSelect:1, cursor:'default'})
		tm.drawing(b)
		tm.storage(b)

		b.vps.gx = 0
		b.vps.gy = 0

		// connect to a db object
		if(b.db){
			b.text = b.db.text
			b.db.font = b.font
			b.db.sh.text = b.sh.text

			var rt = 0
			b.db.changed(function(){
				b.tw = b.db.tw
				b.th = b.db.th
				if(!rt) rt = setTimeout(function(){
					rt = 0
					// if the scrollbars are at 'end' we should keep them at the end
					b.size()
					ui.redraw(b)
				},0)
			})
		}

		// connect cursors
		if(b.cursor){
			b.cursor.linked = b
			b.vcs = b.cursor.vcs
			b.dcs = b.cursor.dcs
			// crosslink the 'view' change event
			b.viewChange = function(x, y){
				//b.cursor.view(x, y, 0, 1)
				fn('here1')
			}
			var last
			b.cursor.viewChange = function(x, y){
				// alright so we have a cursor selection,
				// lets fetch the data stored at our first cursor
				var c = b.dcs.l.first() || b.vcs.l.first()
				//fn(c!=null, c.d!=null, last!=c.d, b.db.selectTrace !=0)	
				if(c && c.d && last != c.d && b.db.selectTrace) b.db.selectTrace(last = c.d)
				b.view(x, y, 0, 1)
				if(b.cursorMove)b.cursorMove()
			}
		}

		// if we 
		b.o = function(){
			// set the view back to our head cursor
			if(b.linked){
				var c = b.vcs.l.first()
				if(c){
					b.linked.view(0,c.y, 0, 1, 1)
				}
			} else {
				b.hy = -1
				ui.redraw(b)
			}
		}

		b.textHover = function(){
			if(b.linked && b.linked.cursorMove) b.linked.cursorMove()
			ui.redraw(b)
			if(b.linked) ui.redraw(b.linked)
		}

		// rendering
		var ly = 0
		function layer(){

			ui.view(b, b.vps.o)

			if(!b._v_.pg) b.size()

			// draw hover cursor
			var y = b.hy
			if(y >=0) b.sh.hover.rect(b.vps.o.x , b.vps.o.y - b.vps.ss + (y + b.vps.y) * b.vps.sy + b.vps.gy, b.vps.o.w , b.vps.sy )

			if(ly != y){
				ly = y
				if(b.linked){
					b.linked.hy = y
					b.linked.view(0, y, 0, 1, 1)
				}
			}
			// draw selection line
			var c = b.vcs.l.first()
			while(c){
				b.sh.mark.rect(b.vps.o.x , b.vps.o.y - b.vps.ss + (b.vps.y + c.y) * b.vps.sy + b.vps.gy, b.vps.o.w, b.vps.sy)
				c = c._d
			}
			var c = b.dcs.l.first()
			while(c){
				b.sh.mark.rect(b.vps.o.x , b.vps.o.y - b.vps.ss + (b.vps.y + c.y) * b.vps.sy + b.vps.gy, b.vps.o.w, b.vps.sy)
				c = c._d
			}
			b.drawText()
			
			//ui.clip(b.vps.o.x, b.vps.o.y, b.vps.o.w, b.vps.o.h )
			b.drawShadows()
		}
		b.l = layer

		b.show = function(){
			b.l = layer
			ui.redraw(b)
		}

		b.hide = function(){
			if(b.l !== -1){
				b.l = -1
				ui.redraw(b)
			}
		}

		return b
	}

	return listView
})


