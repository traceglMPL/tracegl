// | Control behaviors |_________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define(function(require, exports){

	var ui = require("./ui")
	var fn = require("./fn")

	var cm = exports

	// |  button
	// \____________________________________________/
	cm.button = function(b){
		var d = 0
		function cl(){ // clicked
			if(d) return
			d = 1
			if(b.c_) b.c_()
		}
		function nr(){ // normal
			if(!d) return 
			d = 0
			if(b.n_) b.n_()
			return 1
		}
		b.p = function(){
			cl()
			ui.focus(b)
			ui.cap = b
			return 1
		}
		b.m = function(){
			if(ui.cap != b) return 1
			if(ui.isin(b)) cl()
			else nr()
			return 1
		}
		b.r = function(){
			if(ui.cap == b) ui.cap = 0
			if(nr() && ui.isin(b) && b.c) b.c(b)
		}

		b.k = function(){
			if(ui.key.i == 'space'){
				cl()
				nr()
				if(b.c) b.c(b)
			}
		}
	}

	// |  vertical scrollbar
	// \____________________________________________/
	cm.scroll = function(b, k, v){ // button knob vertical
 		var r // real move
		function ds(y){
			r += y
			var o = fn.clamp(r, 0, fn.max(b.ts - b.pg,0))
			if(o != b.mv){
				b.mv = o
				if(b.c) b.c()
				ui.redraw(b)
			}
		}

		b.ds = function(y){
			r = b.mv
			ds(y)
		}

		b.p = function(n){
			if(n != b) return // press event from child
			r = b.mv // one page up/down scrolling
			var l = ui.rel(k)
			ds( (((v?l.y:l.x)<0)?-1:1) * b.pg )
		}

		var x = 0
		var y = 0 // y of mouse
		k.p = function(){	
			ui.cap = k 
			x = ui.mx
			y = ui.my 
			r = b.mv 
			if(k.c_) k.c_()
		}
		k.m = function(){	
			if(ui.cap == k){
				var d = v?(ui.my - y):(ui.mx - x)
				ds( d * (b.ts / b.eval(v?'h':'w')) )
				x = ui.mx
				y = ui.my 
			}
			ui.gl.cursor('default')
			return 1
		}

		b.m = function(){
			ui.gl.cursor('default')
			return 1
		}
		k.r = function(){
			if(ui.cap == k){
				ui.cap = 0
				if(k.n_) k.n_()
			}
		}

		function hider(){
			if(b.pg >= b.ts) b.l = -1
			else b.l = 1
		}

		function mover(){
			if(b.move) b.move()
		}

		b.alias('mv', k, mover)
		b.alias('pg', k, hider)
		b.alias('ts', k, hider)

		b.mv = 0
	}

	// |  hor/vert slider
	// \____________________________________________/
	cm.slider = function(b, k, v){ // button knob vertical
		var r // real move
		function ds(y){
			r += y
			var o = fn.clamp(r, 0, 1)
			if(o != b.mv){
				b.mv = o
				if(b.c) b.c(b)
				ui.redraw(b)
			}
		}

		b.ds = function(y){
			r = b.eval('mv')
			ds(y)
		}
			
		b.p = function(n){
			if(n != b) return // press event from child
			//ui.focus(b)
			r = b.eval('mv') // one page up/down scrolling
			// grab slider
			var l = ui.rel(k)
			ds( (v?l.y:l.x)<0?-0.1:0.1 )
		}
		
		b.f_ = function(){
			if(!ui.cap && k.f_) k.f_()
		}
		
		b.u_ = function(){
			if(!ui.cap && k.u_) k.u_()
		}
		
		b.k = function(){
			switch(ui.key.i){
				case 'home': r = 0;ds(0); break
				case 'end': r = 1;ds(0); break
				case 'left':if(v)return;r = b.mv; ds(-0.1); break
				case 'right':if(v)return;r = b.mv; ds(0.1); break
				case 'up':if(!v)return; r = b.mv; ds(-0.1); break
				case 'down':if(!v)return; r = b.mv; ds(0.1); break
				default: return
			}
			return 1
		}

		var y = 0
		var x = 0
		k.p = function(){	
			if(ui.cap)	return
			ui.cap = k 
			ui.focus(b)
			y = ui.my 
			x = ui.mx
			r =  b.eval('mv')
			if(k.c_) k.c_()
			return 1
		}
		k.m = function(){	
			if(ui.cap == k){
				if(v)
					ds( (ui.my - y) / ( b.eval('h') - k.eval('h') ) )
				else
					ds( (ui.mx - x) / ( b.eval('w') - k.eval('w') ) )
				x = ui.mx
				y = ui.my 
			}
		}
		k.r = function(){
			if(ui.cap == k){
				ui.cap = 0
				if(k.n_) k.n_()
			}
		}

		b.alias('mv', k)
	}

	// |  list 
	// \____________________________________________/
	cm.list = function(b){
		var ty = 0 // total y
		
		function cs(){ // clamp scroller
			if(b._v_){
				var v = b._v_
				var pg = b.eval('h')
				var mv = fn.clamp(v.mv, 0,fn.max(ty - pg, 0))
				v.pg = pg
				v.ts = ty
				//v.set({ pg:pg, ts: ty })
				if(v.mv != mv) v.ds( mv - v.mv)
			}
		}

		b.a_ = function(n){ // node added
			if(n == b._v_) return // ignore the scrollbar
			n.y = ty
			ty += n.eval('h')
			if(b._v_) b._v_.set({ ts: ty })
		}

		b.r_ = function(n){ // node removed
			ty = n.y // old ypos
			var p = n._d // down
			while(p){ // run over DOM updating height
				p.y = ty//({ y1: ty })
				ty += p.eval('h')
				p = p._d
			}
			cs()
		}
		
		b.s = function(){ // mouse scroll
			if(b._v_) b._v_.ds(ui.mv)
		}

		b.v_ = function(){ // viewport changed
			cs()
		}
	}

	// |  selecting childnodes
	// \____________________________________________/
	cm.select = function(b){
		var s // selection

		function se(n){ // select
			if(s == n) return
			if(s && s.d_) s.d_()
			if(s && s.u_) s.u_()
			s = n
			if(ui.foc == b && s.f_)s.f_()
			if(s && s.s_) s.s_()
			if(!s) return
			// scroll-into-view in render
			var rm = ui.frame(function(){
				//fn('frame!')
				rm()
				var rb = ui.view(b)
				var rn = ui.view(n)
				var y = rn.y - rb.y
				//fn(y)
				if(y < 0) b._v_.ds( y )
				if(y + rn.h > rb.h) b._v_.ds( y - rb.h + rn.h )

				// selection node
				b.n = s
				if(b.c) b.c()
			})
		}
		b.sel = se

		b.f_ = function(){
			//if(!s) se(b._c)
			if(s && s.f_) s.f_()
		}

		b.u_ = function(){
			if(s && s.u_) s.u_()
		}

		// add selection handling
		b.m = 
		b.p = function(n){ // mouse press
			if(!ui.md || ui.cap) return
			ui.focus(b)
			if(s == n || b == n) return
			se(n)
			return 1
		}

		b.k = function(){
			if(!s) se(b._c)
			if(s && ui.key.i == 'up' && s._u) se(s._u)
			if(s && ui.key.i == 'down' && s._d) se(s._d)
			if(s && ui.key.i == 'pageup') se(ui.count(s, -10))
			if(s && ui.key.i == 'pagedown') se(ui.count(s,  10))
			if(s && ui.key.i == 'home') se(ui.first(s))
			if(s && ui.key.i == 'end') se(ui.last(s))
		}
	}
	
	// |  drag
	// \____________________________________________/
	cm.drag = function(b, c){
		var d
		var mx
		var my
		var sx 
		var sy
		c.p = function(){ // grab to start drag
			if(ui.bubble(c._p,'p')) return 1 // give parent option to capture first
			ui.cap = c
			mx = ui.mx, my = ui.my
			sx = b.x
			sy = b.y
			if(c.c_)c.c_()
			return 1
		}
		c.m = function(){
			if(ui.cap == c){
				ui.redraw(b)
				b.x = sx + ui.mx - mx
				b.y = sy + ui.my - my
				ui.redraw(b)
			}
		}
		c.r = function(){
			if(ui.cap == c){
				ui.cap = 0
				if(c.n_)c.n_()
			}
		}
	}

	// |  resize
	// \____________________________________________/
	cm.resize = function(b){
		var d
		var mx
		var my
		var bx
		var by
		var ov
		b.p = function(){ // grab to start drag
			if(bx || by){
				ui.cap = b
				mx = ui.mx
				my = ui.my
				ov = ui.view(b)
				return 1
			}
		}
		
		b.m = function(n){
			if(ui.cap == b){ // resize
				var dx = ui.mx - mx
				var dy = ui.my - my
				if(bx == 1) b.w = fn.min(b.maxw || 9999, fn.max(b.minw || 50, ov.w - dx)), b.x = ov.x - (b.w - ov.w)
				if(bx == 2) b.w = fn.min(b.maxw || 9999, fn.max(b.minw || 50, ov.w + dx))
				if(by == 1) b.h = fn.min(b.maxh || 9999, fn.max(b.minh || 50, ov.h - dy)), b.y = ov.y - (b.h - ov.h)
				if(by == 2) b.h = fn.min(b.maxh || 9999, fn.max(b.minh || 50, ov.h + dy))
				ui.redraw(b)				
				return
			}
			//if(n != b) return
			var v = ui.view(b)
			bx = ui.mx > v.x + v.w - 8 && ui.mx < v.x + v.w ? 2 : ui.mx < v.x + 8 && ui.mx >= v.x ? 1 : 0
			by = ui.my > v.y + v.h - 8 && ui.my < v.y + v.h ? 2 : ui.my < v.y + 5 && ui.my >= v.y ? 1 : 0
			var cx = ui.mx > v.x + v.w - 16 && ui.mx < v.x + v.w ? 2 : ui.mx < v.x + 16 && ui.mx >= v.x ? 1 : 0
			var cy = ui.my > v.y + v.h - 16 && ui.my < v.y + v.h ? 2 : ui.my < v.y + 16 && ui.my >= v.y ? 1 : 0
			if(cx && cy) bx = cx, by = cy
			if(bx){
				if(by) ui.cursor(bx == by?'nwse-resize':'nesw-resize')
				else ui.cursor('ew-resize')
			} else ui.cursor(by?'ns-resize':'default')
		}

		b.o = function(){
			ui.cursor('default')
		}
		
		b.r = function(){
			if(ui.cap == b) ui.cap = 0
			bx = by = 0
		}
	}

	// |  split 
	// \____________________________________________/
	cm.hSplit = function(b, d, v){ // background, divider, 
		var c = 0
		var n1
		var n2
		b.a_ = function(n){
			if(c == 0){
				n1 = n
				d.x = n1.w // position divider
			} else if (c == 1){
				n2 = n
				n2.x = d.x + d.w
				n2.w = 'p.w_ - n.x'
			}
			c++
		}

		b.v_ = function(){
			cv(n1.w)
		}

		function cv(w){
			if(w < b.minw) w = b.minw
			var sw = b.eval('w')
			if(sw - (w + d.w) < b.minw) w = sw - b.minw - d.w
			n1.w = d.x = w
			n2.x = d.x + d.w
		}

		var m
		var v
		d.p = function(){ // start grab
			ui.cap = d
			m = ui.mx
			v = d.x
			if(d.c_)d.c_()
		}

		d.m = function(){
			if(ui.cap == d){ // move our splitter bar
				// min width stored on both nodes
				cv(v + (ui.mx - m))
				ui.redraw(b)
			}
		}

		d.r = function(){
			ui.cap = 0
			if(d.n_)d.n_()
		}
	}

	// |  split 
	// \____________________________________________/
	cm.vSplit = function(b, d){ // background, divider, 
		var c = 0
		var n1
		var n2
		b.a_ = function(n){
			if(c == 0){
				n1 = n
				d.y = n1.h // position divider
			} else if (c == 1){
				n2 = n
				n2.y = d.y + d.h
				n2.h = 'p.h_ - n.y'
			}
			c++
		}

		function cv(h){
			if(h < b.minh) h = b.minh
			var sh = b.eval('h')
			if(sh - (h + d.h) < b.minh) h = sh - b.minh - d.h
			n1.h = d.y = h
			n2.y = d.y + d.h
		}

		// viewport resize
		b.v_ = function(){
			cv(n1.h)
		}

		var m
		var v
		d.p = function(){ // start grab
			ui.cap = d
			m = ui.my
			v = d.y
			if(d.c_)d.c_()
		}

		d.m = function(){
			if(ui.cap == d){ // move our splitter bar
				// min width stored on both nodes
				ui.redraw(b)
				cv(v + (ui.my - m))
			}
		}

		d.r = function(){
			if(d.n_)d.n_()
			ui.cap = 0
		}
	}
	// |  fold 
	// \____________________________________________/
	cm.fold = function(g){
		var b
	}

	// |  editing 
	// \____________________________________________/
	cm.edit = function(b, t, c, s, m){ // background, text, cursor, select, marked

		var cs = 0, ce = 0 // cursor / range

		function gc(){ // get cursor
			var m = ui.rel(t)
			var l = 0
			ui.text.pos(t, t.t.length, function(i, x, y){
				if((l+x)/2 > m.x){
					l = i - 1
					if(l<0)l = 0
					return 1
				}
				l = x
			})
			return l
		}
		
		function scr(){
			// scroll cursor into view
			var ps = ui.text.pos(t, cs)
			var pe = ui.text.pos(t, ce)
			var pt = ui.text.pos(t, t.t.length)
			var bv = ui.view(b)
			var tv = ui.view(t)
			tv.x -= b.xs
			var sw = t.b.m[32-t.b.s] / ui.gl.ratio
			var w = bv.w - sw - (tv.x - bv.x)
			if(pe.x > -b.xs + w)	b.xs = -(pe.x - w)
			if(pe.x < -b.xs - sw) b.xs = -pe.x -sw 
			if(pt.x < -b.xs + w && pt.x > w) b.xs += (-b.xs + w) - pt.x
		}

		b.v_ = function(){
			scr()
		}

		function mark(ms, me, re){
			if(me === undefined) me = ms  
			cs = fn.clamp(ms, 0, t.t.length)
			ce = fn.clamp(me, 0, t.t.length)
			var ps = ui.text.pos(t, cs)
			var pe = ui.text.pos(t, ce)
			scr()
			if(cs != ce){
				if(ps.x > pe.x){
					s.x = pe.x
					s.w = ps.x - pe.x
					m.t = t.t.slice(ce,cs)
				} else {
					s.x = ps.x
					s.w = pe.x - ps.x
					m.t = t.t.slice(cs,ce)
				}
				c.w = 0
			} else {
				c.x = ps.x
				c.y = ps.y - 1
				s.x = 0, s.w = 0
				c.w = 1
				m.t = ""
			}
			ui.redraw(b)
			// put m.t in 
		} 

		b.m = function(){
			// do selection
			ui.cursor('text')
			if(ui.cap != b) return 1
			mark(cs, gc())
			return 1
		}
		
		b.o = function(){
			ui.cursor('default')
		}

		var ct

		b.p = function(){
			if(!ui.cap)	ui.focus(b)
			var p = gc()
			if(ct && ct()< 500 && p>=fn.min(cs,ce) && p<= fn.max(cs,ce)){
				mark(0, t.t.length)
			} else {
				mark(p)
				ui.cap = b
			}
		}

		b.u = function(){
			var p = gc()
			for(var q = p;q<t.t.length;q++) if(t.t.charCodeAt(q) != 32) break
			for(var r = p;r>=0;r--) if(t.t.charCodeAt(r) != 32) break
			p = (p - r < q - p) ? r : q
			for(var e = p;e<t.t.length;e++) if(t.t.charCodeAt(e) == 32) break
			for(var s = p;s>=0;s--) if(t.t.charCodeAt(s) == 32) break
			mark(s+1,e)
			if(!ct) ct = fn.dt()
			else ct.reset()
		}

		b.r = function(){
			if(ui.cap == b) ui.cap = 0
		}

		// keyboard cursor relative
		function kcr(v){
			if(ui.key.s) mark(cs, ce + v) // shift is down
			else if(ce == cs)  mark(ce + v) // was 1 cursor
			else mark(v > 0 ? fn.max(ce,cs):fn.min(ce,cs))
		}

		// keyboard cursor absolute
		function kca(v){
			if(ui.key.s) mark(cs, v)
			else mark(v)
		}

		b.k = function(){
			var ms = fn.min(cs,ce)
			var me = fn.max(cs,ce)
			var last = b.t
			switch(ui.key.i){
			case 'up':
			case 'home': 
				kca(0)
				break
			case 'down':
			case 'end': 
				kca(t.t.length)
				break
			case 'right':
				kcr(1)
				break
			case 'left':
				kcr(-1)
				break
			case 'delete':
				b.t = t.t.slice(0,ms) + t.t.slice(ms == me ? me + 1 : me)
				mark(ms)
				break
			case 'backspace':
				if(ms != me || ms>0){
					if(ms == me){
						b.t = t.t.slice(0,ms - 1) + t.t.slice(me)
						kcr(-1)
					} else {
						b.t = t.t.slice(0,ms) + t.t.slice(me)
						mark(ms)
					}
				}
				break
			default:
				if(ui.key.m || ui.key.c){
					if(ui.key.i == 'a'){
						mark(0, t.t.length)
					}
					if(ui.key.i == 'v'){
						ui.gl.getpaste(function(v){
							b.t = t.t.slice(0,ms) + v + t.t.slice(me)
							mark(ms + v.length)
							ui.redraw()
							if(b.c) b.c(b)
						})
					}
					if(ui.key.i == 'c'){
						ui.gl.setpaste(m.t)
					}
					if(ui.key.i == 'x'){
						ui.gl.setpaste(m.t)
						b.t = t.t.slice(0,ms) + t.t.slice(me)
						mark(ms)
					}
				} else if(ui.key.h){
					b.t = t.t.slice(0,ms) + ui.key.v + t.t.slice(me)
					mark(ms + 1)
				}
				break
			}
			if(last != b.t && b.c) b.c(b)
			return ui.key.i!='tab'?1:0
		}
	}

	// |  slides 
	// \____________________________________________/
	cm.slides = function(b){
		var cp = 0
		var tp = 0 
		var vp = 0
		var np = 0

		ui.frame(function(){
			// easing
			if(tp < vp) tp += (vp-tp) / 10
			if(tp > vp) tp -= (tp-vp) / 10
			var w = ui.get(b, '_w')
			if(Math.abs(tp-vp)*w<1)tp = vp
			else { // keep animating
				ui.redraw()
			}
			var k = 0
			var p = b._c
			while(p){
				p.x = Math.round((k - tp) * w)
				k++
				p = p._d
			}
		})

		b.a_ = function(n){ // node added
			np++
		}

		b.k = function(){
			switch(ui.key.i){
			case 'home': 
				vp = 0
				break
			case 'end':
				vp = np - 1
				break
			case 'right':
				if(vp<np-1) vp++
				break
			case 'left':
				if(vp>0)	vp --
				break
			}			
		}
	}
})