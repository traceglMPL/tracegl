// | User Interface |___________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   
define(function(require){

	var gl = require("./gl")
	var fn = require("./fn")
	var el = require("./ext_lib")

	if(!gl) return { load:function(){} }
	var ui = {}

	ui.gl = gl
	ui.load = gl.load

	function ui(){}

	// |  DOM node API
	// \____________________________________________/
	var ex = {

		// coordinates
		x : 'x',
		y : 'y', 
		z : 'z',
		w : 'width', 
		h : 'height',
		d : 'depth',

		// Hooks
		i : 'in',
		o : 'out',
		p : 'press',
		m : 'move',
		r : 'release',
		s : 'scroll',
		k : 'key',
		j : 'joy',
		u : 'doubleclick',
		c : 'click or change', // primary widget event
		n : 'nodeselect', // node object

		// shaders
		v : 'vertex',
		f : 'frag',

		b : 'bitmap', // .bitmap used for fonts
		t : 'text',
		q : 'quick', // do shallow shader fingerprinting
		_ : 'destructor',
		e : 'extension lib',

		l : 'layer draw',
		g : 'group draw',

		a : 'cameramatrix',

		_g : 'groupid',

		// dom hyper tree
		_p : 'parent', 
		_c : 'child',
		_u : 'up',
		_d : 'down',
		_l : 'left',
		_r : 'right',
		_f : 'front',
		_b : 'back',
		// z order
		_z : 'zorder',

		_e : 'end', // last node added
		_t : 'type',
		
		// render
		_q : 'qbuf',
		_v : 'vb',
		_s : 'slot',
		_o : 'old slot lut',
		_k : 'old vb lut',
		_i : 'alloced slots',
		_n : 'numslots',
		_a : 'all child deps',

		_j : 'pushpopstack',

		__ : 'factory',

		// animation (0-9)
		a0 : 'animtime0',
		e0 : 'endevent0',
		i0 : 'interpolator0',

		// space transform
		_x : 'absx',
		_y : 'absy',
		_w : 'absw',
		_h : 'absh',

		// modality
		_m : 'modal',

		// padding
		x_ : 'padded x',
		y_ : 'padded y',
		w_ : 'padded w',
		h_ : 'padded h',
		m_ : 'matrix',

		// child events
		a_ : 'added',
		i_ : 'inserted',
		r_ : 'removed',

		// geom events
		v_ : 'view changed',

		// style events
		f_ : 'focussed',
		u_ : 'unfocussed',
		s_ : 'selected',
		d_ : 'deselected',
		c_ : 'clicked',
		n_ : 'normal',

		// control parts
		_h_ : 'horizontal scrollbar',
		_v_ : 'vertical scrollbar',

		// list nodes
		_0 : 'listc',
		_1 : 'list_c l',
		_2 : 'list_c r',
		_3 : 'list_i l',
		_4 : 'list_i r',
		_5 : 'list_t l',
		_6 : 'list_t r',
		_7 : 'alias key',
		_8 : 'alias object',

		// misc
		t_ : 'starttime',

		// temp
		n_ : 'old width',
		o_ : 'old height',
		g_ : 'old geometry'

	}

	var defaults = {
		i0 : el.i0,
		i1 : el.i1,
		i2 : el.i2,
		i3 : el.i3,
		i4 : el.i4,
		i5 : el.i5,
		i6 : el.i6,
		i7 : el.i7,
		i8 : el.i8,
		i9 : el.i9,
		x_ : 'n._x',
		y_ : 'n._y',
		w_ : 'n._w',
		h_ : 'n._h',
		x : 0,
		y : 0,
		w : 'p.w_ - n.x',
		h : 'p.h_ - n.y',
		_x : 'p.x_ + n.x',		
		_y : 'p.y_ + n.y',		
		_w : 'n.w',		
		_h : 'n.h',
		t : ''
	}

	// |  the DOM node
	// \____________________________________________/
	var node_vs = {};
	function Node(){
		this._p = ui.p
		if(this._p) l_i.add(this)
	}

	(function(p){

		p.set = function(g){
			var t = typeof g
			if(t == 'object') for(var k in g) this[k] = g[k]
			else if(t == 'function') {
				var p = ui.p
				ui.p = this
				g(this)
				ui.p = p
			}
			if(this._9){
				this.$$()
			}
		}

		p.eval = function(k){
			return gl.eval(this, this[k], uni, el)
		}

		p.alias = function(k, o, setCb){
			this.__defineSetter__(k, function(v){ 
				o[k] = v 
				if(setCb) setCb()
			})
			this.__defineGetter__(k, function(){ 
				return o[k] 
			})
		}

		p.has = function(k){
			return '$' + k in this
		}

		p.calc = function(k, c){
			this.__defineSetter__(k, function(v){ 
				delete this[k]
				this[k] = v
			})
			this.__defineGetter__(k, function(){ 
				return c()
			})
		}

		p.show = function(){
			if(!this.$l) return
			this.l = this.$l
			delete this.$l
			ui.redraw(this)
		}

		p.hide = function(){
			if(this.$l) return
			this.$l = this.l
			this.l = -1
			ui.redraw(this)
		}

		// group setter
		function gs(k){
			var pt = '$'+k
			p.__defineSetter__(k, function(v){
				// setting a group callback
				if(!(this._g in group)) group[this._g = parseInt(groupRnd() * 0xffffff)|0xff000000] = this
//				if(!(this._g in group)) group[this._g = groupId++|0xff000000] = this 
				this[pt] = v
			})
			p.__defineGetter__(k, function(){ return this[pt] })
		}

		gs('i')
		gs('m')
		gs('o')
		gs('p')
		gs('r')
		gs('s')

		function setvb(n, k, f){
			if(!n._v) return
			var v
			if(v = n._v[k]){
				var nm = n._i || 1
				v.t.w(f, v.a, n._s * v.s * v.l, v.l * nm, v.s)
				n._v.up = 1
			}
			// update child deps
			if(n._a) for(var m in n._a){
				ui.update(n._a[m])
			}
		}

		// animation setter
		function as(k){
			var pk = '$'+k
			var nk = 'N'+k
			node_vs[k] = 1
			p.__defineSetter__(k, function(v){
				if(!l_a[k]){
					var i = l_a_i[k]
					l_a[k] = fn.list('l' + i, 'r' + i)
					l_a[k].l = 'l' + i
 					l_a[k].r = 'r' + i
					l_a[k].e = 'e' + i
					l_a[k].t = 't' + i
				}
				this[l_a[k].t] = uni.u
				if(!l_a[k].has(this)) l_a[k].add(this)
				this[pk] = v
				setvb(this, nk, v)
			})
			p.__defineGetter__(k, function(){ return this[pk] || 0 })
		}

		// value setter
		function vs(k, d){
			var pk = '$'+k
			var nk = 'N'+k
			node_vs[k] = 1
			p.__defineSetter__(k, function(v){ 
			
				if(this._9){ // already initialized, check vb or call update
					var t = typeof this[pk]
					var y = typeof v
					this[pk] = v
					if(t == y && y == 'number'){
						setvb(this, nk, v)
					} else {
						this.$$()
					}
				} else this[pk] = v
				
			})
			p.__defineGetter__(k, function(){
				if(pk in this) return this[pk]
				if(k in defaults) return defaults[k]
				return d
			})
		}

		node_vs['_g'] = 1
		
		vs('f')
		vs('t')
		vs('x')
		vs('y')
		vs('w')
		vs('h')
		vs('x_')
		vs('y_')
		vs('w_')
		vs('h_')
		vs('_x')
		vs('_y')
		vs('_w')
		vs('_h')
		
		// hook regvar
		gl.regvar = function(k){
			if(k in node_vs) return
			vs(k, 0)
		}

		for(var i = 0;i<10;i++){
			as('a'+i)
			vs('t'+i, 0)
			vs('i'+i, 0)
		}

		// value getters and setters
	})(Node.prototype)

	// main theme texture
	var theme = gl.createTexture()
	ui.t = theme
	ui.theme = function(o){
		// create a palette on theme
		gl.palette(o, theme)
	}

	// |  baseclass for UI shader definitions
	// \____________________________________________/
	ui.shader = function(p){
		var d = {
			e: el,
			d: { // defines
				'P': '3.14159265358979323846264',
				'E': '2.71828182845904523536029'
			},
			u: { // uniforms
				T: 'sampler2D',
				l: 'vec2', // layer x/y
				s: 'vec2',  // screensize
				m: 'vec2',  // mouse
				t: 'float',  // time
				u: 'float'  // anim time
		 	},
		 	y: {
		 		N_b:'sampler2D',
		 		N_g:'ucol'
		 	},
		 	x:{
				f : {
					t : 'vec2',
					c : gl.ratio>1?'vec2(gl_FragCoord.x/2, s.y - gl_FragCoord.y/2)':'vec2(gl_FragCoord.x, s.y - gl_FragCoord.y)'
				}
		 	},
		 	s: {
		 		_: 0,
		 		g: 'n._g'
		 	},
		 	t: theme
		}
		// overload default shader with a deep copy
		for(var k in p){
			if(typeof p[k] == 'object'){
				if(!(k in d)) d[k] = {}
				var s = d[k]
				var u = p[k]
				for(var j in u) s[j] = u[j];
			}else d[k] = p[k]
		}
		return d
	}

	// |  nodelists
	// \____________________________________________/
	var l_i = fn.list('_3','_4')
	var l_t = fn.list('_5','_6') // permanent anims

	var l_a = {} // anims
	var l_a_i = {} // lookup table
	for(var i = 0;i < 10; i++) l_a_i['a'+i] = i

	var group = {}
	var groupRnd = fn.mt()
	var groupId = 1

	var root = new Node()
	root.l = 1
	root.x = 0
	root.y = 0
	root.w = 's.x'
	root.h = 's.y'
	root._m = 1
	root._x = 0
	root._y = 0
	root._w = 's.x'
	root._h = 's.y'

	ui.p = root
	ui.Node = Node

	// Initialize new domnodes
	function initnew(){
		// build up the DOM tree from init list,
		// call init function
		var t = l_i.len && fn.dt()
		var n = l_i.first()
		while(n){
			// build up DOM
			if(n._b){
				var p = n._b
				if(p._f) p._f._u = n, n._d = p._f
				p._f = n
				delete n._p	// back overrides parent
			} else if(n._p){
				var p = n._p
				if(p._e){
					n._u = p._e, p._e = p._e._d = n // append node
				} else p._c = p._e = n
				// call add event on parent
				if(p.a_) p.a_(n)
			}

			//automatic z = tree depth
			if(!n._z){
				var p = n._p || n._b
				var z = 0
				while(p && !p.l){ p = p._p || p._b; z++}
				n._z = z
			}

			// set up layering
			if(n.l){
				var p = n._p || n._b
				while(p && !p.l) p = p._p || p._b
				if(!p._0) p._0 = fn.list('_1', '_2')
				p._0.sorted(n,'_z')
			}

			// setup pickid
			if(!n._g){
				var p = n._p || n._b
				while(p){
					if(p._g){
						n._g = p._g
						break
					}
					p = p._p || p._b
				}
			}

			// call init function
			n.$$()

			n._9 = 1
			n = n._4
		}
		l_i.drop()

		if(t) t.log('initnew: ')
	}
	
	// | updates vertexbuffers
	// \____________________________________________/
	ui.update = function(n){
		if(!n._v) return
		//while(n._v.r) n._v = n._v.r // find last resize

		var vt = n._v.$vt
		var nm = n._i || 1
		for(var i in vt){
			var v = n._v[i]
			var ln = v.n // fetch lookup 
			if(ln){ // if we dont have a lookup, its an internal attribute
				var d = ln.d // scan up to depth * parents
				var k = ln.k // key on that node
				var p = n 
				while(d) p = p._p || p._b, d-- // go to parent
				if(p != n){ // mark our dependency on the parent
					if(!p._a) p._a = {}
					p._a[n] = n
				}
				if(k in p) v.t.w(p[k], v.a, n._s * v.s * v.l, v.l * nm, v.s) // use type write function
			}
		}
		n._v.up = 1
	}

	// | allocate vertexbuffers
	// \____________________________________________/
	ui.alloc = function(n, sh){
		// animation hook on t
		if(sh.$ud.t){
			if(!l_t.has(n)) l_t.add(n)
			gl.anim(ui.draw)
		} 
		else if(l_t.has(n)) l_t.rm(n)

		var v // vertex buffer
		var s = -1 // slot id
		var m = '_n' in  n ? n._n : 1
	
		// fingerprint texture references
		var tn = sh.$tn
		var id = sh.$id
		if(tn){
			for(var k in tn){
				var l = tn[k]
				var d = l.ld
				var p = n
				while(d>0) p = p._p || p._b, d--
				p = p[l.k]
				id += '|' + (p && p.id || 0)
			}
		}
		if(n._v && n._i != m){ // resize
			freenode(n)
		}
		if(!m) return
		if(n._v){
			if(n._v.$id != id){ // we have to switch
				if(n._s == n._v.hi - m || n._s == n._v.lo){ // can be removed from bottom
					if(n._k && n._k[n._v.$id]) delete n._k[n._v.$id] // dont keep in cache
					if(n._s == n._v.lo) n._v.lo += m
					else n._v.hi -= m
					n._v.$us -= m
					if(!n._v.$us) n._v.hi = n._v.lo = 0
				}
				else { // keep slot, but clear data
					n._t.clear(n) 
					var o = n._o || (n._o = {}) // slot by id
					var k = n._k || (n._k = {}) // written buffers by id
					o[n._v.$id] = n._s // cache old slot 
					k[n._v.$id] = n._v // cache old buffer
				}

				// cache lookup new
				if(n._k && (v = n._k[id])) n._s = s = n._o[id], n._v = v 

			} else v = n._v
		} else n._i = -1
		  
		if(!v){ // find/make new vertexbuffer
			var l = n // layer node
			while(!l.l){
				l = l._p || l._b // find it
				if(!l) throw new Error('trying to execute node without a container')
			}

			var z = l._q || (l._q = {}) // z list
			var d = n.l ? 0 : n._z // if we are a layer, our local z = 0
			var q = z[d] // queuebuffers
			if(!q){
				z[d] = q = {z:d}
				// build a z-sorted single linked list on the shader hash object
				var a = z.b
				var b
				while(a){
					if(a.z > d){ // insert between a and b
						if(b) b.d = q, q.d = a
						else z.b = q, q.d = a
						break
					}
					b = a
					a = a.d
				}
				if(!a){ // append end
					if(b) b.d = q
					else z.b = q
				}
			}

			if(!(v = q[id])){ // look up old vertexbuffer
				n._v = v = q[id] = sh.alloc(n.pool || 1) // create new one
				v.$id = id
				v.$n = n // store creating n
			}
			else n._v = v;

		} else s = n._s

		if(s < 0){ // alloc new slot
			n._i = m // store alloced size
			if(v.lo - m >= 0){ // alloc at bottom
				v.lo -= m
				v.$us += m
				s = n._s = v.lo
			} else { // alloc at top
				if(v.hi + m > v.$sc){ // used + num > number of slots
					n._v = v = q[id] = sh.alloc(fn.max(v.$sc * 2, v.$sc + m), v)
					v.$id = id
					v.$n = n
				}
				n._s = s = v.hi, v.hi += m, v.$us += m
			}
		}
	}

	// |  free layer render structs
	function freelayer(n){

		var q  = n._q
		for(var i in q){
			var qb = q[i]
			for(var k in qb) qb[k].sh.free(qb[k])
		}

		if(n._0) n._0.each(freelayer)
		// remove ourself from our parent layer
		var p = n._p || n._b
		while(!p.l) p = p._p || p._b
		p._0.rm(n)
	}

	// |  free non layer node render data
	function freenode(n){

		var v = n._v
		if(!v) return

		var m = n._i || 1

		v.$us -= m

		if(n._k && n._k[v.$id]) delete n._k[v.$id] // remove from cache
		if(n._s == v.hi - m){ // we are at the top 
			v.hi -= m
		} else if(n._s == v.lo) v.lo += m // at the bottom
		else n._t.clear(n) // else in the middle somewhere
		if(!v.$us) v.hi = v.lo = 0// no used left

		delete n._v
		delete n._s

		// drop us from all remaining cache buffers
		var k = n._k
		if(k) for(var i in k){
			var v = k[i]
			v.$us -= m
			if(!v.$us) v.hi = v.lo = 0
		}
		delete n._o
		delete n._k
	}

	// |  unhook node, leave all refs node->tree 
	function unhook(n){
		var p = n._p
		if(!p){
			p = n._b
			if(p && p._f == n) p._f = n._d
		} else {
			if(p._e == n) p._e = n._u
			if(p._c == n) p._c = n._d
		}
		if(n._u) n._u._d = n._d
		if(n._d) n._d._u = n._u
	}

	// |  remove (destroy) a dom node
	// \____________________________________________/
	ui.rm = function(n){
		// remove childnode
		unhook(n)
		// notify parent
		if(n._p && n._p.r_) n._p.r_(n)
		
		// optimally walk non layer tree
		var i = n
		do {
			if(i.l) freelayer(i)
			else freenode(i)

			if(!i.l && i._c) i = i._c
			else if(i._f) i = i._f
			else if(i != n && i._d) i = i._d
			else {
				while(i && !i._d && i != n) i = i._p || i._b
				if(i != n) i = i._d
			}
		}
		while(i != n)

		// walk entire tree and remove from all lists
		var i = n
		do {
			if(i._) i._()
			if(i._g in group) delete group[i._g]
			//if(l_k.has(i)) l_k.rm(i)
			if(l_t.has(i)) l_t.rm(i)
			for(var k in l_a)	if(l_a[k].has(i))	l_a[k].rm(i)

			if(i._c) i = i._c
			else if(i._f) i = i._f
			else if(i != n && i._d) i = i._d
			else {
				while(i && !i._d && i != n) i = i._p || i._b
				if(i != n) i = i._d
			}
		}
		while(i != n)

		// remove tree refs
		delete n._u
		delete n._d
		//delete n._p
		//delete n._b
	}

	// |  count relative
	// \____________________________________________/
	ui.count = function(n, c){
		if(c>0){
			while(c && n._d) n = n._d, c--
		} else {
			while(c && n._u) n = n._u, c++
		}
		return n
	}

	// |  first item
	// \____________________________________________/
	ui.first = function(n){
		return n._p._c
	}

	// |  last item
	// \____________________________________________/
	ui.last = function(n){
		while(n._d) n = n._d
		return n
	}

	// | move layer to top
	// \____________________________________________/
	ui.top = function(n){
		if(!n.l) throw new Error("cannot top non layer node")
		// find parent layer
		var p = n._p || n._b
		while(p && !p.l) p = p._p || n._b
		if(!p._0) p._0 = fn.list('_1', '_2')
		if(p._0.has(n)) p._0.rm(n)
		p._0.add(n)
	}

	ui.modal = fn.stack()
 	ui.modal.push(root)

	// |  ask modal control
	// \____________________________________________/
 	ui.pushmodal = function(n){
 		ui.modal.top()._m = 0
 		ui.modal.push(n)
 		n._m = 1
 	}

	// |  release last modal
	// \____________________________________________/
 	ui.popmodal = function(){
 		var n = ui.modal.pop()
 		n._m = 0
 		ui.modal.top()._m = 1
 	}

	// |  keyboard focus
	// \____________________________________________/
	ui.focus = function(n){
		if(ui.foc == n) return
		if(ui.foc && ui.foc.u_) ui.foc.u_(n)
		if(n && n.f_) n.f_(ui.foc)
		ui.foc = n
	}

	// |  focus next item
	// \____________________________________________/
	ui.focus_next = function(){
		var n = ui.foc._d
		while(n){
			if(n.f_){ ui.focus(n); return;}
			n = n._d
		}
		if(!n) n = ui.foc._p._c 
		while(n){
			if(n.f_){ ui.focus(n); return;}
			n = n._d
		}
	}

	// |  focus previous item
	// \____________________________________________/
	ui.focus_prev = function(){
		var n = ui.foc._u
		while(n){
			if(n.f_){ ui.focus(n); return;}
			n = n._u
		}
		if(!n){
			n = ui.foc._p._c
			while(n._d) n = n._d
		}
		while(n){
			if(n.f_){ ui.focus(n); return;}
			n = n._u
		}
	}
	
	ui.key = {}

	gl.keydown(function(){
		ui.key = gl.key
		if(ui.keydown) ui.keydown()
		if(!ui.foc) ui.foc = root._c
		if(ui.foc){
			if(!ui.bubble(ui.foc, 'k')){
				if(ui.key.i == 'tab'){
					if(!ui.key.s) ui.focus_next()
					else ui.focus_prev()
				}
			}
			gl.anim(ui.draw)
		}
	})

	// |  event bubble
	// \____________________________________________/
	ui.bubble = function(n, e){
		//check if there is a modal flag in the parent chain 
		var p = n
		while(p){
			if(p._m) break
			p = p._p || p._b
		}
		if(!p) return
		if(n[e]){
			if(typeof n[e] == 'object') { 
				n.set(n[e])
				return 1
			} else if(n[e](n)) return 1
		}
		var p = n._p
		while(p){
			if(p[e] && p[e](n)) return 1
			p = p._p
		}
	}
	ui.cursor = gl.cursor

	// |  view computation
	// \____________________________________________/
	ui.view = function(n, v){ // node, left top bottom right
		v = v || {}
		v.x = gl.eval(n, n._x, uni, el),
		v.y = gl.eval(n, n._y, uni, el),
		v.w = gl.eval(n, n._w, uni, el),
		v.h = gl.eval(n, n._h, uni, el)
		return v
	}
	// |  view computation
	// \____________________________________________/
	ui.inner = function(n, v){ // node, left top bottom right
		v = v || {}
		v.x = gl.eval(n, n.x_, uni, el),
		v.y = gl.eval(n, n.y_, uni, el),
		v.w = gl.eval(n, n.w_, uni, el),
		v.h = gl.eval(n, n.h_, uni, el)
		return v
	}
	// |  mouse is in the rect
	// \____________________________________________/
	ui.isin = function(n){
		var r = ui.map(n)
		return !(r.x < 0 || r.x > 1 || r.y < 0 || r.y > 1)
	}

	// |  get mouse remapped to a node
	// \____________________________________________/
	ui.map = function(n, l, t, r, b){ // node, left top right bottom
		var v = ui.view(n)

		if(l) v.x += l
		if(t) v.y += t
		if(r) v.w -= r
		if(b) v.h -= b
		
		return {
			x:(ui.mx - v.x) / v.w,
			y:(ui.my - v.y) / v.h
		}
 	}

	// |  get the mouse relative to a node
	// \____________________________________________/
	ui.rel = function(n){ // node, left top right bottom
		var v = ui.view(n)
		return {
			x:ui.mx - v.x,
			y:ui.my - v.y
		}
 	}

	// |  clip stuff
	// \____________________________________________/
 	ui.clip = function(x, y, w, h, x1, y1, x2, y2){
 		if(arguments.length>4){
			if(x > x1) x1 = x
			if(y > y1) y1 = y
			if(x + w < x2) x2 = x + w
			if(y + h < y2) y2 = y + h
			gl.scissor(x1, (gl.height - (y2)) , x2 - x1, y2 - y1 )
 		} else {
	 		gl.scissor(x, (gl.height - y - h) , w < 0 ? 0: w, h < 0 ? 0: h )
	 	}
 	}

	// |  mouse handling
	// \____________________________________________/
	var md // mousedown
	var ms // mousescroll
	var lp // last pick
	var le // last edge
	var dc // dbclick

	// |  rendering
	// \____________________________________________/
	var dt = fn.dt()
	var uni = {s:{},m:{},l:{}}
	ui.uniforms = uni
	update_uni()

	// |  update uniforms
	function update_uni(){
		uni.t = uni.u = dt() / 1000
		uni.l.x = 0
		uni.l.y = 0
		uni.s.x = gl.width / gl.ratio
		uni.s.y = gl.height / gl.ratio
		uni.m.x = ui.mx
		uni.m.y = ui.my
	}

	var dirty = {}

	// |  draw the layer tree
	function drawLayer(n, x1, y1, x2, y2){

		var v = n.g_ || (n.g_ = {})
		v.x = gl.eval(n, n._x, uni, el)
		v.y = gl.eval(n, n._y, uni, el)
		v.w = gl.eval(n, n._w, uni, el)
		v.h = gl.eval(n, n._h, uni, el)

		if(v.x > x1) x1 = v.x
		if(v.y > y1) y1 = v.y
		if(v.x + v.w < x2) x2 = v.x + v.w
		if(v.y + v.h < y2) y2 = v.y + v.h
		// if we have no area left, bail
		if(x1 >= x2) return
		if(y1 >= y2) return

		if(n.v_ && (n.n_ != v.w || n.o_ != v.h)){
			n.v_() // viewport changed event
			n.n_ = v.w, n.o_ = v.h
		}
		gl.scissor(x1*gl.ratio, (gl.height - (y2*gl.ratio)) , (x2 - x1)*gl.ratio, (y2 - y1)*gl.ratio )

		var q = n._q
		if(q){
			var z = q.b
			while(z){
				var sh
				var b
				for(var k in z) if(sh = (b = z[k]).$sh){
					
					sh.use()
					sh.n(b.$n)
					sh.set(uni)
					sh.draw(b)
				} 
				z = z.d
			}
		}

		if(n.l !== 1) n.l(x1, y1, x2, y2)
		var q = n._0 && n._0.first()
		while(q){
			if(q.l !== -1) drawLayer(q, x1, y1, x2, y2)
			q = q._2
		}
	}

	// |  draw group IDs
	function drawGroupID(n){
		var vx1 = gl.eval(n, n._x, uni, el)
		var vy1 = gl.eval(n, n._y, uni, el)
		var vx2 = vx1 + gl.eval(n, n._w, uni, el)
		var vy2 = vy1 + gl.eval(n, n._h, uni, el)		
		if(ui.mx >= vx1 && ui.my >= vy1 && ui.mx < vx2 && ui.my < vy2){

			var q = n._q
			if(q){
				var z = q.b
				while(z){
					var sh
					var b
					for(var k in z) if(sh = (b = z[k]).$sh){
						sh.use('g')
						sh.n(b.$n)
						sh.set(uni)
						sh.draw(b)
					} 
					z = z.d
				}
			}
			if(n.g) n.g(n)
			var q = n._0 && n._0.first()
			while(q){
				if(q.l !== -1) drawGroupID(q)
				q = q._2
			}	
			//if(n._0) n._0.each(drawGroupID)
		}
	}

	ui.frame = fn.ps()
	var renderTime = fn.dt()
	var pv = new Uint8Array(4)
	ui.move = true
	// |  render UI
	// \____________________________________________/
	ui.draw = function(){
		renderTime.reset()		
		//dc = 0
		initnew()
		ui.frame()
		ui.ms = gl.ms
		// mouse shortcuts
		ui.mx = ui.ms.x, ui.my = ui.ms.y
		ui.mh = ui.ms.h, ui.mv = ui.ms.v
		update_uni()
		//gl.clearColor(0,1,0,0)
		//gl.colorMask(true, true, true, true)
		//gl.clear(gl.COLOR_BUFFER_BIT)
		//gl.colorMask(true, true, true, false)
		gl.disable(gl.BLEND)
	
		// lets draw a 1 pixel window under the mouse for group id
		if(ui.cap){
			var n = ui.cap
		} else {
			if(ui.debug) gl.disable(gl.SCISSOR_TEST)
			else gl.enable(gl.SCISSOR_TEST)
			//var mv = true
			var sx = 0, sy = gl.height - 1
			if(!ui.move){
				sx = ui.mx
				sy = gl.height - ui.my - 1
			}
				
			//gl.scissor(0, gl.height-1, 1, 1)
			gl.scissor(sx, sy, 2, 2)

			// displace everything by the mouse cursor
			if(!ui.move){
				uni.l.x = 0
				uni.l.y = 0
			} else {
				uni.l.x = -ui.mx
				uni.l.y = -ui.my
			}			

			drawGroupID(root)
			// read pixel for picktest
			gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pv)
			var n = group[(pv[3]<<24) | (pv[2]<<16) | (pv[1]<<8) | pv[0]]
		}

		uni.l.x = uni.l.y = 0

		try{ // catch all exceptions in events

			// implement in/out
			if(lp != n){
				if(lp) ui.bubble(lp, 'o')
				if(n) ui.bubble(n, 'i')
				lp = n
			}

			// implement move
			if(n){// && (lm_x != gl.mouse_x || lm_y != gl.mouse_y)){
				// dont sendmove when  we will send release
				if(md || !le) ui.bubble(n, 'm')
			}

			// implement press/release
			if(!md && le){
				if(le) ui.bubble(le, 'r')
				le = null
			} else if(md == 1){
				if(le) ui.bubble(le, 'r')
				le = n
				if(le) ui.bubble(le, 'p')
				md = 2
			}
			// dblclick
			if(dc && n){
				ui.bubble(n, 'u')
				dc = 0
			}

			// implement scroll
			if(ms && n){
				ui.bubble(n, 's')
				ms = 0
			}

		} catch(e){
			var err = e
		}

		if(dirty.x1 !== Infinity){
			// render UI
			gl.colorMask(true, true, true, true)
			gl.enable(gl.BLEND)
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
			gl.enable(gl.SCISSOR_TEST)
			//gl.disable(gl.SCISSOR_TEST)
			drawLayer(root,dirty.x1,dirty.y1,dirty.x2,dirty.y2)
		}
		// animation handling
		var e = null
		dirty.y1 = dirty.x1 = Infinity
		dirty.y2 = dirty.x2 = -Infinity

		for(var k in l_a){
			var _a = k
			var _t = l_a[k].t
			var _r = l_a[k].r
			var _e = l_a[k].e
			n = l_a[k].first()
			while(n){
				if(uni.u >= n[_t] + Math.abs(n[_a])){
					var m = n[_r]
					l_a[k].rm(n)
					//delete n[_a]
					if(n[_e]){
						e = n[_e]
						delete n[_e]
						n.set(e)
					}
					n = m
					//n = l_a[k].first()
				} else {
					ui.redraw(n)
					n = n[_r]
				} 
			}
			if(l_a[k].len) e = 1
		}
		if(e || l_t.len){
			if(l_t.len > 0)	ui.redraw()
			gl.anim(ui.draw)
		}
		if(err) throw err
		//document.title = renderTime()
	}

	// |  do automatic rendering
	// \____________________________________________/
	ui.drawer = function(){
		ui.redraw()
		gl.mouse_p(function(){ md = 1, ui.md = 1,gl.anim(ui.draw) })
		gl.mouse_m(function(){ gl.anim(ui.draw) })
		gl.mouse_r(function(){ md = 0, ui.md = 0, gl.anim(ui.draw) })
		gl.mouse_s(function(){
			ms = 1, gl.anim(ui.draw) 
		})
		gl.mouse_u(function(){ dc = 1, gl.anim(ui.draw) })
		return gl.resize(function(){
			ui.redraw()
		})
	}	

	// |  force a redraw
	// \____________________________________________/
	ui.redraw = function(n){
		while(n && !n.g_) n = n._p
		if(!n){
			dirty.y1 = 0
			dirty.x1 = 0
			dirty.x2 = gl.width
			dirty.y2 = gl.height
		} else {
			var v = n.g_
			if(v.x < dirty.x1) dirty.x1 = v.x
			if(v.y < dirty.y1) dirty.y1 = v.y
			var x2 = v.x + v.w
			var y2 = v.y + v.h
			if(x2 > dirty.x2) dirty.x2 = x2
			if(y2 > dirty.y2) dirty.y2 = y2
		}
		gl.anim(ui.draw)
	}
	// |  force a redraw
	// \____________________________________________/
	ui.redrawRect = function(x, y, w, h){
		if(x < dirty.x1) dirty.x1 = x
		if(y < dirty.y1) dirty.y1 = y
		var x2 = x + w
		var y2 = y + h
		if(x2 > dirty.x2) dirty.x2 = x2
		if(y2 > dirty.y2) dirty.y2 = y2
		gl.anim(ui.draw)
	}
	
	// |  dump
	// \____________________________________________/
	ui.dump = function(n, dv){
		var s = ''
		fn.walk(n, null, function(n, z){
			s += Array(z + 1).join(' ') + n._t._t

			// lets build up our vertexbuffers
			if(n._v){
				var vb = n._v
				if(n.t) s += " t:" + n.t
				var nm = n._i || 1
				if(dv)
				for(var i in vb.vv){
					var v = vb.vv[i]
					s += " " + i + "=" + v.t.r(v.a, n._s * v.s, vb.sl * nm, v.s)
				}
			}
			s += '\n'
		})
		fn(s)
	}

	// primitives
	require('./ui_draw')(ui)

	return ui
})
