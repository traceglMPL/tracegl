// | GL Browser context |_______________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/  

define(function(require, exports, module){

	var fn = require("./fn")

	var gl // context
	var cvs // canvas
	var div // main div
	var img = {} // image cache

	if(typeof navigator === 'undefined'){
		module.exports = null
		return
	}
	var isSafari = navigator.userAgent.match(/Safari/) != null
	var isGecko = navigator.userAgent.match(/Gecko\//) != null
	var isChrome = navigator.userAgent.match(/Chrome\//) != null
	var isIos = navigator.userAgent.match(/Apple.*Mobile\//) != null

	if(!init()){
		module.exports = null
		return
	}

	gl.resize = fn.ps()

	function init(){
		window.requestAnimFrame = (function(){
			return window.requestAnimationFrame ||
				window.webkitRequestAnimationFrame ||
				window.mozRequestAnimationFrame ||
				window.oRequestAnimationFrame ||
				window.msRequestAnimationFrame ||
				function( callback ){
					window.setTimeout(callback, 1000 / 60)
				}
		})()
		
		cvs = document.createElement('canvas')
		div = document.body

		div.style.margin = '0'
		div.style.backgroundColor = 'black'
		div.style.overflow = 'hidden'
		div.style.height = '100%'

		div.style.userSelect = 'none';
		//div.style.cursor = 'none'
		var ratio = window.devicePixelRatio
		document.body.appendChild(cvs)

		window.onresize = function(){
			cvs.style.width = div.offsetWidth - 2
			cvs.style.height = div.offsetHeight - 2
			cvs.width = gl.width = (div.offsetWidth - 2) * ratio
			cvs.height = gl.height = (div.offsetHeight - 2) * ratio
			gl.viewport(0, 0, gl.width, gl.height)
			gl.resize()
		}
		cvs.style.width = div.offsetWidth - 2
		cvs.style.height = div.offsetHeight - 2
		cvs.width  = (div.offsetWidth - 2) * ratio
		cvs.height = (div.offsetHeight - 2) * ratio

		gl = cvs.getContext && cvs.getContext('experimental-webgl', {
			antialias:false, 
			premultipliedAlpha: false,
			alpha: false, 
			preserveDrawingBuffer: true 
		})

		if(!gl){ // lets try to be helpful
			function msg(){
				var w = '<a href="http://en.wikipedia.org/wiki/WebGL#Implementation">WebGL</a>'
				var c = '<a href="http://www.google.com/chrome">Chrome</a>'
				var gi = '<a href="http://www.google.com/search?q=enable+webgl+ios">solution</a>'
				var d = 'Oh no! We cannot use '+w+'.<br>'
				var p1 = 'Reminder to self, try this WebGL link: '
				var l1 = encodeURIComponent(p1+location.href)
				var m = '<a href="mailto:link@n4.io?subject='+l1+'&body='+l1+'">Email yourself the link</a> (replace to).'
				var a = 'http://www.apple.com/feedback/safari.html'
				var w = 'install '+c+' for the best experience. Or '+m
				if(isChrome){
					d += 'You seem to be running Chrome already, try updating your videocard drivers, updating '+c+', or running on a newer computer.<br/>' + m 
				} else if(isIos){
					d += 'Please help by <a href="' + a + '">asking Apple to enable WebGL in mobile safari.</a><br/>' 
					d += 'For now, experience this on a desktop OS. '+m+'<br/>Or search for a '+gi 
				} else if(isSafari) {
					d += w+'<br/><br/>'+
					'To enable webGL in Safari (5.1 or higher) follow these 5 steps:<br/>'+
					'1. Top left of the screen: click Safari then Preferences (opens window).<br/>'+
					'2. Click the advanced tab (gear) in the preferences window, its the last tab on the right.<br/>'+
					'3. At the bottom check the "Show Develop menu in menu bar" checkbox.<br/>'+
					'   At the top of the screen between Bookmarks and Window a new Develop menu appears<br/>'+
					'4. Click the Develop menu at the top, and select Enable WebGL (last item at the bottom)<br/>'+
					'5. <a href="'+location.href+'">Click here to refresh the browser</a><br/>'
					d += 'I know this is a hassle, you can help by <a href="'+a+'"+>asking Apple to enable WebGL by default.</a><br/>' 
				} else {
					d += w + '<br/>'
					d += 'If you have Chrome already, just cut and paste "'+location.href+'" in the address bar of Chrome!<br>' 
				}
				div.style.backgroundColor = 'lightgray'
				div.style.font = '14px Monaco, Consolas'
				div.style.color = 'black'
				div.style.margin = '25'
				document.body.innerHTML = d
			}
			return msg()
		}
		module.exports = gl
		gl.ratio = ratio
		gl.width = cvs.width
		gl.height = cvs.height
		gl.mouse_p = fn.ps()
		gl.mouse_m = fn.ps()
		gl.mouse_r = fn.ps()
		gl.mouse_u = fn.ps()
		gl.mouse_s = fn.ps()
		gl.keydown = fn.ps()
		gl.keyup = fn.ps()


		// default
		// none
		// wait
		// text
		// pointer

		// zoom-in
		// zoom-out
		// grab
		// grabbing

		// ns-resize
		// ew-resize
		// nwse-resize
		// nesw-resize

		// w-resize
		// e-resize
		// n-resize
		// s-resize
		// nw-resize
		// ne-resize
		// sw-resize
		// se-resize

		// help
		// crosshair
		// move

		// col-resize
		// row-resize

		// vertical-text
		// context-menu
		// no-drop
		// not-allowed
		// alias
		// cell
		// copy

		var ct = isGecko ? {
			'grab' : '-moz-grab',
			'grabbing' : '-moz-grabbing'
		}:{
			'grab' : '-webkit-grab',
			'grabbing' : '-webkit-grabbing',
			'zoom-in' : '-webkit-zoom-in',
			'zoom-out' : '-webkit-zoom-out'
		}

		var cursor
		gl.cursor = function(c){
			if(cursor != c)
				document.body.style.cursor = cursor = c in ct? ct[c] : c
		}

		var b = 0 // block anim 
		gl.anim = function(c){
			if(b) return
			b = 1
			window.requestAnimFrame(function(){
				b = 0
				c()
			})
		}
		
		gl.ms = {
			x: -1,
			y: -1,
			h: 0,
			v: 0
		}

		function setMouse(e){
			gl.ms.b = e.button
			gl.ms.c = e.ctrlKey
			gl.ms.a = e.altKey
			gl.ms.m = e.metaKey
			gl.ms.s = e.shiftKey
		}

		// doubleclick filter (dont fire if its dblclick-drag)
		var dfx
		var dfy
		var dfd
		cvs.onmousedown = function(e){
			dfx = e.clientX
			dfy = e.clientY
			setMouse(e)
			gl.mouse_p()
			cvs.focus()
			window.focus()
		} 

		document.ondblclick = function(e){
			if(!dfd) return // its a double click drag
			setMouse(e)
			gl.mouse_u()
		}

		document.onmouseout = function(e){
			gl.ms.x = -1
			gl.ms.y = -1
			gl.mouse_m()
		}

		document.onmousemove = function(e){
			setMouse(e)
			gl.ms.x = e.clientX - 2
			gl.ms.y = e.clientY - 2
			gl.mouse_m()
		}

		window.onmouseup =
		cvs.onmouseup = function(e){
			dfd = dfx == e.clientX && dfy == e.clientY
			setMouse(e)
			gl.mouse_r()
		}

		if(isGecko){
			window.addEventListener('DOMMouseScroll', function(e){
				setMouse(e)
				var d = e.detail;
				d = d * 10
				if(e.axis == 1){
					gl.ms.v = 0
					gl.ms.h = d
				} else {
					gl.ms.v = d
					gl.ms.h = 0
				}
				gl.mouse_s()
			})
		}

		window.onmousewheel = function(e){
			//e.wheelDeltaX or e.wheelDeltaY is set
			setMouse(e)
			var n = Math.abs(e.wheelDeltaX || e.wheelDeltaY)
			if(n%120) n = isSafari?-6:-1
			else n = -15
			gl.ms.h = e.wheelDeltaX / n
			gl.ms.v = e.wheelDeltaY / n
			gl.mouse_s()
		}
		
		// add hidden copy paste textarea
		var clip = document.createElement('textarea')
		clip.tabIndex = -1
		clip.autocomplete = 'off'
		clip.spellcheck = false
		clip.id = 'clipboard'
		clip.style.position = 'absolute'
		clip.style.left = 
		clip.style.top = '-10px'
		clip.style.width =
		clip.style.height = '0px'
		clip.style.border = '0'
		clip.style.display = 'none'
		document.body.appendChild(clip)
/*
		clip.onblur = function(){
			clip.focus()
		}
		clip.focus()
*/
		gl.getpaste = function(cb){
			clip.style.display = 'block'
			clip.select()
			clip.onpaste = function(e){
				cb(e.clipboardData.getData("text/plain"))
				e.preventDefault()
				clip.style.display = 'none'
			}
		}

		gl.setpaste = function(v){
			clip.style.display = 'block'
			clip.value = v
			clip.select()
			setTimeout(function(){
				clip.style.display = 'none'
			},100)
		}

		var kn = { // key normalization
			8:'backspace',9:'tab',13:'enter',16:'shift',17:'ctrl',18:'alt',
			19:'pause',20:'capslock',27:'escape',
			32:'space',33:'pgup',34:'pgdn',
			35:'end',36:'home',37:'left',38:'up',39:'right',40:'down',
			45:'insert',46:'delete',
			48:'0',49:'1',50:'2',51:'3',52:'4',
			53:'5',54:'6',55:'7',56:'8',57:'9',
			65:'a',66:'b',67:'c',68:'d',69:'e',70:'f',71:'g',
			72:'h',73:'i',74:'j',75:'k',76:'l',77:'m',78:'n',
			79:'o',80:'p',81:'q',82:'r',83:'s',84:'t',85:'u',
			86:'v',87:'w',88:'x',89:'y',90:'z',
			91:'leftmeta',92:'rightmeta',
			96:'num0',97:'num1',98:'num2',99:'num3',100:'num4',101:'num5',
			102:'num6',103:'num7',104:'num8',105:'num9',
			106:'multiply',107:'add',109:'subtract',110:'decimal',111:'divide',
			112:'f1',113:'f2',114:'f3',115:'f4',116:'f5',117:'f6',
			118:'f7',119:'f8',120:'f9',121:'f10',122:'f11',123:'f12',
			144:'numlock',145:'scrollock',186:'semicolon',187:'equals',188:'comma',
			189:'dash',190:'period',191:'slash',192:'accent',219:'openbracket',
			220:'backslash',221:'closebracket',222:'singlequote'
		}
		var kr = {} // key repeat

		function key(e, k){
			var r
			if(kr[k]) r = kr[k]++
			else r = 0, kr[k] = 1
			gl.key = {
				a:e.altKey,
			 	c:e.ctrlKey,
			 	s:e.shiftKey,
			 	m:e.metaKey,
			 	r:r, // repeat
			 	k:k, // keycode
			 	i:kn[k], // identifier
			 	v:String.fromCharCode(e.charCode), // value
			 	h:e.charCode // charCode
			}
		}

		var kc = 0
		var ki = 0
		window.onkeydown = function(e){
			kc = e.keyCode
			ki = setTimeout(function(){// only executed when press doesnt fire
				key(e, kc)
				gl.keydown()
			},0)
			// on enter and tab stop it
			if(e.keyCode == 8 || e.keyCode == 9  || e.keyCode == 27 || e.keyCode == 13){
				e.preventDefault()
				e.stopPropagation()
			}
			//e.preventDefault()
		}
		
		window.onkeypress = function(e){
			clearTimeout(ki)
			key(e, kc)
			gl.keydown()
		}

		window.onkeyup = function(e){
			key(e, e.keyCode)
			kr[gl.key.k] = 0
			gl.keyup()
		}

		return true
	}

	// |  font load watcher. go browsers! Safari still manages to break this
	function fwatch(ft, cb){

		var c = document.createElement('canvas')
		c.width = c.height = 4
		var x = c.getContext('2d')
		x.fillStyle = 'rgba(0,0,0,0)'
		x.fillRect(0,0,c.width, c.height)
		x.fillStyle = 'white'
		x.textBaseline = 'top'
		
		var n = document.createElement('span')
		n.innerHTML = 'giItT1WQy@!-/#'
		n.style.position = 'absolute'
		n.style.left = n.style.top = '-10000px'
		n.style.font = 'normal normal normal 300px sans-serif'
		n.style.letterSpacing = '0'
		document.body.appendChild(n)
		
		var w = n.offsetWidth
		n.style.fontFamily = ft
		
		var i = setInterval(function(){
			if(n.offsetWidth != w) { //inconclusive in chrome
				x.font = '4px '+ft
				x.fillText('X',0,0) // x marks the spot
				var p = x.getImageData(0,0,c.width,c.height).data
				for (var j = 0, l = p.length; j < l; j++) if(p[j]){
					document.body.removeChild(n)
					clearInterval(i)
					cb()
					return
				}
			}
		}, 100)
	}


	// |  font and image loader
	// \____________________________________________/
	gl.load = function(){
		var n = 0
		var f = arguments[arguments.length - 1]
		for(var i = 0;i< arguments.length - 1;i++){
			r = arguments[i]
			var t = r.indexOf(':')
			var c = r.slice(0, t)
			var u = r.slice(t + 1)

			if(c == 'g'){// google font
				n++
				var l = document.createElement('link')
				l.setAttribute('rel', 'stylesheet')
				l.setAttribute('type', 'text/css')
				l.setAttribute('href', 'http://fonts.googleapis.com/css?family=' + u.replace(/ /g,'+'))
				document.getElementsByTagName("head")[0].appendChild(l)
				fwatch(u, function(){
					if(!--n) f()
				})
			} else if(c == 'i'){ // image
				var i = new Image()
				i.src = u
				img[u] = i
				n++
				i.onload = function(){
					if(!--n) f()
				}
			} else if(c == 'a'){ // audio

			}
		}
		if(arguments.length == 1) f()
	}

	// |  texture from image
	// \____________________________________________/
	gl.texture = function(i, t, s) {
		if(!t ) t = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, t)

		if( !i.width || (i.width & (i.width - 1)) || (i.height & (i.height - 1)) ){ // not power 2
			if(gl.npot){
				var c = document.createElement("canvas")
				fn(i.width, i.height)
				c.width = fn.nextpow2(i.width)
				c.height = fn.nextpow2(i.height)
				fn(c.width, c.height)
				var x = c.getContext("2d")
				x.drawImage(i, 0, 0, i.width, i.height)
				i = c
			} else {
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, i)
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, s||gl.LINEAR)
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, s||gl.LINEAR)
				t.w = i.width, t.h = i.height
				i = 0
			}
		}
		if(i){
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, i)
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, s||gl.LINEAR)
	//		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
	//		gl.generateMipmap(gl.TEXTURE_2D)
			t.w = i.width, t.h = i.height
		}
		gl.bindTexture(gl.TEXTURE_2D, null)
		return t
	}

	// |  create a camera feed
	// \____________________________________________/
	gl.camera = function(cb) {
		var o = document.createElement('video');
		o.autoplay = 'autoplay';
		if(!window.navigator.webkitGetUserMedia) return
		window.navigator.webkitGetUserMedia({audio:false, video:true},
			function(s){
				o.src = window.webkitURL.createObjectURL(s)
				cb(o)
			}, 
			function(e){
				fn(e)
			}
		)
	}

	// |  texture load queue
	// \____________________________________________/
	gl.loadImage = function(u, cb){
		var t = gl.createTexture()
		if(img[u]){
			gl.texture(img[u], t)
			return t
		}
		var i = new Image()
		i.onload = function(){ gl.texture(i, t); if(cb) cb() }
		i.src = u
		return t
	}

	var sFontSh
	var pFontSh
	// |  Create a pixel font texture
	// \____________________________________________/

	gl.pfont = function(f){ // font
		"no tracegl"
		var t = font((typeof f == 'object') ? f : {f:f})
		// fix up alpha
		if(!pFontSh){
			var d = {u:{s:'sampler2D'}}
			if(isChrome) d.f = function(){
				vec4_v = texture2D(s,vec2(c.x,c.y));
				return_vec4(v.x, v.y, v.z, pow(v.w,1.2))
			} 
			else
			if(isGecko) d.f = function(){
				vec4_v = texture2D(s,vec2(c.x,c.y));
				return_vec4(v.y, v.y, v.y, pow(v.w,1.4))
			}
			else d.f = function(){
				vec4_v = texture2D(s,vec2(c.x,c.y));
				float_y = pow(v.y,0.25);
				return_vec4(y,y,y, pow(v.w,2.2))
			}
			s = gl.getScreenShader(d)
			pFontSh = s
		}
		var t2 = gl.renderTexture(t.w, t.h, function(){
			gl.disable(gl.BLEND)
			pFontSh.use()
			pFontSh.s(t)
			pFontSh.draw()
		})
		for(var k in t) t2[k] = t[k]
		gl.deleteTexture(t)
		return t2
	}
	
	// |  Create a subpixel font texture
	// \____________________________________________/
	gl.sfont = function(f){ // font
		"no tracegl"
		var t
		if(typeof f == 'object'){
			f.a = 1
			t = font(f)
		} else t = font({a:1,f:f})
		// now we have to scale it back using a shader
		if(!sFontSh){
			sFontSh = gl.getScreenShader({
				u: {s:'sampler2D', a:'float'},
				f: function(){
					float_p( 1./2048 )
					float_x( c.x * 0.75 )
					float_g1( pow(texture2D(s,vec2( x - 2 * p, c.y )).g, a) )
					float_b1( pow(texture2D(s,vec2( x - 1 * p, c.y )).g, a) )
					float_r( pow(texture2D(s,vec2( x, c.y )).g, a) )
					float_g( pow(texture2D(s,vec2( x + 1 * p, c.y )).g, a) )
					float_b( pow(texture2D(s,vec2( x + 2 * p, c.y )).g, a) )
					float_rs((r+g1+b1)/3)
					float_gs((r+g+b1)/3)
					float_bs((r+g+b)/3)
					return_vec4(rs,gs,bs, step(min(min(rs,gs),bs),0.9))
				}
			})
		}
		var t2 = gl.renderTexture(t.w, t.h, function(){
			gl.disable(gl.BLEND)
			sFontSh.use()
			sFontSh.s(t)
			sFontSh.a(1)//isGecko?1:1)
			sFontSh.draw()
		})
		for(var k in t) t2[k] = t[k]
		gl.deleteTexture(t)
		return t2
	}

	// |  create updateable canvas texture
	/*
	gl.canvas = function(w, h){ // font
		var c = document.createElement( "canvas" )
		var x = c.getContext( "2d" )
		c.width = x.width = w
		c.height = x.height = h
		var t = gl.createTexture()
		t.w = w
		t.h = h
		t.draw = function(cb){
			cb(x)
			texture(c, t)
		}
		return t
	}*/

	//|  build a palette for use with t
	gl.palette = function(o, t){
		var w = 0
		var h = 1
		for(var i in o) w++
		w = fn.nextpow2(w)
		t = t || gl.createTexture()
		t.w = w
		t.h = h

		var c = document.createElement( "canvas" )
		var x = c.getContext( "2d" )
		c.width = x.width = w
		c.height = x.height = h
		var d = x.createImageData(w, 1)
		var p = d.data
		var j = 0
		var v = 0
		for(var i in o){
			t[i] = v / w
			var r = gl.parseColor(o[i])
			p[j + 0] = r.r * 255
			p[j + 1] = r.g * 255
			p[j + 2] = r.b * 255
			p[j + 3] = r.a * 255
			j += 4
			v++
		}
		x.putImageData(d, 0, 0)
		gl.texture(c, t, gl.NEAREST)

		return t
	}

	// |  Create a font texture
	function font(f){ // font
		var c = document.createElement( "canvas" )
		var x = c.getContext( "2d" )

		var t = gl.createTexture()
		
		var o = {}
		if(typeof f == 'object') o = f, f = o.f || o.font

		// lets parse the fontstring for \dpx
		var n = f.match(/(\d+)px/)
		if(!n) throw new Error("Cannot parse font without size in px")
		var px = parseInt(n[0])
		px = px * gl.ratio
		f = px+'px'+f.slice(n[0].length)
		// calculate grid size
		//if(o.pow2) 
		gs = fn.nextpow2(px)
		//else gs = px + parseInt(px/4) + 1
		//gs = 32
		//console.log(gs)

		t.w = 512 // width
		t.g = gs // grid size
		t.p = px // pixelsize
		t.b = Math.floor(t.w / gs) // how many blocks per line
		t.s = 32 // start
		t.e = o.e || 256 // end
		t.h = fn.nextpow2( ((t.e - 32) / t.b) * gs + 1 ) // height
		//if(t.h == 128) t.h = 512
		t.m = [] // metrics
		t.c = [] // spacing
		t.t = [] // 16 bit texture coords
		t.xp = 0 // x padding
		c.width = o.a?2048:512
		c.height = t.h
		x.scale(o.a?3:1, 1)
		x.fillStyle = o.a?'white':'rgba(0,0,0,0)'
		x.fillRect(0, 0, t.w, t.h)
		x.font = f
		x.fillStyle = o.a?'black':'white'
		x.textBaseline = 'bottom'
		x.textAlign = 'start'

		var ia = 0 // italic adjust
		if(f.match(/italic/i)) ia = parseInt(px/4)

		for(var i = 0, l = t.e - t.s; i <l; i++){
			var xp = i % t.b
			var yp = Math.floor(i / t.b)
			var ch = String.fromCharCode(i + t.s)
			t.c[i] = Math.round(x.measureText(ch).width) 
			t.m[i] = t.c[i] + ia
			t.t[i] = (Math.floor( (( xp * gs - t.xp) / t.w) * 256 ) << 16) |
						(Math.floor( (( yp * gs) / t.h) * 256 ) << 24)
			if(i == 127 - t.s){
				for(var j = 0;j < px+1; j += 2) x.fillRect(xp*gs+2+0.5, yp*gs+j, 0.25, 1)
			} else if(i == 128 - t.s){
				x.fillRect(xp*gs, yp*gs+0.5*px, 1, px)
			}else x.fillText(ch, xp * gs, yp * gs + px + (isGecko?0:1) )
		}

/*		//document.body.appendChild(c)
		x.fillStyle = '#ffffff'
		for(var i = 0; i<t.w; i++)
			for(var j = 0;j<t.h; j++)
				if((i+j)&1) x.fillRect(i,j,1,1)
*/
		gl.bindTexture(gl.TEXTURE_2D, t)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)				
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
		gl.bindTexture(gl.TEXTURE_2D, null)

		return t
	}

	return gl
})