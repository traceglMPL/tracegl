// | Browser and NodeJS module (re)loader |_____/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/

function define(id, fac){

	//PACKSTART
	// | returns path of file
	function path(p){ //
		if(!p) return ''
		p = p.replace(/\.\//g, '')
		var b = p.match(/([\s\S]*)\/[^\/]*$/)
		return b ? b[1] : ''
	}

	// | normalizes relative path r against base b
	function norm(r, b){
		b = b.split(/\//)
		r = r.replace(/\.\.\//g,function(){ b.pop(); return ''}).replace(/\.\//g, '')
		var v = b.join('/')+ '/' + r
		if(v.charAt(0)!='/') v = '/'+v
		return v
	}	
	//PACKEND

	if(typeof process !== "undefined"){
		// | Node.JS Path
		// \____________________________________________/

		if(global.define) return

		var fs = require("fs")
		var cp = require("child_process")
		var Module = require("module")

		var modules = []
		var _compile = module.constructor.prototype._compile

		// hook compile to keep track of module objects
		module.constructor.prototype._compile = function(content, filename){  
			modules.push(this);
			try {        
				return _compile.call(this, content, filename)
			}
			finally {
				modules.pop()
			}
		};

		var outer = define
		module.exports = global.define = function(id, fac) {

			if(fac instanceof Array) throw new Error("injects-style not supported")
			if (!fac) fac = id
			var m = modules[modules.length-1] || require.main

			// store module and factory just like in the other envs
			global.define.module[m.filename] = m
			global.define.factory[m.filename] = fac

			var req = function(m, id) {
				if(id instanceof Array || arguments.length != 2 || id.indexOf('!') != -1)
					throw new Error("unsupported require style")

				var f = Module._resolveFilename(id, m)
				if (f instanceof Array) f = f[0]
				// lets output a filename on stderr for watching
				if(global.define.log && f.indexOf('/') != -1) process.stderr.write('<[<['+f+']>]>')

				return require(f)
			}.bind(this, m)
			if (typeof fac !== "function") return m.exports = fac

			req.factory = function(){
				throw new Error('factory not supported in unpackaged')
			}
						
			var ret = fac.call(m.exports, req, m.exports, m)
			if (ret) m.exports = ret
		}
		global.define.require = require
		global.define.outer = outer
		global.define.path = path
		global.define.norm = norm
		global.define.module = {}
		global.define.factory = {}

		return
	}
	// | Browser Path
	// \____________________________________________/

	//PACKSTART
	function def(id, fac){
		if(!fac) fac = id, id = null
		def.factory[id || '_'] = fac
	}

	def.module = {}
	def.factory = {}
	def.urls = {}
	def.tags = {}

	function req(id, base){
		if(!base) base = ''
		if(typeof require !== "undefined" && id.charAt(0) != '.') return require(id)

		id = norm(id, base)

		var c = def.module[id]
		if(c) return c.exports

		var f = def.factory[id]
		if(!f) throw new Error('module not available '+id + ' in base' + base)
		var m = {exports:{}}

		var localreq = def.mkreq(id)
	
		var ret = f(localreq, m.exports, m)
		if(ret) m.exports = ret
		def.module[id] = m

		return m.exports
	}

	def.mkreq = function(base){
		function localreq(i){
			return def.req(i, path(base))
		}

		localreq.reload = function(i, cb){
			var id = norm(i, base)
			script(id, 'reload', function(){
				delete def.module[id] // cause reexecution of module
				cb( req(i, base) )
			})
		}

		localreq.absolute = function(i){
			return norm(i, path(base))
		}

		return localreq
	}
	def.req = req
	def.outer = define
	if(typeof require !== 'undefined') def.require = require
	def.path = path
	def.norm = norm

	define = def
	def(id, fac)

	//PACKEND

	// the separate file script loader
	def.dling = 0
	def.rldid = 0
	var base = path(window.location.href)

	function script(file, parent, cb){
		var s = document.createElement('script')
		var p = path(file)
		file = file.replace(/\.\//g, '/')
		s.type = 'text/javascript'
		if(cb) rld = '?'+def.rldid++
		else rld = ''
		s.src = base + file + (file.indexOf(".js")!= -1  ? "" : ".js" ) + rld
		def.tags[file] = s
		def.dling++
		function load(){
			var f = def.factory._
			def.factory[file] = f
			def.urls[file] = s.src
			f.toString().replace(/require\s*\(\s*["']([^"']+)["']\s*\)/g, function(x, i){
				if(i.charAt(0) != '.') return 
				i = norm(i, p)
				if(!def.tags[i] && !def.factory[i]) script(i, file)
			})
			if(cb) cb()
			else if(!--def.dling) req(def.main, '') // no more deps
		}
		s.onerror = function(){ console.error("Error loading " + s.src + " from "+parent) }
		s.onload = load
		s.onreadystatechange = function(){
			if(s.readyState == 'loaded' || s.readyState == 'complete') load()
		}
		document.getElementsByTagName('head')[0].appendChild(s)
	}
	def.main = document.body.getAttribute("define-main") ||
		window.location.pathname.replace(/^(.*\/)(.*?)/,"$2").replace(".html","")
	if(!def.main || def.main.match(/\/(?:index)?$/)) def.main = "./main"
	else if(def.main.indexOf('./') != 0)def.main = "./" + def.main
	script(def.main, 'root')

}
define()

