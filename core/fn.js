// | Function, utility lib|_____________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/  

define(function(){

	if(console.log.bind)
		var fn = console.log.bind(console)
	else 
		var fn = function(){
			var s = ''
			for(var i = 0;i<arguments.length;i++) s+= (s?', ':'')+arguments[i]
			console.log(s)
		}

	fn.list     = list
	fn.stack    = stack

	fn.ps       = ps

	fn.wait     = wait
	fn.repeat   = repeat
	fn.events   = events

	fn.dt    	= dt
	fn.mt       = mt
	fn.sha1hex  = sha1hex
	fn.rndhex 	= rndhex
	fn.tr       = tr
	fn.dump     = dump
	fn.walk		= walk

	fn.min      = min
	fn.max      = max
	fn.clamp    = clamp
	fn.nextpow2 = nextpow2

	fn.named    = named

	// |  named arguments
	// \____________________________________________/
	function named(a, f){
		var t = typeof a[0]
		if(t == 'function' || t== 'object') return t
		if(!f) f = named.caller
		if(!f._c) f._c = f.toString()
		if(!f._n) f._n = f._c.match(/function.*?\((.*?)\)/)[1].split(',')
		var n = f._n
		if(a.length > n.length) throw new Error("Argument list mismatch, "+a.length+" instead of "+n.length)
		var g = {}
		for(var i = 0, j = a.length;i<j;i++) g[n[i]] = a[i]
		return g
	}


	// |  left right linked list 
	// \____________________________________________/
	function list(l, r){ 
//		var u // unique id/
//		var f // free slot 
		var b // begin
		var e // end

		function li(){
			return li.fn.apply(0, arguments)
		}

		li.fn = function(a){
			if(arguments.length > 1){
				var rm = {}
				for(var i = 0, j = arguments.length; i<j; i++) li.add(rm[i] = arguments[i])
				return function(){
					for(var i in rm) li.rm(rm[i])
					rm = null
				}
			} 
			li.add(a)
		   return function(){
				if(a) li.rm(a)
				a = null
			}
		}

		var ln = 0
		li.len = 0
		li.add = add
		li.rm  = rm
		
		li.clear = function(){
			var n = b
			while(n){
				var m = n[r]
				delete n[r]
				delete n[l]
				n = m
			}
			b = e = undefined
			li.len = ln = 0
		}

		li.drop = function(){
			b = e = undefined
			li.len = ln = 0
		}

		//|  add an item to the list
		function add(i){
		
			if(arguments.length > 1){
				for(var i = 0, j = arguments.length; i<j; i++) add(arguments[i])
				return ln
			}
			// already in list
			if( l in i || r in i || b == i) return ln

			if(!e) b = e = i
			else e[r] = i, i[l] = e, e = i

			li.len = ++ln
			if(ln == 1 && li.fill) li.fill()
			return ln
		}

		//|  add a sorted item scanning from the  end
		li.sorted = function(i, s){
			if( l in i || r in i || b == i) return ln
			var a = e
			while(a){
				if(a[s] <= i[s]){ // insert after a
					if(a[r]) a[r][l] = i, i[r] = a[r]
					else e = i
					i[l] = a
					a[r] = i
					break
				}
				a = a[l]
			}
			if(!a){ // add beginning
				if(!e) e = i
				if(b) i[r] = b, b[l] = i
				b = i
			}

			li.len = ++ln
			if(ln == 1 && li.fill) li.fill()
			return ln
		}


		//|  remove item from the list
		function rm(i){
			if(arguments.length > 1){
				for(var i = 0, j = arguments.length; i<j; i++) rm(arguments[i])
				return ln
			}

			var t = 0
			if(b == i) b = i[r], t++
			if(e == i) e = i[l], t++ 
			if(i[r]){
				if(i[l]) i[r][l] = i[l]
				else delete i[r][l]
				t++
			}
			if(i[l]){
				if(i[r]) i[l][r] = i[r]
				else delete i[l][r]
				t++
			}
			if(!t) return
			delete i[r]
			delete i[l]

			//if(!e && f) freeid()
			li.len = --ln

			if(!ln && li.empty) li.empty()
			return ln
		}

		//|  run all items in the list
		li.run = function(){
			var n = b, t, v
			while(n) v = n.apply(null, arguments), t = v !== undefined ? v : t, n = n[r]
			return t
		}

		//|  iterate over all items
		li.each = function(c){
			var n = b
			var j = 0
			var t 
			while(n) {
				var x = n[r]
				v = c(n, li, j)
				if(v !== undefined) t = v
				n = x, j++
			}
			return t
		}
		
		//|  check if item is in the list
		li.has = function(i){
			return l in i || r in i || b == i
		}

		li.first = function(){
			return b
		}

		li.last = function(){
			return e
		}

		return li
	}

	// |  apply event pattern to object
	// \____________________________________________/
	function events(o){

		o.on = function(e, f){
			var l = this.$l || (this.$l = {})
			var a = l[e]
			if(!a) l[e] = f
			else{
				if(Array.isArray(a)) a.push(event)
				else l[e] = [l[e], f]
			}
		}

		o.off = function(e, f){
			var l = this.$l || (this.$l = {})
			if(!l) return
			var a = l[e]
			if(!a) return
			if(Array.isArray(a)){
				for(var i = 0;i<a.length;i++){
					if(a[i] == f) a.splice(i,1), i--
				}
			}
			else if (l[e] == f) delete l[e]
		}

		o.clear = function(e, f){
			var l = this.$l 
			if(!l) return
			delete l[e]
		}

		o.emit = function(e){
			var l = this.$l
			if(!l) return
			var a = l[e]
			if(!a) return
			if(arguments.length>1){
				var arg = Array.prototype.slice.call(arguments, 1)
				if(typeof a == 'function') a.apply(null, arg)
				else for(var i = 0;i<a.length;i++) a[i].apply(null, arg)
			} else {
				if(typeof a == 'function') a()
				else for(var i = 0;i<a.length;i++) a[i]()
			}
		}
	}

	// |  simple fixed integer stack
	// \____________________________________________/
	function stack(){
		function st(){
			return st.fn.apply(null, arguments)
		}

		st.fn = function(a){
			if(arguments.length > 1){
				var rm = {}
				for(var i = 0, j = arguments.length; i<j; i++) rm[push(arguments[i])] = 1
				return function(){
					for(var i in rm) st.rm(i)
					rm = null
				}
			} else {
				var i = push(a)
				return function(){
					if(i !== undefined) st.rm(i)
					i = undefined
				}
			}
		}

		st.push  = push
		st.shift = shift
		st.set   = set
		//|  length of the stack, externals are readonly
		var b = st.beg = 1
		var e = st.end = 1
		var l = st.len = 0

		//|  return item on bottom of stack
		st.bottom = function(){
			if(b == e) return null
			return st[b]
		}
	  
		//|  item on the top of the staci
		st.top = function(){
			if(b == e) return null
			return st[e]
		}

		//|  push item to the top of the stack
		function push(a){
			if(arguments.length > 1){
				var r 
				for(var i = 0, j = arguments.length; i<j; i++) r = push(arguments[i])
				return r 
			}

			st[e++] = a, st.len = ++l
			return (st.end = e) - 1
		}
		//|  pop item from the top of the stack
		st.pop = function(){
			var p = st[e - 1]
			if(b != e){	
				delete st[e]
				while(e != b && !(e in st)) e --
				if(!--l) st.beg = st.end = b = e = 1 // cancel drift
				st.len = l
			} else b = e = 1, st.len = l = 0
			st.end = e
			return p
		}

		//|  insert item at the bottom of the stack
		function shift(a){
			if(arguments.length > 1){
				var r 
				for(var i = 0, j = arguments.length; i<j; i++) r = push(arguments[i])
				return r 
			}

			st[--b] = a, st.len = ++l
			return st.beg = b
		}
	  
		//|  remove item at the bottom of the stack
		st.unshift = function(){
			if(b != e){	
				delete st[b]
				while(b != e && !(b in st)) b++
				if(!--l) st.beg = st.end = b = e = 1
				st.len = l
			}
			return st.beg
		}

		//|  set an item with a particular index
		function set(i, v){
			if(arguments.length > 2){
				var r
				for(var i = 0, j = arguments.length; i<j; i+=2) r = add(arguments[i], arguments[i+1])
				return r 
			}
			st[i] = v
			if(i < b) st.beg = b = i
			if(i >= e) st.end = e = i + 1
			return i
		}

		//|  remove item with particular index
		st.rm = function(i){
			if(!i in st) return
			delete st[i]
			if(!--l) {
				st.len = 0
				st.beg = st.end = b = e = 1
				return i
			}
			st.len = l
			if(i == b) while(b != e && !(b in st)) st.beg = ++b
			if(i == e) while(e != b && !(e in st)) st.end = --e
			return i
		}

		//|  iterate over all items in the stack
		st.each = function(c){
			var r 
			var v
			for(var i = b; i < e; i++){
				if(i in st){
					v = c(st[i], st, i) 
					if(v !== undefined) r = v
				}
			}
			return v
		}

		return st
	}
	// | create a random hex string
	// \____________________________________________/
	function rndhex(n){
		var s = ""
		for(var i = 0;i<n;i++) s += parseInt(Math.random()*16).toString(16)
		return s.toLowerCase()
	}	

	// |  pubsub for all your event needs
	// \____________________________________________/
	function ps(il, ir){

		var li = list(il || '_psl', ir || '_psr')
		var of = li.fn
		li.fn = function(i){
			if(arguments.length == 1 && typeof i == 'function') return of(i) // pubsub
			return li.run.apply(null, arguments) // otherwise forward the call to all 
		}
		return li
	}

	// |  mersenne twister 
	// |  Inspired by http://homepage2.nifty.com/magicant/sjavascript/mt.js
	// \____________________________________________/
	function mt(s, h){ // seed, itemarray or hash
		if (s === undefined) s = new Date().getTime();
		var p, t
		if(h){
			p = {}
			var j = 0
			for(var i in h) p[j++] = h[i]
			t = j			
		}
		m = new Array(624)
		
		m[0] = s >>> 0
		for (var i = 1; i < m.length; i++){
			var a = 1812433253
			var b = (m[i-1] ^ (m[i-1] >>> 30))
			var x = a >>> 16, y = a & 0xffff
			var c = b >>> 16, d = b & 0xffff;
			m[i] = (((x * d + y * c) << 16) + y * d) >>> 0			
		}
		var i = m.length

		function nx(a) {
			var v
			if (i >= m.length) {
				var k = 0, N = m.length, M = 397
				do {
					v = (m[k] & 0x80000000) | (m[k+1] & 0x7fffffff)
					m[k] = m[k + M] ^ (v >>> 1) ^ ((v & 1) ? 0x9908b0df : 0)
				} while (++k < N - M)
				do {
					v = (m[k] & 0x80000000) | (m[k+1] & 0x7fffffff)
					m[k] = m[k + M - N] ^ (v >>> 1) ^ ((v & 1) ? 0x9908b0df : 0)
				} while (++k < N - 1)
				v = (m[N - 1] & 0x80000000) | (m[0] & 0x7fffffff)
				m[N - 1] = m[M - 1] ^ (v >>> 1) ^ ((v & 1) ? 0x9908b0df : 0)
				i = 0
			}
			
			v = m[i++]
			v ^= v >>> 11, v ^= (v << 7) & 0x9d2c5680, v ^= (v << 15) & 0xefc60000, v ^= v >>> 18
			if(a!==undefined){
				v = ((a >>> 5) * 0x4000000 + (v>>>6)) / 0x20000000000000 
				if(p) return p[ Math.round(v * ( t - 1 )) ]
				return v
			}
			return nx(v)
		}

		return nx
	}

	// |  sha1 
	// |  Inspired by http://www.webtoolkit.info/javascript-sha1.html
	// \____________________________________________/
	function sha1hex (m) {
		function rl(n,s){ return ( n<<s ) | (n>>>(32-s)) }
		function lsb(v) {
			var s = "", i, vh, vl
			for( i=0; i<=6; i+=2 ) vh = (v>>>(i*4+4))&0x0f,	vl = (v>>>(i*4))&0x0f, s += vh.toString(16) + vl.toString(16)
			return s
		}

	 	function hex(v) {
			var s = "", i, j
			for( i=7; i>=0; i-- ) j = (v>>>(i*4))&0x0f, s += j.toString(16)
			return s
		}

		function utf8(s) {
			s = s.replace(/\r\n/g,"\n");
			var u = "";
			var fc = String.fromCharCode
			for (var n = 0; n < s.length; n++) {
				var c = s.charCodeAt(n)
				if (c < 128) u += fc(c)
				else if((c > 127) && (c < 2048)) u += fc((c >> 6) | 192), u += fc((c & 63) | 128)
				else u += fc((c >> 12) | 224), u += fc(((c >> 6) & 63) | 128), u += fc((c & 63) | 128)
			}
			return u
		}
		m = utf8(m)
		
		var bs, i, j, u = new Array(80)
		var v = 0x67452301, w = 0xEFCDAB89, x = 0x98BADCFE, y = 0x10325476, z = 0xC3D2E1F0
		var a, b, c, d, e, t
		var l = m.length
	 
		var wa = []
		for(i=0; i<l-3; i+=4) j = m.charCodeAt(i)<<24 | m.charCodeAt(i+1)<<16 | m.charCodeAt(i+2)<<8 | m.charCodeAt(i+3), wa.push(j)
	 
	 	var r = l%4
	 	if(r == 0) i = 0x080000000
	 	else if(r == 1) i = m.charCodeAt(l-1)<<24 | 0x0800000
	 	else if(r == 2) i = m.charCodeAt(l-2)<<24 | m.charCodeAt(l-1)<<16 | 0x08000
	 	else i = m.charCodeAt(l-3)<<24 | m.charCodeAt(l-2)<<16 | m.charCodeAt(l-1)<<8	| 0x80
	 
		wa.push(i)
		while((wa.length % 16) != 14) wa.push( 0 )
		wa.push(l>>>29)
		wa.push((l<<3)&0x0ffffffff)

		for(bs=0; bs<wa.length; bs+=16){
	 		for(i=0; i<16; i++) u[i] = wa[bs+i]
			for(i=16; i<=79; i++) u[i] = rl(u[i-3] ^ u[i-8] ^ u[i-14] ^ u[i-16], 1)
	 
			a = v, b = w, c = x, d = y, e = z
 
			for(i = 0;i <= 19;i++) t = (rl(a,5) + ((b&c) | (~b&d)) + e + u[i] + 0x5A827999) & 0x0ffffffff, e = d, d = c, c = rl(b,30), b = a, a = t
			for(i = 20;i <= 39;i++) t = (rl(a,5) + (b ^ c ^ d) + e + u[i] + 0x6ED9EBA1) & 0x0ffffffff, e = d,d = c,c = rl(b,30),b = a,a = t
			for(i = 40;i <= 59;i++) t = (rl(a,5) + ((b&c) | (b&d) | (c&d)) + e + u[i] + 0x8F1BBCDC) & 0x0ffffffff, e = d, d = c, c = rl(b,30), b = a, a = t
			for(i = 60;i <= 79;i++) t = (rl(a,5) + (b ^ c ^ d) + e + u[i] + 0xCA62C1D6) & 0x0ffffffff, e = d, d = c, c = rl(b,30), b = a, a = t

			v = (v + a) & 0x0ffffffff
			w = (w + b) & 0x0ffffffff
			x = (x + c) & 0x0ffffffff
			y = (y + d) & 0x0ffffffff
			z = (z + e) & 0x0ffffffff
		}
		return (hex(v) + hex(w) + hex(x) + hex(y) + hex(z)).toLowerCase()
	}

	// |  wait for t milliseconds
	// \____________________________________________/
	function wait(t){ 
		var p = ps()
		p.empty = function(){
			clearTimeout(i)
		}
		var i = setTimeout(p, t) 
		return p;
	}

	// |  repeat with an interval of t milliseconds
	// \____________________________________________/
	function repeat(t){ 
		var p = ps()
		p.empty = function(){
			clearInterval(i)
		}
		var i = setInterval(p, t)
		return p;
	}

	// |  next larger power of 2
	// \____________________________________________/
	function nextpow2(x) {
	    --x
	    for (var i = 1; i < 32; i <<= 1)  x = x | x >> i
	    return x + 1
	}

	// |  clamp things
	// \____________________________________________/
	function clamp(a, mi, ma){ 
		return a<mi?mi:a>ma?ma:a 
	}

	// |  min
	// \____________________________________________/
	function min(a, b){ 
		return a<b?a:b 
	}

	// |  max
	// \____________________________________________/
	function max(a, b){ 
		return a>b?a:b 
	}

	// |  delta time helper
	// \____________________________________________/
	function dt(){
		var ci
		if (typeof chrome !== "undefined" && typeof chrome.Interval === "function") 
			ci = new chrome.Interval
		
		var n = now()

		function now(){
			return ci ? ci.microseconds() : Date.now()
		}

		function dt(){
			return now() - n
		}

		dt.log = function(m){
			return console.log((m?m:'')+(now() - n ))
		}

		dt.reset = function(){
			n = now()
		}
		return dt;
	}
	
	// |  quick stacktrace
	// \____________________________________________/
	function tr(){
		console.log(new Error().stack)
	}

	// |  node walker
	// \____________________________________________/
	function walk(n, sn, f){
		var s = typeof f != 'function' && f
		var z = 0
		while(n && n != sn){
			if(s) { if(s in n) n[s](n) }
			else f(n, z)

			if(n._c) n = n._c, z++
			else if(n._d) n = n._d
			else {
				while(n && !n._d && n != sn) n = n._p, z--
				if(n) n = n._d
			}
		}
	}
	
	// |  dump objects to string
	// \____________________________________________/ 
	function dump( 
		d, // dump object 
		o, // options {m:99 max depth,  p:0 pack, c:0  capacity, n:1 no recursion }*/, 
		s, // internal string 
		z, // internal depth 
		r  // internal object stack
		){

		if(!s)s = [], r = [], z = 0; 
		o = o || {};
		var k  // key for object enum
		var ic // indent current string
		var ip // indent parent string
		var nl // newline string
		var i  // iterator
		var l  // length of loop
		var t  // test variable in recurblock
		var c = s.length // current output

		switch(typeof(d)){
			case 'function': 
			case 'object': 
				if(d == null) {
					s[c++] = "null"
					break
				}
				if(z >= (o.m || 99)) {
					s[c++] = "{...}"
					break
				}
				r.push(d)

				if(o.p) ic = ic = nl = ""
				else    ic = Array(z + 2).join(' '), ip = Array(z + 1).join(' '), nl = "\n"
					
				if(d.constructor == Array) {
					s[c++] = "[", s[c++] = nl
					for(k = 0; k < d.length; k++){
						s[c++] = ic
						for(i = 0, t = d[k], l = r.length;i < l; i++) if(r[i] == t) break

						var c1 = c
						if(i == l) dump(t, o, s, z + 1, r)
 						else       s[c++] = "nested: " + i + ""

						c = s.length
						var c2 = c
						console.log(c1,c2)
						if(s.slice(c1,c2-c1).join('').length < 50){
							for(var c3 = c1;c3<c2;c3++){
								s[c3] = s[c3].replace?s[c3].replace(/[\r\n\t]|\s\s/g,""):s[c3]
							}
						}
						// we check the substring length and fold if < n


						s[c++]=", "  +nl
					}
					s[c-1] = nl + ip + "]"
				} else {
					if(typeof(d) == 'function') s[c++] = "->"
					s[c++] = "{", s[c++] = nl

					for(k in d) {
						if(d.hasOwnProperty(k)) {
							if(o.c && c > o.c) {
								s[c++] = "<...>"
								break
							}
							s[c++] = ic + (k.match(/[^a-zA-Z0-9_]/)?"'"+k+"'":k) + ':'
							for(i = 0, t = d[k], l = r.length; i < l; i++) if(r[i] == t) break

							var c1 = c
							if(i == l) dump(t, o, s, z + 1, r)
							else       s[c++] = "[nested: " + i + "]"

							c = s.length

							var c2 = c
							if(s.slice(c1,c2).join('').length < 200){
								for(var c3 = c1;c3<c2;c3++){
									if(s[c3] && typeof(s[c3]) == 'string')
										s[c3] = s[c3].replace(/[\r\n\t]|\s\s/g,"")
								}
							}

							s[c++] = ", " + nl
						}
					}
					s[c-1] = nl + ip + "}"
				}
				r.pop()
			break
			case 'string':
				s[c++]="'" + d + "'"
				break
			default:
				s.push(d)
				break
		}

		return z ? 0 : s.join('')
	}

	return fn
})