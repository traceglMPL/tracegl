// | Trace server |________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

require("../core/define")
define(function(require){

	if(process.version.indexOf('v0.6') != -1 || process.version.indexOf('v0.4') != -1){
		console.log("Node version too old, try 0.8 or 0.10")
		process.exit(-1)
		return
	}

	var path = require('path')
	var fs = require('fs')
	var url = require('url')
	var zlib = require('zlib')
	var http = require('http')
	var https = require('https')
	var crypto = require('crypto')
	var instrument = require('./instrument')
	var childproc = require('child_process')

	// the nodejs loader
	if(process.argv[2] && process.argv[2].indexOf('-l')==0) return nodeLoader()
	
	function nodeLoader(){ 
		var filter = makeFilter(process.argv[2].slice(2))

		var m = require('module').Module.prototype;
		var oldCompile = m._compile;
		var did = 1
		m._compile = function(content, filename){

			if(filter.active && filter(filename)) 
				return oldCompile.call(this, content, filename)
			// lets instrument 
			var t = instrument(filename, content, did, filter.opt)
			did = t.id
			// send the dictionary out
			var m = {dict:1, src:t.input, f:filename, d:t.d}
			if(process.send)	process.send(m)
			else process.stderr.write('\x1f'+JSON.stringify(m)+'\x17')
			return oldCompile.call(this, t.output, filename)
		}
		process.argv.splice(1,2) // remove leading arguments
		// clear require cache
		for(var k in define.require.cache) delete define.require.cache[k]
		var file = path.resolve(process.argv[1])
		define.require(file);
	}

	var fn = require('../core/fn')
	var ssl = require('../core/io_ssl')
	var ioServer = require('../core/io_server')

	function out() {
		for (var v = Array.prototype.slice.call(arguments), i = 0, c = out.colors; i < v.length; i++) {
			v[i] = String(v[i]).replace(/~(\w*)~/g, function(m, a) {
				return "\033[" + (c[a] || 0) + "m";
			}) + "\033[0m";
			process.stderr.write(v[i]);
		}
	}

	out.colors = {
		bl:"30",bo:"1",r:"0;31",g:"0;32",y:"0;33",b:"0;34",m:"0;35",c:"0;36",
		w:"0;37",br:"1;31",bg:"1;32",by:"1;33",bb:"1;34",bm:"1;35",bc:"1;36",bw:"1;37"
	}

	function makeFilter(fspec){

		if(typeof fspec == 'string') fspec = JSON.parse(fspec)

		var _do = init(fspec._do)
		var _no = init(fspec._no)

		function init(a){
			var d = []
			for(var i = 0;i<a.length;i++){
				if(a[i].charAt(0)==':') d[i] = a[i].slice(1) 
				else d[i] = new RegExp(a[i].slice(1),"i")
			}
			return d
		}

		function match(d, f){
			if(!d.length) return 0
			for(var i = 0;i<d.length;i++){
				if(typeof d[i] == 'string'){
					if(f.indexOf(d[i]) != -1) return 2
				} else if(f.match(d[i])) return 2
			}
			return 1
		}

		function f(file){
			if(match(_do, file) == 1) return true
			if(match(_no, file) == 2) return true
			return false
		}

		f.opt = fspec._opt
		f.active = _do.length || _no.length
	
		f.stringify = function(){
			return JSON.stringify(fspec)
		}

		return f
	}

	out('~~[trace.GL] ~bc~See~w~ your code. \n')

	function loadSettings(file){
		if(!fs.existsSync(file)) return
		try{
			var data = fs.readFileSync(file).toString().replace(/\/\*[\s|S]?\*\//g,'').replace(/\/\/.*?\n/g,'')
			define.settings = JSON.parse(data)
			define.settingsData = data
			define.settingsFile = file
		}
		catch(e){	
			console.log("Error reading settings file ("+file+") ",e)
		}
	}

	if(!loadSettings(path.resolve(process.cwd(),"tracegl.json")) && 
		!loadSettings("~/tracegl.json") && 
		!loadSettings(path.resolve(path.dirname(__filename),"tracegl.json")) &&
		!define.settings)
		loadSettings(path.resolve(path.dirname(__filename),"tracegl.json"))

	// argument parse variables
	function processArgs(arg){
		var sender // send messages to ui or zip
		var uiport = 2000
		var bind = "0.0.0.0"
		var tgtport = 2080
		var fspec = {_no:[], _do:[], _opt:{}}

		function usage(err){
			out('~br~'+err+'\n')
			out('~w~Usage:\n')
			out('~w~node tracegl ~c~[flag] ~g~target ~y~[args]\n')
			out('  ~g~../path/to/wwwroot ~w~Trace browser js via static fileserver\n')
			out('  ~g~http://proxytarget:port ~w~Trace browser js via proxy\n')
			out('  ~g~nodefile.js ~y~[args] ~w~Trace Node.js process\n')
			out('  ~g~trace.gz ~w~Play back trace.gz file\n')
			out('  ~c~-gz[:trace.gz] ~w~Record trace to gzip file. No trace UI started\n')
			out('  ~c~-do[/:]match ~w~Only trace filenames containing match. Filters -do set first, then -no\n')
			out('  ~c~-no[/:]match ~w~Ignore filenames containing match. Replace : with / for a regexp, use double escaped \\\\ \n')
			out('  ~c~-nolib ~w~Short for -no/jquery.* -no:require.js -no/node\\\\_modules \n')
			out('  ~c~-nocatch ~w~Don\'t create exception catching\n')
			out('  ~c~-bind:0.0.0.0 ~w~Set the hostname to bind our external ports to, default 0.0.0.0\n')
			out('  ~c~-ui:port ~w~Set trace UI port. default: 2000\n')
			out('  ~c~-tgt:port ~w~Set browser JS port. default: 2080\n')
			out('~w~node tracegl.js ~r~[commmand]\n')
			out('  ~r~-settings ~w~write a .tracegl settings template in the current dir\n')
			return
		}
		// process arguments
		for(var i = 2;i<arg.length;i++){
			var a = arg[i]
			if(a.charAt(0) == '-'){
				var d = a.indexOf(':')
				var b
				if(d!=-1) b = a.slice(d+1)

				if(a.indexOf('-gz') == 0){
					if(d!=-1) sender = gzSender(a.slice(d+1))
					else sender = gzSender('trace.gz')
				} else if(a.indexOf('-install') == 0){
				} else if(a.indexOf('-ui') == 0){
					if(d==-1) return usage("No port specified")
					uiport = parseInt(b)
				} else if(a.indexOf('-tgt') == 0){
					if(d==-1) return usage("No port specified")
					tgtport = parseInt(b)
				} else if(a.indexOf('-no') == 0){
					if(a == '-nocatch'){
						fspec._opt.nocatch = 1
					} else
					if(a == '-nolib'){
						fspec._no.push("/jquery.*")
						fspec._no.push(":require.js")
						fspec._no.push("/node\\_modules")
					} else {
						fspec._no.push(a.slice(3))
					}
				} else if(a.indexOf('-do') == 0){
					fspec._do.push(a.slice(3))
				} else if(a.indexOf('-settings') == 0){
					if(fs.existsSync('tracegl.json')){
						return out('~r~ERROR: ~~ .tracegl file already exists, remove before creating a new template\n')
					}
					fs.writeFileSync("tracegl.json", define.settingsData)
					return out('~g~OK: ~~ tracegl.jsonl file written in current directory, open it in an editor to modify settings\n')
				} else if(a.indexOf('-bind')== 0){
					bind = a.slice(6)
				} else return usage("Invalid argument "+a)
			} else {
				if(!sender) sender = uiSender(uiport, bind)
				var f = makeFilter(fspec)

				var isfile;
				try{ isfile = fs.statSync(a).isFile() } catch(e){}

				// execute the right mode
				if(a.match(/\.gz$/i)) return gzPlaybackMode(f, a, sender)
				if(a.match(/\.js$/i) || isfile) return nodeJSMode(f, a, arg.slice(i+1), sender)
				if(a.match(/^https?/)) return proxyMode(f, tgtport, bind, a, sender)
				return browserJSMode(f, tgtport, bind, path.resolve(process.cwd(), a), sender)

				break
			}
		}
		usage("Error, no target specified")
	}

	return processArgs(process.argv)

	// create a file finder
	function fileFinder(root){

		var scanHash
		function scan(dir, done) {
			fs.readdir(dir, function(err, list) {
				if (err) return done(err)
				var i = 0
				function next() {
					var file = list[i++]
					if (!file) return done()
					file = dir + '/' + file
					fs.stat(file, function(err, stat) {
						if (stat && stat.isDirectory()) scan(file, next)
						else {
							var f = file.toLowerCase().split('/')
							while(f.length){
								scanHash[f.join('/')] = file
								f.shift()
							}
							next()
						}
					})
				}
				next()
			})
		}

		return function(file, found){
			// open a file in the editor
			fs.stat(file, function(err, stat){
				if(!err) return found(null, file)
				var sp = file.split('/')
				resolve()
				function resolve(){
					if(sp.length == 0){ // not found the fast way
						function find(){
							var f = file.toLowerCase().split('/')
							while(f.length){
								var sf  = scanHash[f.join('/')]
								if(sf) return found(null, sf)
								f.shift()
							}
							return found("Could not match "+file+" to anything in "+root)
						}
						if(!scanHash){
							console.log("Building file find search db from "+root+" ..")
							scanHash = {}
							scan(root, find)
						} 
						else find()
					} else {
						var sf = path.resolve(root, sp.join('/'))
						fs.stat(sf, function(err, stat){
							if(!err) return found(null, sf)
							sp.shift()
							resolve()
						})
					}
				}
			})
		}
	}

	function openEditor(file, line){
		var ed
		var s = define.settings
		if(!s.editors || 
			!(ed = s.editors[process.platform]))
			return console.log("No editor settings available for your platform")
		// lets try all editors
		for(var k in ed){
			if(fs.existsSync(ed[k].bin)){
				// execute editor
				var rep = {file:file, line:line}
				var args = ed[k].args
				var narg = []
				for(var i = 0;i<args.length;i++){
					narg[i] = args[i].replace(/\$(\w+)/g,function(m,a){
						if(!a in rep) console.log("Opening editor: argument not supported "+a)
						return rep[a]
					})
				}
				console.log('Opening '+file+' line '+line+' with '+k)
				var child = childproc.spawn(ed[k].bin, narg,{
					detached:true,
					stdio:[process.stdin,process.stdout,process.stderr]
				})
				return
			}
		}
	}

	// send data to UI
	function uiSender(port, bind){
		ui = ioServer()
		ui.main = "./trace/trace_client"
		ui.pass = fn.sha1hex("p4ssw0rd")
		if(require.absolute)
			ui.packaged = require.absolute('./trace_client')
		else
			ui.packaged = 1
		ui.favicon = "base64:site/favicon.ico"
		ui.listen(port, bind)
		out("~~[trace.GL]~w~ WebGL trace UI: http://"+bind+":"+port+"\n")

		var dict = []
		var queue = []
		var joined = false 

		var finder = fileFinder(process.cwd())

		// set a filewatch on settings
		if(define.settingsFile)
		fs.exists(define.settingsFile, function(exists){
			if(exists){
				fs.watch(define.settingsFile, function(){
					loadSettings(define.settingsFile)
					ui.send({settings:define.settings})
					console.log("Reloading settings file "+define.settingsFile)
				})
			}
		})

		// incoming channel data
		ui.data = function(m, c){
			if(m.t == 'join'){
				for(var i = 0;i<dict.length;i++) c.send(dict[i])
				for(var i = 0;i<queue.length;i++) c.send(queue[i])
				joined = true
			} else if(m.t == 'open'){
				finder(m.file, function(err, file){
					if(err) return console.log(err)
					openEditor(file, m.line)
				})
				// next up is just eating off
			}
			else console.log('unused message',m)
		}

		// outgoing data channel
		var lgc = 0
		return function(m){
			// verify ordering
			if(!m.dict){
				if(!lgc) lgc = m.g
				else{
					if(lgc + 1 != m.g){
						console.log("Message order error", lgc, m.g)
					}
					lgc = m.g
				}
				if(joined && m.d == 1) queue = [] // clear the queue at depth 1
				queue.push(m)
			} else {	// keep dictionaries for join
				dict.push(m)
			}
			// keep all messages with depth 0
			if(joined) ui.send(m)
		}
	}

	// send data to zip
	function gzSender(file){
		// pipe writer into gzip into file
		var gz = zlib.createGzip()
		var fstr = fs.createWriteStream(file)
		fstr.on('error', function(err){
			console.log("Error writing "+file+" "+err)
		})
		
		gz.on('error', function(err){
			console.log("Error zipping "+file+" "+err)
		})

		gz.pipe(fstr)
		
		var buf = []
		var total = 0

		function flush(){
			if(buf.length){
				gz.write(buf.join(''))
				buf = []
				total = 0
			}
		}

		var terminated = false
		process.on('SIGINT', function() {
			terminated = true
			console.log('got sigint, flushing gz')
			process.stdin.resume()
			flush()
			// wait for the drain, then end and exit
			gz.flush(function(){
				fstr.end(function(){
					console.log("end!")
					process.exit(0)
				})
			})
		});

		process.on('exit', function(){
			console.log('exit!')
			//gz.end()
		})


		return function(m){
			if(!terminated){
				// we should buffer atleast a megabyte
				var data = '\x1f'+JSON.stringify(m)+'\x17'
				buf.push(data)
				total += data.length
				if(total > 1024*1024) flush()
			}
		}
	}

	// app server
	function browserJSMode(filter, port, bind, root, sender){

		// start the target server
		var tgt = ioServer()
		tgt.root = root
		tgt.listen(port, bind)
		//appHttp.watcher = define.watcher()
		out("~~[trace.GL]~w~ Serving browser JS: http://"+bind+":"+port+"\n")

		// incoming message, forward to sender
		tgt.data = function(m, c){
			sender(m)
		}
		
		var fileCache= {}		
		var did = 1 // count instrument offset id
		
		tgt.fileChange = function(f){
			// lets flush everything
			fileCache = {}
			did = 1
			// send reload message to UI
			sender({reload:1})
		}

		tgt.process = function(file, data, type){
			if(type != "application/javascript") return data

			if(filter.active && filter(file)) return data
			// cache
			if(fileCache[file]) return fileCache[file].output
			// lets use trace
			var t = fileCache[file] = instrument(file, data.toString('utf8'), did, filter.opt)
			did = t.id
			// send to UI
			sender({dict:1, f:file, src:t.input, d:t.d})
			return t.output
		}
	}

	function streamParser(dataCb, sideCb){
		var last = ""
		return function(d){
			var data = last + d.toString();
			last = "";
			data = data.replace(/\x1f(.*?)\x17/g, function(x, m){
				try{
					dataCb(JSON.parse(m))
				} catch(e){
					fn('error in '+e,m)
				}
				return ''
			})
			if(data.indexOf('\x1f')!= -1) last = data;
			else if(data.length && sideCb) sideCb(data)
		}
	}

	// node server
	function nodeJSMode(filter, file, args, sender){
		// we start up ourselves with -l
		var cp = require('child_process')
		args.unshift(file)
		args.unshift('-l' + filter.stringify())
		args.unshift(process.argv[1])
 		
 		var stdio = [process.stdin, process.stdout,'pipe']
 		//if(process.version.indexOf('v0.8') != -1)	stdio.push('ipc')

		var child = cp.spawn(process.execPath, args, {
			stdio: stdio
		})

		// stderr datapath
		var sp = streamParser(sender, function(d){
			process.stderr.write(d)
		})
		if(child.stderr) child.stderr.on('data',sp)

		// ipc datapath
		child.on('message', function(m){
			sender(m)
		})
	}

	function proxyMode(filter, port, bind, proxy, sender){
		// start the target server
		var tgt = ioServer()
		tgt.root = root
		tgt.proxy = url.parse(proxy)
		tgt.listen(port, "0.0.0.0")

		//appHttp.watcher = define.watcher()
		out("~~[trace.GL]~w~ Proxying browser JS: http://"+bind+":"+port+" -> "+proxy+"\n")

		// incoming message, forward to sender
		tgt.data = function(m, c){
			sender(m)
		}
		
		var fileCache= {}		
		var did = 1 // count instrument offset id
		tgt.process = function(file, data, type){
			if(type != "application/javascript") return data

			if(filter.active && filter(file)) return data
			// turn off cache
			// if(fileCache[file]) return fileCache[file].output
			// lets use trace
			var t = fileCache[file] = instrument(file, data.toString('utf8'), did, filter.opt)
			did = t.id
			// send to UI
			sender({dict:1, f:file, src:t.input, d:t.d})

			// dump the last 100 chars
			return t.output
		}
	}

	function gzPlaybackMode(filter, file, sender){
		// just output the gz file to sender
		var rs = fs.createReadStream(file)
		var gz = zlib.createGunzip()
		process.stdout.write("Loading gzipped trace .")
		rs.pipe(gz)
		var sp = streamParser(function(m){
			if(m.g%1000 == 0) process.stdout.write(".")
			sender(m)
		})
		gz.on('data', sp)
		gz.on('end', function(){
			process.stdout.write("Complete!\n")
		})
	}
})