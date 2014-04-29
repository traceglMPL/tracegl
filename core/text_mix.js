// | Text Mixins |_________________________/
// |
// | (C) Code.GL 2013
// \____________________________________________/   

define(function(require, exports){

	var ui = require("./ui")
	var fn = require("./fn")

	// |  textview with zoom/scroll 
	// \____________________________________________/
	exports.viewport = function(b){
		// viewport state
		var s = b.vps = {
			o:{}, // outerview
			gx:48, // gutter x
			gy:2,  // gutter y
			ox:7, // original x
			oy:16, // original y
			op:13, // original point size
			os:2, // original shift
			sx:0, // xsize
			sy:0, // ysize
			sp:0, // point size
			ss:0, // selection shift
			ts:3, // tab stops
			x:0, // scroll x
			y:0 // scroll y
		}
		s.sx = s.ox
		s.sy = s.oy
		s.sp = s.op
		s.ss = s.os

		// |  zoom (factor)
		b.zoom = function(z){
			var osy = s.sy
			if(z>1 && s.sy < s.oy/7){
				s.sy *= z
				if(s.sy>s.oy/7) s.sy = s.oy/7

				if(osy!=s.sy) ui.redraw(b)
				return
			}
	
			s.sx *= z
			s.sy *= z
			s.sp *= z
			s.ss *= z

			if(s.sp<s.op/7){
				s.sx = s.ox/7
				s.sp = s.op/7
				s.ss = s.os/7
				if(s.sy<1) s.sy = 1
			}
			if(s.sp > s.op){
				s.sx = s.ox
				s.sy = s.oy
				s.sp = s.op
				s.ss = s.os
			}
			if(osy!=s.sy) ui.redraw(b)
		}

		if('zm' in b) b.zoom(b.zm)

		var v = b._v_
		var h = b._h_
		if(v){
			v._b = b
			v.l = 1
			v.c = function(){ s.y = -v.mv; ui.redraw(b) }
		}
		if(h){
			h._b = b
			h.l = 1
			h.c = function(){ s.x = -h.mv; ui.redraw(b) }
		}
		// |  scroll event hook
		b.s = function(){
			if(!ui.ms.m && !ui.ms.a){
				v.ds(ui.mv / s.sy)
				h.ds(ui.mh / s.sx)
				return
			}
			if(ui.mv > 0){
				var z = Math.pow(0.95,ui.mv / 16)
				if(z<0.9) z = 0.9
				var sy = s.sy
				b.zoom(z)
				var z = (ui.my - s.o.y) 
				b.size()	
				v.ds( z / sy - z / s.sy )
			} else {
				var z = Math.pow(1.05,-ui.mv / 16)
				if(z>1.1) z = 1.1
				var sy = s.sy
				b.zoom(z)
				var z = (ui.my - s.o.y) 
				b.size()	
				v.ds( z / sy - z / s.sy )
			}
		}

		//| update the scroll sizes
		b.v_ = b.size = function(){
			// check if our scrollbar is at the bottom, ifso keep it there
			if(!v || !h) return
			var end = (v.mv >= v.ts - v.pg)
			if(!('h' in s.o))	ui.view(b, s.o)
			// we have pg and ts and mv on a scroll
			v.pg = s.o.h / s.sy 
			v.ts = b.th //+ 1
			h.pg = s.o.w / s.sx
			h.ts = b.tw + 2
			var d 
			if((d = v.mv - (v.ts - v.pg))>0) v.ds(d)
			else if(v.pg && end) v.ds((v.ts - v.pg) - v.mv) // stick to end
			if((d = h.mv - (h.ts - h.pg))>0) h.ds(d)
			//fn(end) v.mv - (v.ts - v.pg)
		}

		//| show x y text position in text view
		b.view = function(x, y, p,  event, center){
			var d
			var c = center ? (s.o.h-s.gy)/s.sy / 2 : 0
			if(center == 2) y += (s.o.h-s.gy)/s.sy / 2
			if(!p || p == 1){
				// scroll down
				if((d = (y + c) - (-s.y + (s.o.h-s.gy)/s.sy - 1) ) > 0) v.ds(d)
			}
			if(!p || p == 2){
				// scroll up up 
				if((d = (y - c)- (-s.y ) ) < 0) v.ds(d)
			}
			// scroll right
			if(!event){
				if((d = ((x+2)) - (-s.x + (s.o.w-s.gx)/s.sx)) > 0) h.ds(d)
				// scroll left
				if((d = ((x) - (-s.x))) < 0) h.ds(d)
				if(b.viewChange) b.viewChange(x,y,p)
			}
			ui.redraw(b)
		}

		// text mouse x
		b.tmx = function(){ 
			return fn.max(0, Math.round(-s.x + (ui.mx - s.o.x - s.gx) / s.sx)) 
		}
		
		// text mouse y
		b.tmy = function(){ 
			return fn.max(0, Math.round(-s.y + (ui.my - s.o.y - s.gy) / s.sy -0.25 )) 
		}
	}

	// |  text cursor and selection
	// \____________________________________________/
	exports.cursors = function(b, opt){
		opt = opt || {}

		function curSet(){
			var s = Object.create(curSet.prototype)
			s.l = fn.list('_u', '_d')
			return s
		}

		(function(p){
		
			// add a new cursor to the set
			p.new = function(u, v, x, y){
				var s = this
				var c = cursor()
				c.u = u || 0
				c.v = v || 0
				c.x = x || 0
				c.y = y || 0
				c.update()
				s.l.add(c)
				return c
			}

			// move all cursors back to the pool
			p.clear = function(n){
				var s = this
				var l = n || -1
				while(s.l.len){
					if(l == 0) break
					var c = s.l.last()
					s.l.rm(c)
					cursor.prototype.pool.add(c)
					l--
				}
			}

			// merge set against self, merges all cursor overlaps
			p.remerge = function(){
				var n = curSet()
				var s = this
				n.merge(s)
				s.l = n.l
			}

			// merge sets. i know this is O(n^2), should be improved someday.
			p.merge = function(o){
				var s = this
				var c = o.l.first()
				var l
				o.v = Infinity
				o.y = -Infinity
				while(c){
					var n = c._d
					o.l.rm(c)
					
					var cu = c.u
					var cv = c.v
					var cx = c.x
					var cy = c.y
					// flip em
					var cf = 0			
					if( (cv - cy || cu - cx ) > 0  ) cu = c.x, cv = c.y, cx = c.u, cy = c.v, cf = 1
					var d = s.l.first()
					while(d){
						var m = d._d
						// order points
						var du = d.u
						var dv = d.v
						var dx = d.x
						var dy = d.y
						// flip em					
						if( (dv - dy || du - dx ) > 0  ) du = d.x, dv = d.y, dx = d.u,	dy = d.v
						// check if intersect
						if ( (cy - dv || cx - du) > 0){ // compare > to [
							if( (cv - dy || cu - dx) < 0){ // compare < to ]
								if( (cv - dv || cu - du) > 0) cv = dv, cu = du
								if( (cy - dy || cx - dx) < 0) cy = dy, cx = dx
								// throw away d
								s.l.rm(d)
								cursor.prototype.pool.add(d)
							}
						}
						d = m
					}
					// keep top and bottom for scroll into view
					if(cv < o.v) o.v = cv, o.cv = c 
					if(cy > o.y) o.y = cy, o.cy = c
					c.u = cf?cx:cu
					c.v = cf?cy:cv
					c.x = cf?cu:cx
					c.y = cf?cv:cy
					c.update()
					s.l.add(c)
					c = n
				}
			}

			// make our set to be this grid selection
			p.grid = function(u, v, x, y){
				var s = this
				// right size the cursorset
				var l = Math.abs(y - v) + 1
				while(s.l.len < l) s.l.add(cursor())
				while(s.l.len > l){
					var c = s.l.last()
					s.l.rm(c)
					cursor.prototype.pool.add(c)
				}
				// set all cursors
				var c = s.l.first()
				var d = y - v > 0 ? 1 : -1
				var i = v
				var e = s + d
				while(c){
					if(c.u != u || c.y != i || c.v != i || c.x != x){
						c.u = u, c.y = c.v = i, c.w = c.x = x
						c.update()
					}
					if(i == y) break
					i += d
					c = c._d
				}
			}

			// forward nav functions to the entire set
			function fwd(n){
				p[n] = function(){ 
					var c = this.l.first()
					while(c){
						c[n].apply(c, arguments)
						c = c._d
					}
				}
			}
			fwd('up')
			fwd('down')
			fwd('left')
			fwd('right')
			fwd('home')
			fwd('end')
			fwd('pgup')
			fwd('pgdn')

			p.copy = function(){
				var a = ""
				var c = this.l.first()
				while(c){
					if(a) a += "\n"
					a += c.copy()
					c = c._d
				}
				return a
			}

		})(curSet.prototype)

		b.vcs = curSet() // visible cursor set
		b.dcs = curSet() // drawing cursor set
		b.mcs = curSet() // marking set
		
		// factory a new cursor object
		function cursor(){
			var c
			var p = cursor.prototype.pool
			if(p.len) p.rm(c = p.last())
			else c = Object.create(cursor.prototype)

			// selection is from u,v to x,y
			c.u = 0 // anchor x
			c.v = 0 // anchor y
			c.x = 0 // cursor x
			c.y = 0 // cursor y
			c.w = 0 // cursor 'width' or maximum x

			return c
		}

		(function(p){

			p.pool = fn.list('_u', '_d')

			// select an AST node
			p.select = function(n){
				var c = this
				c.v = c.y // selection is one line
				c.u = n.x
				c.w = c.x = n.x + n.w
				c.update()
			}
			
			// clear selection
			p.clear = function(){
				var c = this
				c.w = c.u = c.x
				c.v = c.y
				c.update()
			}

			// select current line
			p.selectLine = function(){
				var c = this
				c.w = c.x = c.u = 0
				c.y = c.v + 1
				c.update()
			}

			// cursor from mouse coordinate
			p.mouse = function(b){
				var c = this
				c.w = c.x = b.tmx()
				c.y = fn.min(b.tmy(), b.th - 1)
			}		

			p.updatew = function(){
				var c = this
				c.update()
				c.w = c.x
			}

			p.inRange = function(x,y){
				var c = this
				var d1 = c.v - y || c.u - x
				var d2 = c.y - y || c.x - x
				// we are in range when d1 >= 0 && d2 <= 0
				return d1 <= 0 && d2 >= 0
			}

			p.left = function(s){
				var c = this
				var d = (c.v - c.y || c.u - c.x) 
				if(d != 0 && !s){
					if(d > 0)  c.u = c.x, c.v = c.y
					else c.x = c.u, c.y = c.v
					c.update()
				} else {
	 				if(c.x == 0){
						if(!c.y) return
						c.y --
						c.x = 256
						if(!s) c.u = c.x, c.v = c.y
						c.update()
						c.w = c.x
						if(!s) c.u = c.x
					} else {
						c.w = -- c.x
						if(!s) c.u = c.x, c.v = c.y
						c.update()
					}
				}
			}

			p.right = function(s){
				var c = this
				var d = (c.v - c.y || c.u - c.x) 
				if(d != 0 && !s){
					if(d < 0) c.u = c.x, c.v = c.y
					else c.x = c.u, c.y = c.v
					c.update()
				} else {
					c.w = c.x++ 
					if(!s) c.u = c.x, c.v = c.y
					c.update()
					if(c.x == c.w){ // end of line
						if(c.y >= b.th) return
						c.x = c.w = 0
						c.y++
						if(!s) c.u = c.x, c.v = c.y
						c.update()
					} else c.w = c.x
				}
			}

			p.down = function(s, d){
				var c = this
				if(c.y >= b.th) return
				c.y += d || 1
				if(c.y > b.th - 1) c.y = b.th - 1
				c.x = c.w
				if(!s) c.u = c.x, c.v = c.y
				c.update()
			}

			p.up = function(s, d){
				var c = this
				if(!c.y) return
				c.y -= d || 1
				if(c.y < 0) c.y = 0
				c.x = c.w
				if(!s) c.u = c.x, c.v = c.y
				c.update()
				if(!s) c.u = c.x
			}

			p.home = function(s){
				this.up(s, this.y)
			}

			p.end = function(s){
				this.down(s, b.th - this.y)
			}

			p.pgup = function(s){
				this.up(s, Math.floor(b.vps.o.h / b.vps.sy))
			}

			p.pgdn = function(s){
				this.down(s, Math.floor(b.vps.o.h / b.vps.sy))
			}

			p.copy = function(){
				var c = this
				var u = c.u, v = c.v, x = c.x, y = c.y
				if(y <= v) u = c.x, v = c.y, x = c.u, y = c.v
				if(y == v && x < u) x = c.x, u = c.u
				// lets accumulate text
				var a = ""
				for(var i = v; i <= y; i++){
					var s = 0
					var t = ""
					var e = b.lines[i].length
					if(i == v) s = u
					if(i == y) e = x
					else t = "\n"
					a += b.lines[i].slice(s, e) + t
				}
				return a
			}

			// update selection vertexbuffer
			p.update = function(){
				b.cursorUpdate(this)
			}

			p.view = function(p){
				var c = this
				var d
				b.view(c.x, c.y, p)
			}
		})(cursor.prototype)
		
		//|  interaction
		//\____________________________________________/   

		var tct = fn.dt() // triple click timer
		var tcx = 0 // triple click x
		var tcy = 0 // triple click y

		b.selectLine = function(y){
			b.vcs.clear()
			cmc = b.vcs.new()
			cmc.u = 0
			cmc.w = cmc.x = Infinity
			cmc.y = cmc.v = y
			cmc.update()
			cmc.view()
		}

		b.selectFirst = function(y){
			b.vcs.clear()
			cmc = b.vcs.new()
			cmc.u = 0
			cmc.w = cmc.x = 0
			cmc.y = cmc.v = y
			cmc.update()
			cmc.view()
		}

		// doubleclick
		b.u = function(){ 
			if(!ui.ms.m){ // clear cursors if not holding meta
				b.vcs.clear()
				cmc = b.vcs.new()
			} else { // grab last cursor created
				b.vcs.clear(1) // remove last
				cmc = b.vcs.l.last()
			}
			cmc.mouse(b)
			cmc.clear()
			
			if(b.cursorToNode){
				var n = b.cursorToNode(cmc)
				if(n)	cmc.select( n )
			} else {
				cmc.selectLine()
			}

			// triple click
			tct.reset()
			tcx = ui.mx
			tcy = ui.my
			ui.redraw(b)
		}

		var cmc // current mouse cursor
		var gsx // grid start x
		var gsy // grid start y
		var gmm // grid mouse mode
		// press mouse
		b.p = function(){
			ui.focus(b)

			if(ui.mx == tcx && ui.my == tcy && tct() < 500){
				// triple click
				cmc = b.vcs.l.last()
				cmc.selectLine()
				return 1
			}
			
			// unless press meta, clear all cursors
			var o, u, v
			if(!ui.ms.m){
				// clear cursors
				if(cmc) o = cmc, u = o.u, v = o.v
				b.vcs.clear()
			}

			// if pressing alt go in grid-select mode
			if(ui.ms.a && !opt.singleCursor){
				gsx = b.tmx()
				gsy = b.tmy()
				gmm = 1
			} else {
				gmm = 0
				cmc = b.dcs.new()
				cmc.mouse(b)
				if(!ui.ms.s) cmc.clear()
				else if(o) cmc.u = u, cmc.v = v, cmc.updatew()
				cmc.view()
			}
			ui.cap = b
			return 1
		}

		// move cursor
		b.lastMarker = 1
		b.m = function(){
			if(ui.cap == b){
				// check if gridselect 
				if(gmm){ // gridmode
					b.dcs.grid(gsx, gsy, b.tmx(), b.tmy())
					var c = b.dcs.l.last()
					if(c) c.view()
					// scroll the last cursor into view
				} else {
					cmc.mouse(b)
					if(opt.noSelect) cmc.u = cmc.x, cmc.v = cmc.y
					cmc.updatew()
					cmc.view()
					// scroll into view
				}
			}
			var y = fn.min(b.tmy(), b.th - 1)
			if(y != b.hy && b.textHover){
				b.hy = y
				b.textHover()
			}
			// do marker hover events
			if(b.markerHover){
				var mh = 0
				var x = b.tmx()
				var c = b.mcs.l.first()
				while(c){
					if(c.inRange(x,y)) mh = c
					c = c._d
				}
				b.markerHover(mh)
				if(!mh) ui.gl.cursor(opt.cursor || 'text')
			} else ui.gl.cursor(opt.cursor || 'text')


			return 1
		}

		// release mouse
		b.r = function(){
			// merge b.dcs set into vcs set
			b.vcs.merge(b.dcs)
			ui.cap = 0
		}

		// keypress
		b.k = function(){
			// end mouse operation
			switch(ui.key.i){
				case 'a':
					if(ui.key.c || ui.key.m){
						// select all
						b.vcs.clear()
						cmc = b.vcs.new()
						cmc.u = cmc.v = 0
						cmc.y = b.lines.length - 1
						cmc.x = b.lines[cmc.y].length
						cmc.update()
					}
				break
				case 'c': // copy
					if(ui.key.c || ui.key.m) ui.gl.setpaste(b.vcs.copy())
				break
				case 'pgup':
					b.vcs.pgup(ui.key.s)
					b.vcs.remerge()
					if(b.vcs.cy) b.vcs.cy.view(2)
				break
				case 'pgdn':
					b.vcs.pgdn(ui.key.s)
					b.vcs.remerge()
					if(b.vcs.cv) b.vcs.cv.view(1)
				break
				case 'home':
					b.vcs.home(ui.key.s)
					b.vcs.remerge()
					if(b.vcs.cy) b.vcs.cy.view(2)
				break
				case 'end':
					b.vcs.end(ui.key.s)
					b.vcs.remerge()
					if(b.vcs.cv) b.vcs.cv.view(1)
					// move cursor to end
				break
				case 'down': // move all cursors down
					b.vcs.down(ui.key.s)
					b.vcs.remerge()
					if(b.vcs.cv) b.vcs.cv.view(1)
				break
				case 'up':
					b.vcs.up(ui.key.s)
					b.vcs.remerge()
					if(b.vcs.cy) b.vcs.cy.view(2)
				break
				case 'right':
					b.vcs.right(ui.key.s)
					b.vcs.remerge()
					if(b.vcs.cv) b.vcs.cv.view(1)
				break
				case 'left':
					b.vcs.left(ui.key.s)
					b.vcs.remerge()
					if(b.vcs.cy) b.vcs.cy.view(2)
				break;			
			}
		}
	}

	// |  drawing text structures
	// \____________________________________________/
	exports.drawing = function(b){
		// depends on vps, ssh, 
		b.drawText = function(){

			var s = b.sh.text
			s.use()
			s.set(ui.uniforms)
			s.sz(b.vps.sx, b.vps.sy, b.vps.sp * ui.gl.ratio,  (b.vps.oy - b.vps.sy <2) ? 0.5:0)
			s.b(b.font)

			var t = b.tvc || b.text.first()
			var h = (b.vps.o.h / b.vps.sy)
			if(t){ 
				while(t._u && t.y > (-b.vps.y)) t = t._u // scan up
				while(t._d && t.y < (-b.vps.y)-255) t = t._d // scan down
				b.tvc = t
			}
			while(t && b.vps.y + t.y  < h){
				s.ps(b.vps.x, b.vps.y + t.y, b.vps.o.x + b.vps.gx, b.vps.o.y + b.vps.gy)
				s.draw(t)
				t = t._d
			}
		}

		b.drawSelection = function(){
			var s = b.sh.select
			s.use()
			s.set(ui.uniforms)
			s.sz(b.vps.sx, b.vps.sy, b.vps.ss)
			s.ps(b.vps.x, b.vps.y, b.vps.o.x + b.vps.gx, b.vps.o.y + b.vps.gy)
			
			// draw markers
			var c = b.mcs.l.first()
			while(c){
				if(c.fg) s.fg(c.fg)
				else s.fg(ui.t.codeSelect)
				if(c.vb) s.draw(c.vb)
				c = c._d
			}					

			s.fg(ui.t.codeSelect)
			// visible selection
			var c = b.vcs.l.first()
			while(c){
				//if(c.fg) s.fg(c.fg)
				//else 
				if(c.vb) s.draw(c.vb)
				c = c._d
			}

			// draw selection
			var c = b.dcs.l.first()
			while(c){
				//if(c.fg) s.fg(c.fg)
				//else 
				//s.fg(ui.t.codeSelect)
				if(c.vb) s.draw(c.vb)
				c = c._d
			}


		}

		b.drawCursors = function(){
			var c = b.vcs.l.first()
			var s = b.sh.cursor
			while(c){
				s.rect(b.vps.o.x + b.vps.gx + (b.vps.x + c.x) * b.vps.sx, b.vps.o.y - b.vps.ss + (b.vps.y + c.y) * b.vps.sy + b.vps.gy, 1, b.vps.sy)
				c = c._d
			}

			// draw cursors
			var c = b.dcs.l.first()
			while(c){
				s.rect(b.vps.o.x + b.vps.gx + (b.vps.x + c.x) * b.vps.sx, b.vps.o.y - b.vps.ss + (b.vps.y + c.y) * b.vps.sy + b.vps.gy, 1, b.vps.sy)
				c = c._d
			}
		}

		b.drawLineMarks = function(){

			// visible line carets next to cursor
			var c = b.vcs.l.first()
			var s = b.sh.line
			while(c){
				s.rect(b.vps.o.x, b.vps.o.y - b.vps.ss + (c.y + b.vps.y) * b.vps.sy + b.vps.gy, b.vps.gx - 4, b.vps.sy )
				c = c._d
			}
			// visible line carets next to cursor
			var c = b.dcs.l.first()
			while(c){
				s.rect(b.vps.o.x, b.vps.o.y - b.vps.ss + (c.y + b.vps.y) * b.vps.sy + b.vps.gy, b.vps.gx - 4, b.vps.sy )
				c = c._d
			}
		}

		b.drawLines = function(){
			var s = b.sh.text
			s.use()
			s.set(ui.uniforms)
			s.sz(b.vps.ox, b.lvb.hy, b.vps.op, 0.5)
			s.b(b.font)
			s.ps(0, 0, b.vps.o.x, b.vps.o.y + b.vps.gy + b.lvb.ry)
			s.draw(b.lvb)
		}

		b.drawShadows = function(){
			// optionally draw a dropshadow
			if( b.vps.x != 0){
				b.sh.lrShadow.rect(b.vps.o.x , b.vps.o.y, 5, b.vps.o.h)
			}
			
			// optionally draw a top fade
			if( b.vps.y != 0){
				b.sh.topShadow.rect(b.vps.o.x, b.vps.o.y, b.vps.o.w, 5)
			}

			// right dropshadow
			if(b._h_.l == 1)
				b.sh.lrShadow.rect(b.vps.o.x + b.vps.o.w, b.vps.o.y, - 5, b.vps.o.h)
		}


		b.cursorUpdate = function(c){
			// fetch cursor coords, oriented
			var u = c.u, v = c.v, x = c.x, y = c.y
			var cf
			if(y <= v) u = c.x, v = c.y, x = c.u, y = c.v//, cf = 1
		
			// allocate enough vertexbuffer
			if(!c.vb || c.vb.$sc < (y-v + 1)){
				c.vb = b.sh.select.alloc( (y-v + 1) * 2, c.vb)
			}
			// set up locals
			var j = 0 // line counter
			var e = c.vb.e.a // 
			var r = c.vb.r.a
			var s = c.vb.e.s // stride
			var o = 0 // offset
			var xs
			var xe
			var p1 = NaN // previous x1
			var p2 = NaN // previous x2
			var pf = 0 // previous flags
			var po = 0 // previous offset
			c.vb.hi = 0 // reset vertexbuffer

			// we should start to find c.v from b.tvc
			var t = b.tvc || b.text.first()
			if(t){ 
				while(t._u && (t.y) > v) t = t._u  // scan up
				while(t._d && (t.y+t.l) < v) t = t._d  // scan down
			}

			while(t){
				var l = t.ll.length // chunk length
				var j = t.y
				// selection is in this textchunk
				if(y >= j && v <= j + l){
					var xt = 0
					// loop over text lines
					for(var i = fn.max(0, v - j); i + j <= y && i < l; i++){
								// set up rect coords
						var x1 = 0 
						var y1 = j + i
						var x2 = t.ll[i]
						var y2 = y1 + 1
						// adjust rect
						if(i + j == v) xs = x1 = fn.min(x2, u), /*fl && */t.ld && (c.d = t.ld[i]) // adjust begin at first line
						if(i + j == y) xe = x2 = fn.min(x2, x),xt = 1, /*!fl && */t.ld && (c.d = t.ld[i]) // adjust end at last line 
						else x2 += 1 // include newline
						if(v == y && x2 < x1) xs = x2 = x1, x1 = xe, xe = x2  // flip em

						// corner flagging
						var fl = 0, of = pf
						if(p1 == x1) fl += 1
						if(p1 >= x1 && x2 > p1) pf += 2
						if(p2 >= x2 && x2 > p1) fl += 4
						if(p2 <= x2) pf += 8
						// adjust old flags
						if(of != pf) for(var k = 0;k<6;k++, po += s) r[po] = pf

						po = o+3
						r[o] = x1, r[o+1] = y1, r[o+2] = x2, r[o+3] = fl,
						e[o] = x1, e[o+1] = y1, o += s
						r[o] = x1, r[o+1] = y1, r[o+2] = x2, r[o+3] = fl,
						e[o] = x2, e[o+1] = y1, o += s
						r[o] = x1, r[o+1] = y1, r[o+2] = x2, r[o+3] = fl, 
						e[o] = x1, e[o+1] = y2, o += s
						r[o] = x1, r[o+1] = y1, r[o+2] = x2, r[o+3] = fl,
						e[o] = x2, e[o+1] = y1, o += s
						r[o] = x1, r[o+1] = y1, r[o+2] = x2, r[o+3] = fl,
						e[o] = x1, e[o+1] = y2, o += s
						r[o] = x1, r[o+1] = y1, r[o+2] = x2, r[o+3] = fl,
						e[o] = x2, e[o+1] = y2, o += s
						pf = fl
						p1 = x1
						p2 = x2
						c.vb.hi++
					}
					if(xt) break
				}
				j += l
				t = t._d
			}
			// set our cursorpos to xs or xe
			if(c.y <= c.v) c.x = xs
			else c.x = xe
			if(c.vb.hi) c.vb.up = 1
		}

		b.linesUpdate = function(lncol){
			if(!b.lvb) b.lvb = b.sh.text.alloc(255 * 5)
			// get start/end
			var t = -b.vps.y
			// get skip value
			var k = Math.ceil(b.vps.oy / b.vps.sy)
			b.lvb.hy = k * b.vps.sy
			// round 
			var a = Math.floor(t / k)* k  + 1

			// compute y offset 
			b.lvb.ry = -(t - a + 1) * b.vps.sy

			// get fraction
			var l = fn.min(b.th+2, a + Math.ceil(b.vps.o.h / b.vps.sy) )

			// generate line vertexbuffer
			var e = b.lvb.e.a  // e array
			var f = b.lvb.fg.a // f array
			var s = b.lvb.e.s    // stride
			var o = 0      // offset
			b.lvb.hi = 0
			for(var i = a, y = 0; i < l; i += k, y++){
				var d = i // digits
				var x = 4
				while(d){
					e[o] = x | (y<<8) | b.font.t[ (d%10 + 48) - b.font.s ]
					f[o] = lncol
					b.lvb.hi++
					o += s
					x --
					d = Math.floor(d / 10)
				}
			}
			b.lvb.up = 1
		}
	}

	// |  text storage mgmt
	// \____________________________________________/
	exports.storage = function(b, blockSize){

		// initialize storage values
		blockSize = 250 * 20 || blockSize
		b.text = fn.list('_u', '_d')
		b.tw = 0
		b.th = 0
		b.tvc = null

		function allocNode(len){
			var v = b.text.last()
			// check if we can add the chunk
			if(!v || v.l > 250 || v.hi + len > blockSize){
				var x = 0
				if(v) x = v.x
				v = b.sh.text.alloc(blockSize)
				v.x = x
				v.y = b.th
				v.ll = [] // line length
				v.ld = [] // line data
				v.l = 0
				b.text.add(v)
			}
			return v
		}

		// adds textchunks
		b.addChunk = function(t, fg){
			// get the last buffer 
			var v = allocNode(t.length)
			// append t to the blk
			var e = v.e.a // element array
			var f = v.fg.a // foreground array
			var s = v.e.s // stride
			var o = v.hi * s // offset
			var a = 0
			var l = t.length
			for(var i = 0; i < l; i++){
				if(v.x < 255){
					var c = t.charCodeAt(i)
					e[o] = v.x | (v.l << 8) | b.font.t[c - b.font.s]
					f[o] = fg
					o += s
					a++
				}
				v.x++
			}
			v.hi += a
			v.up = 1
			return v
		}

		b.addTabs = function(num, stops, col){
			var v = allocNode(num)

			var e = v.e.a // element array
			var f = v.fg.a // foreground array
			var s = v.e.s // stride
			var o = v.hi * s // offset
			var y = v.l // ycoord
			var a = 0
			//tb = tb || 1
			for(var i = 0;i<num;i++){
				e[o] = i*stops | (y<<8) | b.font.t[127 - b.font.s]
				f[o] = col
				o += s
				a++
			}
			v.hi += a
			v.up = 1			
			v.x  = num*stops
			return v
		}

		// ends the current line
		b.endLine = function(data, ox){
			var v = b.text.last()
			v.ll[v.l] = arguments.length > 1 ? ox: v.x
			v.ld[v.l] = data
			if(v.x > b.tw) b.tw = v.x
			v.l ++
			b.th ++
			v.x = 0
		}

		// adds a color formatted chunk
		b.addFormat = function(t, colors){
			var v = allocNode(t.length)

			var e = v.e.a // element array
			var f = v.fg.a // foreground array
			var s = v.e.s // stride
			var o = v.hi * s // offset
			var x = v.x
			var y = v.l // ycoord
			var a = 0
			var l = t.length
			var fg = colors.def
			for(var i = 0;i<l;i++){
				if(x>255) break
				var c = t.charCodeAt(i)
				if(c == 12){ // use formfeed as color escape
					fg = colors[t.charAt(++i)] || colors.def
				} else if(c == 32){
					x++
				} else {
					e[o] = x | (y<<8) | b.font.t[c - b.font.s]
					f[o] = fg
					o += s
					a++
					x++
				}
			}
			v.x = x
			v.hi += a
			v.up = 1			
		}
		b.colors = "$LICARR3"
		// clears all text
		b.clearText = function(){
			var v = b.text.first()
			b.text.clear()
			b.tvc = null
			if(v){
				b.text.add(v)
				v.l = 0
				v.y = 0
				v.x = 0
				v.hi = 0
				v.up = true
			}
			b.tw = 0
			b.th = 0
		}

		// uses another storage
		b.setStorage = function(from){
			b.text = from.text
			b.lines = from.lines
			b.tvc = null
			b.tw = from.tw
			b.th = from.th
		}
	}

})