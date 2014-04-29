// | Basic Node.JS server with io channel |_________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/

define(function(require){

	var http = require("http")
	var https = require("https")
	var url = require("url")
	var path = require("path")
	var fs = require("fs")
	var fn = require('./fn')
	var ioChannel = require('./io_channel')

	function ioServer(ssl){

		var hs = ssl?https.createServer(ssl, handler):http.createServer(handler)

		var ch = hs.ch = {}
		
		hs.root = path.resolve(__dirname,'..')//process.cwd()
		hs.pass = 'X'

		hs.send = function(m){
			for(var k in ch) ch[k].send(m)
		}

		function watcher(){
			var d // delta
			var w = {}
			// watch a file
			w.watch = function(f){
				if(w[f]) return
				w[f] = fs.watch(f, function(){
					if(Date.now() - d < 2000) return
					d = Date.now()
					if(hs.fileChange) hs.fileChange(f)
					console.log("---- "+f+" changed, sending reload to frontend ----")
					hs.send({reload:f})
				})
			}
			return w
		}

		hs.watcher = watcher()

		// process io channel
		function chan(req){
			if(req.url.indexOf('/io_') != 0) return
			var m = req.url.split('_')

			if(m[2] != hs.pass) return console.log("invalid password in connection", m[2], hs.pass)		

			var c = ch[m[1]]
			if(c) return c

			c = ch[m[1]] = ioChannel(req.url)

			// do not use event pattern overhead
			c.data = function(d){
				hs.data(d, c)
			}

			c.rpc = function(d, r){
				if(hs.rpc) hs.rpc(d, r, c)
			}
			return c
		}

		hs.on('upgrade', function(req, sock, head) { 
			var c = chan(req)
			if(c)	c.upgrade(req, sock, head)
			else sock.destroy()
		})

		var mime = {
			"htm":"text/html",
			"html":"text/html",
			"js":"application/javascript",
			"jpg":"image/jpeg",
			"jpeg":"image/jpeg",
			"txt":"text/plain",
			"css":"text/css",
			"ico": "image/x-icon",			
			"png":"image/png",
			"gif":"image/gif"
		}
		var mimeRx = new RegExp("\\.(" + Object.keys(mime).join("|") + ")$")

		// alright check if we have proxy mode
		function staticServe(req, res){

			var name = url.parse(req.url).pathname

			if (name == '/'){
				// send out packaged UI
				if(hs.packaged == 1){
					res.writeHead(200,{"Content-Type":"text/html"})
					res.end(
						"<html><head><meta http-equiv='Content-Type' CONTENT='text/html; charset=utf-8'><title></title>"+
						"</head><body style='background-color:black' define-main='"+hs.main+"'>"+
						"<script src='/core/define.js'></script></body></html>"
					)
					return	
				}
				else if(hs.packaged){
					var pkg = ''
					var files = {}
					function findRequires(n, base){
						if(files[n]) return
						files[n] = 1
						var f = define.factory[n]
						if(!f) console.log('cannot find', n)
						else {
							var s = f.toString()
							s.replace(/require\(['"](.*?)['"]\)/g,function(x, m){
								if(m.charAt(0)!='.') return m
								var n = define.norm(m,base)
								findRequires(n, define.path(n))
							})
							pkg += 'define("'+n+'",'+s+')\n'
						}
					}
					findRequires(hs.packaged, define.path(hs.packaged))
					// add the define function
					pkg += "function define(id,fac){\n"+
						define.outer.toString().match(/\/\/PACKSTART([\s\S]*?)\/\/PACKEND/g,'').join('\n').replace(/\/\/RELOADER[\s\S]*?\/\/RELOADER/,'')+"\n"+
						"}\n"
					pkg += 'define.settings='+JSON.stringify(define.settings)+';'
					pkg += 'define.factory["'+hs.packaged+'"](define.mkreq("'+hs.packaged+'"))'
					res.writeHead(200,{"Content-Type":"text/html"})
					res.end(
						"<html><head><meta http-equiv='Content-Type' CONTENT='text/html; charset=utf-8'><title></title>"+
						"</head><body style='background-color:black'>"+
						"<script>"+pkg+"</script></body></html>"
					)	
					return
				}	
				name = 'index.html'
			}

			if(name == '/favicon.ico'){
				if(!hs.favicon){
					res.writeHead(404)
					res.end("file not found")
					return
				}
				if(hs.favicon.indexOf('base64:') == 0){
					name = hs.favicon.slice(7)
				} else {
					res.writeHead(200,{"Content-Type":"image/x-icon"})
					res.end(new Buffer(hs.favicon,"base64"))
					return
				}
			}

			var file = path.join(hs.root, name)

			fs.exists(file, function(x) {
				if(!x){
					res.writeHead(404)
					res.end("file not found")
					//console.log('cannot find '+file)
					return
				}
				fs.readFile(file, function(err, data) {
					if(err){
						res.writeHead(500, {"Content-Type": "text/plain"})
						res.end(err + "\n")
						return
					}
					var ext = file.match(mimeRx), type = ext && mime[ext[1]] || "text/plain"
					if(hs.process) data = hs.process(file, data, type)
					res.writeHead(200, {"Content-Type": type})
					res.write(data)
					res.end()
				})
				if(hs.watcher) hs.watcher.watch(file)
			})
		}

		function proxyServe(req, res){
			// lets do the request at the other server, and return the response
			var opt = {
				hostname:hs.proxy.hostname,
				port:hs.proxy.port,
				method:req.method,
				path:req.url,
				headers:req.headers,
			}
			var u = url.parse(req.url)
			var isJs = 0
			// rip out caching if we are trying to access 
			//if(u.pathname.match(/\.js$/i)) isJs = u.pathname
			// turn off gzip
			delete opt.headers['accept-encoding']
			//if(isJs){
			delete opt.headers['cache-control']
			delete opt.headers['if-none-match']
			delete opt.headers['if-modified-since']
			delete opt.headers['content-security-policy']

			opt.headers.host = hs.proxy.hostname

			req.on('data', function(d){
				p_req.write(d)
			})
			
			req.on('end', function(){
				p_req.end()
			})

			var proto = hs.proxy.protocol == 'https:' ? https : http

			var p_req = proto.request(opt, function(p_res){
				if(!isJs && p_res.headers['content-type'] && p_res.headers['content-type'].indexOf('javascript')!=-1){
					if(u.pathname.match(/\.js$/i)) isJs = u.pathname
					else isJs = '/unknown.js'
				} 
				if(p_res.statusCode == 200 && isJs){
					var total = ""
					var output;
					if(p_res.headers['content-encoding'] === 'gzip' || p_res.headers['content-encoding'] === 'deflate') {
						var zlib = require('zlib')
						var gzip = zlib.createGunzip()
						p_res.pipe(gzip)
						output = gzip
					} else {
						output = p_res
					}
					output.on('data', function(d){
						total += d.toString()
					})
					output.on('end', function(){
						var data = hs.process(isJs, total, "application/javascript")
						var h = p_res.headers
						delete h['cache-control']
						delete h['last-modified']
						delete h['etag']
						delete h['content-length']
						delete h['content-security-policy']
						delete h['content-encoding']
						//h['content-length'] = data.length
 						res.writeHead(p_res.statusCode, p_res.headers)
						res.write(data, function(err){
							res.end()
						})
					})
				} else {
					res.writeHead(p_res.statusCode, p_res.headers)
					p_res.on('data',function(d){
						res.write(d)
					})
					p_res.on('end', function(){
						res.end()
					})
				}
			})	

		}

		function handler(req, res) {
			var c = chan(req)
			if(c && c.handler(req, res)) return

			if(hs.proxy) return proxyServe(req, res)
			return staticServe(req, res)
		}
		return hs
	}
	return ioServer
})