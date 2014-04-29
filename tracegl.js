#!/usr/bin/env node
// | Trace server |________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   


define('/trace/trace_server',function(require){

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
		ui.favicon = "R0lGODlhEAAQAPcAAAAAAAMBAAIAAwIDAQICAgEBBAIABAIABQIBBAAGAAAGAQAHAAAHAQEHAAEHAQIFAQMFAQIEAgIGAAIGAQMFBAQCAwYBAgYDAwYDBQcDBAQEAAQFAwUEAgUFAgUGAAQGAgUGAgYFAgYFAwYGAQcGAwQEBAUEBAUEBQUFBAYEBAYEBQYGBgAIAAAJAAEIAQEJAQIIAAULAQQLAgcJAQcJAgcKAAgEAwsGAg4FBggJAgsKCAsLDAARAAASAAATAAtvCgV0BwN9BQZ4BAZ9Bwl2Aw9wCQ5wDAx+CQ1+ChBvDxNuDBZsERVsHRhtEhhuERhvERhvExB8DBJxEBVzERZxExVyFBV1EhV2FRZ2FhZ2FxF7ERV4EhV6EhZ6ERZ8EhZ8Fhh0Exl1Exp4FiRsHSFzHSNsISNsIyRrIiRsIiZsI6usra6rrL+/wb2/xL2/x7+8x76/xL6+xr6+ybnBx7zAw7/AwL/Aw7/Bxb7Ax73Hwr7EwsK/wMG9xcC/xcS/xcDBwsLAwcPDwcPDwsDDxcPDxMHEw8HGwcLEw8LGx8TFwMTExMbGx8TFyMfFyMXGzMPKw8TIycjFxtv/3d//4OD/3OL/3uL/4uP/5OP/5+v/7Pf/9/j++Pj/+Pn/+fr/+Pv/+vz8/P3+/szMzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAkKAKIAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAEAAQAAAI/gBBARhIsGDBUBjs0FnIsOHCOydUGAJQZGBFihYBLDphY5AFKDloLIkho0mNGU9UCOKQ4VGRKFewHAkDBkmWK1qK9OEQQpGHKQoYUJkgoUqDBFZGICqhgg0IIZs4BWHAYIgmT0Q0NFLRwc6NTBA+THoAw1KEDZhwQDphIlERSWbOXBqTplIZNJSKrDGB4s8lMi5YbPnUScwLB0AuFTKRQg0BLz54cOnh40uPHl0GACJhgtCOIgtY/GDBwgiLFkp0MKogIlARKUWKOImdJDaTIpEyXNCDsffFiocopPCTpw4eOG3eyOHjJs4cR3sygBIhQACC6wgKGDiwPcAKUAEBACH5BAlkAI0ALAAAAAAQABAAhwAAAAMBAAIAAwIDAQICAgEBBAIABAIABQIBBAAGAAAGAQAHAAAHAQEHAAEHAQIFAQMFAQIEAgIGAAIGAQMFBAQCAwYBAgYDAwYDBQcDBAQEAAUEAgUFAgUGAAUGAgYFAgYFAwYGAQcGAwQEBAUEBAUEBQUFBAYEBAYEBQYGBgAIAAAJAAEIAQEJAQULAQQLAgcJAQcJAgcKAAgEAw4FBggJAgsKCAsLDAwICAARAAASAAATAAtvCgN9BQl2Aw9wCQ5wDAx+CQ1+ChBvDxNuDBZsERVsHRhtEhhuERhvERhvExB8DBJxEBVzERZxExVyFBV1EhV2FRZ2FhZ2FxF7ERV6EhZ6ERZ8EhZ8Fhh0Exl1Exp4FiFzHSNsISNsI6usra6rrL+/wb2/xL2/x7+8x76/xL6+xr6+ybnBx7zAw7/AwL/Aw7/Bxb7Ax73Hwr7EwsK/wMG9xcC/xcS/xcDBwsLAwcPDwcPDwsDDxcPDxMHEw8HGwcLEw8LGx8TFwMTExMbGx8TFyMfFyMXGzMPKw8TIycjFxuP/5Pf/9/j++Pv/+vz8/P3+/szMzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAj1ABcBGEiwYEFGGNakWciw4UI2JVDsAfBjYEWKFgEAKjEDjwUlNWIUcfHiiAwYSVDc2ZCB0I8lUaQE0ZJFyJQoVH7I2fDhT4cmChg4mSDhSYMEUEL0GYEijIdDiRj0YMDgECIGPjQIQsFhzaEfEL4++BrhK41CJUj4+erl64+vXdyCIWGCDg4uLFQcUsRgSwsHhw7pIXHiC4ErO3JU0bEDiw4dVgbUEUEiz40fC1TwUKECiIoVRGwEqgDCzg8mP34gST0ktZEfhjJceIOx9sWKfCicmONGTZsyYsiciTPGDJpBcDIsAiFAAILnCAoYODA9QIpFAQEAIfkECQoAhAAsAAAAABAAEACHAAAAAwEAAgADAgMBAgICAQEEAgAEAgAFAgEEAAYAAAYBAAcAAAcBAQcAAgYAAgYBAwUEBAIDBgECBgMDBgMFBwMEBAQABQQCBQUCBQYABgUCBgUDBgYBBwYDBAQEBQQEBQQFBQUEBgQEBgQFBgYGAAgAAAkAAQgBAQkBBQsBBAsCBwkBBwkCBwoACAQDCAkCCwoICwsMDAgIABEAABIAABMAC28KA30FCXYDD3AJDnAMDH4JDX4KEG8PE24MFmwRFWwdGG0SGG4RGG8RGG8TEHwMEnEQFXMRFnETFXIUFXUSFXYVFnYWFnYXEXsRFXoSFnoRFnwSFnwWGHQTGXUTGnUUGngWIXMdq6ytrqusv7/Bvb/Evb/Hv7zHvr/Evr7Gvr7JucHHvMDDv8DAv8DDv8HFvsDHvcfCvsTCwr/Awb3FwL/FxL/FwMHCwsDBw8PBw8PCwMPFw8PEwcTDwcbBwsTDwsbHxMXAxMTExsbHxMXIx8XIxcbMw8rDxMjJyMXG4//k+P/4/Pz8/f7+zMzMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACOoABQEYSLBgwUEUyIhZyLDhwjIgRtABkGNgRYoWAeQB4SKOBCIvWPxIoSJIixVDRsC5UKFPjiJLmOygMoVHkyVOcqy5oAFPhiMKGCB54CBJgwRKONjxMEJLIEAMGNyoAggqAxwW9ozAQIZBDqhfvYIF5AfEhzs5vqYFtHZtlg8h2si4cqJqVCso7M75IAILgSg1ZjyhUUMKDRpQBrjp8EFOjBwLStgoUUJHCRM+YOiJsOFNDiNphaTtkRZIjj8VJqDByPpixToQRLA5M8aMly1dwKjh8iUMnzQVBG0QIACBcQQFDBxQHoCEoIAAIfkECQoAgAAsAAAAABAAEACHAAAAAwEAAgADAgMBAgICAQEEAgAEAgAFAgEEAAYAAAYBAAcAAAcBAQcAAgYAAgYBAwUEBAIDBgECBgMDBgMFBwMEBQQCBQUCBQYABgUCBgUDBgYBBwYDBAQEBQQEBQQFBQUEBgQEBgQFBgYGAAgAAAkABQsBBAsCBwkBBwkCBwoACAQDCAkCCwoICwsMDAgIABEAABIAABMAC28KA30FCXYDD3AJDnAMDH4JDX4KEG8PE24MFmwRFWwdGG0SGG4RGG8RGG8TEHwMEnEQFXMRFnETFXIUFXUSFXYVFnYWFnYXEXsRFXoSFnoRFnwSFnwWGHQTGXUTGngWIXMdq6ytrqusv7/Bvb/Evb/Hv7zHvr/Evr7Gvr7JucHHvMDDv8DAv8DDv8HFvsDHvcfCvsTCwr/Awb3FwL/FxL/FwMHCwsDBw8PBw8PCwMPFw8PEwcTDwcbBwsTDwsbHxMXAxMTExsbHxMXIx8XIxcbMw8rDxMjJyMXG4//k+P/4/Pz8/f7+zMzMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACOkA/QAYSLBgwT8UwHhZyLDhwjAfRMABYGNgRYoWAdT5sKKNhCAsUvAwccKHChRARLCxUCGPDSFIkuCIAiWHEiRLbJyxkIEOBiIKGBR54MBIgwRHNsjpIMJKHxsMGNDgwwcqgxp87oi4AIYBn6hfvYJloOeDhzk2qqa1sXZtFQ8g0ryYQtWqlLoM3ngIQYWAExkwmMSQ8SRGjCYD1HDw4MaFjQUkZpAgcYNEiR0t7ETQsMbGELY/2Opg28PGngoTyGBcfbFiHAgh0Iz5IkbLlSxczGDZ0gVPmQp+NAgQgKA4ggIGDiQPMMJPQAAh+QQJCgB7ACwAAAAAEAAQAIYAAAADAQACAAMCAwECAgIBAQQCAAQCAAUCAQQABgAABgEABwAABwEBBwACBgACBgEDBQQEAgMGAQIGAwMGAwUHAwQFBAIFBQIFBgAGBQIGBQMGBgEHBgMEBAQFBAQFBAUFBQQGBAQGBAUGBgYACAAACQAFCwEECwIHCQEHCQIHCgAIBAMICQILCggLCwwMCAgAEQAAEgAAEwALbwoPcAkOcAwMfgkNfgoQbw8TbgwWbBEVbB0YbRIYbhEYbxEYbxMQfAwScRAVcxEWcRMVchQVdRIVdhUWdhYWdhcRexEVehIWehEWfBIWfBYYdBMZdROrrK2uq6y/v8G9v8S9v8e/vMe+v8S+vsa+vsm5wce8wMO/wMC/wMO/wcW+wMe9x8K+xMLCv8DBvcXAv8XEv8XAwcLCwMHDw8HDw8LAw8XDw8TBxMPBxsHCxMPCxsfExcDExMTGxsfExcjHxcjFxszDysPEyMnIxcbj/+T8/Pz9/v7MzMwAAAAAAAAAAAAAAAAH1YB5AIOEhYV6FFxai4yNi10fImwANIOVlJYAcR8raRI/LCk6Jic8Kig+ImgWFXU0QEZHNk9ON0hGSTRjFhlwGEIKDEMPDkQNCUUbbh0iUgw0DAx4eM/R03MiF1x40NzS3dB2Hx5v3DTm6DQ0UR4gZS/T1dLmDGseIVAETDIwSjEyTWLEWDLADAcPalzQWEBiBgkSNUiUyNFCTgQNZ2gEUddDHQ51O2jcqTABDKaTlyq1gRCCzJctXqxMqYJFDJUrWeiEqZBHgwABCIIiKGDgQNEAI/IEAgAh+QQJCgB6ACwAAAAAEAAQAIYAAAADAQACAAMCAwECAgIBAQQCAAQCAAUCAQQABgAABgEABwAABwEBBwACBgACBgEDBQQEAgMGAQIGAwMGAwUHAwQFBAIFBQIFBgAGBQIGBQMGBgEHBgMEBAQFBAQFBAUFBQQGBAQGBAUGBgYACAAACQAFCwEECwIHCQEHCQIHCgAIBAMICQILCggLCwwAEQAAEgAAEwALbwoPcAkOcAwMfgkNfgoQbw8TbgwWbBEVbB0YbRIYbhEYbxEYbxMQfAwScRAVcxEWcRMVchQVdRIVdhUWdhYWdhcRexEVehIWehEWfBIWfBYYdBMZdROrrK2uq6y/v8G9v8S9v8e/vMe+v8S+vsa+vsm5wce8wMO/wMC/wMO/wcW+wMe9x8K+xMLCv8DBvcXAv8XEv8XAwcLCwMHDw8HDw8LAw8XDw8TBxMPBxsHCxMPCxsfExcDExMTGxsfExcjHxcjFxszDysPEyMnIxcbj/+T8/Pz9/v7MzMwAAAAAAAAAAAAAAAAAAAAH04B4AIOEhYV5FFtZi4yNi1wfImsAM4OVlJYAcB8raBI+LCk5Jic7Kig9ImcWFXQzP0VGNU5NNkdFSDNiFhlvGEEKDEIPDkMNCUQbbR0iUQwzDHd3DM/R03IiF1vP0zPd33UfHm4z3uV35+dQHiBk0tTQ79VqHiFPBEsxL0kwMUwwMJQMKMPBQxoXMxaQkEGCBA0SJXC0iBNBg5kZQMrxKHejnI4ZdipM+IKp5KVKbCCEGONFS5cqUqhcCTPFCpY5YCrg0SBAAIKfCAoYODA0wAg8gQAAOw=="
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
function define(id,fac){
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
}

// | Function, utility lib|_____________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/  

define('/core/fn',function(){

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
// Acorn is a tiny, fast JavaScript parser written in JavaScript.
//
// Acorn was written by Marijn Haverbeke and released under an MIT
// license. The Unicode regexps (for identifiers and whitespace) were
// taken from [Esprima](http://esprima.org) by Ariya Hidayat.
//
// Git repositories for Acorn are available at
//
//     http://marijnhaverbeke.nl/git/acorn
//     https://github.com/marijnh/acorn.git
//
// Please use the [github bug tracker][ghbt] to report issues.
//
// [ghbt]: https://github.com/marijnh/acorn/issues
//
// This file defines the main parser interface. The library also comes
// with a [error-tolerant parser][dammit] and an
// [abstract syntax tree walker][walk], defined in other files.
//
// [dammit]: acorn_loose.js
// [walk]: util/walk.js

define('/core/acorn',function(require, exports, module){
  "no tracegl"
  "use strict";
  exports.version = "0.1.01";

  // The main exported interface (under `self.acorn` when in the
  // browser) is a `parse` function that takes a code string and
  // returns an abstract syntax tree as specified by [Mozilla parser
  // API][api], with the caveat that the SpiderMonkey-specific syntax
  // (`let`, `yield`, inline XML, etc) is not recognized.
  //
  // [api]: https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API

  var options, input, inputLen, sourceFile;
  var hack

  exports.parse = function(inpt, opts, inhack) {
    input = String(inpt); inputLen = input.length;
    hack = inhack
    setOptions(opts);
    initTokenState();
    return parseTopLevel(options.program);
  };

  // A second optional argument can be given to further configure
  // the parser process. These options are recognized:

  var defaultOptions = exports.defaultOptions = {
    // `ecmaVersion` indicates the ECMAScript version to parse. Must
    // be either 3 or 5. This
    // influences support for strict mode, the set of reserved words, and
    // support for getters and setter.
    ecmaVersion: 5,
    // Turn on `strictSemicolons` to prevent the parser from doing
    // automatic semicolon insertion.
    strictSemicolons: false,
    // When `allowTrailingCommas` is false, the parser will not allow
    // trailing commas in array and object literals.
    allowTrailingCommas: true,
    // By default, reserved words are not enforced. Enable
    // `forbidReserved` to enforce them.
    forbidReserved: false,
    // When `locations` is on, `loc` properties holding objects with
    // `start` and `end` properties in `{line, column}` form (with
    // line being 1-based and column 0-based) will be attached to the
    // nodes.
    locations: false,
    // A function can be passed as `onComment` option, which will
    // cause Acorn to call that function with `(block, text, start,
    // end)` parameters whenever a comment is skipped. `block` is a
    // boolean indicating whether this is a block (`/* */`) comment,
    // `text` is the content of the comment, and `start` and `end` are
    // character offsets that denote the start and end of the comment.
    // When the `locations` option is on, two more parameters are
    // passed, the full `{line, column}` locations of the start and
    // end of the comments.
    onComment: null,
    // Nodes have their start and end characters offsets recorded in
    // `start` and `end` properties (directly on the node, rather than
    // the `loc` object, which holds line/column data. To also add a
    // [semi-standardized][range] `range` property holding a `[start,
    // end]` array with the same numbers, set the `ranges` option to
    // `true`.
    //
    // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
    ranges: false,
    // It is possible to parse multiple files into a single AST by
    // passing the tree produced by parsing the first file as
    // `program` option in subsequent parses. This will add the
    // toplevel forms of the parsed file to the `Program` (top) node
    // of an existing parse tree.
    program: null,
    // When `location` is on, you can pass this to record the source
    // file in every node's `loc` object.
    sourceFile: null
  };

  function setOptions(opts) {
    options = opts || {};
    for (var opt in defaultOptions) if (!options.hasOwnProperty(opt))
      options[opt] = defaultOptions[opt];
    sourceFile = options.sourceFile || null;
  }

  // The `getLineInfo` function is mostly useful when the
  // `locations` option is off (for performance reasons) and you
  // want to find the line/column position for a given character
  // offset. `input` should be the code string that the offset refers
  // into.

  var getLineInfo = exports.getLineInfo = function(input, offset) {
    for (var line = 1, cur = 0;;) {
      lineBreak.lastIndex = cur;
      var match = lineBreak.exec(input);
      if (match && match.index < offset) {
        ++line;
        cur = match.index + match[0].length;
      } else break;
    }
    return {line: line, column: offset - cur};
  };

  // Acorn is organized as a tokenizer and a recursive-descent parser.
  // The `tokenize` export provides an interface to the tokenizer.
  // Because the tokenizer is optimized for being efficiently used by
  // the Acorn parser itself, this interface is somewhat crude and not
  // very modular. Performing another parse or call to `tokenize` will
  // reset the internal state, and invalidate existing tokenizers.

  exports.tokenize = function(inpt, opts) {
    input = String(inpt); inputLen = input.length;
    setOptions(opts);
    initTokenState();

    var t = {};
    function getToken(forceRegexp) {
      readToken(forceRegexp);
      t.start = tokStart; t.end = tokEnd;
      t.startLoc = tokStartLoc; t.endLoc = tokEndLoc;
      t.type = tokType; t.value = tokVal;
      return t;
    }
    getToken.jumpTo = function(pos, reAllowed) {
      tokPos = pos;
      if (options.locations) {
        tokCurLine = tokLineStart = lineBreak.lastIndex = 0;
        var match;
        while ((match = lineBreak.exec(input)) && match.index < pos) {
          ++tokCurLine;
          tokLineStart = match.index + match[0].length;
        }
      }
      var ch = input.charAt(pos - 1);
      tokRegexpAllowed = reAllowed;
      skipSpace();
    };
    return getToken;
  };

  // State is kept in (closure-)global variables. We already saw the
  // `options`, `input`, and `inputLen` variables above.

  // The current position of the tokenizer in the input.

  var tokPos;

  // The start and end offsets of the current token.

  var tokStart, tokEnd;

  // When `options.locations` is true, these hold objects
  // containing the tokens start and end line/column pairs.

  var tokStartLoc, tokEndLoc;

  // The type and value of the current token. Token types are objects,
  // named by variables against which they can be compared, and
  // holding properties that describe them (indicating, for example,
  // the precedence of an infix operator, and the original name of a
  // keyword token). The kind of value that's held in `tokVal` depends
  // on the type of the token. For literals, it is the literal value,
  // for operators, the operator name, and so on.

  var tokType, tokVal;

  // Interal state for the tokenizer. To distinguish between division
  // operators and regular expressions, it remembers whether the last
  // token was one that is allowed to be followed by an expression.
  // (If it is, a slash is probably a regexp, if it isn't it's a
  // division operator. See the `parseStatement` function for a
  // caveat.)

  var tokRegexpAllowed;

  // When `options.locations` is true, these are used to keep
  // track of the current line, and know when a new line has been
  // entered.

  var tokCurLine, tokLineStart;

  // These store the position of the previous token, which is useful
  // when finishing a node and assigning its `end` position.

  var lastStart, lastEnd, lastEndLoc;

  // This is the parser's state. `inFunction` is used to reject
  // `return` statements outside of functions, `labels` to verify that
  // `break` and `continue` have somewhere to jump to, and `strict`
  // indicates whether strict mode is on.

  var inFunction, labels, strict;

  // This function is used to raise exceptions on parse errors. It
  // takes an offset integer (into the current `input`) to indicate
  // the location of the error, attaches the position to the end
  // of the error message, and then raises a `SyntaxError` with that
  // message.

  function raise(pos, message) {
    var loc = getLineInfo(input, pos);
    message += " (" + loc.line + ":" + loc.column + ")";
    var err = new SyntaxError(message);
    err.pos = pos; err.loc = loc; err.raisedAt = tokPos;
    throw err;
  }

  // ## Token types

  // The assignment of fine-grained, information-carrying type objects
  // allows the tokenizer to store the information it has about a
  // token in a way that is very cheap for the parser to look up.

  // All token type variables start with an underscore, to make them
  // easy to recognize.

  // These are the general types. The `type` property is only used to
  // make them recognizeable when debugging.

  var _num = {type: "num"}, _regexp = {type: "regexp"}, _string = {type: "string"};
  var _name = {type: "name"}, _eof = {type: "eof"};

  // Keyword tokens. The `keyword` property (also used in keyword-like
  // operators) indicates that the token originated from an
  // identifier-like word, which is used when parsing property names.
  //
  // The `beforeExpr` property is used to disambiguate between regular
  // expressions and divisions. It is set on all token types that can
  // be followed by an expression (thus, a slash after them would be a
  // regular expression).
  //
  // `isLoop` marks a keyword as starting a loop, which is important
  // to know when parsing a label, in order to allow or disallow
  // continue jumps to that label.

  var _break = {keyword: "break"}, _case = {keyword: "case", beforeExpr: true}, _catch = {keyword: "catch"};
  var _continue = {keyword: "continue"}, _debugger = {keyword: "debugger"}, _default = {keyword: "default"};
  var _do = {keyword: "do", isLoop: true}, _else = {keyword: "else", beforeExpr: true};
  var _finally = {keyword: "finally"}, _for = {keyword: "for", isLoop: true}, _function = {keyword: "function"};
  var _if = {keyword: "if"}, _return = {keyword: "return", beforeExpr: true}, _switch = {keyword: "switch"};
  var _throw = {keyword: "throw", beforeExpr: true}, _try = {keyword: "try"}, _var = {keyword: "var"};
  var _while = {keyword: "while", isLoop: true}, _with = {keyword: "with"}, _new = {keyword: "new", beforeExpr: true};
  var _this = {keyword: "this"}, _const = {keyword:"const"};

  // The keywords that denote values.

  var _null = {keyword: "null", atomValue: null}, _true = {keyword: "true", atomValue: true};
  var _false = {keyword: "false", atomValue: false};

  // Some keywords are treated as regular operators. `in` sometimes
  // (when parsing `for`) needs to be tested against specifically, so
  // we assign a variable name to it for quick comparing.

  var _in = {keyword: "in", binop: 7, beforeExpr: true};

  // Map keyword names to token types.

  var keywordTypes = {"break": _break, "case": _case, "catch": _catch,
                      "continue": _continue, "debugger": _debugger, "default": _default,
                      "do": _do, "else": _else, "finally": _finally, "for": _for,
                      "function": _function, "if": _if, "return": _return, "switch": _switch,
                      "throw": _throw, "try": _try, "var": _var, "while": _while, "with": _with,
                      "null": _null, "true": _true, "false": _false, "new": _new, "in": _in,
                      "instanceof": {keyword: "instanceof", binop: 7, beforeExpr: true}, "this": _this,
                      "typeof": {keyword: "typeof", prefix: true, beforeExpr: true},
                      "void": {keyword: "void", prefix: true, beforeExpr: true},
                      "delete": {keyword: "delete", prefix: true, beforeExpr: true},
                   	 "const": _const};

  // Punctuation token types. Again, the `type` property is purely for debugging.

  var _bracketL = {type: "[", beforeExpr: true}, _bracketR = {type: "]"}, _braceL = {type: "{", beforeExpr: true};
  var _braceR = {type: "}"}, _parenL = {type: "(", beforeExpr: true}, _parenR = {type: ")"};
  var _comma = {type: ",", beforeExpr: true}, _semi = {type: ";", beforeExpr: true};
  var _colon = {type: ":", beforeExpr: true}, _dot = {type: "."}, _question = {type: "?", beforeExpr: true};

  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator. `isUpdate` specifies that the node produced by
  // the operator should be of type UpdateExpression rather than
  // simply UnaryExpression (`++` and `--`).
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.

  var _slash = {binop: 10, beforeExpr: true}, _eq = {isAssign: true, beforeExpr: true};
  var _assign = {isAssign: true, beforeExpr: true}, _plusmin = {binop: 9, prefix: true, beforeExpr: true};
  var _incdec = {postfix: true, prefix: true, isUpdate: true}, _prefix = {prefix: true, beforeExpr: true};
  var _bin1 = {binop: 1, beforeExpr: true}, _bin2 = {binop: 2, beforeExpr: true};
  var _bin3 = {binop: 3, beforeExpr: true}, _bin4 = {binop: 4, beforeExpr: true};
  var _bin5 = {binop: 5, beforeExpr: true}, _bin6 = {binop: 6, beforeExpr: true};
  var _bin7 = {binop: 7, beforeExpr: true}, _bin8 = {binop: 8, beforeExpr: true};
  var _bin10 = {binop: 10, beforeExpr: true};

  // Provide access to the token types for external users of the
  // tokenizer.

  exports.tokTypes = {bracketL: _bracketL, bracketR: _bracketR, braceL: _braceL, braceR: _braceR,
                      parenL: _parenL, parenR: _parenR, comma: _comma, semi: _semi, colon: _colon,
                      dot: _dot, question: _question, slash: _slash, eq: _eq, name: _name, eof: _eof,
                      num: _num, regexp: _regexp, string: _string};
  for (var kw in keywordTypes) exports.tokTypes[kw] = keywordTypes[kw];

  // This is a trick taken from Esprima. It turns out that, on
  // non-Chrome browsers, to check whether a string is in a set, a
  // predicate containing a big ugly `switch` statement is faster than
  // a regular expression, and on Chrome the two are about on par.
  // This function uses `eval` (non-lexical) to produce such a
  // predicate from a space-separated string of words.
  //
  // It starts by sorting the words by length.

  function makePredicate(words) {
    words = words.split(" ");
    var f = "", cats = [];
    out: for (var i = 0; i < words.length; ++i) {
      for (var j = 0; j < cats.length; ++j)
        if (cats[j][0].length == words[i].length) {
          cats[j].push(words[i]);
          continue out;
        }
      cats.push([words[i]]);
    }
    function compareTo(arr) {
      if (arr.length == 1) return f += "return str === " + JSON.stringify(arr[0]) + ";";
      f += "switch(str){";
      for (var i = 0; i < arr.length; ++i) f += "case " + JSON.stringify(arr[i]) + ":";
      f += "return true}return false;";
    }

    // When there are more than three length categories, an outer
    // switch first dispatches on the lengths, to save on comparisons.

    if (cats.length > 3) {
      cats.sort(function(a, b) {return b.length - a.length;});
      f += "switch(str.length){";
      for (var i = 0; i < cats.length; ++i) {
        var cat = cats[i];
        f += "case " + cat[0].length + ":";
        compareTo(cat);
      }
      f += "}";

    // Otherwise, simply generate a flat `switch` statement.

    } else {
      compareTo(words);
    }
    return new Function("str", f);
  }

  // The ECMAScript 3 reserved word list.

  var isReservedWord3 = makePredicate("abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile");

  // ECMAScript 5 reserved words.

  var isReservedWord5 = makePredicate("class enum extends super const export import");

  // The additional reserved words in strict mode.

  var isStrictReservedWord = makePredicate("implements interface let package private protected public static yield");

  // The forbidden variable names in strict mode.

  var isStrictBadIdWord = makePredicate("eval arguments");

  // And the keywords.

  var isKeyword = makePredicate("break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this const");

  // ## Character categories

  // Big ugly regular expressions that match characters in the
  // whitespace, identifier, and identifier-start categories. These
  // are only applied when a character is found to actually have a
  // code point above 128.

  var nonASCIIwhitespace = /[\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/;
  var nonASCIIidentifierStartChars = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0\u08a2-\u08ac\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097f\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d\u0c58\u0c59\u0c60\u0c61\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d60\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f0\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191c\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19c1-\u19c7\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua697\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua793\ua7a0-\ua7aa\ua7f8-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa80-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uabc0-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";
  var nonASCIIidentifierChars = "\u0371-\u0374\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u0620-\u0649\u0672-\u06d3\u06e7-\u06e8\u06fb-\u06fc\u0730-\u074a\u0800-\u0814\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0840-\u0857\u08e4-\u08fe\u0900-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962-\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09d7\u09df-\u09e0\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2-\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b5f-\u0b60\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c01-\u0c03\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62-\u0c63\u0c66-\u0c6f\u0c82\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2-\u0ce3\u0ce6-\u0cef\u0d02\u0d03\u0d46-\u0d48\u0d57\u0d62-\u0d63\u0d66-\u0d6f\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2\u0df3\u0e34-\u0e3a\u0e40-\u0e45\u0e50-\u0e59\u0eb4-\u0eb9\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f41-\u0f47\u0f71-\u0f84\u0f86-\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u1000-\u1029\u1040-\u1049\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u170e-\u1710\u1720-\u1730\u1740-\u1750\u1772\u1773\u1780-\u17b2\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u1920-\u192b\u1930-\u193b\u1951-\u196d\u19b0-\u19c0\u19c8-\u19c9\u19d0-\u19d9\u1a00-\u1a15\u1a20-\u1a53\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1b46-\u1b4b\u1b50-\u1b59\u1b6b-\u1b73\u1bb0-\u1bb9\u1be6-\u1bf3\u1c00-\u1c22\u1c40-\u1c49\u1c5b-\u1c7d\u1cd0-\u1cd2\u1d00-\u1dbe\u1e01-\u1f15\u200c\u200d\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2d81-\u2d96\u2de0-\u2dff\u3021-\u3028\u3099\u309a\ua640-\ua66d\ua674-\ua67d\ua69f\ua6f0-\ua6f1\ua7f8-\ua800\ua806\ua80b\ua823-\ua827\ua880-\ua881\ua8b4-\ua8c4\ua8d0-\ua8d9\ua8f3-\ua8f7\ua900-\ua909\ua926-\ua92d\ua930-\ua945\ua980-\ua983\ua9b3-\ua9c0\uaa00-\uaa27\uaa40-\uaa41\uaa4c-\uaa4d\uaa50-\uaa59\uaa7b\uaae0-\uaae9\uaaf2-\uaaf3\uabc0-\uabe1\uabec\uabed\uabf0-\uabf9\ufb20-\ufb28\ufe00-\ufe0f\ufe20-\ufe26\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";
  var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
  var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");

  // Whether a single character denotes a newline.

  var newline = /[\n\r\u2028\u2029]/;

  // Matches a whole line break (where CRLF is considered a single
  // line break). Used to count lines.

  var lineBreak = /\r\n|[\n\r\u2028\u2029]/g;

  // Test whether a given character code starts an identifier.

  function isIdentifierStart(code) {
    if (code < 65) return code === 36;
    if (code < 91) return true;
    if (code < 97) return code === 95;
    if (code < 123)return true;
    return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code));
  }

  // Test whether a given character is part of an identifier.

  function isIdentifierChar(code) {
    if (code < 48) return code === 36;
    if (code < 58) return true;
    if (code < 65) return false;
    if (code < 91) return true;
    if (code < 97) return code === 95;
    if (code < 123)return true;
    return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code));
  }

  // ## Tokenizer

  // These are used when `options.locations` is on, for the
  // `tokStartLoc` and `tokEndLoc` properties.

  function line_loc_t() {
    this.line = tokCurLine;
    this.column = tokPos - tokLineStart;
  }

  // Reset the token state. Used at the start of a parse.

  function initTokenState() {
    tokCurLine = 1;
    tokPos = tokLineStart = 0;
    tokRegexpAllowed = true;
    skipSpace();
    // token tree output hack
    if(hack) hack.initTokenState(hack, tokPos, input)
  }

  // Called at the end of every token. Sets `tokEnd`, `tokVal`, and
  // `tokRegexpAllowed`, and skips the space after the token, so that
  // the next one's `tokStart` will point at the right position.

  function finishToken(type, val) {
    tokEnd = tokPos;
    if (options.locations) tokEndLoc = new line_loc_t;
    tokType = type;
    skipSpace();
    tokVal = val;
    tokRegexpAllowed = type.beforeExpr;
    // token tree output hack
    if(hack) hack.finishToken(hack, type, val, input, tokStart, tokEnd, tokPos)
  }

  function skipBlockComment() {
    var startLoc = options.onComment && options.locations && new line_loc_t;
    var start = tokPos, end = input.indexOf("*/", tokPos += 2);
    if (end === -1) raise(tokPos - 2, "Unterminated comment");
    tokPos = end + 2;
    if (options.locations) {
      lineBreak.lastIndex = start;
      var match;
      while ((match = lineBreak.exec(input)) && match.index < tokPos) {
        ++tokCurLine;
        tokLineStart = match.index + match[0].length;
      }
    }
    if (options.onComment)
      options.onComment(true, input.slice(start + 2, end), start, tokPos,
                        startLoc, options.locations && new line_loc_t);
  }

  function skipLineComment() {
    var start = tokPos;
    var startLoc = options.onComment && options.locations && new line_loc_t;
    var ch = input.charCodeAt(tokPos+=2);
    while (tokPos < inputLen && ch !== 10 && ch !== 13 && ch !== 8232 && ch !== 8329) {
      ++tokPos;
      ch = input.charCodeAt(tokPos);
    }
    if (options.onComment)
      options.onComment(false, input.slice(start + 2, tokPos), start, tokPos,
                        startLoc, options.locations && new line_loc_t);
  }

  // Called at the start of the parse and after every token. Skips
  // whitespace and comments, and.

  function skipSpace() {
    while (tokPos < inputLen) {
      var ch = input.charCodeAt(tokPos);
      if (ch === 32) { // ' '
        ++tokPos;
      } else if(ch === 13) {
        ++tokPos;
        var next = input.charCodeAt(tokPos);
        if(next === 10) {
          ++tokPos;
        }
        if(options.locations) {
          ++tokCurLine;
          tokLineStart = tokPos;
        }
      } else if (ch === 10) {
        ++tokPos;
        ++tokCurLine;
        tokLineStart = tokPos;
      } else if(ch < 14 && ch > 8) {
        ++tokPos;
      } else if (ch === 47) { // '/'
        var next = input.charCodeAt(tokPos+1);
        if (next === 42) { // '*'
          skipBlockComment();
        } else if (next === 47) { // '/'
          skipLineComment();
        } else break;
      } else if ((ch < 14 && ch > 8) || ch === 32 || ch === 160) { // ' ', '\xa0'
        ++tokPos;
      } else if (ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
        ++tokPos;
      } else {
        break;
      }
    }
  }

  // ### Token reading

  // This is the function that is called to fetch the next token. It
  // is somewhat obscure, because it works in character codes rather
  // than characters, and because operator parsing has been inlined
  // into it.
  //
  // All in the name of speed.
  //
  // The `forceRegexp` parameter is used in the one case where the
  // `tokRegexpAllowed` trick does not work. See `parseStatement`.

  function readToken_dot() {
    var next = input.charCodeAt(tokPos+1);
    if (next >= 48 && next <= 57) return readNumber(true);
    ++tokPos;
    return finishToken(_dot);
  }

  function readToken_slash() { // '/'
    var next = input.charCodeAt(tokPos+1);
    if (tokRegexpAllowed) {++tokPos; return readRegexp();}
    if (next === 61) return finishOp(_assign, 2);
    return finishOp(_slash, 1);
  }

  function readToken_mult_modulo() { // '%*'
    var next = input.charCodeAt(tokPos+1);
    if (next === 61) return finishOp(_assign, 2);
    return finishOp(_bin10, 1);
  }

  function readToken_pipe_amp(code) { // '|&'
    var next = input.charCodeAt(tokPos+1);
    if (next === code) return finishOp(code === 124 ? _bin1 : _bin2, 2);
    if (next === 61) return finishOp(_assign, 2);
    return finishOp(code === 124 ? _bin3 : _bin5, 1);
  }

  function readToken_caret() { // '^'
    var next = input.charCodeAt(tokPos+1);
    if (next === 61) return finishOp(_assign, 2);
    return finishOp(_bin4, 1);    
  }

  function readToken_plus_min(code) { // '+-'
    var next = input.charCodeAt(tokPos+1);
    if (next === code) return finishOp(_incdec, 2);
    if (next === 61) return finishOp(_assign, 2);
    return finishOp(_plusmin, 1);    
  }

  function readToken_lt_gt(code) { // '<>'
    var next = input.charCodeAt(tokPos+1);
    var size = 1;
    if (next === code) {
      size = code === 62 && input.charCodeAt(tokPos+2) === 62 ? 3 : 2;
      if (input.charCodeAt(tokPos + size) === 61) return finishOp(_assign, size + 1);
      return finishOp(_bin8, size);
    }
    if (next === 61)
      size = input.charCodeAt(tokPos+2) === 61 ? 3 : 2;
    return finishOp(_bin7, size);
  }
  
  function readToken_eq_excl(code) { // '=!'
    var next = input.charCodeAt(tokPos+1);
    if (next === 61) return finishOp(_bin6, input.charCodeAt(tokPos+2) === 61 ? 3 : 2);
    return finishOp(code === 61 ? _eq : _prefix, 1);
  }

  function getTokenFromCode(code) {
    switch(code) {
      // The interpretation of a dot depends on whether it is followed
      // by a digit.
    case 46: // '.'
      return readToken_dot();

      // Punctuation tokens.
    case 40: ++tokPos; return finishToken(_parenL);
    case 41: ++tokPos; return finishToken(_parenR);
    case 59: ++tokPos; return finishToken(_semi);
    case 44: ++tokPos; return finishToken(_comma);
    case 91: ++tokPos; return finishToken(_bracketL);
    case 93: ++tokPos; return finishToken(_bracketR);
    case 123: ++tokPos; return finishToken(_braceL);
    case 125: ++tokPos; return finishToken(_braceR);
    case 58: ++tokPos; return finishToken(_colon);
    case 63: ++tokPos; return finishToken(_question);

      // '0x' is a hexadecimal number.
    case 48: // '0'
      var next = input.charCodeAt(tokPos+1);
      if (next === 120 || next === 88) return readHexNumber();
      // Anything else beginning with a digit is an integer, octal
      // number, or float.
    case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: // 1-9
      return readNumber(false);

      // Quotes produce strings.
    case 34: case 39: // '"', "'"
      return readString(code);

    // Operators are parsed inline in tiny state machines. '=' (61) is
    // often referred to. `finishOp` simply skips the amount of
    // characters it is given as second argument, and returns a token
    // of the type given by its first argument.

    case 47: // '/'
      return readToken_slash(code);

    case 37: case 42: // '%*'
      return readToken_mult_modulo();

    case 124: case 38: // '|&'
      return readToken_pipe_amp(code);

    case 94: // '^'
      return readToken_caret();

    case 43: case 45: // '+-'
      return readToken_plus_min(code);

    case 60: case 62: // '<>'
      return readToken_lt_gt(code);

    case 61: case 33: // '=!'
      return readToken_eq_excl(code);

    case 126: // '~'
      return finishOp(_prefix, 1);
    }

    return false;
  }

  function readToken(forceRegexp) {
    if (!forceRegexp) tokStart = tokPos;
    else tokPos = tokStart + 1;
    if (options.locations) tokStartLoc = new line_loc_t;
    if (forceRegexp) return readRegexp();
    if (tokPos >= inputLen) return finishToken(_eof);

    var code = input.charCodeAt(tokPos);
    // Identifier or keyword. '\uXXXX' sequences are allowed in
    // identifiers, so '\' also dispatches to that.
    if (isIdentifierStart(code) || code === 92 /* '\' */) return readWord();
    
    var tok = getTokenFromCode(code);

    if (tok === false) {
      // If we are here, we either found a non-ASCII identifier
      // character, or something that's entirely disallowed.
      var ch = String.fromCharCode(code);
      if (ch === "\\" || nonASCIIidentifierStart.test(ch)) return readWord();
      raise(tokPos, "Unexpected character '" + ch + "'");
    } 
    return tok;
  }

  function finishOp(type, size) {
    var str = input.slice(tokPos, tokPos + size);
    tokPos += size;
    finishToken(type, str);
  }

  // Parse a regular expression. Some context-awareness is necessary,
  // since a '/' inside a '[]' set does not end the expression.

  function readRegexp() {
    var content = "", escaped, inClass, start = tokPos;
    for (;;) {
      if (tokPos >= inputLen) raise(start, "Unterminated regular expression");
      var ch = input.charAt(tokPos);
      if (newline.test(ch)) raise(start, "Unterminated regular expression");
      if (!escaped) {
        if (ch === "[") inClass = true;
        else if (ch === "]" && inClass) inClass = false;
        else if (ch === "/" && !inClass) break;
        escaped = ch === "\\";
      } else escaped = false;
      ++tokPos;
    }
    var content = input.slice(start, tokPos);
    ++tokPos;
    // Need to use `readWord1` because '\uXXXX' sequences are allowed
    // here (don't ask).
    var mods = readWord1();
    if (mods && !/^[gmsiy]*$/.test(mods)) raise(start, "Invalid regexp flag");
    return finishToken(_regexp, new RegExp(content, mods));
  }

  // Read an integer in the given radix. Return null if zero digits
  // were read, the integer value otherwise. When `len` is given, this
  // will return `null` unless the integer has exactly `len` digits.

  function readInt(radix, len) {
    var start = tokPos, total = 0;
    for (var i = 0, e = len == null ? Infinity : len; i < e; ++i) {
      var code = input.charCodeAt(tokPos), val;
      if (code >= 97) val = code - 97 + 10; // a
      else if (code >= 65) val = code - 65 + 10; // A
      else if (code >= 48 && code <= 57) val = code - 48; // 0-9
      else val = Infinity;
      if (val >= radix) break;
      ++tokPos;
      total = total * radix + val;
    }
    if (tokPos === start || len != null && tokPos - start !== len) return null;

    return total;
  }

  function readHexNumber() {
    tokPos += 2; // 0x
    var val = readInt(16);
    if (val == null) raise(tokStart + 2, "Expected hexadecimal number");
    if (isIdentifierStart(input.charCodeAt(tokPos))) raise(tokPos, "Identifier directly after number");
    return finishToken(_num, val);
  }

  // Read an integer, octal integer, or floating-point number.
  
  function readNumber(startsWithDot) {
    var start = tokPos, isFloat = false, octal = input.charCodeAt(tokPos) === 48;
    if (!startsWithDot && readInt(10) === null) raise(start, "Invalid number");
    if (input.charCodeAt(tokPos) === 46) {
      ++tokPos;
      readInt(10);
      isFloat = true;
    }
    var next = input.charCodeAt(tokPos);
    if (next === 69 || next === 101) { // 'eE'
      next = input.charCodeAt(++tokPos);
      if (next === 43 || next === 45) ++tokPos; // '+-'
      if (readInt(10) === null) raise(start, "Invalid number")
      isFloat = true;
    }
    if (isIdentifierStart(input.charCodeAt(tokPos))) raise(tokPos, "Identifier directly after number");

    var str = input.slice(start, tokPos), val;
    if (isFloat) val = parseFloat(str);
    else if (!octal || str.length === 1) val = parseInt(str, 10);
    else if (/[89]/.test(str) || strict) raise(start, "Invalid number");
    else val = parseInt(str, 8);
    return finishToken(_num, val);
  }

  // Read a string value, interpreting backslash-escapes.

  function readString(quote) {
    tokPos++;
    var out = "";
    for (;;) {
      if (tokPos >= inputLen) raise(tokStart, "Unterminated string constant");
      var ch = input.charCodeAt(tokPos);
      if (ch === quote) {
        ++tokPos;
        return finishToken(_string, out);
      }
      if (ch === 92) { // '\'
        ch = input.charCodeAt(++tokPos);
        var octal = /^[0-7]+/.exec(input.slice(tokPos, tokPos + 3));
        if (octal) octal = octal[0];
        while (octal && parseInt(octal, 8) > 255) octal = octal.slice(0, octal.length - 1);
        if (octal === "0") octal = null;
        ++tokPos;
        if (octal) {
          if (strict) raise(tokPos - 2, "Octal literal in strict mode");
          out += String.fromCharCode(parseInt(octal, 8));
          tokPos += octal.length - 1;
        } else {
          switch (ch) {
          case 110: out += "\n"; break; // 'n' -> '\n'
          case 114: out += "\r"; break; // 'r' -> '\r'
          case 120: out += String.fromCharCode(readHexChar(2)); break; // 'x'
          case 117: out += String.fromCharCode(readHexChar(4)); break; // 'u'
          case 85: out += String.fromCharCode(readHexChar(8)); break; // 'U'
          case 116: out += "\t"; break; // 't' -> '\t'
          case 98: out += "\b"; break; // 'b' -> '\b'
          case 118: out += "\u000b"; break; // 'v' -> '\u000b'
          case 102: out += "\f"; break; // 'f' -> '\f'
          case 48: out += "\0"; break; // 0 -> '\0'
          case 13: if (input.charCodeAt(tokPos) === 10) ++tokPos; // '\r\n'
          case 10: // ' \n'
            if (options.locations) { tokLineStart = tokPos; ++tokCurLine; }
            break;
          default: out += String.fromCharCode(ch); break;
          }
        }
      } else {
        if (ch === 13 || ch === 10 || ch === 8232 || ch === 8329) raise(tokStart, "Unterminated string constant");
        out += String.fromCharCode(ch); // '\'
        ++tokPos;
      }
    }
  }

  // Used to read character escape sequences ('\x', '\u', '\U').

  function readHexChar(len) {
    var n = readInt(16, len);
    if (n === null) raise(tokStart, "Bad character escape sequence");
    return n;
  }

  // Used to signal to callers of `readWord1` whether the word
  // contained any escape sequences. This is needed because words with
  // escape sequences must not be interpreted as keywords.

  var containsEsc;

  // Read an identifier, and return it as a string. Sets `containsEsc`
  // to whether the word contained a '\u' escape.
  //
  // Only builds up the word character-by-character when it actually
  // containeds an escape, as a micro-optimization.

  function readWord1() {
    containsEsc = false;
    var word, first = true, start = tokPos;
    for (;;) {
      var ch = input.charCodeAt(tokPos);
      if (isIdentifierChar(ch)) {
        if (containsEsc) word += input.charAt(tokPos);
        ++tokPos;
      } else if (ch === 92) { // "\"
        if (!containsEsc) word = input.slice(start, tokPos);
        containsEsc = true;
        if (input.charCodeAt(++tokPos) != 117) // "u"
          raise(tokPos, "Expecting Unicode escape sequence \\uXXXX");
        ++tokPos;
        var esc = readHexChar(4);
        var escStr = String.fromCharCode(esc);
        if (!escStr) raise(tokPos - 1, "Invalid Unicode escape");
        if (!(first ? isIdentifierStart(esc) : isIdentifierChar(esc)))
          raise(tokPos - 4, "Invalid Unicode escape");
        word += escStr;
      } else {
        break;
      }
      first = false;
    }
    return containsEsc ? word : input.slice(start, tokPos);
  }

  // Read an identifier or keyword token. Will check for reserved
  // words when necessary.

  function readWord() {
    var word = readWord1();
    var type = _name;
    if (!containsEsc) {
      if (isKeyword(word)) type = keywordTypes[word];
      else if (options.forbidReserved &&
               ((options.ecmaVersion === 3 ? isReservedWord3 : isReservedWord5)(word) ||
               strict && isStrictReservedWord(word)))
        raise(tokStart, "The keyword '" + word + "' is reserved");
    }
    return finishToken(type, word);
  }

  // ## Parser

  // A recursive descent parser operates by defining functions for all
  // syntactic elements, and recursively calling those, each function
  // advancing the input stream and returning an AST node. Precedence
  // of constructs (for example, the fact that `!x[1]` means `!(x[1])`
  // instead of `(!x)[1]` is handled by the fact that the parser
  // function that parses unary prefix operators is called first, and
  // in turn calls the function that parses `[]` subscripts — that
  // way, it'll receive the node for `x[1]` already parsed, and wraps
  // *that* in the unary operator node.
  //
  // Acorn uses an [operator precedence parser][opp] to handle binary
  // operator precedence, because it is much more compact than using
  // the technique outlined above, which uses different, nesting
  // functions to specify precedence, for all of the ten binary
  // precedence levels that JavaScript defines.
  //
  // [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser

  // ### Parser utilities

  // Continue to the next token.
  
  function next() {
    lastStart = tokStart;
    lastEnd = tokEnd;
    lastEndLoc = tokEndLoc;
    readToken();
  }

  // Enter strict mode. Re-reads the next token to please pedantic
  // tests ("use strict"; 010; -- should fail).

  function setStrict(strct) {
    strict = strct;
    /*if(!hack){
	    tokPos = lastEnd;
	    skipSpace();
	    readToken();
	 }*/
  }

  // Start an AST node, attaching a start offset.

  function node_t() {
    this.type = null;
    this.start = tokStart;
    this.end = null;
  }

  function node_loc_t() {
    this.start = tokStartLoc;
    this.end = null;
    if (sourceFile !== null) this.source = sourceFile;
  }

  function startNode() {
    var node = new node_t();
    if (options.locations)
      node.loc = new node_loc_t();
    if (options.ranges)
      node.range = [tokStart, 0];
    return node;
  }

  // Start a node whose start offset information should be based on
  // the start of another node. For example, a binary operator node is
  // only started after its left-hand side has already been parsed.

  function startNodeFrom(other) {
    var node = new node_t();
    node.start = other.start;
    if (options.locations) {
      node.loc = new node_loc_t();
      node.loc.start = other.loc.start;
    }
    if (options.ranges)
      node.range = [other.range[0], 0];

    return node;
  }

  // Finish an AST node, adding `type` and `end` properties.

  function finishNode(node, type) {
    node.type = type;
    node.end = lastEnd;
    if (options.locations)
      node.loc.end = lastEndLoc;
    if (options.ranges)
      node.range[1] = lastEnd;
    return node;
  }

  // Test whether a statement node is the string literal `"use strict"`.

  function isUseStrict(stmt) {
    return options.ecmaVersion >= 5 && stmt.type === "ExpressionStatement" &&
      stmt.expression.type === "Literal" && stmt.expression.value === "use strict";
  }

  // Predicate that tests whether the next token is of the given
  // type, and if yes, consumes it as a side effect.

  function eat(type) {
    if (tokType === type) {
      next();
      return true;
    }
  }

  // Test whether a semicolon can be inserted at the current position.

  function canInsertSemicolon() {
    return !options.strictSemicolons &&
      (tokType === _eof || tokType === _braceR || newline.test(input.slice(lastEnd, tokStart)));
  }

  // Consume a semicolon, or, failing that, see if we are allowed to
  // pretend that there is a semicolon at this position.

  function semicolon() {
    if (!eat(_semi) && !canInsertSemicolon()) unexpected();
  }

  // Expect a token of a given type. If found, consume it, otherwise,
  // raise an unexpected token error.

  function expect(type) {
    if (tokType === type) next();
    else unexpected();
  }

  // Raise an unexpected token error.

  function unexpected() {
    raise(tokStart, "Unexpected token");
  }

  // Verify that a node is an lval — something that can be assigned
  // to.

  function checkLVal(expr) {
    if (expr.type !== "Identifier" && expr.type !== "MemberExpression")
      raise(expr.start, "Assigning to rvalue");
    if (strict && expr.type === "Identifier" && isStrictBadIdWord(expr.name))
      raise(expr.start, "Assigning to " + expr.name + " in strict mode");
  }

  // ### Statement parsing

  // Parse a program. Initializes the parser, reads any number of
  // statements, and wraps them in a Program node.  Optionally takes a
  // `program` argument.  If present, the statements will be appended
  // to its body instead of creating a new node.

  function parseTopLevel(program) {
    lastStart = lastEnd = tokPos;
    if (options.locations) lastEndLoc = new line_loc_t;
    inFunction = strict = null;
    labels = [];
    readToken();

    var node = program || startNode(), first = true;
    if (!program) node.body = [];
    while (tokType !== _eof) {
      var stmt = parseStatement();
      node.body.push(stmt);
      if (first && isUseStrict(stmt)) setStrict(true);
      first = false;
    }
    return finishNode(node, "Program");
  }

  var loopLabel = {kind: "loop"}, switchLabel = {kind: "switch"};

  // Parse a single statement.
  //
  // If expecting a statement and finding a slash operator, parse a
  // regular expression literal. This is to handle cases like
  // `if (foo) /blah/.exec(foo);`, where looking at the previous token
  // does not help.

  function parseStatement() {
    if (tokType === _slash)
      readToken(true);

    var starttype = tokType, node = startNode();

    // Most types of statements are recognized by the keyword they
    // start with. Many are trivial to parse, some require a bit of
    // complexity.

    switch (starttype) {
    case _break: case _continue:
      next();
      var isBreak = starttype === _break;
      if (eat(_semi) || canInsertSemicolon()) node.label = null;
      else if (tokType !== _name) unexpected();
      else {
        node.label = parseIdent();
        semicolon();
      }

      // Verify that there is an actual destination to break or
      // continue to.
      for (var i = 0; i < labels.length; ++i) {
        var lab = labels[i];
        if (node.label == null || lab.name === node.label.name) {
          if (lab.kind != null && (isBreak || lab.kind === "loop")) break;
          if (node.label && isBreak) break;
        }
      }
      if (i === labels.length) raise(node.start, "Unsyntactic " + starttype.keyword);
      return finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");

    case _debugger:
      next();
      semicolon();
      return finishNode(node, "DebuggerStatement");

    case _do:
      next();
      labels.push(loopLabel);
      node.body = parseStatement();
      labels.pop();
      expect(_while);
      node.test = parseParenExpression();
      semicolon();
      return finishNode(node, "DoWhileStatement");

      // Disambiguating between a `for` and a `for`/`in` loop is
      // non-trivial. Basically, we have to parse the init `var`
      // statement or expression, disallowing the `in` operator (see
      // the second parameter to `parseExpression`), and then check
      // whether the next token is `in`. When there is no init part
      // (semicolon immediately after the opening parenthesis), it is
      // a regular `for` loop.

    case _for:
      next();
      labels.push(loopLabel);
      expect(_parenL);
      if (tokType === _semi) return parseFor(node, null);
      if (tokType === _var) {
        var init = startNode();
        next();
        parseVar(init, true);
        if (init.declarations.length === 1 && eat(_in))
          return parseForIn(node, init);
        return parseFor(node, init);
      }
      var init = parseExpression(false, true);
      if (eat(_in)) {checkLVal(init); return parseForIn(node, init);}
      return parseFor(node, init);

    case _function:
      next();
      return parseFunction(node, true);

    case _if:
      next();
      node.test = parseParenExpression();
      node.consequent = parseStatement();
      node.alternate = eat(_else) ? parseStatement() : null;
      return finishNode(node, "IfStatement");

    case _return:
      // hack
      //if (!inFunction) raise(tokStart, "'return' outside of function");
      next();

      // In `return` (and `break`/`continue`), the keywords with
      // optional arguments, we eagerly look for a semicolon or the
      // possibility to insert one.
      
      if (eat(_semi) || canInsertSemicolon()) node.argument = null;
      else { node.argument = parseExpression(); semicolon(); }
      return finishNode(node, "ReturnStatement");

    case _switch:
      next();
      node.discriminant = parseParenExpression();
      node.cases = [];
      expect(_braceL);
      labels.push(switchLabel);

      // Statements under must be grouped (by label) in SwitchCase
      // nodes. `cur` is used to keep the node that we are currently
      // adding statements to.
      
      for (var cur, sawDefault; tokType != _braceR;) {
        if (tokType === _case || tokType === _default) {
          var isCase = tokType === _case;
          if (cur) finishNode(cur, "SwitchCase");
          node.cases.push(cur = startNode());
          cur.consequent = [];
          next();
          if (isCase) cur.test = parseExpression();
          else {
            if (sawDefault) raise(lastStart, "Multiple default clauses"); sawDefault = true;
            cur.test = null;
          }
          // hack!
          cur.colon = tokPos
          expect(_colon);
        } else {
          if (!cur) unexpected();
          cur.consequent.push(parseStatement());
        }
      }
      if (cur) finishNode(cur, "SwitchCase");
      next(); // Closing brace
      labels.pop();
      return finishNode(node, "SwitchStatement");

    case _throw:
      next();
      if (newline.test(input.slice(lastEnd, tokStart)))
        raise(lastEnd, "Illegal newline after throw");
      node.argument = parseExpression();
      semicolon();
      return finishNode(node, "ThrowStatement");

    case _try:
      next();
      node.block = parseBlock();
      node.handlers = [];
      while (tokType === _catch) {
        var clause = startNode();
        next();
        expect(_parenL);
        clause.param = parseIdent();
        if (strict && isStrictBadIdWord(clause.param.name))
          raise(clause.param.start, "Binding " + clause.param.name + " in strict mode");
        expect(_parenR);
        clause.guard = null;
        clause.body = parseBlock();
        node.handlers.push(finishNode(clause, "CatchClause"));
      }
      node.finalizer = eat(_finally) ? parseBlock() : null;
      if (!node.handlers.length && !node.finalizer)
        raise(node.start, "Missing catch or finally clause");
      return finishNode(node, "TryStatement");

    case _var:
      next();
      node = parseVar(node);
      semicolon();
      return node;
	
	case _const:
		next();
		node = parseVar(node, false, "const")
		semicolon();
		return node;

    case _while:
      next();
      node.test = parseParenExpression();
      labels.push(loopLabel);
      node.body = parseStatement();
      labels.pop();
      return finishNode(node, "WhileStatement");

    case _with:
      if (strict) raise(tokStart, "'with' in strict mode");
      next();
      node.object = parseParenExpression();
      node.body = parseStatement();
      return finishNode(node, "WithStatement");

    case _braceL:
      return parseBlock();

    case _semi:
      next();
      return finishNode(node, "EmptyStatement");

      // If the statement does not start with a statement keyword or a
      // brace, it's an ExpressionStatement or LabeledStatement. We
      // simply start parsing an expression, and afterwards, if the
      // next token is a colon and the expression was a simple
      // Identifier node, we switch to interpreting it as a label.

    default:
      var maybeName = tokVal, expr = parseExpression();
      if (starttype === _name && expr.type === "Identifier" && eat(_colon)) {
        for (var i = 0; i < labels.length; ++i)
          if (labels[i].name === maybeName) raise(expr.start, "Label '" + maybeName + "' is already declared");
        var kind = tokType.isLoop ? "loop" : tokType === _switch ? "switch" : null;
        labels.push({name: maybeName, kind: kind});
        node.body = parseStatement();
        labels.pop();
        node.label = expr;
        return finishNode(node, "LabeledStatement");
      } else {
        node.expression = expr;
        semicolon();
        return finishNode(node, "ExpressionStatement");
      }
    }
  }

  // Used for constructs like `switch` and `if` that insist on
  // parentheses around their expression.

  function parseParenExpression() {
    expect(_parenL);
    var val = parseExpression();
    expect(_parenR);
    return val;
  }

  // Parse a semicolon-enclosed block of statements, handling `"use
  // strict"` declarations when `allowStrict` is true (used for
  // function bodies).

  function parseBlock(allowStrict) {
    var node = startNode(), first = true, strict = false, oldStrict;
    node.body = [];
    expect(_braceL);
    while (!eat(_braceR)) {
      var stmt = parseStatement();
      node.body.push(stmt);
      if (first && isUseStrict(stmt)) {
        oldStrict = strict;
        setStrict(strict = true);
      }
      first = false
    }
    if (strict && !oldStrict) setStrict(false);
    return finishNode(node, "BlockStatement");
  }

  // Parse a regular `for` loop. The disambiguation code in
  // `parseStatement` will already have parsed the init statement or
  // expression.

  function parseFor(node, init) {
    node.init = init;
    expect(_semi);
    node.test = tokType === _semi ? null : parseExpression();
    expect(_semi);
    node.update = tokType === _parenR ? null : parseExpression();
    expect(_parenR);
    node.body = parseStatement();
    labels.pop();
    return finishNode(node, "ForStatement");
  }

  // Parse a `for`/`in` loop.

  function parseForIn(node, init) {
    node.left = init;
    node.right = parseExpression();
    expect(_parenR);
    node.body = parseStatement();
    labels.pop();
    return finishNode(node, "ForInStatement");
  }

  // Parse a list of variable declarations.

  function parseVar(node, noIn, kind) {
    node.declarations = [];
    node.kind =  kind || "var";
    for (;;) {
      var decl = startNode();
      decl.id = parseIdent();
      if (strict && isStrictBadIdWord(decl.id.name))
        raise(decl.id.start, "Binding " + decl.id.name + " in strict mode");
      decl.init = eat(_eq) ? parseExpression(true, noIn) : null;
      node.declarations.push(finishNode(decl, "VariableDeclarator"));
      if (!eat(_comma)) break;
    }
    return finishNode(node, "VariableDeclaration");
  }

  // ### Expression parsing

  // These nest, from the most general expression type at the top to
  // 'atomic', nondivisible expression types at the bottom. Most of
  // the functions will simply let the function(s) below them parse,
  // and, *if* the syntactic construct they handle is present, wrap
  // the AST node that the inner parser gave them in another node.

  // Parse a full expression. The arguments are used to forbid comma
  // sequences (in argument lists, array literals, or object literals)
  // or the `in` operator (in for loops initalization expressions).

  function parseExpression(noComma, noIn) {
    var expr = parseMaybeAssign(noIn);
    if (!noComma && tokType === _comma) {
      var node = startNodeFrom(expr);
      node.expressions = [expr];
      while (eat(_comma)) node.expressions.push(parseMaybeAssign(noIn));
      return finishNode(node, "SequenceExpression");
    }
    return expr;
  }

  // Parse an assignment expression. This includes applications of
  // operators like `+=`.

  function parseMaybeAssign(noIn) {
    var left = parseMaybeConditional(noIn);
    if (tokType.isAssign) {
      var node = startNodeFrom(left);
      node.operator = tokVal;
      node.left = left;
      next();
      node.right = parseMaybeAssign(noIn);
      checkLVal(left);
      return finishNode(node, "AssignmentExpression");
    }
    return left;
  }

  // Parse a ternary conditional (`?:`) operator.

  function parseMaybeConditional(noIn) {
    var expr = parseExprOps(noIn);
    if (eat(_question)) {
      var node = startNodeFrom(expr);
      node.test = expr;
      node.consequent = parseExpression(true);
      expect(_colon);
      node.alternate = parseExpression(true, noIn);
      return finishNode(node, "ConditionalExpression");
    }
    return expr;
  }

  // Start the precedence parser.

  function parseExprOps(noIn) {
    return parseExprOp(parseMaybeUnary(noIn), -1, noIn);
  }

  // Parse binary operators with the operator precedence parsing
  // algorithm. `left` is the left-hand side of the operator.
  // `minPrec` provides context that allows the function to stop and
  // defer further parser to one of its callers when it encounters an
  // operator that has a lower precedence than the set it is parsing.

  function parseExprOp(left, minPrec, noIn) {
    var prec = tokType.binop;
    if (prec != null && (!noIn || tokType !== _in)) {
      if (prec > minPrec) {
        var node = startNodeFrom(left);
        node.left = left;
        node.operator = tokVal;
        next();
        node.right = parseExprOp(parseMaybeUnary(noIn), prec, noIn);
        var node = finishNode(node, /&&|\|\|/.test(node.operator) ? "LogicalExpression" : "BinaryExpression");
        return parseExprOp(node, minPrec, noIn);
      }
    }
    return left;
  }

  // Parse unary operators, both prefix and postfix.

  function parseMaybeUnary(noIn) {
    if (tokType.prefix) {
      var node = startNode(), update = tokType.isUpdate;
      node.operator = tokVal;
      node.prefix = true;
      next();
      node.argument = parseMaybeUnary(noIn);
      if (update) checkLVal(node.argument);
      else if (strict && node.operator === "delete" &&
               node.argument.type === "Identifier")
        raise(node.start, "Deleting local variable in strict mode");
      return finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
    }
    var expr = parseExprSubscripts();
    while (tokType.postfix && !canInsertSemicolon()) {
      var node = startNodeFrom(expr);
      node.operator = tokVal;
      node.prefix = false;
      node.argument = expr;
      checkLVal(expr);
      next();
      expr = finishNode(node, "UpdateExpression");
    }
    return expr;
  }

  // Parse call, dot, and `[]`-subscript expressions.

  function parseExprSubscripts() {
    return parseSubscripts(parseExprAtom());
  }

  function parseSubscripts(base, noCalls) {
    if (eat(_dot)) {
      var node = startNodeFrom(base);
      node.object = base;
      node.property = parseIdent(true);
      node.computed = false;
      return parseSubscripts(finishNode(node, "MemberExpression"), noCalls);
    } else if (eat(_bracketL)) {
      var node = startNodeFrom(base);
      node.object = base;
      node.property = parseExpression();
      node.computed = true;
      expect(_bracketR);
      return parseSubscripts(finishNode(node, "MemberExpression"), noCalls);
    } else if (!noCalls && eat(_parenL)) {
      var node = startNodeFrom(base);
      node.callee = base;
      node.arguments = parseExprList(_parenR, false);
      return parseSubscripts(finishNode(node, "CallExpression"), noCalls);
    } else return base;
  }

  // Parse an atomic expression — either a single token that is an
  // expression, an expression started by a keyword like `function` or
  // `new`, or an expression wrapped in punctuation like `()`, `[]`,
  // or `{}`.

  function parseExprAtom() {
    switch (tokType) {
    case _this:
      var node = startNode();
      next();
      return finishNode(node, "ThisExpression");
    case _name:
      return parseIdent();
    case _num: case _string: case _regexp:
      var node = startNode();
      node.value = tokVal;
      node.raw = input.slice(tokStart, tokEnd);
      next();
      return finishNode(node, "Literal");

    case _null: case _true: case _false:
      var node = startNode();
      node.value = tokType.atomValue;
      node.raw = tokType.keyword
      next();
      return finishNode(node, "Literal");

    case _parenL:
      var tokStartLoc1 = tokStartLoc, tokStart1 = tokStart;
      next();
      var val = parseExpression();
      val.start = tokStart1;
      val.end = tokEnd;
      if (options.locations) {
        val.loc.start = tokStartLoc1;
        val.loc.end = tokEndLoc;
      }
      if (options.ranges)
        val.range = [tokStart1, tokEnd];
      expect(_parenR);
      return val;

    case _bracketL:
      var node = startNode();
      next();
      node.elements = parseExprList(_bracketR, true, true);
      return finishNode(node, "ArrayExpression");

    case _braceL:
      return parseObj();

    case _function:
      var node = startNode();
      next();
      return parseFunction(node, false);

    case _new:
      return parseNew();

    default:
      unexpected();
    }
  }

  // New's precedence is slightly tricky. It must allow its argument
  // to be a `[]` or dot subscript expression, but not a call — at
  // least, not without wrapping it in parentheses. Thus, it uses the 

  function parseNew() {
    var node = startNode();
    next();
    node.callee = parseSubscripts(parseExprAtom(), true);
    if (eat(_parenL)) node.arguments = parseExprList(_parenR, false);
    else node.arguments = [];
    return finishNode(node, "NewExpression");
  }

  // Parse an object literal.

  function parseObj() {
    var node = startNode(), first = true, sawGetSet = false;
    node.properties = [];
    next();
    while (!eat(_braceR)) {
      if (!first) {
        expect(_comma);
        if (options.allowTrailingCommas && eat(_braceR)) break;
      } else first = false;

      var prop = {key: parsePropertyName()}, isGetSet = false, kind;
      if (eat(_colon)) {
        prop.value = parseExpression(true);
        kind = prop.kind = "init";
      } else if (options.ecmaVersion >= 5 && prop.key.type === "Identifier" &&
                 (prop.key.name === "get" || prop.key.name === "set")) {
        isGetSet = sawGetSet = true;
        kind = prop.kind = prop.key.name;
        prop.key = parsePropertyName();
        if (tokType !== _parenL) unexpected();
        prop.value = parseFunction(startNode(), false);
      } else unexpected();

      // getters and setters are not allowed to clash — either with
      // each other or with an init property — and in strict mode,
      // init properties are also not allowed to be repeated.

      if (prop.key.type === "Identifier" && (strict || sawGetSet)) {
        for (var i = 0; i < node.properties.length; ++i) {
          var other = node.properties[i];
          if (other.key.name === prop.key.name) {
            var conflict = kind == other.kind || isGetSet && other.kind === "init" ||
              kind === "init" && (other.kind === "get" || other.kind === "set");
            if (conflict && !strict && kind === "init" && other.kind === "init") conflict = false;
            if (conflict) raise(prop.key.start, "Redefinition of property");
          }
        }
      }
      node.properties.push(prop);
    }
    return finishNode(node, "ObjectExpression");
  }

  function parsePropertyName() {
    if (tokType === _num || tokType === _string) return parseExprAtom();
    return parseIdent(true);
  }

  // Parse a function declaration or literal (depending on the
  // `isStatement` parameter).

  function parseFunction(node, isStatement) {
    if (tokType === _name) node.id = parseIdent();
    // hack! used to make acorn parse function(){}
    //else if (isStatement) unexpected();
    else node.id = null;
    node.params = [];
    var first = true;
    expect(_parenL);
    while (!eat(_parenR)) {
      if (!first) expect(_comma); else first = false;
      node.params.push(parseIdent());
    }

    // Start a new scope with regard to labels and the `inFunction`
    // flag (restore them to their old value afterwards).
    var oldInFunc = inFunction, oldLabels = labels;
    inFunction = true; labels = [];
    node.body = parseBlock(true);
    inFunction = oldInFunc; labels = oldLabels;

    // If this is a strict mode function, verify that argument names
    // are not repeated, and it does not try to bind the words `eval`
    // or `arguments`.
    if (strict || node.body.body.length && isUseStrict(node.body.body[0])) {
      for (var i = node.id ? -1 : 0; i < node.params.length; ++i) {
        var id = i < 0 ? node.id : node.params[i];
        if (isStrictReservedWord(id.name) || isStrictBadIdWord(id.name))
          raise(id.start, "Defining '" + id.name + "' in strict mode");
        if (i >= 0) for (var j = 0; j < i; ++j) if (id.name === node.params[j].name)
          raise(id.start, "Argument name clash in strict mode");
      }
    }

    return finishNode(node, isStatement ? "FunctionDeclaration" : "FunctionExpression");
  }

  // Parses a comma-separated list of expressions, and returns them as
  // an array. `close` is the token type that ends the list, and
  // `allowEmpty` can be turned on to allow subsequent commas with
  // nothing in between them to be parsed as `null` (which is needed
  // for array literals).

  function parseExprList(close, allowTrailingComma, allowEmpty) {
    var elts = [], first = true;
    while (!eat(close)) {
      if (!first) {
        expect(_comma);
        if (allowTrailingComma && options.allowTrailingCommas && eat(close)) break;
      } else first = false;

      if (allowEmpty && tokType === _comma) elts.push(null);
      else elts.push(parseExpression(true));
    }
    return elts;
  }

  // Parse the next token as an identifier. If `liberal` is true (used
  // when parsing properties), it will also convert keywords into
  // identifiers.

  function parseIdent(liberal) {
    var node = startNode();
    node.name = tokType === _name ? tokVal : (liberal && !options.forbidReserved && tokType.keyword) || unexpected();
    next();
    return finishNode(node, "Identifier");
  }

});

// | Acorn.js tools |____________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/

define('/core/acorn_tools',function(require, exports, module){
  "no tracegl"

	var acorn = require('./acorn')

	exports.dump = function(o, t, r){
		t = t || ''
		var a = Array.isArray(o)
		var s = (a?'[':'{')
		for(var k in o)if(o.hasOwnProperty(k)){

			if(k == 'parent' || k == 'tokens' || k=='start' || k=='end' || k=='token' || k=='loc') continue
			if(k == 'token'){
				s += '\n'+t+'token: '+o[k].t
				continue
			}
			var v = o[k]
			s += '\n' + t + k+': '
			if(typeof v == 'object') {
				s += exports.dump(v, t + ' ', r)
			}
			else s += v
		}
		s += '\n'+t.slice(1) + (a?']':'}')
		return s
	}

	//
	// AST walker
	//

	var walk = {
		Literal:              {}, // 1 single node
		Identifier:           {}, // 2 array of nodes
		Program:              {body:2}, // 3 keyss structure
		ExpressionStatement:  {expression:1}, // 4 value endpoint
		BreakStatement:       {},
		ContinueStatement:    {},
		DebuggerStatement:    {},
		DoWhileStatement:     {body:1, test:1},
		ReturnStatement:      {argument:1},
		SwitchStatement:      {discriminant:1,cases:2},
		SwitchCase:           {consequent:2,test:1},
		WhileStatement:       {test:1, body:1},
		WithStatement:        {object:1,body:1},
		EmptyStatement:       {},
		LabeledStatement:     {body:1,label:4},
		BlockStatement:       {body:2},
		ForStatement:         {init:1,test:1,update:1,body:1},
		ForInStatement:       {left:1,right:1,body:1},
		VariableDeclaration:  {declarations:2},
		VariableDeclarator:   {id:4,init:1},
		SequenceExpression:   {expressions:2},
		AssignmentExpression: {left:1,right:1},
		ConditionalExpression:{test:1,consequent:1,alternate:1},
		LogicalExpression:    {left:1,right:1},
		BinaryExpression:     {left:1,right:1},
		UpdateExpression:     {argument:1},
		UnaryExpression:      {argument:1},
		CallExpression:       {callee:1,arguments:2},
		ThisExpression:       {},
		ArrayExpression:      {elements:2},
		NewExpression:        {callee:1,arguments:2},
		FunctionDeclaration:  {id:4,params:2,body:1},
		FunctionExpression:   {id:4,params:2,body:1},
		ObjectExpression:     {properties:3},
		MemberExpression:     {object:1,property:1},
		IfStatement:          {test:1,consequent:1,alternate:1},
		ThrowStatement:       {argument:1},
		TryStatement:         {block:1,handlers:2,finalizer:1},
		CatchClause:          {param:1,guard:1,body:1}
	}

	function walkDown(n, o, p, k){
		if(!n) return
		var f = o[n.type]
		if(f){
			if(f(n, p)) return
		}
		var w = walk[n.type]
		for(var k in w){
			var t = w[k] // type
			var m = n[k] // node prop
			if(t == 2){ // array
				if(!Array.isArray(m))throw new Error("invalid type")
				for(var i = 0; i < m.length; i++){
					walkDown(m[i], o, {up:p, sub:k, type:n.type, node:n, index:i} )
				}
			} else if(t == 3){ // keys
				if(!Array.isArray(m))throw new Error("invalid type")
				for(var i = 0; i < m.length; i++){
					walkDown(m[i].value, o, {up:p, sub:k, type:n.type, node:n, index:i, key:m[i].key} )
				}
			} else { // single  node or value
				if(m) walkDown(m, o, {up:p, sub:k, type:n.type, node:n})
			}
		}
	}

	function walkUp(p, o){
		while(p){
			var f = o[p.node.type]
			if(f && f(p.node, p)) break
			p = p.up
		}
	}
	exports.walkDown = walkDown
	exports.walkUp = walkUp

	//
	// AST serializer
	//

	var sSep

	function sExp(e){
		if(!e || !e.type) return ''
		return sTab[e.type](e)
	}

	function sBlk(b){
		var s = ''
		for(var i = 0;i<b.length;i++)	s += sExp(b[i]) + sSep
		return s
	}

	function sSeq(b){
		var s = ''
		for(var i = 0;i<b.length;i++){
			if(i) s += ', '
			s += sExp(b[i])
		}
		return s
	}

	var sTab = {
		Literal:              function(n){ return n.raw },
		Identifier:           function(n){ return n.name },
		Program:              function(n){ return sBlk(n.body) },
		ExpressionStatement:  function(n){ return sExp(n.expression) },
		BreakStatement:       function(n){ return 'break' },
		ContinueStatement:    function(n){ return 'continue' },
		DebuggerStatement:    function(n){ return 'debugger' },
		DoWhileStatement:     function(n){ return 'do'+sExp(n.body)+sSep+'while('+sExp(n.test)+')' },
		ReturnStatement:      function(n){ return 'return '+sExp(n.argument) },
		SwitchStatement:      function(n){ return 'switch('+sExp(n.discriminant)+'){'+sBlk(n.cases)+'}' },
		SwitchCase:           function(n){ return 'case '+sExp(n.test)+':'+sSep+sBlk(n.consequent) },	
		WhileStatement:       function(n){ return 'while('+sExp(n.test)+')'+sExp(n.body) },
		WithStatement:        function(n){ return 'with('+sExp(n.object)+')'+sExp(n.body) },
		EmptyStatement:       function(n){ return '' },
		LabeledStatement:     function(n){ return sExp(n.label) + ':' + sSep + sExp(n.body) },
		BlockStatement:       function(n){ return '{'+sSep+sBlk(n.body)+'}' },
		ForStatement:         function(n){ return 'for('+sExp(n.init)+';'+sExp(n.test)+';'+sExp(n.update)+')'+sExp(n.body) },
		ForInStatement:       function(n){ return 'for('+sExp(n.left)+' in '+sExp(n.right)+')'+sExp(n.body) },		
		VariableDeclarator:   function(n){ return sExp(n.id)+' = ' +sExp(n.init) },
		VariableDeclaration:  function(n){ return 'var '+sSeq(n.declarations) },
		SequenceExpression:   function(n){ return sSeq(n.expressions) },
		AssignmentExpression: function(n){ return sExp(n.left)+n.operator+sExp(n.right) },
		ConditionalExpression:function(n){ return sExp(n.test)+'?'+sExp(n.consequent)+':'+sExp(n.alternate) },
		LogicalExpression:    function(n){ return sExp(n.left)+n.operator+sExp(n.right) },
		BinaryExpression:     function(n){ return sExp(n.left)+n.operator+sExp(n.right) },
		UpdateExpression:     function(n){ return n.prefix?n.operator+sExp(n.argument):sExp(n.argument)+n.operator },
		UnaryExpression:      function(n){ return n.prefix?n.operator+sExp(n.argument):sExp(n.argument)+n.operator },
		CallExpression:       function(n){ return sExp(n.callee)+'('+sSeq(n.arguments)+')' },
		ThisExpression:       function(n){ return 'this' },
		ArrayExpression:      function(n){ return '['+sSeq(n.elements)+']' },
		NewExpression:        function(n){ return 'new '+sExp(n.callee)+'('+sSeq(n.arguments)+')' },
		FunctionDeclaration:  function(n){ return 'function'+(n.id?' '+sExp(n.id):'')+'('+sSeq(n.params)+')'+sExp(n.body) },
		FunctionExpression:   function(n){ return 'function'+(n.id?' '+sExp(n.id):'')+'('+sSeq(n.params)+')'+sExp(n.body) },
		ObjectExpression:     function(n){
			var s = '{'
			var b = n.properties
			for(var i = 0;i<b.length;i++){
				if(i) s += ', '
				s += sExp(b.key) + ':' + sExp(b.value)
			}
			s += '}'
			return s
		},
		MemberExpression:     function(n){
			if(n.computed)	return sExp(n.object)+'['+sExp(n.property)+']'
			return sExp(n.object)+'.'+sExp(n.property)
		},
		IfStatement:          function(n){ 
			return 'if('+sExp(n.test)+')' + sExp(n.consequent) + sSep +
			       (n.alternate ? 'else ' + sExp(n.alternate) + sSep : '') 
		},
		ThrowStatement:       function(n){ return 'throw '+sExp(n.argument) },
		TryStatement:         function(n){ 
			return 'try '+sExp(n.block)+sSep+sBlk(n.handlers)+sSep+
			       (n.finalizer? 'finally ' + sBlk(n.finalizer) : '')
		},
		CatchClause:          function(n){
			return 'catch(' + sExp(n.param) + (n.guard?' if '+sExp(n.guard):')') + sExp(n.body)
		}
	}

	function stringify(n, sep){
		sSep = sep || '\n'
		return sExp(n)
	}

	exports.stringify = stringify

	var types = acorn.tokTypes

	function nodeProto(p){

		// property getter type checking
		for(var k in types){
			(function(k){
				p.__defineGetter__(k, function(){
					return this._t == types[k]
				})
			})(k)
		}
		// other types
		p.__defineGetter__('isAssign', function(){ return this._t && this._t.isAssign })
		p.__defineGetter__('isLoop', function(){ return this._t && this._t.isLoop })
		p.__defineGetter__('prefix', function(){ return this._t && this._t.prefix })
		p.__defineGetter__('beforeExpr', function(){ return this._t && this._t.beforeExpr })
		p.__defineGetter__('beforeNewline', function(){ return this.w && this.w.match(/\n/) })
		p.__defineGetter__('beforeEnd', function(){ return this.w && this.w.match(/\n/) || this.d.semi || this.d.braceR })
		p.__defineGetter__('fnscope', function(){ return this.d.parenL ? this.d.d : this.d.d.d })
		p.__defineGetter__('last', function(){ var t = this; while(t._d) t = t._d; return t })
		p.__defineGetter__('astParent', function(){ var t = this; while(t._d) t = t._d; return t })
		
		// walker
		p.walk = function(cb){
			var n = this
			var p = n
			cb(n)
			n = n._c
			while(n && n != p){
				cb(n)
				if(n._c) n = n._c
				else while(n != p){ 
					if(n._d){ n = n._d; break } 
					n = n._p 
				}
			}
		}
	}

	function Node(){ }
	nodeProto(Node.prototype)

	// acorn parse wrapper that also spits out a token tree	
	exports.parse = function(inpt, opts) {
		var h = {
			finishToken:finishToken,
			initTokenState:initTokenState,
			tokTree:new Node()
		}
		h.tokTree.root = 1
		h.tokTree.t = h.tokTree.w = ''

		if(opts && opts.compact) h.compact = 1
		if(opts && opts.noclose) h.noclose = 1

		var n = acorn.parse(inpt, opts, h)
		n.tokens = h.tokTree
		return n
	}

	function initTokenState(hack, tokPos, input){
		if(tokPos != 0) hack.tokTree.w = input.slice(0, tokPos)
	}

	function finishToken(hack, type, val, input, tokStart, tokEnd, tokPos){	
		var tokTree = hack.tokTree
		var n
		if(type == types.eof) return
		if(type == types.regexp && tokTree._e && tokTree._e._t.binop == 10){
			// verify this one
			n = tokTree._e, tokStart -= 1 
		} else if(hack.compact && tokTree._e && (type == types.name && tokTree._e._t == types.dot || type == types.dot && tokTree._e._t == types.name)){
			n = tokTree._e
			n._t = type
			n.t += input.slice(tokStart, tokEnd)			
		} else {
			var n = new Node()
			var t = tokTree
			if(t){
				if(!t._c) t._e = t._c = n
				else t._e._d = n, n._u = t._e, t._e = n
			}
			n._p = t
			n._t = type
			n.t = input.slice(tokStart, tokEnd)
		}

		if(tokEnd != tokPos) n.w = input.slice(tokEnd, tokPos)
		else n.w = ''

		if(type == types.braceL || type == types.bracketL || type == types.parenL){
			tokTree = n
		} 
		else if(type == types.braceR || type == types.bracketR || type == types.parenR){
			if(hack.noclose){
				if(!tokTree._e._u) delete tokTree._c, delete tokTree._e
				else delete tokTree._e._u._d
			}
			if(tokTree._p)
			 	tokTree = tokTree._p
		} 
		hack.tokTree = tokTree
	}
})

// | Browser <> Node.JS communication channels |__/
// |
// |  (C) Code.GL 2013
// \____________________________________________/

define('/core/io_channel',function(require, exports, module){

	if(typeof process !== "undefined"){

		var cr = require('crypto')
		// | Node.JS Path
		// \____________________________________________/
		module.exports = function(url){
			var ch = {}

			var pr // poll request
			var pt // poll timer
			var nc /*no cache header*/ = {"Content-Type": "text/plain","Cache-Control":"no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0"}
			var sd = []// send data
			var ws // websocket
			var wk // websocket keepalive
			var st // send timeout

			function wsClose(){
				if(ws) ws.destroy(), ws = 0
				if(wk) clearInterval(wk), wk = 0
			}

			function endPoll(c, d){ // end poll http status code, data
				if(!pr) return
				pr.writeHead(c, nc)
				pr.end(d)
				pr = null
			}

			ch.handler = function(req, res){
				if(req.url != url) return
				if(req.method == 'GET'){ // Long poll
					endPoll(304)
					if(pt) clearInterval(pt), pt = 0
					pt = setInterval(function(){endPoll(304)}, 30000)
					pr = res
					if(sd.length) endPoll(200, '['+sd.join(',')+']'), sd.length = 0 // we have pending data
					return 1
				}

				if(req.method == 'PUT'){ // RPC call
					var d = ''
					req.on('data', function(i){ d += i.toString() })
					req.on('end', function(){
						if(!ch.rpc) return res.end()
						d = parse(d)
						if(!d) return res.end()
						ch.rpc(d, function(r){
							res.writeHead(200, nc)
							res.end(JSON.stringify(r))
						})
					})
					return 1
				}

				if(req.method == 'POST'){ // Message  
					var d = ''
					req.on('data', function(i){ d += i.toString() })
					req.on('end', function(){
						res.writeHead(204, nc)
						res.end()
						d = parse(d)
						if(ch.data && d && d.length) for(var i = 0;i<d.length;i++) ch.data(d[i])
					})
					return 1
				}
			}

			ch.upgrade = function(req, sock, head){
				if(req.headers['sec-websocket-version'] != 13) return sock.destroy()
				wsClose()
				ws = sock

			   // calc key
				var k = req.headers['sec-websocket-key']
				var sha1 = cr.createHash('sha1');
				sha1.update(k + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
				var v = 'HTTP/1.1 101 Switching Protocols\r\n'+
					'Upgrade: websocket\r\n'+
					'Connection: Upgrade\r\n'+
					'Sec-WebSocket-Accept: ' + sha1.digest('base64') +'\r\n'+
					'Sec-WebSocket-Protocol: ws\r\n\r\n'
				ws.write(v)

				var max = 100000000
				var h = new Buffer(14) // header
				var o = new Buffer(10000) // output
				var s = opcode // state
				var e = 1// expected
				var w = 0// written
				var r // read
				var i // input

				var m // mask offset
				var c // mask counter
				var l // payload len

				function err(t){
					console.log('websock '+t)
					wsClose()
				}

				function head(){
					var se = e
					while(e > 0 && r < i.length && w < h.length) h[w++] = i[r++], e--
					if(w > h.length) return err("unexpected data in header"+ se + s.toString())
					return e != 0
				}

				function data(){
					while(e > 0 && r < i.length) o[w++] = i[r++] ^ h[m + (c++&3)], e--
					if(e) return 
					var d = parse(o.toString('utf8', 0, w))
					if(ch.data && d && d.length) {
						for(var j = 0;j<d.length;j++) ch.data(d[j])
					}
					return e = 1, w = 0, s = opcode
				}

				function mask(){
					if(head()) return
					if(!l) return e = 1, w = 0, s = opcode
					m = w - 4
					w = c = 0
					e = l
					if(l > max) return err("buffer size request too large "+l+" > "+max)
					if(l > o.length) o = new Buffer(l)
					return s = data
				}

				function len8(){
					if(head()) return
					return l = h.readUInt32BE(w - 4), e = 4, s = mask
				}

				function len2(){
					if(head()) return 
					return l = h.readUInt16BE(w - 2), e = 4, s = mask
				}

				function len1(){
					if(head()) return
					if(!(h[w  - 1] & 128)) return err("only masked data")
					var t = h[w - 1] & 127
					if(t < 126) return l = t, e = 4, s = mask
					if(t == 126) return e = 2, s = len2
					if(t == 127) return e = 8, s = len8
				}

				function pong(){
					if(head()) return
					if(h[w-1] & 128) return e = 4, l = 0, s = mask 
					return e = 1, w = 0, s = opcode
				}

				function opcode(){
					if(head()) return
					var f = h[0] & 128
					var t = h[0] & 15
					if(t == 1){
						if(!f) return err("only final frames supported")
						return e = 1, s = len1
					}
					if(t == 8) return wsClose()
					if(t == 10) return e = 1, s = pong
					return err("opcode not supported " + t)
				}

				ws.on('data', function(d){
					i = d
					r = 0
					while(s());
				})

				var cw = ws
				ws.on('close', function(){
					if(cw == ws) wsClose()
					o = null
				})

				// 10 second ping frames
				var pf = new Buffer(2)
				pf[0] = 9 | 128
				pf[1] = 0
				wk = setInterval(function(){
					ws.write(pf)
				}, 10000)
			}

			function wsWrite(d){
				var h
				var b = new Buffer(d)
				if(b.length < 126){
					h = new Buffer(2)
					h[1] = b.length
				} else if (b.length<=65535){
					h = new Buffer(4)
					h[1] = 126
					h.writeUInt16BE(b.length, 2)
				} else {
					h = new Buffer(10)
					h[1] = 127
					h[2] = h[3] = h[4] =	h[5] = 0
					h.writeUInt32BE(b.length, 6)
				}
				h[0] = 128 | 1
				ws.write(h)
				ws.write(b)
			}

			ch.send = function(m){
				sd.push(JSON.stringify(m))
				if(!st) st = setTimeout(function(){
					st = 0
					if(ws) wsWrite('['+sd.join(',')+']'), sd.length = 0
					else
					if(pr) endPoll(200, '['+sd.join(',')+']'), sd.length = 0
				}, 0)
			}

			return ch
		}

		return
	}
	// | Browser Path
	// \____________________________________________/

	module.exports = 
	//CHANNEL
	function(url){
		var ch = {}

		var sd = [] // send data
		var bs = [] // back data
		var bi = 0 // back interval
		var ws // websocket
		var wt // websocket sendtimeout
		var wr = 0 //websocket retry
		var sx // send xhr
		var tm;

		function xsend(d){
			var d = '[' + sd.join(',') +']'
			sd.length = 0
			sx = new XMLHttpRequest()
			sx.onreadystatechange = function(){
				if(sx.readyState != 4) return
				sx = 0
				if(sd.length > 0) xsend()
			}
			sx.open('POST', url)
			sx.send(d)
		};

		function wsFlush(){
			if(ws === 1) {
				if(!wt){
					wt = setTimeout(function(){
						wt = 0
						wsFlush()
					},50)
				}
				return
			} else if (!ws){
				if(!ws) console.log('Websocket flooded, trace data lost')
			}
			if(sd.length){
				var data = '[' + sd.join(',') + ']'
				sd.length = 0
				if(bs.length || ws.bufferedAmount > 500000){
					bs.push(data)
					if(!bi) bi = setInterval(function(){
						if(ws && ws.bufferedAmount < 500000)
							ws.send(bs.shift())
						if(!ws || !bs.length) clearInterval(bi), bi = 0
						if(!ws) console.log('Websocket flooded, trace data lost')
					}, 10)
				} else ws.send(data)
			}
		}

		//| send json message via xhr or websocket
		ch.send = function(m){
			sd.push(JSON.stringify(m))
			if(ws){
				if(sd.length>10000) wsFlush()
				if(!wt) wt = setTimeout(function(){
					wt = 0
					wsFlush()
				},0)
			} else {
				if(!sx) return xsend()
			}
		}

		function poll(){
			var x = new XMLHttpRequest()
			x.onreadystatechange = function(){
				if(x.readyState != 4) return
				if(x.status == 200 || x.status == 304) poll()
				else setTimeout(poll, 500)
				try{ var d = JSON.parse(x.responseText) }catch(e){}
				if(d && ch.data && d.length) for(var i = 0;i<d.length;i++) ch.data(d[i])
			}
			x.open('GET', url)
			x.send()
		}

		ch.rpc = function(m, cb){ // rpc request
			var x = new XMLHttpRequest()
			x.onreadystatechange = function(){
				if(x.readyState != 4) return
				var d
				if(x.status == 200 ) try{d = JSON.parse(x.responseText) }catch(e){}
				if(cb) cb(d)
			}
			x.open('PUT', url)
			x.send(JSON.stringify(m))
			return x
		}

		function websock(){
			var u = 'ws://'+window.location.hostname +':'+window.location.port+''+url
			var w = new WebSocket(u, "ws")
			ws = 1
			w.onopen = function(){
				ws = w
			}
			w.onerror = w.onclose = function(e){
				if(ws == w){ // we had a connection, retry
					console.log("Websocket closed, retrying", e)
					ws = 0
					websock()
				} else {
					console.log("Falling back to polling", e)
					ws = 0, poll()
				}
			}
			w.onmessage = function(e){
				var d = parse(e.data)
				if(d && ch.data) for(var i = 0;i<d.length;i++) ch.data(d[i])
			}
		}
		
		if(typeof no_websockets !== "undefined" || typeof WebSocket === "undefined") poll()
		else websock()
		//poll()
		return ch
	}

	function parse(d){ // data
		try{ return JSON.parse(d);	}catch (e){ return }
	}

	//CHANNEL
})
// | Instrumenter |______________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/trace/instrument',function(require){
	var fn = require("../core/fn")
	var acorn = require("../core/acorn")
	var acorn_tools = require("../core/acorn_tools")

	var io_channel = require("../core/io_channel")
//	var dt = fn.dt()

	var gs = "_$_"

	function tracehub(){
		//TRACE
		try{ _$_ } catch(e){ 
			_$_ = {};
			(function(){
				var isNode = typeof process != 'undefined'
				var isBrowser = typeof window != 'undefined'
				var isWorker = !isNode && !isBrowser

				if(isNode) global._$_ = _$_

				var max_depth = 1
				var max_count = 5
				function dump(i, d){
					var t = typeof i
					if(t == 'string'){

						if(i.length>100) return i.slice(0,100)+"..."
						return i
					}
					if(t == 'boolean') return i
					if(t == 'number') {
						if( i === Infinity) return "_$_Infinity"
						if( i == NaN ) return "_$_NaN"
						return i
					}
					if(t == 'function') return "_$_function"
					if(t == 'undefined') return "_$_undefined"
					if(t == 'object'){
						if(i === null) return null
						if(Array.isArray(i)){
							if(i.length == 0) return []
							if(d>=max_depth) return "_$_[..]"
							var o = []
							for(var k = 0;k<i.length && k<max_count;k++){
								var m = i[k]
								o[k] = dump(m, d+1)
							}
							if(k<i.length){
								o[k] = "..."
							}
							return o
						}
						if(d>=max_depth) return "_$_{..}"
						var o = {}
						var c = 0 
						try{ 
						var pd 
						for(var k in i) if(pd = Object.getOwnPropertyDescriptor(i, k)){
							if(c++>max_count){
								o["..."] = 1
								break
							}
							if(pd.value !== undefined) o[k] = dump(pd.value, d+1)
						}
						} catch(e){}
						return o
					}
				}

				//var no_websockets = 1
				var channel = //CHANNEL
				0;
				if (isBrowser) {
					_$_.ch = channel('/io_X_X');
					_$_.ch.data = function(m){
						if(m.reload) location.reload()
					}
					//_$_.ch = {send : function(){}}
					window.onerror = function(error, url, linenr){}					
				} else if (isWorker){
					_$_.ch = {send : function(){}}
				} else if(isNode){
					_$_.ch = {send : function(m){
						try{
							if(process.send)process.send(m);else process.stderr.write('\x1f' + JSON.stringify(m) + '\x17')
						} catch(e){
							console.log(e, m)
						}
					}}
				}
				var lgc = 0
				var dp = 0 // depth
				var di = 0
				var gc = 1
				
				var lr = 0 // last return
				
				// function call entry

				if(typeof global !== 'undefined'){
					_$_.f = function(i, a, t, u){
						if(lr) _$_.ch.send(lr, 1), lr = 0
						// dump arguments
						dp ++
						if(!di) di = global.setTimeout(function(){di = dp = 0},0)
						var r = {i:i, g:gc++, d:dp, u:u, t:global.Date.now()}
						if(a){
							r.a = []
							for(var j = 0;j<a.length;j++) r.a[j] = dump(a[j], 0)
						} else r.a = null
						_$_.ch.send(r)
						return r.g
					}
				} else {
					_$_.f = function(i, a, t, u){
						if(lr) _$_.ch.send(lr, 1), lr = 0
						// dump arguments
						dp ++
						if(!di) di = setTimeout(function(){di = dp = 0},0)
						var r = {i:i, g:gc++, d:dp, u:u, t:Date.now()}
						if(a){
							r.a = []
							for(var j = 0;j<a.length;j++) r.a[j] = dump(a[j], 0)
						} else r.a = null
						_$_.ch.send(r)
						return r.g
					}
				}
				
				// callsite annotation for last return
				_$_.c = function(i, v){
					if(!lr) return v
					lr.c = i
					_$_.ch.send(lr)
					lr = 0
					return v
				}
				// function exit
				_$_.e = function(i, r, v, x){
					if(lr) _$_.ch.send(lr, 1), lr = 0
					for(var k in r){
						var j = r[k]
						if(j !== null){
							var t = typeof j
							if(t =='undefined' | t=='function')	r[k] = '_$_' + t
							else if(t=='object' ) r[k] = dump(j, 0)
							else if(t == 'number'){
								if(j === Infinity) r[k] = '_$_Infinity'
								if(j === NaN) r[k] = '_$_NaN'
							}
						}
					}
					r.g = gc++
					r.i = i
					r.d = dp
					if(arguments.length>2) r.v = dump(v, 0), r.x = x
					lr = r
					if(dp>0)dp --
					return v
				}

			})()		
		}
		//TRACE
	}

	var head 
	function mkHead(){
	
		// imperfect newline stripper
		function strip(i){
			var t = acorn_tools.parse(i)
			var o = ''
			t.tokens.walk(function(n){
				o+= n.t
				if(n.w.indexOf('\n')!=-1 && !n._c) o += ';'
				else if(n.w.indexOf(' ')!=-1) o+= ' '
			})
			return o
		}

		// trace impl
		var trc = tracehub.toString().match(/\/\/TRACE[\s\S]*\/\/TRACE/)[0]
		// fetch io channel
		for(var k in define.factory) if(k.indexOf('core/io_channel') != -1)break
		var chn = define.factory[k].toString().match(/\/\/CHANNEL\n([\s\S]*)\/\/CHANNEL/)[1]

		return strip(trc.replace('//CHANNEL', chn)+"\n")
	};

	function instrument(file, src, iid, opt){
		if(!head) head = mkHead()
		src = src.replace(/^\#.*?\n/,'\n')
		src = src.replace(/\t/g,"   ")

		try {
			var n = acorn.parse(src,{locations:1})
		} catch(e){
			fn('Parse error instrumenting '+file+' '+e)
			return {
				input:src,//cutUp(cuts,src),
				output:src,
				id:iid, 
				d:{}
			}
		}

		if(opt.dump) fn(acorn_tools.dump(n))
		// verify parse
		var dict = {}
		var id = iid
		var assignId = []

		var cuts = fn.list('_u','_d')
		function cut(i, v){
			if(i === undefined) throw new Error()
			var n = {i:i, v:v}
			cuts.sorted(n, 'i') 
			return n
		}
		
		function instrumentFn(n, name, isRoot, parentId){
			// if the first thing in the body is 
			if(n.body && n.body.body && n.body.body[0] &&
				n.body.body[0].type == 'ExpressionStatement' &&
				n.body.body[0].expression.type == 'Literal' &&
				n.body.body[0].expression.value == 'no tracegl') return

			var fnid  = id
			if(!isRoot){
				var fhead = cut(n.body.start + 1, '')
				var args = []
				for(var i = 0;i<n.params.length;i++){
					var p = n.params[i]
					args[i] = {
						n:acorn_tools.stringify(p),
						x:p.loc.start.column,
						y:p.loc.start.line,
						ex:p.loc.end.column,
						ey:p.loc.end.line
					}
				}
				
				dict[id++] = {x:n.body.loc.start.column, y:n.body.loc.start.line, 
					ex:n.body.loc.end.column,
					ey:n.body.loc.end.line,
					sx:n.loc.start.column,
					sy:n.loc.start.line,
					n:name, 
					a:args
				}
			} else {
				var fhead = cut(n.start, '')
				dict[id++] = {x:n.loc.start.column, y:n.loc.start.line, 
					ex:n.loc.end.column,
					ey:n.loc.end.line,
					n:name, 
					a:[],
					root:1
				}
			}

			var loopIds = []

			function addLoop(b, s, e){
				if(!b || !('type' in b)) return

				var x, o
				if(b.type == 'BlockStatement') x = gs + 'b.l'+id+'++;', o = 1
				else if (b.type == 'ExpressionStatement') x = gs + 'b.l'+id+'++,', o = 0
				else if (b.type == 'EmptyStatement') x = gs + 'b.l'+id+'++', o = 0
				if(x){
					cut(b.start + o, x)
					loopIds.push(id)
					dict[id++] = {x:s.column, y:s.line, ex:e.column, ey:e.line}
				}
			}

			function logicalExpression(n){
				var hasLogic = 0
				// if we have logical expressions we only mark the if 
				acorn_tools.walkDown(n, {
					LogicalExpression:function(n, p){
						// insert ( ) around logical left and right
						hasLogic = 1
						if(n.left.type != 'LogicalExpression'){
							cut(n.left.start, '('+gs+'b.b'+id+'=')
							cut(n.left.end, ')')
							dict[id++] = {x:n.left.loc.start.column, y:n.left.loc.start.line, ex:n.left.loc.end.column, ey:n.left.loc.end.line}
						}
						if(n.right.type != 'LogicalExpression'){
							cut(n.right.start, '('+gs+'b.b'+id+'=')
							cut(n.right.end, ')')
							dict[id++] = {x:n.right.loc.start.column, y:n.right.loc.start.line, ex:n.right.loc.end.column, ey:n.right.loc.end.line}
						}
					},
					FunctionExpression:  function(){return 1},
					FunctionDeclaration: function(){return 1}
				})
				return hasLogic
			}
			
			function needSemi(p, pos){
				if(pos){
					var c = pos - 1
					var cc = src.charAt(c)
					while(c>0){
						if(cc!=' ' && cc != '\t' && cc != '\r' && cc!='\n') break
						cc = src.charAt(--c)
					}
					//console.log(cc)
					if(cc == '(') return false
				}
				return p.node.type == 'ExpressionStatement' &&
						(p.up.node.type == 'BlockStatement' || 
							p.up.node.type == 'Program' || 
							p.up.node.type == 'SwitchCase')
			}

			acorn_tools.walkDown(isRoot?n:n.body,{
				FunctionExpression:function(n, p){
					//return 1
					var name = 'function()'
					acorn_tools.walkUp(p,{
						VariableDeclarator:  function(n, p){ return name = acorn_tools.stringify(n.id) },
						AssignmentExpression:function(n, p){ return name = acorn_tools.stringify(n.left) },
						ObjectExpression:    function(n, p){ return name = acorn_tools.stringify(p.key) },
						CallExpression:      function(n, p){ 
							var id = '' // use deepest id as name
							acorn_tools.walkDown(n.callee, {Identifier: function(n){id = n.name}})
							if(id == 'bind') return
							return name = (n.callee.type == 'FunctionExpression'?'()':id) + '->' 
						}
					})
					instrumentFn(n, name, false, fnid)
					return 1
				},
				FunctionDeclaration:function(n, p){
					//return 1
					instrumentFn(n, acorn_tools.stringify(n.id), false, fnid)
					return 1
				},
				ForInStatement: function(n, p){ addLoop(n.body, n.loc.start, n.body.loc.start ) },
				ForStatement: function(n, p){ addLoop(n.body, n.loc.start, n.body.loc.start) },
				WhileStatement: function(n, p){ addLoop(n.body, n.loc.start, n.body.loc.start) },
				DoWhileStatement : function(n, p){ addLoop(n.body, n.loc.start, n.body.loc.start) },
				IfStatement: function(n, p){
					var b = n.test
					cut(b.start, gs+'b.b'+id+'=')
					var m = dict[id++] = {x:n.loc.start.column, y:n.loc.start.line, 
						ex:n.test.loc.end.column + 1, ey:n.test.loc.end.line}
					// lets go and split apart all boolean expressions in our test
					if(logicalExpression(n.test)){
						m.ex = m.x + 2
						m.ey = m.y
					}
					//addBlock(n.consequent)
					//addBlock(n.alternate)
				},
				ConditionalExpression : function(n, p){
					var b = n.test
					if(!logicalExpression(n.test)){
						cut(b.start, (needSemi(p, b.start)?';':'')+'('+gs+'b.b'+id+'=')
						
						cut(b.end, ')')
						dict[id++] = {x:b.loc.start.column, y:b.loc.start.line, 
							ex:b.loc.end.column + 1, ey:b.loc.end.line}
					}
				},				
				SwitchCase : function(n, p){ 
					var b = n.test
					if(b){
						cut(n.colon, gs+'b.b'+id+'=1;')
						dict[id++] = {x:n.loc.start.column, y:n.loc.start.line, ex:b.loc.end.column, ey:b.loc.end.line}
					}
				},
				VariableDeclarator  : function(n, p){
					if(n.init && n.init.type != 'Literal' && n.init.type != 'FunctionExpression' && n.init.type != 'ObjectExpression')
						addAssign(n.id.loc, n.init.start)
				},
				ObjectExpression : function(n, p){
					for(var i = 0;i<n.properties.length;i++){
						var k = n.properties[i].key
						var v = n.properties[i].value
						if(v && v.type != 'Literal' && v.type != 'FunctionExpression' && v.type != 'ObjectExpression'){
							addAssign(k.loc, v.start)
						}
					}
				},
				AssignmentExpression : function(n, p){
					if(/*n.operator == '='*/n.right.type != 'Literal' && n.right.type != 'FunctionExpression' && n.right.type != 'ObjectExpression')
						addAssign(n.left.loc, n.right.start)
				},
				CallExpression: function(n, p){
					// only if we are the first of a SequenceExpression
					if(p.node.type == 'SequenceExpression' && p.node.expressions[0] == n) p = p.up
					cut(n.start, (needSemi(p, n.start)?';':'')+'('+gs+'.c('+id+',')					
					cut(n.end - 1, "))")
					var a = []
					for(var i = 0;i<n.arguments.length;i++){
						var arg = n.arguments[i]
						if(arg)
							a.push({x:arg.loc.start.column, y:arg.loc.start.line,ex:arg.loc.end.column, ey:arg.loc.end.line})
						else a.push(null)
					}

					var ce = 0
					if(n.callee.type == 'MemberExpression'){
						if(n.callee.property.name == 'call') ce = 1
						if(n.callee.property.name == 'apply') ce = 2
					}
					dict[id++] = {x:n.callee.loc.start.column, y:n.callee.loc.start.line, ex:n.callee.loc.end.column, ey:n.callee.loc.end.line, a:a, ce:ce}
				},
				NewExpression: function(n, p){
					if(p.node.type == 'SequenceExpression' && p.node.expressions[0] == n) p = p.up
					cut(n.start, (needSemi(p, n.start)?';':'')+'('+gs+'.c('+id+',')					
					cut(n.end, "))")
					var a = []
					for(var i = 0;i<n.arguments.length;i++){
						var arg = n.arguments[i]
						if(arg)
							a.push({x:arg.loc.start.column, y:arg.loc.start.line,ex:arg.loc.end.column, ey:arg.loc.end.line})
						else a.push(null)
					}
					dict[id++] = {isnew:1,x:n.callee.loc.start.column, y:n.callee.loc.start.line, ex:n.callee.loc.end.column, ey:n.callee.loc.end.line, a:a}
				},
				ReturnStatement:     function(n, p){
					if(n.argument){
						//assignId.push(id)
						//cut(n.start+6, " "+gs+".b="+gs+"b,"+gs + "["+iid+"][" + (id-iid) + "]=")
						cut(n.argument.start, "("+gs+".e("+id+","+gs+"b,(")
						cut(n.argument.end, ")))")
					} else {
						cut(n.start+6, " "+gs + ".e(" + id + ", "+gs+"b)")
					}
					dict[id++] = {x:n.loc.start.column, y:n.loc.start.line, ret:fnid, r:1}
					// return object injection
				},
				CatchClause: function(n, p){
					// catch clauses need to send out a depth-reset message
					//cut(n.body.start + 1, gs + '.x('+gs+'d,'+gs+'b.x'+id+'='+ac.stringify(n.param)+');')
					cut(n.body.start + 1, gs+'b.x'+id+'='+acorn_tools.stringify(n.param)+';')
					
					// lets store the exception as logic value on the catch
					dict[id++]= {x:n.loc.start.column, y:n.loc.start.line, ex:n.loc.start.column+5,ey:n.loc.start.line}
				}
			})
	
			function addAssign(mark, inj){
				cut(inj, gs+"b.a"+id+"=")
				dict[id++] = {x:mark.start.column, y:mark.start.line,	ex:mark.end.column, ey:mark.end.line}
			}

			// write function entry
			var s = 'var '+gs+'b={};'
			if(loopIds.length){
				s = 'var '+gs+'b={'
				for(var i = 0;i<loopIds.length;i++){
					if(i) s += ','
					s += 'l'+loopIds[i]+':0'
				}
				s += '};'
			}

			var tryStart = "try{"
			var tryEnd = "}catch(x){"+gs+".e(" + id + "," + gs + "b,x,1);throw x;}"

			if(opt.nocatch){
				tryStart = ""
				tryEnd = ""
			}

			if(isRoot){
				fhead.v = 'var '+gs+'g'+fnid+'=' +gs + ".f(" + fnid + ",null,0,0);" + s + tryStart
				cut(n.end, ";" + gs + ".e(" + id + "," + gs + "b)" + tryEnd)
				dict[id++] = {x:n.loc.end.column, y:n.loc.end.line, ret:fnid, root:1}
			
			} else {
				fhead.v = 'var '+gs+'g'+fnid+'=' +gs + ".f(" + fnid + ",arguments,this,"+gs+"g"+parentId+");" + s + tryStart 
				cut(n.body.end - 1, ";" + gs + ".e(" + id + "," + gs + "b)" + tryEnd)
				dict[id++] = {x:n.body.loc.end.column, y:n.body.loc.end.line, ret:fnid}
			}
		}	

		instrumentFn(n, file, true, 0)

		function cutUp(cuts, str){
			var s = ''
			var b = 0
			var n = cuts.first()
			while(n){

				s += str.slice(b, n.i)
				s += n.v
				b = n.i
				n = n._d
			}
			s += str.slice(b)
			return s
		}	

		//"_$_.set("+iid+",["+assignId.join(',')+"]);"
		return {
			input:src,//cutUp(cuts,src),
			clean:cutUp(cuts, src), 
			output:head + cutUp(cuts, src), 
			id:id, 
			d:dict
		}
	}

	return instrument
})
define('/core/io_ssl',function(require, exports, module){

    // this is an unrooted certficate to run traceGL over https
	module.exports = {
		cert: "-----BEGIN CERTIFICATE-----\n"+
	"MIIB7zCCAVgCCQD4paokB3c5RzANBgkqhkiG9w0BAQUFADA8MQswCQYDVQQGEwJO\n"+
	"TDELMAkGA1UECBMCTkgxDDAKBgNVBAcTA0FNUzESMBAGA1UEChMJTG9jYWxob3N0\n"+
	"MB4XDTEyMTAyNzExMjEyNVoXDTEyMTEyNjExMjEyNVowPDELMAkGA1UEBhMCTkwx\n"+
	"CzAJBgNVBAgTAk5IMQwwCgYDVQQHEwNBTVMxEjAQBgNVBAoTCUxvY2FsaG9zdDCB\n"+
	"nzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEA0CEQ2x8I4ri+ePcetGP6+jWmpe1A\n"+
	"0U+q4jZYb/ws1D8sfnexc9UCz1j5y1WVyLxExfNTw7gi19+1ASGWE/JGSbIl6aRd\n"+
	"8Ez0IuYLEtCds/BXRAj2Mq9Iu45T8fgswgX2ErtuGEOHfSOA+l9PvtBPg2AKJNzP\n"+
	"4WJY0hw6HDS+lccCAwEAATANBgkqhkiG9w0BAQUFAAOBgQCQMx+M4iM/6ZQNwGzi\n"+
	"9U9Gm2hvemSmgcP05zBeisN3yFGNxNtVZyZ3K/sITE2KOW11Wcd/VDWfO6OGxlPx\n"+
	"yObL+GPVkL/2HEfBfYovqcSdHT+ZiVVo4tYJt6Tdx8iGAuOtAP7C+vl81CDI4fHf\n"+
	"9npl96D1wcQjW3PtI7YacYXjmQ==\n"+
	"-----END CERTIFICATE-----",
		key:"-----BEGIN RSA PRIVATE KEY-----\n"+
	"MIICXQIBAAKBgQDQIRDbHwjiuL549x60Y/r6Naal7UDRT6riNlhv/CzUPyx+d7Fz\n"+
	"1QLPWPnLVZXIvETF81PDuCLX37UBIZYT8kZJsiXppF3wTPQi5gsS0J2z8FdECPYy\n"+
	"r0i7jlPx+CzCBfYSu24YQ4d9I4D6X0++0E+DYAok3M/hYljSHDocNL6VxwIDAQAB\n"+
	"AoGAPo2BlGnqcMHXtWGIX+0gtGzFjl8VORN5p41v3RBspMnr5IKy2b5unsT+Joet\n"+
	"gexbuybbyRohlsIMk691fL83MknJA7CPTE0RZKEKN2gS41cagpM8+3rm57ElZBub\n"+
	"SjZUq8WYbL0gY4GL6b+jgdm9F4qlm5DxVBqk4oadHEhZHqECQQD79XiV9SWB6m/+\n"+
	"tg6leOeBnlbfHURwyyyhDEbhXEWfr9OUXg+vng+rDtf5p1T6u3oQ0u1lYG+RlFwu\n"+
	"MDMSWZM3AkEA03eh6sxJBvvLzNIHFsy9Oer7Tq+1R7nr0/ylmr2kjUeVg3fSiuCY\n"+
	"MTD9c+YubBidN7PNXZyiW/o2sYRRHdp58QJAL77Feg05bVQCow7W2a5+mEZsCd2e\n"+
	"8YzeySntaJk2rFsCShRE/q+CIpUugiWeaeEK8ZM230YV/k1R5oLFus10owJBAKsS\n"+
	"iwDCBwoJRVQLTQTa2PIz8N41Mzg1Zlz2dJp8dNR+ZqwWkVMcYsLY2RGb005Lk1Ru\n"+
	"tuLWRlqWTwzI+D5ocmECQQC99YYhg+Jo9ONQz7ov5KSh1NCBDZCBd91GEV+NJzgd\n"+
	"WArz102//xuzKcakjdHPUbuUYUeIAC/8grKvN2hnsB4h\n"+
	"-----END RSA PRIVATE KEY-----"
	}
})
// | Basic Node.JS server with io channel |_________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/

define('/core/io_server',function(require){

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
// | GL Browser context |_______________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/  

define('/core/gl_browser',function(require, exports, module){

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
// | GL Shader compilers |______________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/core/gl',function(require, exports, module){
	var fn = require("./fn")
	var gl = require("./gl_browser") 
	var acorn = require("./acorn")
	var acorn_tools = require("./acorn_tools")

	if(!gl){
		module.exports = null
		return
	}
	module.exports = gl

	//|  shader object
	//\____________________________________________/

	function Shader(){}

	(function(){
		var la = 0 // last attribute
		this.use = function(f){
			var ss = this.$ss = this.$sf[f || '_'] // selected shader
			this.$ul = ss.ul // uniform lookup
			gl.useProgram(ss.sp)
			var ha = 0 // highest attribute
			for(var i in ss.al){
				var a = ss.al[i]
				gl.enableVertexAttribArray(a)
				if(a > ha) ha = a
			}
			while(la > ha) gl.disableVertexAttribArray(la--)
			la = ha
			this.$tc = 0 // texture counter
			var tl = this.$tl
			// lets set all texture lookups
			for(var i in tl){
				var tc = this.$tc++
				gl.activeTexture(gl.TEXTURE0 + tc)
				gl.bindTexture(gl.TEXTURE_2D, tl[i])
				gl.uniform1i(this.$ul[i], tc)
			}
			var u = this.$un
			if(u) for(var k in u) this[k](u[k])
		}

		this.n = function(n){
			var nu = this.$nu
			// set all uniforms from n
			for(var i in nu){
				var v = nu[i]
				var p = n
				var d = v.d
				var k = v.k
				while(d > 0) p = p._p || p._b, d--
				var t = typeof p[k]
				if(t == 'string') this[i](p.eval(k))
				else this[i](p[k] || 0)
			}
		}

		//|  draw buffer
		this.draw = function(b){
			var sd = this.$sd
			var ss = this.$ss
			b  = b || this.$b
			gl.bindBuffer(gl.ARRAY_BUFFER, b.$vb)
			if(b.up) gl.bufferData(gl.ARRAY_BUFFER, b.$va, gl.STATIC_DRAW)
			var vt = b.$vt // vertex types
			for(var i in vt){
				var t = vt[i]
				gl.vertexAttribPointer(ss.al[i], t.c, t.t, !t.n, b.$vs, b[i].o)
			}
			if(sd.i){
				gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.$ib)
				if(b.up) gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.$ia, gl.STATIC_DRAW)
				gl.drawElements(sd.m, (b.hi - b.lo) * b.$ic, gl.UNSIGNED_SHORT, b.lo * b.$ic)
			} else {
            gl.drawArrays(sd.m, b.lo * b.$sl, (b.hi - b.lo) * b.$sl)
         }
         //if(gl.getError()) throw new Error("webGL error on draw")
			b.up = false
		}

		this.set = function(u){
			for(var k in u) this[k](u[k])
		}

		var _delvb = []
		var _delib = []
		//|  allocate buffer
		this.alloc = function(sc, ob){
			var sd = this.$sd // shader def
			var ad = this.$ad // attribute dep
			var an = this.$an // attribute node lookup
			var b = {} // buffer

			var vs = 0 // vertex stride
			for(var k in ad) vs += gt.types[ ad[k] ].s

			var vl = sc * vs * sd.l
			var va = new ArrayBuffer(vl)

			if(sd.i){
				var il = sc * 2 * sd.i
				var ia = new ArrayBuffer(il)
			}

			if(ob){ 
				var x = new Int32Array(ob.$va)
				var y = new Int32Array(va)
				for(var j = 0, l = ob.$vl >> 2; j < l; j++) y[j] = x[j] // because adding memcpy to a memblock API doesnt make sense...
				b = ob
				if(sd.i){// copy index buffer
					var x = new Int32Array(ob.$ia)
					var y = new Int32Array(ia)
					for(var j = 0, l = ob.$il >> 1; j < l; j++) y[j] = x[j]
				}
			} else {
				b.$vb = _delvb.pop() || gl.createBuffer()
				if(sd.i) b.$ib = _delib.pop() || gl.createBuffer() // indexbuffer
				b.lo = 0 // low used
				b.hi = 0 // high used
				b.$us = 0 // status counter
			}
			
			if(sd.i){
				b.$ia = ia // index array
				b.i = {
					a: new Uint16Array(ia), // indices
					i: sd.i,
					l: sd.l
				}
				b.$il = il // index length
				b.$ic = sd.i
			}
			b.up = true
			b.$sc = sc // slots
			b.$va = va // vertex array
			b.$vl = vl // vertex buffer length in bytes
 			b.$vs = vs // vertex stride in bytes
			b.$sl = sd.l // slot length
			b.$vt = {} // vertex types
			b.$sh = this  // shader

			var o = 0 // offset
			var vt = b.$vt
			for(var i in ad){ // create arrayviews
				var t = gt.types[ad[i]] // look up type
				vt[i] = t
				b[i] = {
					a : new t.a(va, o),
					t : t, // type
					s : vs / t.f, // stride
					o : o, // offset
					n : an[i], // lookup on n
					l : sd.l // vertex count
				}
				o += t.s
			}
			return b
		}

		this.free = function(b){
			_delvb.push(b.$vb)
			b.$vb = 0
			if(b.$ib){
				_delib.push(b.$ib)
				b.$ib  = 0
			}
		}
	}).apply(Shader.prototype)
	
	// uniform setter functions for shader
	var shader_us = {
		0: function(i){
			return function(t){
				var tc = this.$tc++
				gl.activeTexture(gl.TEXTURE0 + tc)
				gl.bindTexture(gl.TEXTURE_2D, t)
				gl.uniform1i(this.$ul[i], tc)
			}
		},
		1: function(i, u){ 
			return function(x) {
				gl[u](this.$ul[i], x)
			}
		},
		2: function(i, u){ 
			return function(x, y) {
				if(typeof x == 'object') gl[u](this.$ul[i], x.x, x.y)
				else gl[u](this.$ul[i], x, y)
			}
		},
		3: function(i, u){ 
			return function(x, y, z) {
				if(typeof x == 'object') gl[u](this.$ul[i], x.x, x.y, x.z)
				else gl[u](this.$ul[i], x, y, z)
			}
		},
		4: function(i, u){
			return function(x, y, z, w) {
				if(typeof x == 'object') gl[u](this.$ul[i],x.x, x.y, x.z, x.w)
				else gl[u](this.$ul[i], x, y, z, w)
			}
		}
	}

	var illegal_attr = {hi:1,lo:1,i:1,up:1}

	// |  shader function id-ifyer for fast caching
	// \____________________________________________/
	var fnid_c = 1 // the function id counter
	var fnid_o = {} // id to function string lookup
	var fnid_tc = {} // tracecache, used for fast shader hashing
	var fnid_rc = {} // reverse function lookup
	var fnid_ev = {} // js function evaluation cache

	// fingerprint this function against a domtree node n
	function fnid(f, n){
		if(!n || n.q) return f
		var c = f._c
		if(!c) f._c = c = f.toString().replace(/[;\s\r\n]*/g,'')
		var i = fnid_o[c]
		var tc = fnid_tc[i]
		if(!tc) return '@' // not compiled yet
		var s = String(i)
		for(var k in tc){ // walk the tracecache
			var v = tc[k]
			var p = n
			while(v>0) p = n._p || n._b, v--, s += '^' 
			var j = p[k]
			var t = typeof j
			if(p.hasOwnProperty(k)){ // clean up unregistered properties to getter/setters
				delete p[k]
				p[k] = j
			}
			if(t == 'number') s += k+'#'
			else if(t == 'object') s+= k+'*'
			else if(t == 'undefined') s += k+'?'
			else s += k + fnid(j, p)
		}
		return s
	}

	gl.totalCompiletime = 0

	// wrap createTexture to set a unique id on each texture
	gl.createTexture2 = gl.createTexture
	var textureID = 0
	// make sure textures have unique ID's
	gl.createTexture = function(){
		var t = gl.createTexture2()
		t.id = textureID++
		return t
	}

	//|  compile or cache shader from definition
	//\____________________________________________/
	gl.getShader = function(sd, dn){ // shader def, domnode

		// shader definition
		// m : mode, gl.TRIANGLES
		// l : length, vertices per slot
		// i : indices, indices per slot
		// v : vertex shader
		// f : fragment shader
		// p : point size shader
		// d : defines
		// e : extension library
		// s : switchable fragments

		sd.l = sd.l || 1
		sd.d = sd.d || {}
		sd.e = sd.e || {}
		sd.x = sd.x || {}
		sd.y = sd.y || {}
		sd.u = sd.u || {}
		if(!sd.cache) sd.cache = {}
		
		var vi = dn && dn.v || sd.v
		var fi = dn && dn.f || sd.f

		var sid = fnid(vi, dn) + '|' + fnid(fi, dn)
		var sh = sd.cache[sid]

		if(sh) return sh

		// create new shader object
		sh = new Shader()
		sh.$sd = sd
		var ad = sh.$ad = {} // attribute deps
		var an = sh.$an = {} // attribute node lookup
		var nu = sh.$nu = {} // node uniforms
		var ud = sh.$ud = {} // uniform deps
		var tl = sh.$tl = {} // texture list
		var nd = sh.$nd = {} // n dependencies
		var tn // texture on n 

		var dt = Date.now()
		
		var fw  // function wraps
		var fd = {} // function definitions
		var in_f
		var rd  // already defined

		var fa = {} // frag attributes
		var ts = {} // texture slots
		
		var ti = 0 // texture id 
		var wi = 0 // function wrap id
		
		// compiler output
		var oh  // output head
		var od  // output definitions
		var oe  // output expression
		var ob  // output body

		// parse and generate fragment shader
		oh = ob = od = '', pd = {}, fw = '', in_f = true
		if(sd.m == gl.POINTS) pd.c = 1

		var cs = fi
		if(typeof cs == 'function'){
			sd.e._f = cs
			cs = '_f()'
		}
		var ns =  {n:dn || {l:1}, np:'N', dp:0}
		oe = expr(cs, 0, 0, ns)

		// compile switchable fragment shaders
		var ssf = sd.s || {_:0}
		var sf = {}
		for(var i in ssf) sf[i] = expr(ssf[i], [oe], 0, ns)

		// deal with c in POINT fragment shader
		if(sd.m == gl.POINTS){
			//delete fa.c
			oh += 'vec2 c;\n'
			ob += gl.flip_y?
			 ' c = vec2(gl_PointCoord.x,gl_PointCoord.y);\n':
			 ' c = vec2(gl_PointCoord.x,1.-gl_PointCoord.y);\n'
		}

		var yf = '', yd = '', yb = '', yv = ''

		// pack varyings
		var vu = 0 // used
		var vs = 0
		var vn = { 0:'x',1:'y',2:'z',3:'w' }
		for(var i in fa){
			yd += fa[i] + ' ' + i +';\n'
				if(fa[i] == 'float'){ //pack
		 				yb += ' ' + i + ' = v_' + vs + '.' + vn[vu] + ';\n'
			 			yv += ' v_' + vs + '.' + vn[vu] + ' = ' + i + ';\n'
			 			vu++
		 			if(vu >= 4){
			 			yf += 'varying vec4 v_' + vs + ';\n'
			 			vs ++, vu = 0
			 		}
				} 
				else {
				if(fa[i] == 'ucol'){
					yf += 'varying vec4 '+ i + 'v;\n'
	 				yf += 'varying float ' + i + 'v_x;\n'
	 				yf += 'varying float ' + i + 'v_y;\n'
	 				yf += 'varying float ' + i + 'v_z;\n'
	 				yf += 'varying float ' + i + 'v_w;\n'
	 				yb += ' ' + i + ' = vec4('+i+'v_x,'+i+'v_y,'+i+'v_z,'+i+'v_w);\n'
		 			yv += ' ' + i + 'v_x = ' + i + '.x;\n'
		 			yv += ' ' + i + 'v_y = ' + i + '.y;\n'
		 			yv += ' ' + i + 'v_z = ' + i + '.z;\n'
		 			yv += ' ' + i + 'v_w = ' + i + '.w;\n'
		 		} else {
	 				yf += 'varying ' + fa[i] + ' ' + i + 'v_;\n'
	 				yb += ' ' + i + ' = ' + i + 'v_;\n'
		 			yv += ' ' + i + 'v_ = ' + i + ';\n'
		 		}
	 		}
		}
		if(vu > 0) yf += 'varying vec'+(vu>1?vu:2)+' v_' + vs + ';\n'

		var fs = 
			'precision mediump float;\n' +
			'#define ucol vec4\n' +
			oh + od + yf + yd + fw  +
			'void main(void){\n'+ yb + ob + 
			' gl_FragColor = '

		// generate multiple fragments
		for(var i in sf) sf[i] = fs + sf[i] + ';\n}\n'

		cs = vi
		if(typeof cs == 'function'){
			sd.e._v = cs
			cs = '_v()'
		}

		// parse and generate vertexshader
		oh = ob = od = '', pd = {}, fw = '', in_f = false
		oe = expr(cs, 0, 0, ns)
		// glpoint unit expression 
		if(sd.p) ob += ' gl_PointSize = ' + expr(sd.p, 0, 0, ns) + ';\n'

		for(var i in ad){
			if(i in illegal_attr) throw new Error("Cannot name an attribute hi,lo or i." + i)
			od += 'attribute ' + ad[i] + ' ' + i + ';\n'
		}

		var vs = 
			'precision mediump float;\n'+
			'#define ucol vec4\n' +
			oh + od + yf + fw + '\n' +
			'void main(void){\n'+ yv + ob + 
			' gl_Position = ' + oe + ';\n' +
		'}\n'

		if(sd.dbg || (dn && dn.dbg)){
			var o = ''
			for(var i in sf) o +=  '---- fragment shader '+i+' ----\n' + sf[i]  
			fn('---- vertex shader ----\n' + vs + o)
			/*
			fn('---- trace cache ----\n')
			for(k in fnid_tc){
				var o = ''
				for(l in fnid_tc[k])o += l+':'+fnid_tc[k][l]+' '
				fn(k+' -> '+o + ' ' + fnid_rc[k]._c)
			}*/
		}

		var gv = gl.createShader(gl.VERTEX_SHADER)
		gl.shaderSource(gv, vs)
		gl.compileShader(gv)
		if (!gl.getShaderParameter(gv, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(gv) + "\n" + vs)				

		sh.$sf = {}
		for(var i in sf) sh.$sf[i] = frag(gv, sf[i])

		// define uniform setters on shader object
		for(var i in sd.u) if(!(i in ud)) sh[i] = function(){}

		for(i in ud){
			var t = ud[i] // type
			var y = gt.types[t] // uniform function name
			if(i in sh) throw new Error("Cannot use uniform with name "+i)
			sh[i] = shader_us[y.c](i, y.u)
		}

		gl.totalCompiletime += Date.now() - dt

		sid = fnid(vi, dn) + '|' + fnid(fi, dn)
		
		sh.$id = sid
		sd.cache[sid] = sh

		return sh

		// compile fragment
		function frag(gv, fs){
			var s = {}

			s.al = {}
			s.ul = {}

			var gf = gl.createShader(gl.FRAGMENT_SHADER)
			gl.shaderSource(gf, fs)
			gl.compileShader(gf)

			if (!gl.getShaderParameter(gf, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(gf) + "\n" + fs)

			var sp = s.sp = gl.createProgram()
			gl.attachShader(sp, gv)
			gl.attachShader(sp, gf)
			gl.linkProgram(sp)

			if (!gl.getProgramParameter(sp, gl.LINK_STATUS)){
				console.log(vs, fs)
				throw new Error("Could not link, max varying:" + gl.getParameter(gl.MAX_VARYING_VECTORS) +"\n"+ gl.getShaderInfoLog(gf) + fs)
			}

			gl.useProgram(sp)

			for(var i in ad) s.al[i] = gl.getAttribLocation(sp, i)
			for(i in ud) s.ul[i] = gl.getUniformLocation(sp, i)

			return s
		}

		// GLSL expresion compiler
		function expr(f, a, lv, ns){ // function, args, local variables, nodestruct
			if(!f) return a[0]

			var c = f._c || (f._c = f.toString().replace(/[;\s\r\n]*/g,''))

			// lets id-ify the function
			var id = f._i
			if(!id) f._i = id = fnid_o[c] || (fnid_o[c] = fnid_c++)

			var tc = fnid_tc[id] || (fnid_tc[id] = {})// trace cache
			fnid_rc[id] = f

			var p = acorn_tools.parse(c,{noclose:1, compact:1}).tokens._c

			var ma = {} // macro args

			if(p.t.match(/^function/)){
				if(a){ // we have args, build up macro args
					var c = 0 // arg count
					while(!p.parenL) p = p._d // scan till we have ()
					for(var i = p._c; i; i = i._d) if(i.name)	c++ // count args
					c = a.length - c - 1  // smear (1,2)->(a,b,c) to (a=1,b=1,c=2)
					for(var i = p._c; i; i = i._d) if(i.name) ma[i.t] = a[++c < 0 ? 0 : c]
				}

				while(p && !p.braceL) p = p._d // skip to the function body	
			} else {
				p = p._p // skip back up
			}

			function subexpr(i, f, lv, ns){ // iter parse, function, local variables,  nodestruct
				var c = f._c || (f._c = f.toString().replace(/[;\s\r\n]*/g,''))
				var e = f._e
				if(!e) f._e = e =c.indexOf('_fw_') != -1 ? 3 : 
				                 c.indexOf('return_') != -1 ? 2 : 
				                 c.indexOf('return') != -1 ? 4 : 1

				var ar // args
				if(i._d && i._d.parenL){
					ar = expand(i._d._c, 0, lv, ns), i._d.t = i._d._t = ''
				}

				if(e == 1){ // macro
					if(ar) for(var j = 0;j<ar.length;j++) ar[j] = '('+ar[j]+')'
					i.t = '('+expr(f, ar, lv, ns)+')'
				}
				else if(e == 2){ // its a function
					var o = i.t.indexOf('.')
					if(o != -1) i.t = i.t.slice(0, o) + '_' + i.t.slice(o+1)
					if(!fd[i.t]){ // not defined yet
						fd[i.t] = 1
						var v = subfn(f, i.t, ns)
						fw += v
					}
					i.t = i.t+'('+ar.join(',')+')'
				}
				else if(e == 3){ // its a function wrapper 
					// lets parse out return type 
					var m = c.match(/([a-zA-Z0-9_]*)\_fw\_([a-zA-Z0-9_]*)/)
					var v = m[1] || 'vec4'
					var o = 'vec2 c'
					if(m[2]) o = m[2].replace(/_/g,' ')
					fw += v + ' _fw' + wi + '(' + o + '){\n return ' + ar[ar.length - 1] + ';\n}\n'
					ar[ar.length-1] = '_fw' + wi++
					i.t = expr(f, ar, lv, ns)
				}
				else if(e == 4) { // its a string generator
					var b = []
					if(ar) for(var j = 0;j<ar.length;j++) b[j] = '('+ar[j]+')'
					var v = f.apply(null, b)
					var o = v.indexOf('#')
					if(o == -1) i.t = v
					else {
						v = v.slice(0,o)+'_fw'+wi+v.slice(o+1)
						fw += v;
						i.t = '_fw' + wi + '(' + ar.join(',') + ')'
						wi++
					}
				}
			}
			// parse GLSL subfunction
			function subfn(f, t, ns){
				var ce = f._ce
				if(!ce) f._ce = ce = f.toString()
				var p = acorn_tools.parse(ce,{noclose:1, compact:1, tokens:1}).tokens._c
				//var p = ep(ce)._c // parse code and fetch first child
				
				var i // iterator
				var lv = {}// local variables
				var rt // return type
				// lets parse the args and write the function header
				//fn(ce,p)
				while(!p.parenL) p = p._d // scan till we have ()
				var os = '(' // output string
				for(i = p._c; i; i = i._d) if(i.name){
					var j = i.t.indexOf('_')
					var k = i.t.slice(j + 1)
					var y = i.t.slice(0, j)
					os += (os != '(' ? ',' : '' )+ y + ' ' + k
					lv[k] = y
				}
				os = t + os + ')'

				while(p && !p.braceL) p = p._d // skip to the function body	
				i = p
				
				while(i){
					while(i.braceL){
						os += '{\n'
						if(!i._c){ s+= '}\n'; break;}
						i = i._c
					}
					if(i.name && i._d && i._d.semi){ // empty define
						var o = i.t.indexOf('_'), y
						var k = i.t.slice(o+1)
						if(o != 0 && gt.types[y = i.t.slice(0,o)]){
							lv[k] = y // define it
						} else y = i.t, k = ''
						os +=  y + ' ' + k + ';'
						i = i._d
					}else
					if(i.name && i._d && i._d.isAssign){ // assign define
						var o = i.t.indexOf('_'), y
						var k = i.t.slice(o+1)
						if(o != 0 && gt.types[y = i.t.slice(0,o)]){
							lv[k] = y // define it
						} else y = i.t, k = ''
						// output stuff and following expression
						// find end ;
						var j = i;
						while(j && !j.semi) j = j._d
						if(!j) throw new Error("assignment without terminating ; found")
						os += y + ' ' + k + ' ' + i._d.t + ' ' + expand(i._d._d, j, lv, ns) + ';'
						i = j
					} else 					
					if(i.name && i._d && i._d.parenL){
						var o = i.t.indexOf('_'), y
						if(o != 0 && gt.types[y = i.t.slice(0,o)]){
							var k = i.t.slice(o+1)
							lv[k] = y, k += ' = ' + y
							os += y + ' '+ k + '('+ expand(i._d._c, 0, lv, ns).join(',')+');\n'
							i = i._d
						} else if(y == 'return'){
							var k = i.t.slice(o+1)
							if(rt && k != rt) throw new Error("please use one return type in "+t)
							rt = k
							os += 'return '+ k + '('+ expand(i._d._c, 0, lv, ns).join(',')+');\n'
							i = i._d
						} else {
							os += expand(i, i._d._d, lv, ns)[0]
							i = i._d
						}
					}else if(i.if && i._d.parenL){
						os += ';\n'+i.t +'('+ expand(i._d._c, 0, lv, ns).join(',')+')'
						i = i._d
					}else if(i.for && i._d.parenL){ // for loop
						var p1  = i._d._c, p2, p3, p4
						p2 = p1
						while(p2 && !p2.semi) p2 = p2._d
						p3 = p2._d
						while(p3 && !p3.semi) p3 = p3._d
						// init decl from p1
						var o = p1.t.indexOf('_')
						if(!p1 || !p2 || !p3 || o == -1) throw new Error("for loop without init declaration")
						var k = p1.t.slice(o + 1)
						var y = p1.t.slice(0, o)
						lv[k] = y
						p1.t = k
						os += 'for(' + y +' '+ expand(p1, p2, lv, ns) + ';' + expand(p2._d, p3, lv, ns) + ';' + expand(p3._d, 0, lv, ns) + ')'
						i = i._d._d
					}
					else{ 
						os +=  i.t + ' '
					}
					while(i && !i._d && i != p){
						i = i._p || i._b, os+= ';\n}\n'
					}
					if(i) i = i._d
				}
				if(!rt) throw new Error("no returntype for "+t)
				os = rt + ' ' + os

				return os
			}

			function expand(i, x, lv, ns){ // recursive expression expander
				var ea = [] // expression args
				var os = '' // output string
				while(i && i != x){
					// integer bypass
					if(i.t == '+' && i._d && i._d.num && (!i._u || i._u.t == '=')){
						i.t = '', i._d._t = {}
					}else // auto float
					if(i.num && i.t.indexOf('.') == -1){
						i.t += '.'
					}
					else if(i.name){
						var o
						var t = (o = i.t.indexOf('.')) != -1 ? i.t.slice(0, o) : i.t

						if(t in ma) i.t = ma[t] // expand macro arg
						else if(o==0){} // property 
						else if(lv && (t in lv)){} // local variable
						else if(t in pd){} // previously defined
						else if(t in sd.d) // define
							pd[t] = oh += '#define ' + t + ' ' + sd.d[t] + '\n'
						else if(t in gt.cv4) // color 
							pd[t] = oh += '#define ' + t + ' ' + gt.cv4[t] + '\n'
						else  if(t == 't' && o != -1){ // theme palette access
							var k = i.t.slice(o+1)
							if(!sd.t) throw new Error('theme object not supplied to compiler for '+i.t)
							if(!(k in sd.t)) throw new Error('color not defined in theme: ' + i.t)
							if(!('T' in ud)){ // set up T uniform
								pd.T = ud.T = 'sampler2D'
								tl.T = sd.t
								oh += 'uniform sampler2D T;\n'
							}
							i.t = 'texture2D(T,vec2('+sd.t[k]+',0))'
						}
						else if(t in sd.u) // uniform
							pd[t] = ud[t] = sd.u[t], oh += 'uniform ' + ud[t] + ' ' + t + ';\n'
						else if(t in sd.a){ // attribute 
							in_f ? fa[t] = ad[t] = sd.a[t] : ad[t] = sd.a[t]
						} 
						else if(t == 'n' || t == 'p'){
							var n2 = ns
							var k = i.t.slice(o+1)
							if(t == 'p'){
								n2 = {
									np: 'P' + ns.np, // node parent
									dp: ns.dp+1, // depth
									n: ns.n._p || ns.n._b // n
								}
								tc[k] = 1
							} else tc[k] = 0
							var j = n2.n[k]
							var to = typeof j
							gl.regvar(k) // hook to allow ui node prototype to update
							var is_tex = j instanceof WebGLTexture
							if(to == 'function' || to == 'string') subexpr(i, j, lv, n2)
							else if(to == 'object' && !is_tex){ // its an animating property

							} else {
								if(n2.n.l || is_tex){ // make it a node uniform
									var lu = {d:n2.dp || 0, k:k}
									k = n2.np + k
									if(is_tex){ 
										if(!tn) tn = sh.$tn = {} // texture n ref
										tn[k] = lu
									}
									if(!pd[k]){
										nu[k] = lu
										pd[k] = ud[k] = (is_tex?'sampler2D':sd.y[k] || 'float')
										oh += 'uniform ' + ud[k] + ' ' + k + ';\n'
									}
									i.t = k
								} else { // attribute dep
									var lu = {d:n2.dp, k:k}
									k = n2.np + k
									an[k] = lu
									i.t = k
									in_f ? fa[k] = ad[k] = (sd.y[k] || 'float') : ad[k] = (sd.y[k] || 'float')
								}
							}
						}
						else if(t in sd.x){ // use expression value
							var o = sd.x[t]
							oh += o.t +' '+t + ';\n'
							ob += t + ' = ' + expr(o.c, 0, lv, ns) + ';\n'
							pd[t] = 1
						}
						else if(ns.n.e && t in ns.n.e) // node ext lib
							subexpr(i, ns.n.e[t], lv, ns) 
						else if(t in sd.e)
							subexpr(i, sd.e[t], lv, ns) // glsl expression
						else if(!(t in gt.types || t in gt.builtin)){ // undefined
							//fn(cq.dump(ri))
							throw new Error("undefined variable used:" + t + " in " + f)
						}
					} else if(i.string){
						if(!in_f) throw new Error("texture not supported in vertex shader")	
						if(!(i.t in ts)){
							var o = ts[i.t] = '_'+(ti++)
							ud[o] = 'sampler2D'
							var t = i.t.slice(1, -1)
							tl[o] = gl.loadImage(t) // use 
							oh += 'uniform sampler2D '+o+';\n'
						}
						i.t = ts[i.t]
					}
					if(i.comma) ea.push(os), os = '' 
					else if(i.parenL) os+= '(' + expand(i._c, null, lv, ns).join(',') + ')'
					else os += i.t
				
					i = i._d
				}
				ea.push(os)
				return ea
			}
			return expand(p._c,0,lv,ns)[0]
		}
	}
	
	// |  evaluate a float shader expression in js
	// \____________________________________________/


	// JS version of the expression compiler
	function js_expr(f, a, un, el, rd){ // function, args
		if(!f) return a[0]

		var c = f._c
		var id = f._i
		if(!c) f._c = c = f.toString()
		if(!id) f._i = id = fnid_o[c] || (fnid_o[c] = fnid_c++)
		
		var p = acorn_tools.parse(c,{noclose:1, compact:1, tokens:1}).tokens._c
		var i // iterator
		var m = {} // macro args

		if(p.t.match(/^function/)){
			if(a){ // we have args, build up macro args
				var c = 0 // arg count
				while(!p.parenL) p = p._d // scan till we have ()
				for(i = p._c; i; i = i._d) if(i.name)	c++ // count args
				c = a.length - c - 1  // smear (1,2)->(a,b,c) to (a=1,b=1,c=2)
				for(i = p._c; i; i = i._d) if(i.name) m[i.t] = a[++c < 0 ? 0 : c]
			}

			while(p && !p.braceL) p = p._d // skip to the function body	
		} else{
			p = p._p
		}

		function subexpr(i, f){ // iter node, function
			var c = f._c
			if(!c) f._c = c = f.toString().replace(/[;\s\r\n]*/g,'')

			var e = f._e
			if(!e) f._e = e = c.indexOf('_fw_') != -1 ? 3 : 
			                 c.indexOf('return_') != -1 ? 2 : 
			                 c.indexOf('return') != -1 ? 4 :1				
			var a // args
			if(i._d && i._d.parenL){
				a = expand(i._d._c), i._d.t = i._d._t = ''
				for(var j = 0; j < a.length; j++) a[j] = '(' + a[j] + ')'
			}

			if(e == 1)i.t = '(' + js_expr(f, a, un, el, rd) + ')' // its a macro
			else if(e == 2) throw new Error("cant use function wrappers in JS expressions")
			else if(e == 3) throw new Error("cant use sub functions in JS expressions")
			else if(e == 4) i.t = f.apply(null, a)
		}

		function expand(i){ // recursive expander
			var a = [] // args we collect for macros
			var s = '' // string concatenator
			while(i){
				if(i.num && i.t.indexOf('.') == -1) i.t += '.'
				else if(i.name){
					var o, t = (o = i.t.indexOf('.')) != -1 ? i.t.slice(0, o) : i.t

					if(t in m) i.t = m[t] // expand macro arg
					else if(t in un){ // uniform
						i.t = '__u.'+i.t
					}
					else if(t == 'n' || t == 'p'){ // node reference
						var k = i.t.slice(o+1)
						i.t = t+'_'+k
						if(!rd[t+'_'+k]){
							rd.b += 'var '+t+'_'+k+' = __x('+t+','+t+'.'+k+', __u, __e);\n'
							rd[t+'_'+k] = 1
						}
					}
					else if(t in el){
						subexpr(i, el[t]) // glsl expression
					}
					else if(t in gt.builtin){ // builtin
						i.t = '__b.' + i.t
					} else {
						fn(un)
						throw new Error("undefined variable used in JS expression:(" + t + ")")
					}
				} 
				else if(i.string) throw new Error("texture not supported in JS expressions")
				if(i.comma) a.push(s), s = '' 
				else if(i.parenL) s+= '(' + expand(i._c).join(',') + ')'
				else s += i.t
				i = i._d
			}
			a.push(s)
			return a
		}
		return expand(p._c)[0]
	}

	gl.eval = function(n, f, un, el){
		if(typeof f == 'number') return f
		var j = fnid_ev[f]
		if(!j){
			var rd = {b:''} // already defined
			var e = js_expr(f, 0, un, el, rd) // compile it
			rd.b += 'return '+e+'\n'
			fnid_ev[f] = j = Function('n','p','__u','__e','__b','__x', rd.b)
		}		
		// actual evaluation
		return j(n, n._p || n._b, un, el, gt.builtin, gl.eval)
	}


	//|  render to texture
	//\____________________________________________/
	gl.renderTexture = function(w, h, f){
		var b = gl.createFramebuffer()
		b.width = w
		b.height = h
		var t = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, t)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)

		gl.bindFramebuffer(gl.FRAMEBUFFER, b)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)

		gl.viewport(0, 0, w, h)

		f()

		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		gl.bindTexture(gl.TEXTURE_2D, null)
		gl.deleteFramebuffer(b)
		gl.viewport(0, 0, gl.width, gl.height)
		t.id = gl.textureID++
		return t
	}


	//|  detect POINT ORIGIN
	//\____________________________________________/
	function detect_y(){
		// build shaders
		var v = 'attribute vec2 c;void main(void){gl_PointSize = 2.;gl_Position = vec4(c.x,c.y,0,1.);}'
		var f = 'precision mediump float;void main(void){gl_FragColor = vec4(gl_PointCoord.y>0.5?1.0:0.0,gl_PointCoord.x,0,1.);}'
		var fs = gl.createShader(gl.FRAGMENT_SHADER)
		gl.shaderSource(fs, f), gl.compileShader(fs)
		if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(fs))

		var vs = gl.createShader(gl.VERTEX_SHADER)
		gl.shaderSource(vs, v), gl.compileShader(vs)
		if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vs))

		sp = gl.createProgram()
		gl.attachShader(sp, vs), 
		gl.attachShader(sp, fs),
		gl.linkProgram(sp)

		var b = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, b)
		var x = new Float32Array(2)
		x[0] = -1, x[1] = 1
		gl.bufferData(gl.ARRAY_BUFFER, x, gl.STATIC_DRAW)

		var cl = gl.getAttribLocation(sp, 'c')
		gl.useProgram(sp)
		gl.enableVertexAttribArray(cl)
		gl.vertexAttribPointer(cl, 2, gl.FLOAT, false, 8, 0);
		gl.drawArrays(gl.POINTS, 0, 1)
		var pv = new Uint8Array(4)
	   gl.readPixels(0, gl.height - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pv)
		gl.deleteBuffer(b)
	   return pv[0] != 0
	}

	//|  gl table with lookups
	function gt(){
		// u:uniformfn  s:stride  a:arraytype  f:floatsize  c:components  w:writefn  r:readfn  t:type
		var y = {}
		y.int    = {u:"uniform1i", c:1}
		y.ivec2  = {u:"uniform2i", c:2}
		y.ivec3  = {u:"uniform3i", c:3}
		y.ivec4  = {u:"uniform4i", c:4}
		y.uint   = {u:"uniform1i", c:1}
		y.uvec2  = {u:"uniform2i", c:2}
		y.uvec3  = {u:"uniform3i", c:3}
		y.uvec4  = {u:"uniform4i", c:4}
		y.double = {u:"uniform1f", s:8,  a:Float64Array, f:8, c:1, w:fl, r:_fl, t:gl.FLOAT}
		y.dvec2  = {u:"uniform2f", s:16, a:Float64Array, f:8, c:2, w:v2, r:_v2, t:gl.FLOAT}
		y.dvec3  = {u:"uniform3f", s:24, a:Float64Array, f:8, c:3, w:v3, r:_v3, t:gl.FLOAT}
		y.dvec4  = {u:"uniform4f", s:32, a:Float64Array, f:8, c:4, w:v4, r:_v4, t:gl.FLOAT}
		y.float  = {u:"uniform1f", s:4,  a:Float32Array, f:4, c:1, w:fl, r:_fl, t:gl.FLOAT}
		y.vec2   = {u:"uniform2f", s:8,  a:Float32Array, f:4, c:2, w:v2, r:_v2, t:gl.FLOAT}
		y.vec3   = {u:"uniform3f", s:12, a:Float32Array, f:4, c:3, w:v3, r:_v3, t:gl.FLOAT}
		y.vec4   = {u:"uniform4f", s:16, a:Float32Array, f:4, c:4, w:v4, r:_v4, t:gl.FLOAT}
		y.ucol   = {u:"uniform1ic", s:4,  a:Uint32Array,  f:4, c:4, w:co, r:_co, t:gl.UNSIGNED_BYTE, n:false, x:'vec4'},
		y.sampler2D = {c:0}
		y.bool = {c:0}
		gt.types = y

		// native vertex shader variables
		gt.vertex = {
			gl_Position:1,
			gl_PointSize:1,
			gl_DepthRange:1
		}
		// native fragment shader variables
		gt.fragment = {
			gl_DepthRange:1,
			gl_FragCoord:1,
			gl_PointCoord:1,
			gl_FrontFacing:1,
			gl_FragColor:1,
			gl_FragData:1
		}
		// native globals
		gt.globals = {
			gl_MaxVertexAttribs:1,
			gl_MaxVertexUniformVectors:1,
			gl_MaxVaryingVectors:1,
			gl_MaxVertexTextureImageUnits:1,
			gl_MaxCombinedTextureImageUnits:1,
			gl_MaxTextureImageUnits:1,
			gl_MaxFragmentUniformVectors:1,
			gl_MaxDrawBuffers:1
		}

		gt.builtin = {
			// trig
			sin:Math.sin,
			cos:Math.cos,
			tan:Math.tan,
			asin:Math.asin,
			acos:Math.acos,
			atan:Math.atan,
			sinh:function(a){ return (Math.exp(a) - Math.exp(-a))/2 },
			cosh:function(a){ return (Math.exp(a) + Math.exp(-a))/2 },
			tanh:function(a){ return (Math.exp(a) - Math.exp(-a)) / (Math.exp(a) + Math.exp(-a)) },
			asinh:function(a){ return Math.log(a + Math.sqrt(a * a + 1)) },
			acosh:function(a){ return Math.log(a + Math.sqrt(a * a - 1)) },
			atanh:function(a){ return 0.5 * Math.log((1 + a) / (1 - a)) },
			degrees:function(a){ return a*180/Math.PI },
			radians:function(a){ return a*Math.PI/180 },
			// clamping
			abs:Math.abs,
			ceil:Math.ceil,
			floor:Math.floor,
			trunc:Math.floor,
			round:Math.round,
			min:Math.min,
			max:Math.max,
			// logic			
			all:function(a){ return a != 0 },
			any:function(a){ return a != 0 },
			not:function(a){ return a == 0 },
			clamp:function(a, mi, ma) {return a < mi ? mi : a > ma ? ma : a },
			roundEven:function(a) { return Math.round(a / 2) * 2 },			
			equal:function(a, b) { return a == b },
			greaterThan:function(a, b) { return a > b },
			greaterThanEqual:function(a, b) { return a >= b },
			lessThan:function(a, b) { return a < b },
			lessThanEqual:function(a, b) { return a <= b },
			notEqual:function(a, b) { return a != b },
			isinf:function(a) { return a === Number.POSITIVE_INFINITY || a === Number.NEGATIVE_INFINITY },
			isnan:function(a) { return a === NaN},
			sign:function(a) { return a >= 0 ? 1 : -1 },
			// mod pow exp
			mod:Math.mod,
			pow:Math.pow,
			sqrt:Math.sqrt,
			exp:Math.exp,
			log:Math.log,
			fract:function(a) { return a - Math.floor(a) },
			exp2:function(a) { return a * a },
			log2:function(a){ return Math.log(a,2) },
			step:function(e, a){ return a < e ? 0 : 1 },
			inverse:function(a) { return 1/a },
			inversesqrt:function(a){ return 1 / Math.sqrt(a) },
			mix:function(a, b, f){ return (1-f) * a + f * b },
			smoothstep:function(e1, e2, x){ if(x<e1) return 0; if(x>e1) return 1; x = (x-e1) / (e2-e1); return x * x * (3 - 2 * x); },
			length:function(a){ return a },
			modf:1,

			noise:1,cross:1,distance:1,dot:1,outerProduct:1,normalize:1,
			// matrix
			determinant:1,matrixCompMult:1,transpose:1,
			// derivatives
			dFdx:1,dFdy:1,fwidth:1,
			// operations with 3 types
			faceforward:1,fma:1,reflect:1,refract:1,
			// texture
			texture2D:1,
			texelFetch:1,texelFetchOffset:1,texture:1,textureGrad:1,textureGradOffset:1,
			textureLod:1,textureLodOffset:1,textureOffset:1,textureProj:1,textureProjGrad:1,
			textureProjGradOffset:1,textureProjLod:1,textureProjLodOffset:1,textureSize:1,
			gl_FragCoord:1
		}

		gt.col = {}
		gt.cv4 = {}
		// float JS value type to vertexbuffer parser
		function fl(i, a, o, m, s){
			a[o] = parseFloat(i)
			if(m <= 1) return
			var x = a[o], o2 = o + s
			while(m > 1) a[o2] = x, m--, o2 += s
		}

		// stringify stored float(s)
		function _fl(a, o, m, s) {
			var v = 'fl |' + a[o] + '|'
			if(m <= 1) return v
			var x = a[o], o2 = o + s
			while(m > 1) v += ' ' + a[o2] + '|', m--, o2 += s
			return v
		}

		// vec2 JS value type to vertexbuffer parser
		function v2(i, a, o, m, s){
			var t = typeof i
			if(t == 'object')     a[o] = i.x,  a[o + 1] = i.y
			else if(t == 'array') a[o] = i[0], a[o + 1] = i[1]
			else                  a[o] = a[o + 1] = parseFloat(i[0])
			if(m <= 1) return 
			var x = a[o], y = a[o + 1], o2 = o + s
			while(m > 1) a[o2] = x, a[o2 + 1] = y, m--, o2 += s
		}
	 
		// stringify stored vec2)
		function _v2(a, o, m, s) {
			var v = '|'+ a[o] + ' ' + a[o + 1] + ''
			if(m <= 1) return v
			var x = a[o], o2 = o + s
			while(m > 1) v += '|'+ a[o2] + ' ' + a[o2 + 1] + '', m--, o2 += s
			return v + '|'
		}

		// vec3 JS value type to vertexbuffer parser
		function v3(i, a, o, m, s){
			var t = typeof i
			if(t == 'object')     a[o] = i.x,  a[o + 1] = i.y,  a[o + 2] = i.z
			else if(t == 'array') a[o] = i[0], a[o + 1] = i[1], a[o + 2] = i[2]
			else                  a[o] = a[o + 1] = a[o + 2] = parseFloat(v[0])
			if(m <= 1) return
			var x = a[o], y = a[o + 1], z = a[o + 2], o2 = o + s

			while(m > 1) a[o2] = x, a[o2 + 1] = y, a[o2 + 2] = z, n--, o2 += s
		}

		// stringify stored vec3
		function _v3(a, o, m, s) {
			var v = '|'+ a[o] + ' ' + a[o + 1] + ' ' + a[o + 2] + ''
			if(m <= 1) return v
			var x = a[o], o2 = o + s
			while(m > 1) v += '|'+ a[o2] + ' ' + a[o2 + 1] + ' ' + a[o2 + 2] + '', m--, o2 += s
			return v
		}

		// vec4 JS value type to vertexbuffer parser
		function v4(i, a, o, m, s){
			var t = typeof i
			if(t == 'object'){
				if('r' in i)        a[o] = i.r,  a[o + 1] = i.g,  a[o + 2] = i.b,       a[o + 3] = i.a
				else if('h' in i)   a[o] = i.x,  a[o + 1] = i.y,  a[o + 2] = i.x + i.w, a[o + 3] = i.y + i.h
				else                a[o] = i.x,  a[o + 1] = i.y,  a[o + 2] = i.z,       a[o + 3] = i.w
			} else if(t == 'array')a[o] = v[0], a[o + 1] = v[1], a[o + 2] = v[2],      a[o + 3] = v[3]
			else {
				if(parseFloat(i) == i) a[o] = a[o + 1] = a[o + 2] = a[o + 3] = parseFloat(i)
				else {
					i = parseColor(i)
			  	   a[o] = i.r,  a[o + 1] = i.g,  a[o + 2] = i.b,       a[o + 3] = i.a
				}
			}
			if(m <= 1) return;

			var x = a[o], y = a[o + 1], z = a[o + 2], w = a[o + 3], o2 = o + s

			while(m > 1) a[o2] = x, a[o2 + 1] = y, a[o2 + 2] = z, a[o2 + 3] = w, m--, o2 += s
		}

		// stringify stored vec4)
		function _v4(a, o, m, s) {
			var v = '|'+ a[o] + ' ' + a[o + 1] + ' ' + a[o + 2] + ' ' + a[o + 3] + ''
			if(m <= 1) return v
			var x = a[o], o2 = o + s
			while(m > 1) v += '|' + a[o2] + ' ' + a[o2 + 1] + ' ' + a[o2 + 2] + ' ' + a[o2 + 3] + '', m--, o2 += s
			return v
		}   

		// color JS value type to vertexbuffer parser
		function co(i, a, o, m, s){
			var t = typeof i;
			if(t == 'number') a[o] = i
			else if(t == 'object' || t == 'function'){
				if('r' in i) a[o] = ((i.r*255)&0xff)<<24 | ((i.g*255)&0xff)<<16 | ((i.b*255)&0xff)<<8 | ((i.a*255)&0xff)
				else         a[o] = ((i.x*255)&0xff)<<24 | ((i.y*255)&0xff)<<16 | ((i.z*255)&0xff)<<8 | ((i.w*255)&0xff)
			}
			else if(t == 'array') a[o] = ((i[0]*255)&0xff)<<24 | ((i[1]*255)&0xff)<<16 | ((i[2]*255)&0xff)<<8 | ((i[3]*255)&0xff)
			else {
				var i = parseColor(i)
				a[o] = ((i.r*255)&0xff)<<24 | ((i.g*255)&0xff)<<16 | ((i.b*255)&0xff)<<8 | ((i.a*255)&0xff)
			}
			if(m <= 1) return

			var x = a[o], o2 = o + s
			while(m > 1) a[o2] = x, m--, o2 += s;
		}

		// stringify stored color)
		function _co(a, o, m, s) {
			var v = '|'+ a[o] 
			if(m <= 1) return v
			var x = a[o], o2 = o + s
			while(m > 1) v += '|' + a[o2], m--, o2 += s
			return v
		}   		
	}
	gt()

	gl.flip_y = detect_y()

	// |  parse string colors
	// \____________________________________________/
	function parseColor(s) {
		var c
		if(!s.indexOf("vec4")) {
			c = s.slice(5,-1).split(",")
			return {r:parseFloat(c[0]), g:parseFloat(c[1]), b:parseFloat(c[2]),a:parseFloat(c[3])}
		} 
		if(!s.indexOf("rgba")) {
			c = s.slice(5,-1).split(",")
			return {r:parseFloat(c[0])/255, g:parseFloat(c[1])/255, b:parseFloat(c[2])/255,a:parseFloat(c[3])}
		} 
		if(!s.indexOf("rgb")) {
			c = s.slice(4,-1).split(",")
			return {r:parseFloat(c[0])/255, g:parseFloat(c[1])/255, b:parseFloat(c[2])/255,a:1.0}
		} 
		if(c = gt.col[s])
			return c	
	}  

	function packColor(c){
		return (c.a*255<<24)&0xff000000 | ((c.b*255<<16)&0xff0000) | (c.g*255<<8)&0xff00 | (c.r*255)&0xff 
	}

	gl.parseColor = parseColor
	gl.packColor = packColor
	// ABGR
	gl.uniform1ic = function(i, u){	gl.uniform4f(i,(u&0xff)/255,((u>>8)&0xff)/255,((u>>16)&0xff)/255,((u>>24)&0xff)/255) }
	
	//|  a fullscreen shader with buffer
	//\____________________________________________/
	gl.getScreenShader = function(sd){
		var d = {
			m:gl.TRIANGLES,
			l:6,
			a:{c:'vec2'},
			v:'vec4(c.x * 2. -1, 1. - c.y * 2., 0, 1.)'
		}
		for(var k in sd) d[k]  = sd[k]	

		var sh = gl.getShader(d)

		var b = sh.$b = sh.alloc(1)// write 2 triangles
		var a = b.c.a
		a[0] = a[1] = a[3] = a[7] = a[10] = a[4] = 0
		a[2] = a[5] = a[6] = a[8] = a[9] = a[11] = 1
		b.hi = 1
		return sh 
	}

	//|  debug wrap whole GL api  
	//\____________________________________________/
	function debug(stack){
		if('__createTexture' in gl) return
		
		var glrev = {}
		for(var k in gl){
			if(k == 'debug' || k == 'undebug' || k == 'eval' || k == 'regvar' || 
				k == 'parseColor') continue;
			if(typeof gl[k] == 'function'){
				gl['__'+k] = gl[k];
				function gldump(k){
					var v = '__' + k
					gl[k] = function(){
						var s = [], t;
						for(var i = 0; i<arguments.length; i++){
							var a = arguments[i]
							if(a && (t = glrev[a])) s.push(a+" = gl."+t+"")
							else s.push(a)
						}
						if(stack) fn.log(new Error().stack)
						var rv = gl[v].apply(gl, arguments)
						console.log("gl." + k + "(" + s.join(", ") + ")" + ((rv !== undefined)?(" -> " + rv):""))
						return rv
					}
				}
				gldump(k)
			} else {
				glrev[gl[k]] = k;
			}
		}
	}
	gl.debug = debug

	function undebug(){
		if(!('__createTexture' in gl)) return
		for(var k in gl){
			if(k.indexOf('__') == 0){
				var k2 = k.slice(2)
				gl[k2] = gl[k]
				delete gl[k]
			}	
		}
	}
	gl.undebug = undebug
})

// | GLSL Extension lib |_______________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/  

define('/core/ext_lib',function(require, exports){
	"no tracegl"
	var fn = require("./fn")

	var e = exports

	e.i0 = function(){ clamp(step(0, -n.a0) + (u - n.t0)/n.a0, 0, 1) } 
	e.i1 = function(){ clamp(step(0, -n.a1) + (u - n.t1)/n.a1, 0, 1) }
	e.i2 = function(){ clamp(step(0, -n.a2) + (u - n.t2)/n.a2, 0, 1) }
	e.i3 = function(){ clamp(step(0, -n.a3) + (u - n.t3)/n.a3, 0, 1) }
	e.i4 = function(){ clamp(step(0, -n.a4) + (u - n.t4)/n.a4, 0, 1) }
	e.i5 = function(){ clamp(step(0, -n.a5) + (u - n.t5)/n.a5, 0, 1) }
	e.i6 = function(){ clamp(step(0, -n.a6) + (u - n.t6)/n.a6, 0, 1) }
	e.i7 = function(){ clamp(step(0, -n.a7) + (u - n.t7)/n.a7, 0, 1) }
	e.i8 = function(){ clamp(step(0, -n.a8) + (u - n.t8)/n.a8, 0, 1) }
	e.i9 = function(){ clamp(step(0, -n.a9) + (u - n.t9)/n.a9, 0, 1) }

	e.tsin  = function(x) { (0.5 * sin(x) + 0.5) }
	e.tcos  = function(x) { (0.5 * cos(x) + 0.5) }
	e.len   = function(x) { length(x) }
	e.rad   = function(xp, yp){
		sqrt(pow(c.x, 2 + xp) + pow(c.y, 2 + yp))
	}

	e.theme = function(i){
		texture2D(T,vec2(i,0))
	}

	function img(c){
		texture2D(1, w.x, w.y)
	}

	e.dbg = function(c){
		vec4(w.x, w.y, 1-w.y, 1)
	}

	e._tf_ = 1
	e.linx = function(){
		(c.x)
	}

	e.liny = function(){
		(c.y)
	}

	e.ts = function(a){
		(0.5*sin(a*t)+0.5)
	}

	e.tc = function(a){
		(0.5*cos(a*t)+0.5)
	}

	e.rotate = e.rot = function(r, _fw_){
		_fw_(vec2((c.x-.5) * cos(r) - (c.y-.5) * sin(r), (c.x-.5) * sin(r) + (c.y-.5) * cos(r))+.5)
	}

	e.scale = function(x, y, _fw_){
		_fw_(((c-.5)*vec2(x,y))+.5)
	}

	e.move = function(x, y, _fw_){
		_fw_(c-vec2(x,y))
	}

	e.spiral = function(r, _fw_){
		_fw_(vec2((c.x-.5) * cos(r*len(c-.5)) - (c.y-.5) * sin(r*len(c-.5)), (c.x-.5) * sin(r*len(c-.5)) + (c.y-.5) * cos(r*len(c-.5)))+.5)
	}

	e.pixel = function(x, y, _fw_){
		_fw_(vec2(floor((c.x-.5)*x)/x,floor((c.y-.5)*y)/y)+.5) 
	}

	e.normal_ = function(float_ln, float_n1, float_n2, float_n3){
		return_vec3( 
			cross(
				normalize(vec3(0,ln,n2-n1)),
				normalize(vec3(ln,0,n3-n1))
			)

			
		);
	}

	e.mask = function(float_a, vec4_c){
		return_vec4(c.x,c.y,c.z,a)
	}

	e.pow2 = function(float_xp, float_yp,  vec2_c){
		return_vec2(pow(c.x,pow(xp,1.2)), pow(c.y,pow(yp,1.2)))
	}

	e.hermite = function(float_t, float_p0, float_p1, float_m0, float_m1){
	   float_t2 = t*t;
	   float_t3 = t2*t;
	   return_float((2*t3 - 3*t2 + 1)*p0 + (t3-2*t2+t)*m0 + (-2*t3+3*t2)*p1 + (t3-t2)*m1);
	}
	
	e.normal = function(ds, ln, float_fw_vec2_c){
		normal_(ln,
				  float_fw_vec2_c(vec2(c.x, c.y)),
				  float_fw_vec2_c(vec2(c.x+ds, c.y)),
				  float_fw_vec2_c(vec2(c.x, c.y+ds)))
	}

	e.img = function(a){
		texture2D(a, vec2(c.x, c.y))
	}	
	
	e.font = function(){
		texture2D(n.b,vec2(e.z, e.w))
	}

	e.fontgrow = function(){
		return_vec4(
			(
				texture2D(n.b,vec2(e.z - 'n.b'.x, e.w - 'n.b'.y)) +
				texture2D(n.b,vec2(e.z, e.w - 'n.b'.y)) +
				texture2D(n.b,vec2(e.z + 'n.b'.x, e.w - 'n.b'.y)) +
				texture2D(n.b,vec2(e.z - 'n.b'.x, e.w)) +
				texture2D(n.b,vec2(e.z, e.w)) +
				texture2D(n.b,vec2(e.z + 'n.b'.x, e.w)) +
				texture2D(n.b,vec2(e.z - 'n.b'.x, e.w + 'n.b'.y)) +
				texture2D(n.b,vec2(e.z, e.w + 'n.b'.y)) +
				texture2D(n.b,vec2(e.z+ 'n.b'.x, e.w + 'n.b'.y))
			))
	}

	e.fontshift = function(){
		texture2D(n.b,vec2(e.z- 'n.b'.x, e.w - 'n.b'.y))
	}

	e.blend = function(vec4_a, vec4_b){
		return_vec4( a.xyz * (1-b.w) + (b.w)*b.xyz, max(a.w,b.w) )
	}
	
	e.subpix = function(vec4_c, vec4_fg, vec4_bg){
		float_a(3.2*(t.subpx).w)
		return_vec4(vec4(pow(c.r * pow(fg.r, a) + (1-c.r) * pow(bg.r, a), 1/a),
					 pow(c.g * pow(fg.g, a) + (1-c.g) * pow(bg.g, a), 1/a),
					 pow(c.b * pow(fg.b, a) + (1-c.b) * pow(bg.b, a), 1/a), 
					 c.a*fg.a)*1.0)
	}

	e.sfont = function(vec4_fg, vec4_bg){
		vec4_c( texture2D(n.b, vec2(e.z, e.w)) )
		float_a(3.2*(t.subpx).w)
		return_vec4(vec4(pow(c.r * pow(fg.r, a) + (1-c.r) * pow(bg.r, a), 1/a),
					 pow(c.g * pow(fg.g, a) + (1-c.g) * pow(bg.g, a), 1/a),
					 pow(c.b * pow(fg.b, a) + (1-c.b) * pow(bg.b, a), 1/a), 
					 c.a*fg.a))
	}

	e.sfont2 = function(vec4_fg, vec4_bg, float_a){
		vec4_c( texture2D(n.b, vec2(e.z, e.w)) )
		return_vec4(vec4(pow(c.r * pow(fg.r, a) + (1-c.r) * pow(bg.r, a), 1/a),
					 pow(c.g * pow(fg.g, a) + (1-c.g) * pow(bg.g, a), 1/a),
					 pow(c.b * pow(fg.b, a) + (1-c.b) * pow(bg.b, a), 1/a), 
					 c.a*fg.a))
	}

	e.alpha = function(vec4_i, float_a){
		return_vec4(i.x,i.y,i.z,a)
	}

	// we return a function based on the number of arguments
	e.mix = function(){
		var a = arguments
		var l = a.length

		var s = 'vec4 #('
		for(var i = 0;i < l - 1; i++){
			s+= (i?',vec4 a':'vec4 a')+i
		}
		s += ',float f){\n return '
		for(var i = 0; i < l - 2; i++){
			s += 'mix(a' + i + ','
			if(i == l - 3) {
				s += 'a'+(i+1)
				while(i >= 0) {
					s += ',clamp(f' + (l>3 ? '*'+(l - 2)+'.-'+(i)+'.' : '')+ ',0.,1.))'
					i--
				}
				break
			}
		}
		s += ';\n}\n'
		return s
	}

	// Seriously awesome GLSL noise functions. (C) Credits and kudos go to
	// Stefan Gustavson, Ian McEwan Ashima Arts
	// Google keywords: GLSL simplex noise
	// MIT License. 
	
	e.permute1 = function(float_x) {
		return_float( mod((34.0 * x + 1.0) * x, 289.0) );
	}
	
	e.permute3 = function(vec3_x) {
		return_vec3( mod((34.0 * x + 1.0) * x, 289.0) );
	}

	e.permute4 = function(vec4_x) {
		return_vec4( mod((34.0 * x + 1.0) * x, 289.0) );
	}
	
	e.isqrtT1 = function(float_r){
	  return_float(1.79284291400159 - 0.85373472095314 * r);
	}

	e.isqrtT4 = function(vec4_r){
	  return_vec4(1.79284291400159 - 0.85373472095314 * r);
	}

	e.snoise2 = function(vec2_v){
		vec4_C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439); 
		vec2_i  = floor(v + dot(v, C.yy) );
		vec2_x0 = v -   i + dot(i, C.xx);

		vec2_i1;
		i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
		vec4_x12 = x0.xyxy + C.xxzz;
		x12.xy -= i1;

		i = mod(i, 289.0); // Avoid truncation effects in permutation
		vec3_p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0 ));

		vec3_m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
		m = m*m;
		m = m*m;

		vec3_x = 2.0 * fract(p * C.www) - 1.0;
		vec3_h = abs(x) - 0.5;
		vec3_ox = floor(x + 0.5);
		vec3_a0 = x - ox;
		m *= (1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h ));
		vec3_g;
		g.x  = a0.x  * x0.x  + h.x  * x0.y;
		g.yz = a0.yz * x12.xz + h.yz * x12.yw;
		return_float(130.0 * dot(m, g));
	}

	e.snoise3 = function(vec3_v){ 
		vec2_C = vec2(1.0/6.0, 1.0/3.0);
		vec4_D = vec4(0.0, 0.5, 1.0, 2.0);

		// First corner
		vec3_i = floor(v + dot(v, C.yyy));
		vec3_x0 = v - i + dot(i, C.xxx);
		vec3_g = step(x0.yzx, x0.xyz);
		vec3_l = 1.0 - g;
		vec3_i1 = min(g.xyz, l.zxy);
		vec3_i2 = max(g.xyz, l.zxy);
		vec3_x1 = x0 - i1 + 1.0 * C.xxx;
		vec3_x2 = x0 - i2 + 2.0 * C.xxx;
		vec3_x3 = x0 - 1. + 3.0 * C.xxx;

		// Permutations
		i = mod(i, 289.0);
		vec4_p = permute4(permute4(permute4( 
			i.z + vec4(0.0, i1.z, i2.z, 1.0))
			+ i.y + vec4(0.0, i1.y, i2.y, 1.0)) 
			+ i.x + vec4(0.0, i1.x, i2.x, 1.0));

		// ( N*N points uniformly over a square, mapped onto an octahedron.)
		float_n_ = 1.0/7.0;
		vec3_ns = n_ * D.wyz - D.xzx;
		vec4_j = p - 49.0 * floor(p * ns.z *ns.z);
		vec4_x_ = floor(j * ns.z);
		vec4_y_ = floor(j - 7.0 * x_);
		vec4_x = x_ * ns.x + ns.yyyy;
		vec4_y = y_ * ns.x + ns.yyyy;
		vec4_h = 1.0 - abs(x) - abs(y);
		vec4_b0 = vec4( x.xy, y.xy );
		vec4_b1 = vec4( x.zw, y.zw );
		vec4_s0 = floor(b0)*2.0 + 1.0;
		vec4_s1 = floor(b1)*2.0 + 1.0;
		vec4_sh = -step(h, vec4(0.0));
		vec4_a0 = b0.xzyw + s0.xzyw*sh.xxyy;
		vec4_a1 = b1.xzyw + s1.xzyw*sh.zzww;
		vec3_p0 = vec3(a0.xy,h.x);
		vec3_p1 = vec3(a0.zw,h.y);
		vec3_p2 = vec3(a1.xy,h.z);
		vec3_p3 = vec3(a1.zw,h.w);

		//Normalise gradients
		vec4_norm = isqrtT4(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
		p0 *= norm.x;
		p1 *= norm.y;
		p2 *= norm.z;
		p3 *= norm.w;

		// Mix final noise value
		vec4_m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
		m = m * m;
		return_float(42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
			dot(p2,x2), dot(p3,x3) ) ));
	}

	e.snoise4_g = function(float_j, vec4_ip)
	{
		vec4_p;
		p.xyz = floor( fract (vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
		p.w = 1.5 - dot(abs(p.xyz), vec3(1.0,1.0,1.0));
		vec4_s = vec4(lessThan(p, vec4(0.0)));
		p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www; 
		return_vec4(p);
	}

	e.snoise4 = function(vec4_v)
	{
		vec4_C = vec4(0.138196601125011,0.276393202250021,0.414589803375032,-0.447213595499958);
		// First corner
		vec4_i  = floor(v + dot(v, vec4(0.309016994374947451)) );
		vec4_x0 = v - i + dot(i, C.xxxx);
		vec4_i0;
		vec3_isX = step( x0.yzw, x0.xxx );
		vec3_isYZ = step( x0.zww, x0.yyz );
		i0.x = isX.x + isX.y + isX.z;
		i0.yzw = 1.0 - isX;
		i0.y += isYZ.x + isYZ.y;
		i0.zw += 1.0 - isYZ.xy;
		i0.z += isYZ.z;
		i0.w += 1.0 - isYZ.z;
		vec4_i3 = clamp( i0, 0.0, 1.0 );
		vec4_i2 = clamp( i0-1.0, 0.0, 1.0 );
		vec4_i1 = clamp( i0-2.0, 0.0, 1.0 );
		vec4_x1 = x0 - i1 + C.xxxx;
		vec4_x2 = x0 - i2 + C.yyyy;
		vec4_x3 = x0 - i3 + C.zzzz;
		vec4_x4 = x0 + C.wwww;
		// Permutations
		i = mod(i, 289.0 );
		float_j0 = permute1( permute1( permute1( permute1(i.w) + i.z) + i.y) + i.x);
		vec4_j1 = permute4( permute4( permute4( permute4(
			i.w + vec4(i1.w, i2.w, i3.w, 1.0 ))
			+ i.z + vec4(i1.z, i2.z, i3.z, 1.0 ))
			+ i.y + vec4(i1.y, i2.y, i3.y, 1.0 ))
			+ i.x + vec4(i1.x, i2.x, i3.x, 1.0 ));
		// Gradients: 7x7x6 points over a cube, mapped onto a 4-cross polytope
		// 7*7*6 = 294, which is close to the ring size 17*17 = 289.
		vec4_ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0) ;
		vec4_p0 = snoise4_g(j0,   ip);
		vec4_p1 = snoise4_g(j1.x, ip);
		vec4_p2 = snoise4_g(j1.y, ip);
		vec4_p3 = snoise4_g(j1.z, ip);
		vec4_p4 = snoise4_g(j1.w, ip);
		// Normalise gradients
		vec4_nr = isqrtT4(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
		p0 *= nr.x;
		p1 *= nr.y;
		p2 *= nr.z;
		p3 *= nr.w;
		p4 *= isqrtT1(dot(p4,p4));
		// Mix contributions from the five corners
		vec3_m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
		vec2_m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)), 0.0);
		m0 = m0 * m0;
		m1 = m1 * m1;
		return_float(49.0 * (dot(m0*m0, vec3(dot( p0, x0 ), dot(p1, x1), dot(p2, x2)))
		+ dot(m1*m1, vec2( dot(p3, x3), dot(p4, x4)))));
	}

	e.cell = function(vec2_v){
		return_float(cell3(vec3(v.x, v.y,0)))
	}

	e.cell2 = function(vec3_P){
		float_K = 0.142857142857;// 1/7
		float_Ko = 0.428571428571;// 1/2-K/2
		float_K2 = 0.020408163265306;// 1/(7*7)
		float_Kz = 0.166666666667;// 1/6
		float_Kzo = 0.416666666667;// 1/2-1/6*2
		float_ji = 0.8;// smaller jitter gives less errors in F2
		vec3_Pi = mod(floor(P), 289.0);
		vec3_Pf = fract(P);
		vec4_Pfx = Pf.x + vec4(0.0, -1.0, 0.0, -1.0);
		vec4_Pfy = Pf.y + vec4(0.0, 0.0, -1.0, -1.0);
		vec4_p = permute4(Pi.x + vec4(0.0, 1.0, 0.0, 1.0));
		p = permute4(p + Pi.y + vec4(0.0, 0.0, 1.0, 1.0));
		vec4_p1 = permute4(p + Pi.z); // z+0
		vec4_p2 = permute4(p + Pi.z + vec4(1.0)); // z+1
		vec4_ox1 = fract(p1*K) - Ko;
		vec4_oy1 = mod(floor(p1*K), 7.0)*K - Ko;
		vec4_oz1 = floor(p1*K2)*Kz - Kzo; // p1 < 289 guaranteed
		vec4_ox2 = fract(p2*K) - Ko;
		vec4_oy2 = mod(floor(p2*K), 7.0)*K - Ko;
		vec4_oz2 = floor(p2*K2)*Kz - Kzo;
		vec4_dx1 = Pfx + ji*ox1;
		vec4_dy1 = Pfy + ji*oy1;
		vec4_dz1 = Pf.z + ji*oz1;
		vec4_dx2 = Pfx + ji*ox2;
		vec4_dy2 = Pfy + ji*oy2;
		vec4_dz2 = Pf.z - 1.0 + ji*oz2;
		vec4_d1 = dx1 * dx1 + dy1 * dy1 + dz1 * dz1; // z+0
		vec4_d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2; // z+1

		vec4_d= min(d1,d2); // F1 is now in d
		d2 = max(d1,d2); // Make sure we keep all candidates for F2
		d.xy = (d.x < d.y) ? d.xy : d.yx; // Swap smallest to d.x
		d.xz = (d.x < d.z) ? d.xz : d.zx;
		d.xw = (d.x < d.w) ? d.xw : d.wx; // F1 is now in d.x
		d.yzw = min(d.yzw, d2.yzw); // F2 now not in d2.yzw
		d.y = min(d.y, d.z); // nor in d.z
		d.y = min(d.y, d.w); // nor in d.w
		d.y = min(d.y, d2.x); // F2 is now in d.y
		return_vec2(sqrt(d.xy)); // F1 and F2
	}

	e.cell3 = function(vec3_P){
		float_K = 0.142857142857;
		float_Ko = 0.428571428571; // 1/2-K/2
		float_K2 = 0.020408163265306;// 1/(7*7)
		float_Kz = 0.166666666667;// 1/6
		float_Kzo = 0.416666666667;// 1/2-1/6*2
		float_ji = 1.0;// smaller jitter gives more regular pattern

		vec3_Pi = mod(floor(P), 289.0);
		vec3_Pf = fract(P) - 0.5;

		vec3_Pfx = Pf.x + vec3(1.0, 0.0, -1.0);
		vec3_Pfy = Pf.y + vec3(1.0, 0.0, -1.0);
		vec3_Pfz = Pf.z + vec3(1.0, 0.0, -1.0);

		vec3_p = permute3(Pi.x + vec3(-1.0, 0.0, 1.0));
		vec3_p1 = permute3(p + Pi.y - 1.0);
		vec3_p2 = permute3(p + Pi.y);
		vec3_p3 = permute3(p + Pi.y + 1.0);
		vec3_p11 = permute3(p1 + Pi.z - 1.0);
		vec3_p12 = permute3(p1 + Pi.z);
		vec3_p13 = permute3(p1 + Pi.z + 1.0);
		vec3_p21 = permute3(p2 + Pi.z - 1.0);
		vec3_p22 = permute3(p2 + Pi.z);
		vec3_p23 = permute3(p2 + Pi.z + 1.0);
		vec3_p31 = permute3(p3 + Pi.z - 1.0);
		vec3_p32 = permute3(p3 + Pi.z);
		vec3_p33 = permute3(p3 + Pi.z + 1.0);

		vec3_ox11 = fract(p11*K) - Ko;
		vec3_oy11 = mod(floor(p11*K), 7.0)*K - Ko;
		vec3_oz11 = floor(p11*K2)*Kz - Kzo; // p11 < 289 guaranteed
		vec3_ox12 = fract(p12*K) - Ko;
		vec3_oy12 = mod(floor(p12*K), 7.0)*K - Ko;
		vec3_oz12 = floor(p12*K2)*Kz - Kzo;
		vec3_ox13 = fract(p13*K) - Ko;
		vec3_oy13 = mod(floor(p13*K), 7.0)*K - Ko;
		vec3_oz13 = floor(p13*K2)*Kz - Kzo;
		vec3_ox21 = fract(p21*K) - Ko;
		vec3_oy21 = mod(floor(p21*K), 7.0)*K - Ko;
		vec3_oz21 = floor(p21*K2)*Kz - Kzo;
		vec3_ox22 = fract(p22*K) - Ko;
		vec3_oy22 = mod(floor(p22*K), 7.0)*K - Ko;
		vec3_oz22 = floor(p22*K2)*Kz - Kzo;
		vec3_ox23 = fract(p23*K) - Ko;
		vec3_oy23 = mod(floor(p23*K), 7.0)*K - Ko;
		vec3_oz23 = floor(p23*K2)*Kz - Kzo;
		vec3_ox31 = fract(p31*K) - Ko;
		vec3_oy31 = mod(floor(p31*K), 7.0)*K - Ko;
		vec3_oz31 = floor(p31*K2)*Kz - Kzo;
		vec3_ox32 = fract(p32*K) - Ko;
		vec3_oy32 = mod(floor(p32*K), 7.0)*K - Ko;
		vec3_oz32 = floor(p32*K2)*Kz - Kzo;
		vec3_ox33 = fract(p33*K) - Ko;
		vec3_oy33 = mod(floor(p33*K), 7.0)*K - Ko;
		vec3_oz33 = floor(p33*K2)*Kz - Kzo;

		vec3_dx11 = Pfx + ji*ox11;
		vec3_dy11 = Pfy.x + ji*oy11;
		vec3_dz11 = Pfz.x + ji*oz11;
		vec3_dx12 = Pfx + ji*ox12;
		vec3_dy12 = Pfy.x + ji*oy12;
		vec3_dz12 = Pfz.y + ji*oz12;
		vec3_dx13 = Pfx + ji*ox13;
		vec3_dy13 = Pfy.x + ji*oy13;
		vec3_dz13 = Pfz.z + ji*oz13;
		vec3_dx21 = Pfx + ji*ox21;
		vec3_dy21 = Pfy.y + ji*oy21;
		vec3_dz21 = Pfz.x + ji*oz21;
		vec3_dx22 = Pfx + ji*ox22;
		vec3_dy22 = Pfy.y + ji*oy22;
		vec3_dz22 = Pfz.y + ji*oz22;
		vec3_dx23 = Pfx + ji*ox23;
		vec3_dy23 = Pfy.y + ji*oy23;
		vec3_dz23 = Pfz.z + ji*oz23;
		vec3_dx31 = Pfx + ji*ox31;
		vec3_dy31 = Pfy.z + ji*oy31;
		vec3_dz31 = Pfz.x + ji*oz31;
		vec3_dx32 = Pfx + ji*ox32;
		vec3_dy32 = Pfy.z + ji*oy32;
		vec3_dz32 = Pfz.y + ji*oz32;
		vec3_dx33 = Pfx + ji*ox33;
		vec3_dy33 = Pfy.z + ji*oy33;
		vec3_dz33 = Pfz.z + ji*oz33;

		vec3_d11 = dx11 * dx11 + dy11 * dy11 + dz11 * dz11;
		vec3_d12 = dx12 * dx12 + dy12 * dy12 + dz12 * dz12;
		vec3_d13 = dx13 * dx13 + dy13 * dy13 + dz13 * dz13;
		vec3_d21 = dx21 * dx21 + dy21 * dy21 + dz21 * dz21;
		vec3_d22 = dx22 * dx22 + dy22 * dy22 + dz22 * dz22;
		vec3_d23 = dx23 * dx23 + dy23 * dy23 + dz23 * dz23;
		vec3_d31 = dx31 * dx31 + dy31 * dy31 + dz31 * dz31;
		vec3_d32 = dx32 * dx32 + dy32 * dy32 + dz32 * dz32;
		vec3_d33 = dx33 * dx33 + dy33 * dy33 + dz33 * dz33;

		vec3_d1a = min(d11, d12);
		d12 = max(d11, d12);
		d11 = min(d1a, d13); // Smallest now not in d12 or d13
		d13 = max(d1a, d13);
		d12 = min(d12, d13); // 2nd smallest now not in d13
		vec3_d2a = min(d21, d22);
		d22 = max(d21, d22);
		d21 = min(d2a, d23); // Smallest now not in d22 or d23
		d23 = max(d2a, d23);
		d22 = min(d22, d23); // 2nd smallest now not in d23
		vec3_d3a = min(d31, d32);
		d32 = max(d31, d32);
		d31 = min(d3a, d33); // Smallest now not in d32 or d33
		d33 = max(d3a, d33);
		d32 = min(d32, d33); // 2nd smallest now not in d33
		vec3_da = min(d11, d21);
		d21 = max(d11, d21);
		d11 = min(da, d31); // Smallest now in d11
		d31 = max(da, d31); // 2nd smallest now not in d31
		d11.xy = (d11.x < d11.y) ? d11.xy : d11.yx;
		d11.xz = (d11.x < d11.z) ? d11.xz : d11.zx; // d11.x now smallest
		d12 = min(d12, d21); // 2nd smallest now not in d21
		d12 = min(d12, d22); // nor in d22
		d12 = min(d12, d31); // nor in d31
		d12 = min(d12, d32); // nor in d32
		d11.yz = min(d11.yz,d12.xy); // nor in d12.yz
		d11.y = min(d11.y,d12.z); // Only two more to go
		d11.y = min(d11.y,d11.z); // Done! (Phew!)
		return_vec2(sqrt(d11.xy)); // F1, F2
	}

	return e
})

// | UI Drawing |____________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/  

define('/core/ui_draw',function(require, exports, module){

	var fn = require("./fn")

	module.exports = function(ui){

		// |  group
		// \____________________________________________/
		function group(g){
			var n = new ui.Node()
			n._t = group
			n.$$ = function(){}
			n.l = 1
			if(g) n.set(g)
			return n
		}
		ui.group = group

		// |  rectangle
		// \____________________________________________/

		function rect(g){
			var n = new ui.Node()
			n._t = rect
			n.$$ = function(){
				var sh = ui.gl.getShader(rect.sd, n)
				// alloc buffers
				ui.alloc(n, sh)
				// set our default values on c
				rect.set(n._v.c, n._s, 0, 1)
				n._v.up = 1 // todo, partial updates properly				

				// update all the rest of the variables
				ui.update(n)
			}
			if(g) n.set(g)
			return n
		}

		rect.sd = ui.shader({
			a:{c:'vec2'},
			v:'vec4(((n._x+c.x*n._w+l.x)/s.x)*2.-1.,1.-((n._y+c.y*n._h+l.y)/s.y)*2.,0,1.)',
			f:'green',
			m:ui.gl.TRIANGLES,
			l:6
		})

		rect.set = function(v, i, z, d){ // vb, index, zero, digit
			var s = v.s // stride
			var o = i * s * v.l // offset
			var a = v.a
			a[o] = z, a[o+1] = z, o += s
			a[o] = d, a[o+1] = z, o += s
			a[o] = z, a[o+1] = d, o += s
			a[o] = d, a[o+1] = z, o += s
			a[o] = d, a[o+1] = d, o += s
			a[o] = z, a[o+1] = d, o += s
		}

		rect.clear = function(n){ // clear node
			rect.set(n._v.c, n._s, 0, 0)
			n._v.up = 1
		}


		rect.drawer = function(n){
			n.l = 1
			var sd = ui.gl.getShader(rect.sd, n)
			// allocate buffer of 1 rect
			var b = sd.alloc(1)
			rect.set(b.c, 0, 0, 1)
			b.hi = 1
			sd.rect = function(x, y, w, h){
				sd.use()
				sd.N_x(x)
				sd.N_y(y)
				sd.N_w(w)
				sd.N_h(h)
				sd.set(ui.uniforms)
				sd.draw(b)
			}
			return sd
		}
		ui.rect = rect

		// |  text
		// \____________________________________________/
		function text(g){

			var n = new ui.Node()
			n._t = text
			n.$$ = function(){
				var ol = n._n // text length

				var t = n.t // text

				var m = t && t.length || 0
				l = 0
				for(var i = 0; i < m; i++){
					var c = t.charCodeAt(i)
					if(c>32) l++ 
				}
				n._n = l
				// compile shaders
				n.w = 0
				n.h = 0

				var sh = ui.gl.getShader(text.sd, n)

				ui.alloc(n, sh)

				if(!n._v) return

				var v = n._v.e // element array
				var a = v.a
				var s = v.s // stride
				var o = n._s * s * v.l // offset

				var b = n.b // bitmap font
				if(!b) throw new Error("missing font on textnode")

				var floor = Math.floor
				var x = 0
				var y = 0
				var w = 0
				for(var i = 0;i < m;i++){
					var c = t.charCodeAt(i)
					if(c > 32){
						var d = c - b.s
						var wn = b.m[d] + 2*b.xp
						var x2 = x + (wn / ui.gl.ratio)
						var y2 = y + (b.g / ui.gl.ratio)
 
						var tx1 = ((d % b.b) * b.g - b.xp) / b.w
						var ty1 = (floor(d / b.b) * b.g) / b.h
						var tx2 = tx1 + (wn / (b.w))
						var ty2 = ty1 + (b.g / b.h)

						a[o] = x,  a[o+1] = y,  a[o+2] = tx1, a[o+3] = ty1, o += s
						a[o] = x2, a[o+1] = y,  a[o+2] = tx2, a[o+3] = ty1, o += s
						a[o] = x,  a[o+1] = y2, a[o+2] = tx1, a[o+3] = ty2, o += s
						a[o] = x2, a[o+1] = y,  a[o+2] = tx2, a[o+3] = ty1, o += s
						a[o] = x2, a[o+1] = y2, a[o+2] = tx2, a[o+3] = ty2, o += s
						a[o] = x,  a[o+1] = y2, a[o+2] = tx1, a[o+3] = ty2, o += s

						x += b.c[d] / ui.gl.ratio 

					} 
					else if(c == 10) y += b.g/ ui.gl.ratio , x = 0
					else if(c == 32) x += b.m[0]/ ui.gl.ratio 
					else if(c == 9) x += 3 * b.m[0]/ ui.gl.ratio 
					if(x > w) w = x
				}
				// store width and height
				n.w = ui.text.pos(n, m).x, n.h = y + b.p/ ui.gl.ratio 
				n._v.up = 1		 

				if(n._v.c) text.set(n._v.c, n._s, l, 0, 1)

				ui.update(n)				
			}

			if(g) n.set(g)

			return n
		}
		
		text.clear = function(n){
			text.set(n._v.e, n._s, n._i, 0, 0)
			n._v.up = 1
		}

		text.set = function(v, i, l, z, d){
			var a = v.a
			var s = v.s // stride
			var o = i * s * v.l // offset
			for(var j = 0;j < l; j++){
				a[o] = z, a[o + 1] = z, o += s
				a[o] = d, a[o + 1] = z, o += s
				a[o] = z, a[o + 1] = d, o += s
				a[o] = d, a[o + 1] = z, o += s
				a[o] = d, a[o + 1] = d, o += s
				a[o] = z, a[o + 1] = d, o += s
			}
		}

		text.sd = ui.shader({
			a: {c: 'vec2', e: 'vec4'},
			v:'vec4(((n._x+e.x+l.x)/s.x)*2.-1.,1.-((n._y+e.y+l.y)/s.y)*2.,0,1.)',
			f:'font',
			l:6,
			m:ui.gl.TRIANGLES
		})

		text.pos = function(n, l, cb){ // node, pos, callback
			if(!n.t) return {x:0,y:0}
			if(l == -1) l = n.t.length
			var b = n.b // bitmap font
			var x = 0
			var y = 0
			var w = 0 
			var t = n.t
			var ratio = ui.gl.ratio
			for(var i = 0;i < l; i++){
				if(cb && cb(i, x / ratio, y / ratio)) break
				var c = t.charCodeAt(i)
				if(c > 32){
					var d = c - b.s
					w = b.m[d] + 2*b.xp
					x += b.c[d] 
				} else if(c == 10) y += b.p, x = 0
				else if(c == 32) x += b.m[0]
				else if(c == 9) x += 3 * b.m[0]
			}
			return {x:x / ratio, y:y / ratio}
		}
		ui.text = text
		
		// |  edge
		// \____________________________________________/
		function edge(g){
			var n = new ui.Node()
			n._t = edge

			n.x_ = 'n.x + n.mx'
			n.y_ = 'n.y + n.my'
			n.w_ = 'n.w - 2*n.mx'
			n.h_ = 'n.h - 2*n.my'

			n.$$ = function(){

				var sh = ui.gl.getShader(edge.sd, n)

				ui.alloc(n, sh)

				if(!n._v)return
				// 0     1
				//   4 5
				//   7 6
				// 3     2
				var v = n._v.e
				var a = v.a // array
				var s = v.s // stride
				var o = n._s * v.l * s // offset
				a[o] = 0, a[o+1] = 0, a[o+2] = 0, a[o+3] = 0, o += s
				a[o] = 1, a[o+1] = 0, a[o+2] = 0, a[o+3] = 0, o += s
				a[o] = 1, a[o+1] = 1, a[o+2] = 0, a[o+3] = 0, o += s
				a[o] = 0, a[o+1] = 1, a[o+2] = 0, a[o+3] = 0, o += s

				a[o] = 0, a[o+1] = 0, a[o+2] = 1, a[o+3] = 1, o += s
				a[o] = 1, a[o+1] = 0, a[o+2] =-1, a[o+3] = 1, o += s
				a[o] = 1, a[o+1] = 1, a[o+2] =-1, a[o+3] =-1, o += s
				a[o] = 0, a[o+1] = 1, a[o+2] = 1, a[o+3] =-1, o += s

				// indices
				var v = n._v.i
				var a = v.a
				var o = n._s * v.i
				var i = n._s * v.l
				a[o++] = i + 0, a[o++] = i + 4, a[o++] = i + 1
				a[o++] = i + 1, a[o++] = i + 4, a[o++] = i + 5
				a[o++] = i + 5, a[o++] = i + 6, a[o++] = i + 1
				a[o++] = i + 1, a[o++] = i + 6, a[o++] = i + 2
				a[o++] = i + 7, a[o++] = i + 3, a[o++] = i + 6
				a[o++] = i + 6, a[o++] = i + 3, a[o++] = i + 2
				a[o++] = i + 0, a[o++] = i + 3, a[o++] = i + 4
				a[o++] = i + 4, a[o++] = i + 3, a[o++] = i + 7

				var v = n._v.c // view
				if(v){
					var a = v.a
					var s = v.s // stride
					var o = n._s * v.l * s // offset
					a[o] = 0, a[o+1] = 0, o += s
					a[o] = 1, a[o+1] = 0, o += s
					a[o] = 0, a[o+1] = 0, o += s
					a[o] = 1, a[o+1] = 0, o += s

					a[o] = 0, a[o+1] = 1, o += s
					a[o] = 1, a[o+1] = 1, o += s
					a[o] = 0, a[o+1] = 1, o += s
					a[o] = 1, a[o+1] = 1, o += s				
				}
				n._v.clean = false

				ui.update(n)				
			}

			if(g) n.set(g)

			return n
		}

		edge.sd = ui.shader({
			a: {c: 'vec2', e: 'vec4'},
			v: 'vec4(((n._x+e.x*n._w+e.z*n.mx+l.x)/s.x)*2.-1.,1.-((n._y+e.y*n._h+e.w*n.my+l.y)/s.y)*2.,0,1.)',
	 		f: 'vec4(0,1.,0,1.)',
			l:8,
			i:24,
			m:ui.gl.TRIANGLES
		})

		ui.edge = edge

	}
})
// | User Interface |___________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   
define('/core/ui',function(require){

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

// | Control behaviors |_________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/core/controls_mix',function(require, exports){

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
// | Controls |_________________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/  

define('/core/controls',function(require, exports){

	var ui = require("./ui")
	var fn = require("./fn")
	var cm = require("./controls_mix")

	var ct = exports

	ct.f1s = ui.gl.sfont("12px Arial")
	ct.f1p = ui.gl.pfont("12px Arial")

	// shared style functions
	var bump = 'mix(vec4(0,0,0,0), n.hc, (0.5 + 0.5 * dot(vec3(1,0,0),normal(0.001, 0.001, n.hm))))' 

	// |  bumpmapped button
	// \____________________________________________/
	ct.button = function(g){
		// parts
		var b = ui.rect()
		var t = ui.text()
		t._p = b

		// behaviorw
		cm.button(b)

		// style
		var bu = '0.3*pow(sin(c.x*P*0.999),(1+4*n.i1)/n.w)*pow(sin(c.y*P*0.98),2/n.h)'
		var bd = '0.3*((1-n.i0)+1.5*(n.i0)*len(c-0.5)*pow(tsin(len(c-0.5)*5-n.i0),1))*pow(sin(c.x*P*0.999),(1+40*n.i1)/n.w)*pow(sin(c.y*P*0.98),2/n.h)'
		b.f = bump
		t.f = 'sfont(t.deftbg, t.dlgtxt)'
		b.hm = bu
		//t.hc = 'mix(t.defbg2, t.defbg2, n.i1)'
		b.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'

		t.b = ct.f1s

		// states
		b.f_ = 
		b.s_ = 
		b.i = function(){ t.a1 = b.a1 = -0.01 }
		b.u_ = 
		b.d_ = 
		b.o = function(){	t.a1 = b.a1 = 0.1 }
		b.n_ = function(){ b.a0 = -0.1, b.e0 = { hm : bu } }
		b.c_ = function(){ b.a0 = 0.01, b.e0 = 0, b.hm = bd }

		// layout
		b.h = 24
		b.y_ = 'n._y + 5'
		t.x = 'floor(0.5*p.w - 0.5*n.w)'

		// properties
		b.alias('t', t)
		b.calc('w', function(){return ui.text.pos(t, -1).x + 20 })
		b.set(g)

		return b
	}
	
	// |  hiding vertical scrollbar
	// \____________________________________________/
	ct.vScrollHider = function(g){
		"no tracegl"
		// parts
		var b = ui.rect()
		var k = ui.rect()
		k._p = b
		b.e = k.e = ct.el 

		// behavior
		cm.scroll(b, k, 1)

		// style
		b.f = 'vec4(0,0,0,0)'
		
		b.shape = k.shape = function(vec2_v){
			return_float(len(vec2(pow(abs(v.x),n.w/15),pow(abs(v.y),n.h/5))))
		}

		b.f = 'mix(vec4(0,0,0,0),vec4(.4,.4,.4,0.1-n.i1),1-smoothstep(0.6,1.0,n.shape(2*(c-.5))) )'
		k.f = 'mix(vec4(0,0,0,0),vec4(.4,.4,.4,1-n.i1),1-smoothstep(0.8,1.0,n.shape(2*(c-.5))) )'

		var hider
		var inout 
		// states
		b.i = 
		k.i = function(){ b.a1 = k.a1 = -0.01; inout = 1; if(hider)clearTimeout(hider), hider = 0 }
		b.o = 
		k.o = function(){	
			if(hider) clearTimeout(hider)
			hider = setTimeout(function(){
				hider = 0
				b.a1 = k.a1 = 0.5
				ui.redraw(b)
			}, 1000)
			inout = 0
			//b.a1 = k.a1 = 0.1;inout = 0
		}
		k.n_ = function(){ k.a0 = -0.3 }
		k.c_ = function(){ k.a0 = 0.05, k.e0 = 0}



		// when scrolling we should show and fade out
		b.move = function(){
			if(inout) return
			if(hider) clearTimeout(hider)
			else b.a1 = k.a1 = -0.1 
			hider = setTimeout(function(){
				hider = 0
				b.a1 = k.a1 = 0.5
				ui.redraw(b)
			}, 1000)
		}

		// layout
		k.x = '0'
		k.dh = '(p.h_ - 2 - n.cs) * clamp(n.pg / n.ts, 0, 1)'
		k.y = 'floor(1 + (n.mv / n.ts) * (p.h - 2 - max(0,30 - n.dh)))'
		k.w = 'p.w_'
		k.h = 'max(n.dh, 30)'
		b.x = 'p.w_ - 10'
		b.w = '10'
		b._x = 'p._x + n.x' // disconnect scrollbar from padding
		b._y = 'p._y + n.y' // disconnect scrollbar from padding

		// properties
		b.set(g)

		return b
	}

	// |  horizontal scrollbar
	// \____________________________________________/
	ct.hScrollHider = function(g){
		"no tracegl"
		// parts
		var b = ui.rect()
		var k = ui.rect()
		k._p = b

		// behavior
		cm.scroll(b, k)

		// style
		// style
		b.f = 'vec4(0,0,0,0)'
		b.shape = k.shape = function(vec2_v){
			return_float(len(vec2(pow(abs(v.x),n.w/5),pow(abs(v.y),n.h/20))))
		}
		b.f = 'mix(vec4(0,0,0,0),vec4(.5,.5,.5,0.1-n.i1),1-smoothstep(0.8,1.0,n.shape(2*(c-.5))) )'
		k.f = 'mix(vec4(0,0,0,0),vec4(.5,.5,.5,1-n.i1),1-smoothstep(0.8,1.0,n.shape(2*(c-.5))) )'

		var hider
		var inout 
		// states
		b.i = 
		k.i = function(){ b.a1 = k.a1 = -0.01; inout = 1; if(hider)clearTimeout(hider), hider = 0 }
		b.o = 
		k.o = function(){	
			if(hider) clearTimeout(hider)
			hider = setTimeout(function(){
				hider = 0
				b.a1 = k.a1 = 0.5
				ui.redraw(b)
			}, 1000)
			inout = 0
			//b.a1 = k.a1 = 0.1;inout = 0
		}
		k.n_ = function(){ k.a0 = -0.3 }
		k.c_ = function(){ k.a0 = 0.05, k.e0 = 0}

		// when scrolling we should show and fade out
		b.move = function(){
			if(inout) return
			if(hider) clearTimeout(hider)
			else b.a1 = k.a1 = -0.1 
			hider = setTimeout(function(){
				hider = 0
				b.a1 = k.a1 = 0.5
				ui.redraw(b)
			}, 1000)
		}

		// layout
		k.y = '0'
		k.x = '1 + (n.mv / n.ts) * (p.w - 2)'
		k.h = 'p.h_'
		k.w = '(p.w_ - 2) * clamp(n.pg / n.ts, 0, 1)'
		b.y = 'p.h_ - 10'
		b.h = '10'
		b._x = 'p._x + n.x' // disconnect scrollbar from padding
		b._y = 'p._y + n.y' // disconnect scrollbar from padding
		// properties
		b.set(g)

		return b
	}
	// |  vertical scrollbar
	// \____________________________________________/
	ct.vScroll = function(g){
		// parts
		var b = ui.rect()
		var k = ui.rect()
		k._p = b
		b.e = k.e = ct.el 

		// behavior
		cm.scroll(b, k, 1)

		// style
		b.f = 'mix(t.defbg2,t.dlgbg,0.3+0.03*snoise2(vec2(c.x*n.w*0.5,c.y*n.h*0.5)))'
		k.f = bump
		var bu = 'pow(sin(c.x*P*0.999),1/n.w) * pow(sin(c.y*P*0.999),1/n.h)'
		var bd = 'pow(sin(c.x*P*0.999),1/n.w) * pow(sin(c.y*P*0.999),1/n.h) + sin((c.y-0.5)*P*(n.i0))'
		b.hm = bd
		k.hm = bu
		b.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'
		k.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'

		// states
		k.i = function(){ k.a1 = -0.1 }
		k.o = function(){	k.a1 = 0.5 }
		k.n_ = function(){ k.a0 = -0.3, k.e0 = {hm:bu} }
		k.c_ = function(){ k.a0 = 0.05, k.e0 = 0, k.set({hm:bd}) }

		// layout
		k.x = '1'
		k.dh = '(p.h_ - 2 - n.cs) * clamp(n.pg / n.ts, 0, 1)'
		k.y = 'floor(1 + (n.mv / n.ts) * (p.h - 2 - max(0,30 - n.dh)))'
		k.w = 'p.w_ - 2'
		k.h = 'max(n.dh, 30)'
		b.x = 'p.w_ - 10'
		b.w = '10'
		b._x = 'p._x + n.x' // disconnect scrollbar from padding
		b._y = 'p._y + n.y' // disconnect scrollbar from padding

		// properties
		b.set(g)

		return b
	}

	// |  horizontal scrollbar
	// \____________________________________________/
	ct.hScroll = function(g){
		// parts
		var b = ui.rect()
		var k = ui.rect()
		k._p = b

		// behavior
		cm.scroll(b, k)

		// style
		b.f = 'mix(t.defbg2,t.dlgbg,0.3+0.03*snoise2(vec2(c.x*n.w*0.5,c.y*n.h*0.5)))'
		k.f = bump
		var bu = 'pow(sin(c.x*P*0.999),3/n.w) * pow(sin(c.y*P*0.999),1/n.h)*0.15'
		var bd = 'pow(sin(c.x*P*0.999),3/n.w) * pow(sin(c.y*P*0.999),1/n.h)*0.15 + sin((c.y-0.5)*P*(n.i0))'
		b.hm = bd
		k.hm = bu
		b.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'
		k.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'

		// states
		k.i = function(){ k.a1 = -0.1 }
		k.o = function(){	k.a1 = 0.5 }
		k.n_ = function(){ k.a0 = -0.3, k.e0 = {hm:bu} }
		k.c_ = function(){ k.a0 = 0.05, k.e0 = 0, k.set({hm:bd}) }

		// layout
		k.y = '1'
		k.x = '1 + (n.mv / n.ts) * (p.w - 2)'
		k.h = 'p.h_ - 2'
		k.w = '(p.w_ - 2) * clamp(n.pg / n.ts, 0, 1)'
		b.y = 'p.h_ - 10'
		b.h = '10'
		b._x = 'p._x + n.x' // disconnect scrollbar from padding
		b._y = 'p._y + n.y' // disconnect scrollbar from padding
		// properties
		b.set(g)

		return b
	}

	// |  hv scrollbar filler
	// \____________________________________________/
	ct.hvFill = function(g){
		var b = ui.rect()

		b.f = 'mix(t.defbg2,t.dlgbg,0.3+0.03*snoise2(vec2(c.x*n.w*0.5,c.y*n.h*0.5)))'
		b._x = 'p._x + n.x' // disconnect scrollbar from padding
		b._y = 'p._y + n.y' // disconnect scrollbar from padding
		b.set(g)
		return b
	}

	// | hv scroll mixin
	// \____________________________________________/
	ct.hvScroll = function(b){
		//vertical scrollbar
		var v = b._v_ || (b._v_ = ct.vScroll())
		v._b = b // use front list
		v.l = 1
		v._z = Infinity
		// horiz scrollbar
		var h = b._h_ || (b._h_ = ct.hScroll())
		h._b = b // use front list
		h.l = 1
		h._z = Infinity

		var sw = 10  // scrollbar width
	
		// scroll corner
		var c = ct.hvFill({x:'p.w_ - '+sw, y:'p.h_ - '+sw, w:sw, h:sw})
		c._b = b
		c.l = 1

		function cv(){ // compute view
			var y = b.eval('h')
			var x = b.eval('w')
			v.pg = y
			v.ts = b.vSize + sw
			h.pg = x
			h.ts = b.hSize + sw
			var m = fn.clamp(v.mv, 0,fn.max(b.vSize - y, 0))
			if(v.mv != m) v.ds( m - v.mv)
			var m = fn.clamp(h.mv, 0,fn.max(b.hSize - x, 0))
			if(h.mv != m) h.ds( m - h.mv)
		}

		b.v_ = cv

		b.mark = 1
		b.s = function(){ 
			v.ds(ui.mv)
			h.ds(ui.mh)
		}
		v.c = function(){ b.vScroll = Math.round(-v.mv);ui.redraw(b)}
		v.h = 'p.h_ - ' + sw
		h.w = 'p.w_ - ' + sw
		h.c = function(){ b.hScroll = Math.round(-h.mv);ui.redraw(b) }
		b.hScroll = 0
		b.vScroll = 0
		b.hSize = 0
		b.vSize = 0
		b.x_ = 'n._x + n.hScroll' // scroll padded
		b.y_ = 'n._y + n.vScroll' // scroll padded

	}


	// |  vertical slider
	// \____________________________________________/
	ct.vSlider = function(g){
		// parts
		var b = ui.rect()
		var k = ui.rect()
		k._p = b

		// behavior
		cm.slider(b, k, true)

		// style
		k.f = bump
		b.f = 'mix( vec4(0,0,0,0),black, (pow(sin(c.x*P),n.w*4)) )'
		var bu = '0.75*pow(sin(c.x*P*0.999),(10 + 50*n.i1)/n.w) * pow(sin(c.y*P*0.999),10/n.h)'
		var bd = '0.75*((1-n.i0)+0.5*(n.i0)*len(c-0.5)*pow(tsin(len(c-0.5)*5-n.i0),1))*pow(sin(c.x*P*0.999),(10 + 50*n.i1)/n.w)*pow(sin(c.y*P*0.999),10/n.h)'
		k.hm = bu
		b.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'
		k.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'

		// states
		k.f_=
		k.i = function(){ k.a1 = -0.01 }
		k.u_= 
		k.o = function(){	k.a1 = 0.1 }
		k.n_ = function(){ k.a0 = -0.1, k.e0 = {hm:bu} }
		k.c_ = function(){ k.a0 = 0.01, k.e0 = 0, k.set({hm:bd}) }

		// layout
		k.x = '0'
		k.y = '(n.mv) * (p.h - n.h)'
		k.w = 'p.w'
		k.h = 'p.w*0.5'
		b.w = 20
		b._x = 'p.x_ + n.x + 5'
		b.mv = 0
		// properties
		b.set(g)

		return b
	}

	// |  horizontal slider
	// \____________________________________________/
	ct.hSlider = function(g){
		// parts
		var b = ui.rect()
		var k = ui.rect()
		k._p = b
		
		// behavior
		cm.slider(b, k, false)

		// style
		k.f = bump
		b.f = 'mix( vec4(0,0,0,0),black, (pow(sin(c.y*P),n.h*4)) )'
		var bu = '0.75*pow(sin(c.x*P*0.999),(10 + 10*n.i1)/n.w) * pow(sin(c.y*P*0.999),10/n.h)'
		var bd = '0.75*((1-n.i0)+0.5*(n.i0)*len(c-0.5)*pow(tsin(len(c-0.5)*5-n.i0),1))*pow(sin(c.x*P*0.999),(10 + 10*n.i1)/n.w)*pow(sin(c.y*P*0.999),10/n.h)'
		k.hm = bu
		b.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'
		k.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'

		// states
		k.f_=
		k.i = function(){ k.a1 = -0.01 }
		k.u_= 
		k.o = function(){	k.a1 = 0.1 }
		k.n_ = function(){ k.a0 = -0.1, k.e0 = {hm:bu} }
		k.c_ = function(){ k.a0 = 0.01, k.e0 = 0, k.set({hm:bd}) }

		// layout
		k.y = 0
		k.x = '(n.mv) * (p.w - n.w)'
		k.w = 'p.h*0.5'
		k.h = 'p.h'
		b.h = 20
		b._x = 'p.x_ + n.x + 5'
		b.mv = 0
		// properties
		b.set(g)

		return b
	}

	// |  item
	// \____________________________________________/
	ct.item = function(t){
		var g = fn.named(arguments)
		// parts
		var b = ui.rect()
		var t = ui.text()
		t._p = b

		// style
		var sb = 'mix(t.deftxt,t.selbg,n.i0)'  // selected base
		var nb = 't.defbg' // normal base 
		var st = 'sfont( mix(t.deftxt,t.selbg,n.i0), t.seltxt)' // selected text
		var nt = 'sfont(t.defbg, t.deftxt)' // normal text
		b.f = nb
		t.f = nt
		t.b = ct.f1s

		// states
		b.p = function(){}
		b.s_ = function(){ b.set({ f:sb }), t.set({ f:st }) }
		b.d_ = function(){ b.set({ f:nb }), t.set({ f:nt }) }
		b.f_ = function(){ b.a0 = t.a0 = 0.1 }
		b.u_ = function(){ b.a0 = t.a0 = -0.1 }

		// layout
		b.h = t.b.p + 6
		b.x_ = 'n._x + 3'
		b.y_ = 'n._y + 2'

		// properties
		b.alias('t', t)
		b.set(g)

		return b 
	}

	// |  label
	// \____________________________________________/
	ct.label = function(g){
		var t = ui.text()
		t.f = 'sfont(t.defbg, t.deftxt)' // text frag shader
		t.b = ct.f1s // text bitmap
		t.set(g)
		return t
	}

	// |  label centered
	// \____________________________________________/
	ct.labelc = function(g){
		var t = ui.text()
		t.f = 'sfont(t.defbg, t.deftxt)' // text frag shader
		t.b = ct.f1s // text bitmap
		t.x = 'ceil(0.5*p.w - 0.5*n.w)' // center			
		t.set(g)
		return t
	}

	// |  list
	// \____________________________________________/
	ct.list = function(g){
		// parts
		var b = ui.rect()
		var v = b._v_ = ct.vscroll()
		v._b = b // use front list
		b.l = v.l = 1 // both are layers
		
		// behavior
		cm.list(b)
		cm.select(b)

		// styling
		b.f = 't.defbg'

		// states / scrolling
		b.ys = 0
		v.mv = 0
		v.c = function(){
			b.ys = Math.round(-v.mv)
		}

		// layout
		b.y_ = 'n._y + n.ys' // scroll padded
		v._y = 'p._y + n.y' // disconnect scrollbar from padding

		b.set(g)

		return b
	}
	
	// |  edit
	// \____________________________________________/
	ct.edit = function(g){
		// parts
		var b = ui.rect() // base
		var t = ui.text() // text
		var c = ui.rect() // cursor
		var s = ui.rect() // selection
		var m = ui.text()	// marked text
		var e // empty text
		t._p = c._p = s._p = b
		m._p = s
		b.l = 1
		c.l = 1
		c._z = 10
		
		c.w = '1'
		c.h = '15'
		c.f = 'mix(vec4(1,1,1,1),vec4(1,1,1,0),n.i0)'
		s.f = 'mix(vec4(1,1,1,1),vec4(0.5,0.5,0.5,1),n.i0)'
		s.w = 0
		s.h = 15

		b.f = bump
		b.h = 24

		var bw = '1-0.5*pow(sin(c.x*P*0.9),1/n.w)*pow(sin(c.y*P*0.9),1/n.h)'
		b.hm = bw
		b.hc = 'mix(t.dlghi, t.dlgbg, n.i0)'

		var bl
		var foc
		b.f_ = function(){
			foc = 1
			m.a0 = -0.05
			s.a0 = -0.05
			c.a0 = -0.05
			b.a0 = -0.1
			if(e){
				e.hide()
			}
		}
		b.u_ = function(){
			// hide cursor 
			foc = 0
			m.a0 = 0.05
			s.a0 = 0.05
			c.a0 = 0.05
			b.a0 = 0.1
			if(e){
				if(b.t.length) e.hide()
				else e.show()
			}
		}
		b.xs = 0
		b.ys = 0
		b.y_ = 'n._y + 6 + n.ys'
		b.x_ = 'n._x + 5 + n.xs'

		m.b = ct.f1s
		t.b = ct.f1s
		t.f = 'sfont( t.defbg, t.deftxt)'
		m.f = 'sfont2( mix(vec4(1,1,1,1),vec4(0.5,0.5,0.5,1),n.i0), vec4(0,0,0,1), 1.0)'

		cm.edit(b, t, c, s, m)
		// add a cursor over the text
		b.alias('t', t, function(){
			if(e){
				if(b.t.length) e.hide()
				else if(!foc) e.show()
			}
		})
		b.set(g)

		// empty text
		if(b.empty){
			e = ui.text()
			e._p = b
			e.l = 1
			e.x = 2
			e.b = ct.f1s
			e.f = 'sfont( t.defbg, t.deftxt*0.75)'
			e.t = b.empty
		}

		return b
	}

	// |  combobox
	// \____________________________________________/
	ct.comboBox = function(g){
		var e = ct.edit()
	}

	// |  dropshadow
	// \____________________________________________/
	ct.dropShadow = function(g){
		// add dropshadow
		var e = ui.edge()
		e.set(g)
		var r = e.radius || 10
		e._x = 'p._x - (' + r + ')'
		e._y = 'p._y - (' + r + ')'
		e._w = 'p._w + (' + (2 * r) + ')'
		e._h = 'p._h + (' + (2 * r) + ')'
		e.l = 1
		e.mx = r
		e.my = r
		e.stepa = e.stepa || 0
		e.stepb = e.stepb || 1
		e.inner = e.inner || "vec4(0,0,0,0.5)"
		e.outer = e.outer || "vec4(0,0,0,0)"
		e.f = 'mix('+e.inner+','+e.outer+',smoothstep('+e.stepa+','+e.stepb+',len(vec2(pow(abs(2*((f.x-n._x)/n._w-.5)),n._w/30),pow(abs(2*((f.y-n._y)/n._h-.5)),n._h/30)))))'

		return e
	}

	// |  dropshadow
	// \____________________________________________/
	ct.innerShadow = function(g){
		// add dropshadow
		var e = ui.edge()
		e.set(g)
		var r = e.radius || 10
		e.l = 1
		e.mx = r
		e.my = r
		e.stepa = e.stepa || 0
		e.stepb = e.stepb || 1
		e.inner = e.inner || "vec4(0,0,0,0.5)"
		e.outer = e.outer || "vec4(0,0,0,0)"
		e.f = 'mix('+e.inner+','+e.outer+',smoothstep('+e.stepa+','+e.stepb+',len(vec2(pow(abs(2*((f.x-n._x)/n._w-.5)),n._w/30),pow(abs(2*((f.y-n._y)/n._h-.5)),n._h/30)))))'

		return e
	}

	// |  window
	// \____________________________________________/
	ct.window = function(g){
		// parts
		var b = ui.rect()
		var c = ui.rect()
		var t = ui.text()
		var d = ct.dropShadow()
		c._p = b
		d._p = b
		t._p = c

		b.l = 1

		b.minw = 200
		b.minh = 100

		// behavior
		cm.drag(b, c)
		cm.resize(b)

		// style
		b.f = bump
		c.f = bump
		var bw = 'pow(sin(c.x*P*0.999),2/n.w)*pow(sin(c.y*P*0.99),2/n.h)'
		var bc = 'pow(sin(c.x*P*0.999),2/n.w)*pow(sin(c.y*P*0.98),2/n.h)+(n.i0)*0.01*(sin((c.y-0.5)*n.h*n.i0*1))'
		var bu = 'pow(sin(c.x*P*0.999),2/n.w)*pow(sin(c.y*P*0.98),2/n.h)'
		c.hm = bu
		c.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'
		b.hm = bw
		b.hc = 'mix(t.dlghi, t.dlgbg, n.i1)'
		t.f = 'sfont(t.defbg, t.deftxt)'
		t.b = ct.f1s

		// interaction
		c.i = function(){ c.a1 = -0.1 }
		c.o = function(){	c.a1 = 0.3 }
		c.n_ = function(){ c.a0 = -0.3, c.e0 = {hm:bu} }
		c.c_ = function(){ c.a0 = 0.05, c.e0 = 0, c.set({hm:bc}), ui.top(b) }

		// layout
		c._x = 'p._x'
		c._y = 'p._y'
		c._w = 'p._w'
		c.h = 30
		c.x_ = 'n._x + 10'
		c.y_ = 'n._y + 6'

		b.y_ = 'n._y + 40'
		b.x_ = 'n._x + 10'
		b.w_ = 'n._w - 20'
		b.h_ = 'n._h - 50'

		b.alias('t',t)
		b.set(g)

		return b
	}

	// |  hsplit
	// \____________________________________________/

	ct.hSplit = function(g){
		// parts
		var b = ui.group()
		b.l = 1
		var d = ui.rect()
		d._b = b 
		d.l = 1
		d.w = 5
		b.minw = 50

		// styling
		d.f = 'mix(mix(t.dlghi,t.splitter1,n.i1),mix(t.splitter3,t.splitter2,n.i0),pow(sin(c.x*P),0.8))'

		//states
		d.f_
		d.i = function(){ d.a1 = -0.01;ui.cursor('ew-resize') }
		d.u_= 
		d.o = function(){	d.a1 = 0.1;ui.cursor('default')  }
		d.n_ = function(){ d.a0 = 0.1}
		d.c_ = function(){ d.a0 = -0.01 }

		// apply behavior
		cm.hSplit(b, d)
		b.set(g)

		return b
	}

	// |  vsplit
	// \____________________________________________/

	ct.vSplit = function(g){
		// parts
		var b = ui.group()
		b.l = 1
		var d = ui.rect()
		d._b = b 
		d.l = 1
		d.h = 5
		b.minh = 50

		// styling
		d.f = 'mix(mix(t.dlghi,t.splitter1,n.i1),mix(t.splitter3,t.splitter2,n.i0),pow(sin(c.y*P),0.8))'

		// states
		d.f_
		d.i = function(){ d.a1 = -0.01;ui.cursor('ns-resize') }
		d.u_= 
		d.o = function(){	d.a1 = 0.1;ui.cursor('default')  }
		d.n_ = function(){ d.a0 = 0.1}
		d.c_ = function(){ d.a0 = -0.01 }
		// apply behavior
		cm.vSplit(b, d)
		b.set(g)

		return b
	}
	// |  fold
	// \____________________________________________/
	ct.fold = function(g){
		// +- icon tree icon
		return ui.rect(function(n){
			n.y = 20
			n.w = 15
			n.h = 15
			n.f = ''
				+ 'mix(vec4(0,0,0,0),white,'
				+	'clamp(pow(pow((1-2*len(c-0.5)),1.0)*(pow(sin(c.x*P),88)*ts(2)+pow(sin(c.y*P),88))*0.5+0.8,4)-0.75,0,1)+' 
				+	'0.7*pow(sin(P*len(vec2(pow(2*(c.x-0.5),2),pow(2*(c.y-0.5),2))) -0.3-0.5*ts(2)),4)' 
				+ ')' 
		})
	}

	// |  c9
	// \____________________________________________/
	ct.ico_c9 = function(g){
		return ui.rect(function(n){
			n.y = 300
			n.w = 100
			n.h = 100
			n.f = ''
				+	'mix(vec4(0,0,0,0),white,'
				+		'(1-clamp(pow(5*len(c-0.5-vec2(-0.25*ts(1),0)),30*ts(1)),0,1) * '
				+		'clamp(pow(5*len(c-0.5-vec2(+0.25*ts(1),0)),30*ts(1)),0,1) *  '
				+		'clamp(pow(5*len(c-0.5-vec2(0,-.17*pow(ts(1),4))),30*ts(1)),0,1) *'
				+		'clamp(pow(5*len(c-0.5-vec2(0,0)),30*ts(1)),0,1) *'
				+		'clamp(pow(5*len(c-0.5-vec2(-.12*ts(1),0)),30*ts(1)),0,1) *'
				+		'clamp(pow(5*len(c-0.5-vec2(+.12*ts(1),0)),30*ts(1)),0,1))' 
				+	')' 
		})
	}


	// |  horizontal slides with kb nav
	// \____________________________________________/
	ct.slides = function(g){
		var b = ui.group()
			
		var fnt_big = ui.gl.pfont("55px Monaco")
		var fnt_med = ui.gl.pfont("30px Monaco")

		//| our slide template
		b.slide = function(g){
			var n = ui.rect()
			n.l = 1
			n.b = fnt_big
			n.f = 'mix(black,gray,c.y);'
			
			//| part templates
			n.title = function(t, y){
				var g = fn.named(arguments)
				var n = ui.text()
				n.x = '0.5*p.w - 0.5*n.w' // center
				n.y = 5
				n.b = fnt_big
				n.f = 'font * white'
				n.set(g)
				return n
			}

			var bc = 0
			//| bullet
			n.bullet = function(t, y){
				var g = fn.named(arguments)
				var n = ui.text()
				n.x = '0.5*p.w - 0.5*800 + 20'
				n.y = '0.5*p.h - 0.5*600 + 20 + n.yv*40'
				n.yv = bc++
				n.b = fnt_med
				n.f = 'font * white'
				n.set(g)
				return n
			}

			// picture frame
			n.pic = function(g){
				var n = ui.rect()
				n.x = '0.5*p.w - 0.5*n.w'
				n.y = '0.5*p.h - 0.5*n.h'
				n.w = 800
				n.h = 600
				n.set(g)
				return n
			}
			n.set(g)
			return n
		}
		cm.slides(b)
		b.set(g)

		return b
	}
})

// | Themes |___________________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/core/themes',function(require, exports){
	function hex(c){ return 'vec4('+(((c>>16)&0xff)/255)+','+(((c>>8)&0xff)/255)+','+((c&0xff)/255)+',1)'	}
	function hexs(c){ return hex(parseInt(c,16)) }
	exports.dark = {
		subpx:  'vec4(0,0,0,1)',
		dlgbg:  hexs('808080'),
		dlgbg:  hexs('8F8F94'),
		dlghi:  hexs('9996e2'),
		sliderbase: 'vec4(0,0,0,0.1)',
		splitter1: hexs('333333'),
		splitter2: hexs('444444'),
		splitter3: hexs('777777'),
		dlgtxt: hexs('FFFFFF'),
		defbg2: hexs('000000'),
		defbg:  hexs('333333'),
		deftxt: hexs('D3D3D3'),
		deftbg: hexs('7f7f7f'),
		selbg:  hexs('9996e2'),
		seltxt: hexs('000000'),
		codeHover: hexs('2E2D52'),
		codeSelect : hexs('424171'), 
		codeMark : hexs('424171'),
//		codeMark : hexs('035487'),
//		codeSelect: hexs('033b6e'),
		codeCursor: hexs('FFFFFF'),
		codeBg2: hexs('4c4c4c'),
		codeCall: hexs('033b6e'),
		codeSelf: hexs('4D55A1'),
		codeArg: hexs('032c54'),
		codeBg: hexs('151426'),
//		codeBg: hexs('001e3e'),
		codeFg: hexs('FFFFFF'),
		codeLineBg: hexs('001625'),
		codeLine: hexs('7a909e'),
		codeTab: hexs('3f5c73'),
		codeNumber: hexs('fb638d'),
		codeVardef: hexs('fdec85'),
		codeName: hexs('FFFFFF'),
		codeString: hexs('3ed625'),
		codeOperator: hexs('f59c25'),
		codeComment: hexs('1a89f3'),
		codeColor1: hexs('ffcccc'), 
		codeColor2: hexs('ffe0cc'),
		codeColor3: hexs('fffecc'),
		codeColor4: hexs('c7f5c4'),
		codeColor5: hexs('c4f0f4'),
		codeColor6: hexs('c9c4f4'),
		codeColor7: hexs('f6c6e6'),
		codeColor8: hexs('ffffff'),
		codeExNone: hexs('660000'),
		codeExOnce: hexs('006600'),
		codeExMany: hexs('0B615E')
	}

	exports.light = {
		subpx: 'vec4(0,0,0,0.4)',
		dlgbg:  hexs('FFFFFF'),
//		dlgbg:  hexs('8F8F94'),
		dlghi:  hexs('efefef'),
		sliderbase: 'vec4(0,0,0,0.1)',
		splitter1: hexs('5f5f5f'),
		splitter2: hexs('6f6f6f'),
		splitter3: hexs('9f9f9f'),
		dlgtxt: hexs('FFFFFF'),
		defbg2: hexs('3f3f3f'),
		defbg:  hexs('6f6f6f'),
		deftxt: hexs('FFFFFF'),
		deftbg: hexs('7f7f7f'),
		selbg:  hexs('9996e2'),
		seltxt: hexs('000000'),
		codeHover: hexs('FFF7C2'),
		codeSelect : hexs('d3e2f4'), 
		codeMark : hexs('FFED75'),
//		codeMark : hexs('035487'),
//		codeSelect: hexs('033b6e'),
		codeCursor: hexs('000000'),
		codeBg2: hexs('ffffff'),
		codeCall: hexs('E0E6FF'),
		codeSelf: hexs('F2D9FC'),
		codeArg: hexs('D9E0FF'),
//		codeBg: hexs('001e3e'),
		codeBg: hexs('ededed'),
		codeFg: hexs('000000'),
		codeLineBg: hexs('d3e2f4'),
		codeLine: hexs('808080'),
		codeTab: hexs('3f5c73'),
		codeNumber: hexs('0000FF'),
		codeVardef: hexs('8B0000'),
		codeName: hexs('000000'),
		codeString: hexs('006400'),
		codeOperator: hexs('f59c25'),
		codeComment: hexs('0000FF'),
		codeColor1: hexs('539a2f'), 
		codeColor2: hexs('9aa633'),
		codeColor3: hexs('ac8935'),
		codeColor4: hexs('ac4d35'),
		codeColor5: hexs('a13143'),
		codeColor6: hexs('942d8b'),
		codeColor7: hexs('592d94'),
		codeColor8: hexs('2d3894'),
		codeExNone: hexs('FFE0E0'),
		codeExOnce: hexs('DDF0CE'),
		codeExMany: hexs('D6FFFE')
	}
})
// | Text Mixins |_________________________/
// |
// | (C) Code.GL 2013
// \____________________________________________/   

define('/core/text_mix',function(require, exports){

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
// | UI trace database |________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/trace/trace_db',function(require, exports, module){
	
	var fn = require("../core/fn")
	var ui = require("../core/ui")
	var tm = require("../core/text_mix")

	function traceDb(o){
		// we store the trace list and databases
		var db = {sh:{}}	

		// put a textstore on the db object
		tm.storage(db)

		// fire a changed event
		db.changed = fn.ps()

		// file and line dictionaries
		db.lineDict = o?o.lineDict:{} // line dictionary
		db.fileDict = o?o.fileDict:{}
		db.msgIds = {}

		// trace message
		//  i - line index
		//  a - arguments
		//  d - depth
		//  c - call entry ID
		//  r - return message
		//  t - type
		//  s - searchable text
		//  y - y coordinate 
		//  b000 - block marker

		// line object
		//   fid - file ID
		//   ret - function return index (for return)
		//   x - x coordinate 
		//   y - y coordinate 
		//   ex - end x
		//   ey - end y
		//   n - function name
		//   a - argument name array

		// file dictionary
		//  longName
		//  shortName

		var fid = 0 // file id

		// trace colors
		db.colors = {
			def:ui.t.codeName,
			i:ui.t.codeName,
			s:ui.t.codeString,
			a:ui.t.codeOperator,
			n:ui.t.codeNumber,
			v:ui.t.codeVardef,
			t:ui.t.codeName,
			c:ui.t.codeComment,
			1:ui.t.codeColor1,
			2:ui.t.codeColor2,
			3:ui.t.codeColor3,
			4:ui.t.codeColor4,
			5:ui.t.codeColor5,
			6:ui.t.codeColor6,
			7:ui.t.codeColor7,
			8:ui.t.codeColor8
		}

		var last
		var lgc = 0
		db.processTrace = function(m){

			if(!lgc) lgc = m.g
			else{
				if(lgc + 1 != m.g){
					fn("Message order discontinuity", lgc, m.g)
				}
				lgc = m.g
			}

			// look up trace message
			var l = db.lineDict[m.i]
			if(!l){
				fn('got trace without lookup')
				return
			}

			// make callstack parents
			if(!last){ 
				if(l.n) last = m
			} else {
				if(m.d > last.d) m.p = last, last = m
				else { // depth is equal or less
					if(l.ret){ // we are a return/
						// store us as the return message
						// check if we can be a return from last
						if(l.ret != last.i){
							var l2 = db.lineDict[l.ret]
							var n2 = db.fileDict[l2.fid].longName 
							var l3 = db.lineDict[last.i]
							var n3 = db.fileDict[l3.fid].longName
							fn('invalid return',m.i, n2, l2.n, l2.y, n3, l3.n, l3.y)
						}
						last.r = m
						// add return to text search field
						last.s += ' '+db.fmtCall(m).replace(/\f[a-zA-Z0-9]/g,'')
					} else {

						//var l2 = db.lineDict[l.ret]
						var n2 = db.fileDict[l.fid].longName 

						var l3 = db.lineDict[last.i]
						var n3 = db.fileDict[l3.fid].longName
						// non return following
						//	fn('missed return from', n3, l3.n,l3.y, 'got', m.i, n2, l.n, l.y)
						fn(m.i, l)
					}
					// if we are not a  return(m.f)
					var d = (last.d - m.d) + 1
					while(d > 0 && last) last = last.p, d--
					if(l.n){
						m.p = last, last = m
					}
				}
			}
			// add our line if  we are a function call
			if(l.n){
				if(last && last.p){ // store our call on 
					if(last.p.cs)	m.nc = last.p.cs
					last.p.cs = m
				}
				m.y = db.th
				var dp = m.d > 64 ? 64 : m.d
				db.addTabs(dp, 1, ui.t.codeTab)
				var t = db.fmtCall(m)
				db.addFormat((m.d>dp?'>':'')+t, db.colors)
				db.endLine(m)
				// keep a ref
				if(!db.firstMessage) db.firstMessage = m

				db.msgIds[m.g] = m

				// chain the closures
				var u = db.msgIds[m.u]
				if(u){
					if(u.us) m.nu  = u.us
					u.us = m
				}

				m.s = t.replace(/\f[a-zA-Z0-9]/g,'')

				db.changed()
				return true
			}
		}

		db.find = function(id){
			return db.msgIds[id]
		}

		db.addTrace = function(m){
			db.addFormat(db.fmtCall(m), db.colors)
			db.endLine(m)
		}

		db.fmt  = function(v, lim){
			lim = lim || 255
			var t = typeof v
			if(t == 'string'){
				if(v.indexOf('_$_') == 0){
					v = v.slice(3)
					if(v == 'undefined') return '\fn'+v
					return '\fv' + v
				}
				return '\fs'+JSON.stringify(v)
			}
			if(t == 'number') return '\fn'+v
			if(t == 'boolean') return '\fn'+v
			if(t == 'undefined') return '\fnundefined'
			if(!v) return '\fnnull'
			if(Array.isArray(v)){
				var s = '\fi['
				for(var k in v){
					if(s.length!=3) s+='\fi,'
					s += db.fmt(v[k])
				}
				s += '\fi]'
				if(s.length>lim) return s.slice(0,lim)+' \fv...\fi]'
			} else {
				var s = '\fi{'
				for(var k in v){
					if(s.length!=3) s+='\fi,'
					if(k.indexOf(' ')!=-1) s+='\fs"'+ k+'"'+'\fi:'
					else s += '\ft' + k + ':'
					t = typeof v[k]
					s += db.fmt(v[k])
				}
				s += '\fi}'
				if(s.length>lim) return s.slice(0,lim)+' \fv...\fi}'
			}
			return s
		}

		db.modColor = function(mod){
			var uid = 0
			for(var i = 0;i<mod.length;i++) uid += mod.charCodeAt(i)
			return (uid)%8 + 1
		}

		// returns a formatted function traceline
		db.fmtCall = function(m){
			if(m.x){
				return '\faexception '+(m.v===undefined?'':db.fmt(m.v))
			} 
			var l = db.lineDict[m.i]
			var mod = db.fileDict[l.fid].shortName 
			var col = db.modColor(mod)
	
			if(l.ret){ // function return
				var f = db.lineDict[l.ret]
				return '\fareturn '+(m.v===undefined?'':db.fmt(m.v))
			} else {
				var s = []
				for(var i = 0;i<l.a.length;i++) s.push('\ft'+l.a[i].n + '\fa=' + db.fmt(m.a[i]))
				return '\f'+col+mod+ '\fa \fi'+l.n+'\fi('+s.join('\fi,')+'\fi)'
			}
		}

		// adds a dictionary
		db.addDict = function(m){
			var d = m.d
			for(var k in d){
				db.lineDict[k] = d[k]
				db.lineDict[k].fid = fid
			}
			var sn = m.f.match(/[\/\\]([^\/\\]*)(?:.js)$/)
			sn = sn?sn[1]:m.f
			db.fileDict[fid++] = {
				longName:m.f,
				shortName:sn
			}
		}

		return db
	}

	return traceDb
})

// | Shader library |____________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/core/text_shaders',function(require, exports){
	"no tracegl"
	var gl = require("./gl")
	var ui = require("./ui")

	// code text using POINTS
	exports.codeText = ui.shader({
		u: {
			b:'sampler2D', // font texture
			sz:'vec4', //x:font width, y:font height, z:point size, w:pixel adjustment
			ps:'vec4', //x:text x offset, y:text y offset, z:pixel x offset, w:pixel y offset
		},
		a: {
			e:'ucol', // x:text x coord, y:text y coord, z:font texture x, w:font texture y
			fg:'float' // foreground color
		},
		p: 'sz.z',
		v: gl.ratio>1?
			'vec4((((ps.z+(ps.x+e.x*255)*sz.x+0.25*sz.z)+sz.w+l.x)/s.x)*2.-1.,1.-(((ps.w + (ps.y+e.y*255)*sz.y+0.25*sz.z)+sz.w+l.y)/s.y)*2.,0,1.)':
			'vec4(((floor(ps.z+(ps.x+e.x*255)*sz.x+0.5*sz.z)+sz.w+l.x)/s.x)*2.-1.,1.-((floor(ps.w + (ps.y+e.y*255)*sz.y+0.5*sz.z)+sz.w+l.y)/s.y)*2.,0,1.)',
		f: gl.ratio>1?
			'subpix(texture2D(b,vec2(e.z*0.99609375 + c.x/(512./26.), e.w*0.99609375 + c.y/(512./26.))),t.codeBg,theme(fg))':
			'subpix(texture2D(b,vec2(e.z*0.99609375 + c.x/(512./13.), e.w*0.99609375 + c.y/(128./13.))),t.codeBg,theme(fg))',
		m: ui.gl.POINTS,
		l: 1
	})

	// selection rectangle, flagged round edges
	exports.selectRect = ui.shader({
		u: {
			sz:'vec4', //x:font width, y:font height, z:shift y
			ps:'vec4', //x:text x offset, y:text y offset, z:pixel x offset, w:pixel y offset
			fg:'float' //palette foreground
		},
		a: {
			e:'vec2', //x:text coord x, y:text coord y
			r:'vec4'  //x:left text coord, y:top text coord, z:right text coord, w:flag 1 tl, 2 bl, 4 tr, 8 br
		}, 
		v: 'vec4((floor(ps.z + (e.x+ps.x)*sz.x+l.x)/s.x)*2.-1., 1.-(floor(ps.w + (e.y+ps.y)*sz.y-sz.z+l.y)/s.y)*2.,0,1.)',
		f: function(){
			vec3_v(floor(ps.z + (ps.x + r.x)* sz.x),floor(ps.w + (ps.y + r.y )* sz.y - sz.z), ps.z + (ps.x + r.z) * sz.x)
			vec4_c(theme(fg))
			if(f.x < v.x + 0.5*sz.x){
				vec2_d(f.x - (v.x + sz.x), f.y - (v.y + 0.5*sz.y))
				if(d.y<0 && mod(r.w,2) == 1) return_vec4(c)
				if(d.y>0 && mod(r.w,4) >= 2) return_vec4(c)
				return_vec4(c.xyz, sqrt(d.x*d.x+d.y*d.y)>9?0:c.w)
			} else if(f.x > v.z - 0.5*sz.x ){
				vec2_d(f.x - (v.z - sz.x), f.y - (v.y + 0.5*sz.y))
				if(d.y<0 && mod(r.w,8) >= 4) return_vec4(c)
				if(d.y>0 && mod(r.w,16) >= 8) return_vec4(c)
				return_vec4(c.xyz, sqrt(d.x*d.x+d.y*d.y)>9?0:c.w)
			}
			return_vec4(c)
		},
		m: ui.gl.TRIANGLES,
		l: 6
	})
})

// | Code view |______________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/trace/code_db',function(require){

	var fn = require("../core/fn")
	var ui = require("../core/ui")

	var acorn_tools = require("../core/acorn_tools")

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
	
	function codeDb(g){

		var db = {sh:{}}
		db.files = {}

		var ls = 0 // leading spaces
		var lw = 0 // leading width
		function addWhitespace(f, text, fg){
			// process whitespace and comments
			var l = text.length
			var v = f.text.last() || f.addChunk('', c)
			// if n.w contains comments
			for(var i = 0;i < l; i++){

				var c = text.charCodeAt(i)
				if(c == 32){ // space
					// are we crossing a tab boundary?
					if(ls && !(v.x%tabWidth)) v = f.addChunk("\x7f", ctbl.tab)
					else v.x ++
				}
				else if(c == 9){ // tab
					// snap to tab boundary
					var tw = tabWidth - v.x%tabWidth
					// output tabline ad tw
					if(ls && !(v.x%tabWidth)) v = f.addChunk("\x7f", ctbl.tab), v.x += tabWidth - 1
					else v.x += tw
				}
				else if(c == 10){ // newline
					var xold = v.x
					if(v.x < lw){ // output missing tabs
						for(v.x = v.x?tabWidth:0;v.x<lw;v.x += tabWidth - 1)
							v = f.addChunk("\x7f", ctbl.tab)
					}
					f.endLine(xold)
					ls = 1
				} else {
					// output blue comment thing
					if(ls) lw = v.x, ls = 0
					v = f.addChunk(text.charAt(i), fg || ctbl.comment)
				}
			}
		}

		// theme lookup
		var ctbl = {
			"num" : ui.t.codeNumber,
			"regexp": ui.t.codeRegexp,
			"name": ui.t.codeName,
			"string": ui.t.codeString,
			"keyword": ui.t.codeOperator,
			"var": ui.t.codeVardef,
			"tab": ui.t.codeTab,
			"comment": ui.t.codeComment,
			"operator": ui.t.codeOperator
		}

		var tabWidth = 3

		db.fetch = function(name, cb){
			// if we dont have name, 
		}

		db.parse = function(name, src){
			var f = db.files[name] || (db.files[name] = {})
			f.file = name
			// create text storage on file object
			tm.storage(f)
			f.font = ft1 // todo centralize font
			f.sh = {text:db.sh.text}
			src = src.replace(/^\#.*?\n/,'\n')
			f.lines = src.replace(/\t/,Array(tabWidth+1).join(' ')).split(/\n/)

			var t = acorn_tools.parse(src)
			t.tokens.walk(function(n){
				if(n.t){
					// colorize token
					var c = ctbl[n._t.type]
					if(!c) {
						if(n._t.binop || n._t.isAssign) c = ctbl.operator
						else if(n._t.keyword){
							if(n.t == 'var' || n.t == 'function') c = ctbl.var
							else c = ctbl.keyword
						} else c = ctbl.name
					}
					// process token
					if(n.t.indexOf('\n')!= -1){
						var a = n.t.split(/\n/)
						for(var i = 0;i<a.length;i++){
							f.addChunk(a[i], c)
							if(i < a.length - 1) f.endLine()
						}
					} else {
						if(ls) lw = f.text.last().x, ls = 0
						f.addChunk(n.t, c)
					}
				}
				addWhitespace(f, n.w)
				
			})
			//b.size()
			return f
		}

		return db
	}

	return codeDb
})

// | List view |________________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/trace/list_view',function(require, exports, module){

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



// | Code view |______________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/trace/code_view',function(require){

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

// | Code view |______________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/trace/hover_text',function(require){

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
	
	hoverText.ft = ft1
	function hoverText(g){
		"no tracegl"
		// background
		var b = ui.rect({f:'mix(vec4(0,0,0,0),alpha(t.codeBg2,0.9),1-smoothstep(0.5,1.0,n.shape(2*(c-.5))))'})
		b.shape = function(vec2_v){
			return_float(len(vec2(pow(abs(v.x),n.w/5),pow(abs(v.y),n.h/5))))
		}
		
		// scrollbars
		//b._v_ = ct.vScroll({h:'p.h - 10'})
		//b._h_ = ct.hScroll({w:'p.w - 10'})

		b.set(g)
		b.font = ft1

		//|  rendering
		//\____________________________________________/   

		// shaders+-

		var ts1 = ts.codeText
	//	ts1.f = 'subpix(texture2D(b,vec2(e.z*0.99609375 + c.x/(512./26.), e.w*0.99609375 + c.y/(128./26.))),t.codeBg,theme(fg))'
//		ts1.f = 'subpix(texture2D(b,vec2(e.z*0.99609375 + c.x/(512./13.), e.w*0.99609375 + c.y/(512./13.))),t.codeBg,theme(fg))'
		//ts1.f = 'subpix(texture2D(b,vec2(0.219 + c.x*0.025390625, 0.191 + c.y*0.025390625)),t.codeBg,theme(fg))'
	//	ts1.f = 'fg*0.001+vec4(c.x, c.y,e.z,1)'//+subpix(texture2D(b,1.-vec2(e.z*0.99609375 + c.x/(512./26.), e.w*0.99609375 + c.y/(256./26.))),t.codeBg,theme(fg))+red'
		//ts1.dbg = 1
		b.sh = {
			text: ui.gl.getShader(ts1), // text
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
		tm.storage(b)

		b.vps.gx = 5
		b.vps.gy = 5

		b.fit = function(x, y){
			var w = b.tw * b.vps.sx + 2*b.vps.gx
			x -= 0.5 * w
			if(x + w > ui.gl.width)
				x = fn.max(0, x + (ui.gl.width - (x + w)))
			if(x < 0) x = 0

			b.show(x, y + b.vps.sy, w,
			   b.th * b.vps.sy + 1*b.vps.gy
			)
		}

		b.show = function(x, y, w, h){
			b.l = layer
			ui.redraw(b)
			ui.redrawRect(x, y, w, h)
			b.x = x
			b.y = y
			b.w = w
			b.h = h
		}

		b.hide = function(){
			if(b.l !== -1){
				b.l = -1
				ui.redraw(b)
			}
		}

		// rendering
		function layer(){
			ui.view(b, b.vps.o)

			//if(!b._v_.pg) b.size()
			// draw if/else markers

			b.drawSelection()
			if(b.text) b.drawText()
		}
		b.l = layer
		return b
	}

	return hoverText
})

// | Code view |______________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/trace/code_bubble',function(require){

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
	
	function codeBubble(g){

		// background rect
		var bg = ui.group({l:1})
		bg.set(g)
		// bubble border 
		var border = ct.innerShadow({
			radius: 10,
			stepa:1.05,
			stepb:1.15,
			inner:'t.codeBg',
			outer:'alpha(t.codeBg,0)'
		})
		border._p = bg
		// title area 
		var title = ui.rect({sel:0,f:'mix(t.codeHover,t.codeMark,n.sel)', y:10, h:30, x:10, w:'p.w - 20'})
		title._p = bg
		//title._p = bg
		bg.title = title

		// code body
		var body = bg.body = ui.rect({f:'t.codeBg', x:10, y:40, h:'p.h - (n.y+10)', w:'p.w - 20'})
		body._p = bg

		// scrollbars
		body._v_ = ct.vScrollHider({h:'p.h - 10'})
		body._h_ = ct.hScrollHider({w:'p.w - 10'})

		// head scrollers
		title._v_ = ct.vScroll({h:'p.h - 10'})
		title._h_ = ct.hScroll({w:'p.w - 10'})

		title.font = ft1
		body.font = ft1
		//|  rendering
		//\____________________________________________/   

		// shaders+-
		body.sh = title.sh = {
			text: ui.gl.getShader(ts.codeText), // text
			select: ui.gl.getShader(ts.selectRect), // selection
			cursor: ui.rect.drawer({f:'t.codeCursor'}), // cursor
			line: ui.rect.drawer({f:'t.codeLineBg'}), // linemark
			lrShadow: ui.rect.drawer({f:'mix(vec4(0,0,0,0.2),vec4(0,0,0,0),c.x)'}), // dropshadow
			topShadow: ui.rect.drawer({f:'mix(t.codeBg,vec4(0,0,0,0),c.y)'})
		}

		// mix in behaviors
		tm.viewport(body)
		tm.cursors(body)
		tm.drawing(body)
		tm.storage(body)

		// mix in title stuff
		tm.viewport(title)
		tm.cursors(title)
		tm.drawing(title)
		tm.storage(title)
		
		title.vps.gy = 5
		title.vps.gx = 2
		body.vps.gx = 2

		// unhook scrollwheel 
		title.s = null
		body.s = null
		// forward scrollbar scroll message
		title._h_.s = body._h_.s = bg._p.s
		title._v_.s = body._v_.s = bg._p.s

		//bg.titleBuf = body.sh.text.alloc(1024)
		
		title.l = function(){
			ui.view(title, title.vps.o)
			title.drawSelection()
			if(title.text){
				title.drawText()
			}
		}

		/*title.m = function(){
			ui.cursor('default')
		}*/

		// rendering
		body.l = function(){
			ui.view(body, body.vps.o)

			if(!body._v_.pg) body.size()
			// update line numbers
/*
			body.linesUpdate(ui.t.codeLine)
			body.drawLineMarks()
			body.drawLines()
*/
			//ui.clip(body.vps.o.x + body.vps.gx, body.vps.o.y, body.vps.o.w - body.vps.gx, body.vps.o.h)
			body.drawSelection()
			if(body.text){
				body.drawText()
			}
			//body.drawCursors()
			//ui.clip(body.vps.o.x, body.vps.o.y, body.vps.o.w, body.vps.o.h)
			//body.drawShadows()
		}
		
		// doubleclick
		body.u = function(){
			// dump file/line 
			var c = body.vcs.l.first()
			if(c && bg.clickLine)
				bg.clickLine(body.file.file, c.y)
			// send rpc to server to open file/line
			// make configurable open using .tracegl
		}

		// resets the view to the last line
		bg.resetLine = function(){
			body.view(0, body.line, 0, 1, 2)
		}


		function setTitle(m){
			var v = bg._p._p._p._p.hoverView
			var tdb = body.tdb

			var l = tdb.lineDict[m.i]
			var f = tdb.fileDict[l.fid]

			v.clearText()

			// filename
			v.addFormat(f.longName + " line " + l.y, tdb.colors)
			v.endLine()
			var mod = '\f'+tdb.modColor( f.shortName )+f.shortName
			// lets output filename
			v.addFormat(mod + ' \fi' + l.n + "("+(l.a.length?"":")"), tdb.colors)
			v.endLine()
			// then function arguments
			for(var i = 0;i<l.a.length;i++){
				var e = i < l.a.length - 1
				v.addFormat( '   \ft'+l.a[i] + '\fa = ' + tdb.fmt(m.a[i], 255) + (e?",":""), tdb.colors )
				v.endLine()
			} 
			if(m.r && m.r.v !== '_$_undefined' && m.r.v !== undefined){
				v.addFormat((l.a.length?")":"")+' '+tdb.fmtCall(m.r), tdb.colors)
				v.endLine()
			} else {
				if(l.a.length){
					v.addFormat(")", tdb.colors)
					v.endLine()
				}
			}
		}
		

		bg.setTitle = function(m, tdb){
		
			var h = 0
 			body.y = h + 10
			title.h = h + 10
			delete title.vps.o.h // cause height to be recalculated in v_
			title.v_()

			// then function return
			return h
		}

		// update bubble with content
		bg.setBody = function(m, tdb, file, line, height){
			// format trace message in bubble
			body.setStorage(file)
			body.file = file
			bg.msg = m
			body.tdb = tdb

			delete body.vps.o.h // cause height to be recalculated in v_
			bg.h = height
			body.v_()
			body.line = line - 1
			body.view(0, body.line, 0, 1, 2)

			body.mcs.clear()
			// mark booleans from return value message
			var r = m.r
			bg.ret_obj = r
			for(var k in r){
				var l = tdb.lineDict[k.slice(1)]
				//fn(r, l)
				if(!l) continue
				// boolean logic
				if(k.charAt(0) == 'b'){
					var c = body.mcs.new(l.x, l.y - 1, l.ex, l.ey - 1)
					var v = r[k]
					if(v == '_$_undefined' || v=='_$_NaN' || !v) c.fg = ui.t.codeExNone
					else c.fg = ui.t.codeExOnce
					c.jmp = c.lst = null
					c.type = 'logic'
					c.value = r[k]
				} else
				// loop counters
				if(k.charAt(0) == 'l'){
					var c = body.mcs.new(l.x, l.y - 1, l.ex, l.ey - 1)
					var v = r[k]
					if(v == 0) c.fg = ui.t.codeExNone
					else if (v == 1) c.fg = ui.t.codeExOnce
					else c.fg = ui.t.codeExMany
					c.jmp = c.lst = null
					c.type = 'loop x'
					c.value = r[k]
				} else
				// assignments
				if(k.charAt(0) == 'a' && k.length>1){
					var c = body.mcs.new(l.x, l.y - 1, l.ex, l.ey - 1)
					var v = r[k]
					c.fg = ui.t.codeArg
					c.jmp = c.lst = null
					c.type = '='
					c.value = r[k]
				} else
				// exceptions
				if(k.charAt(0) == 'x'){
					var c = body.mcs.new(l.x, l.y - 1, l.ex, l.ey - 1)
					var v = r[k]
					c.fg = ui.t.codeExOnce
					c.jmp = c.lst = null
					c.type = 'exception'
					c.value = r[k]
				}				
			}

			// lets mark the main function args
			var l = tdb.lineDict[m.i]
			if(l.a) for(var i = 0;i<l.a.length;i++){
				var a = l.a[i]
				var c = body.mcs.new(a.x, a.y - 1, a.ex, a.ey - 1)
				c.type = a.n +' ='
				c.value = m.a[i]
				c.jmp = c.lst = null
				c.fg = ui.t.codeArg
			}

			// mark the function itself and the return point
			// we should mark jmp = 2
			var c = body.mcs.new(l.sx, l.sy - 1, l.sx + 8, l.sy - 1)
			c.type = null
			c.value = m
			c.jmp = 2
			c.lst = null
			c.fg = ui.t.codeSelf

			if(r){
				var l = tdb.lineDict[r.i]
				if(l && l.r){
					var c = body.mcs.new(l.x, l.y - 1, l.x + 6, l.y - 1)
					c.type = 'returns'
					c.value = r.v
					c.jmp = 1
					c.lst = null
					c.fg = ui.t.codeSelf
				}
			}	

			var maxlst = 100

			var sites = {}
			// lets mark function calls
			var fc = m.cs
			while(fc){
				// check if we are re-marking a callsite, ifso 
				// store more calls on our marker
				if(fc.r){
					// translate the call site line 
					var l = tdb.lineDict[fc.r.c]
					if(l){
						// add to existing callsite
						var id = fc.r.c
						var c
						if(sites[id]) c = sites[id]
						else {
							c = (sites[id] = body.mcs.new(l.x, l.y - 1, l.ex, l.ey - 1))
							c.lst = []
							c.args = []
							c.jmp = fc
							c.fg = ui.t.codeCall
						}
						if(bg.prev && bg.prev.msg == fc){
							c.fg = ui.t.codeSelf
						}
					
						// lets mark all function arguments
						c.lst.unshift({
							type:'returns',
							value:fc.r?fc.r.v:null
						})

						// lets mark all function arguments
						// we have 2 'unique' call patterns called call and apply
						// in apply we have this, array
						// in call we have this, ..args..
						var args = c.args
						// the function line
						var fl = tdb.lineDict[fc.i]
						if(l.a){
							for(var i = 0;i<l.a.length;i++){
								var a = l.a[i]
								if(a){
									var c = args[i]
									if(!c){
										c = (args[i] = body.mcs.new(a.x, a.y - 1, a.ex, a.ey - 1))
										c.lst = []
									}
									c.fg = ui.t.codeArg
									// lets mark all function arguments

									if(l.ce){ // its a call or apply
										if(i == 0){
											c.lst.push({type:"this", value:"?"})
										} else{
											if(l.ce == 1){ // call
												if(c.lst.length<maxlst) c.lst.unshift({
													type:(fl.a[i - 1] ? fl.a[i - 1].n : '?') +' =',
													value:fc.a?fc.a[i - 1]:null
												})
											} else { // its an apply
												//if(c.lst.length) c.lst = []
												//for(var j = 0;j < fc.a.length;j++)
												if(c.lst.length<maxlst) 
												c.lst.push({
													type:null,//(fl.a[j] ? fl.a[j].n : '?') +' =',
													value:fc,//fc.a?fc.a[j]:null
												})
											}
										}
									} else {
										if(c.lst.length<maxlst) c.lst.unshift({
											type:(fl.a[i] ? fl.a[i].n : '?') +' =',
											value:fc.a?fc.a[i]:null
										})
									}
								}
							}
						}
					}
				}
				fc = fc.nc
			}

			// lets mark function sub closure calls
			sites = {}
			var rblock = {}
			function addClosures(m){
				var fc = m.us
				while(fc){
					if(rblock[fc.g]) return
					rblock[fc.g] = 1

					var l = tdb.lineDict[fc.i]
					if(l){
						// add to existing callsite
						var c
						var id = fc.i
						if(sites[id]) c = sites[id]
						else {
							c = (sites[id] = body.mcs.new(l.sx, l.sy - 1, l.sx + 8, l.sy - 1))
							c.lst = []
							c.jmp = fc
							c.fg = ui.t.codeCall
						}
						if(c.lst.length<maxlst){
							c.lst.unshift({
								type:null,
								value:fc//fc.r?fc.r.v:l.n
							})
						}
					}
					addClosures(fc)
					fc = fc.nu
				}
			}
			addClosures(m, 0)

		}

		body.o = function(){
			var v = bg._p._p._p._p.hoverView
			v.hide()
		}
		
		var lx, ly, lc

		var oldr = body.r
		body.r = function(){
			oldr()
			var l = lc
			if(l && l.jmp){
				// jump to parent function
				if(l.jmp === 1){
					if(!bg.next || bg.next.l === -1)return
					var sv = bg._p._p._p._p.stackView
					sv.ly = -1
					sv.selectFirst(bg.stacky + bg.stackh)
				} else if (l.jmp === 2){
					var m = body.tdb.find(bg.msg.u)
					if(m) bg._p._p._p._p.selectCall(m.y)
				} else {
					bg._p._p._p._p.selectCall(l.jmp.y)
				}
			}
		}

		function formatCall(m, v, tdb){
			var up = tdb.msgIds[m.u]
			v.addFormat((up?((m.t - up.t)+'ms '):'')+tdb.fmtCall(m), tdb.colors)
			if(m.r && m.r.v) v.addFormat(' '+tdb.fmtCall(m.r), tdb.colors)
		}

		body.markerHover = function(m){
				
			// make sure we only process on change
			if(ui.mx == lx && ui.my == ly && m == lc)return
			lx = ui.mx, ly = ui.my, lc = m

			var tdb = body.tdb
			
			// when we get a function call, or 'null' we show the hoverview
			var v = bg._p._p._p._p.hoverView
			if(!m){ // no hover
				v.hide()
				return
			} 
			else {
				v.clearText()
				if(m.lst){
					var l = m.lst.length
					for(var i = 0;i<l;i++){
						if(m.lst[i].type){
							v.addFormat((l>1?i+': ':'')+m.lst[i].type+' '+tdb.fmt(m.lst[i].value, 255), tdb.colors)
						} else {
							formatCall(m.lst[i].value, v, tdb)
						}
						v.endLine()
					}
				} else {
					if(m.type){
						v.addFormat(m.type+' '+tdb.fmt(m.value, 255), tdb.colors)
					} else {
						formatCall(m.value, v, tdb)
					}
					v.endLine()
				}
				// if the width > bubblebg we should move the hover to the left
				v.fit(ui.mx, ui.my)
			}
			// we get this fired when someone hovers over a marker.
			ui.gl.cursor('pointer')
		}

		return bg
	}

	return codeBubble
})

// | Trace Client|________________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define('/trace/trace_client',function(require){
	define.settings = define.settings || {}
	document.title = "traceGL"
	
	var fn = require("../core/fn")
	var ui = require("../core/ui")
	if(!ui.gl) return

	var ct = require("../core/controls")

	var themes = require("../core/themes")
	
	var theme_type = define.settings.theme || 'dark'
	ui.theme(themes[define.settings.theme] || themes.dark)// set theme

	var ioChannel = require("../core/io_channel")

	var traceDb = require('./trace_db')
	var codeDb = require('./code_db')
	var listView = require('./list_view')
	var codeView = require("./code_view")
	var hoverText = require("./hover_text")
	var codeBubble = require("./code_bubble")

	var pass = fn.sha1hex("p4ssw0rd")
	var sess = fn.rndhex(8)
	var chan = ioChannel("/io_"+sess+"_"+pass)
	var dt = fn.dt()

	var instrument = require('./instrument')

	window.ui = ui

	// theme reloading when file change
	define.reload = function(t){
		console.log(t)
		if(t.indexOf('themes.js') != -1){ // reload themes
			require.reload('../core/themes', function(t){
				ui.theme(t.dark)
				ui.redraw()
			})
			return 1 // dont refresh the browser
		}
	}
	ui.load(function(){

		var tdb = traceDb()
		var sdb = traceDb(tdb)
		var cdb = codeDb()

		var paused 
		var paused_m

		// io channel data function
		chan.data = function(m){
			if(m.dict){
				// parse incoming source
				cdb.parse(m.f, m.src)
				return tdb.addDict(m)
			}
			else if(m.settings){
				define.settings = m.settings
				theme_type = define.settings.theme || 'dark'
				ui.theme(themes[define.settings.theme] || themes.dark)
				ui.redraw()
			} else {
				// we clicked pause, but we wont actually pause untill depth = 1
				if(paused && !paused_m)	if(m.d == 1) paused_m = paused;
				// we unpaused, but we wont unpause till we reach a depth = 1
				if(!paused && paused_m)	if(m.d == 1) paused_m = paused

				if(paused_m) return
	
				if(tdb.processTrace(m) && searchBox.t.length && !searcher && matchSearch(m)){
					sdb.addTrace(m)
					sdb.changed()
				}
			}
		}

		var bubbles = fn.list('prev', 'next')

		function clearTraces(){
			// clear the traceDb, searchDb
			// clear the bubbles and the 
			tdb.clearText()
			sdb.clearText()
			tdb.msgIds = {}
			tdb.firstMessage = null
			stackView.clearText()
			miniView.tvc = null
			bigView.tvc = null
			sminiView.tvc = null
			sbigView.tvc = null
			var b = bubbles.first()
			while(b){
				b.hide()
				b = b.next
			}
			tdb.changed()
			sdb.changed()
			ui.redraw()
		}

		function selectBubble(b, scroll){
			var n = bubbles.first()
			while(n){
				if(n != b) n.title.sel = 0
				n = n.next
			}
			b.title.sel = 1
			if(scroll){
				var v = bubbleBg._v_
				v.ds(b.y - v.mv)
				ui.redraw(bubbleBg)
			}
		}

		function selectCall(y){
			miniView.selectFirst(y)
			bigView.view(0, y, 0, 1, 1)
			// scroll up
			bubbleBg._v_.ds(-bubbleBg._v_.mv)
			stackView.ly = -1
			stackView.selectFirst(0)
		}

		// respond to a selectTrace by building all the callbubbles
		sdb.selectTrace = function(m){
			ui.dbg = m
			// lets select the  m in tdb
			selectCall(m.y)
		}

		tdb.selectTrace = function(m){
			//fn('selectTrace')
			var y = 0 // y pos
			var stacky = 0 // callstack counter
			var spacing = 1 // spacing between bubbles
			var rev = false // reverse callstack
			var b = {next:bubbles.first()}
			var max = 64
			stackView.clearText()

			if(rev) while(m.p) m.p.c = m, m = m.p
			while(m && max >0){
				max--
				// lookup line and file
				var l = tdb.lineDict[m.i]
				var f = tdb.fileDict[l && l.fid]
				if(!f){m = m.c;continue;}

				// find available bubble for stack
				if(b) b = b.next
				if(!b){
					b = codeBubble({x:1, y:y, w:'p.w', h:300, _p:bubbleBg})
					bubbles.add(b);
					// sync selection between title and
					(function(prev){
						b.title.p = function(n){
							var b = n._p
							b.resetLine()
							stackView.selectFirst(stackView.ly = b.stacky)
							selectBubble(b)
							ui.redraw(bubbleBg)
							prev()
						}
					})(b.title.p)
					b.clickLine = function(file, line){
						chan.send({t:'open',file:file,line:line})
					}
				}

				// stackView cursor
				b.stacky = stacky

				// build up the stackView
				stackView.addFormat( tdb.fmtCall(m), tdb.colors ), stacky++
				stackView.endLine(b)
				if(m.r && m.r.v !== '_$_undefined' && m.r.v !== undefined){
					stackView.addFormat( ' '+tdb.fmtCall(m.r), tdb.colors ), stacky++
					stackView.endLine(b)
					b.stackh = 2
				} else b.stackh = 1

				// set the title on the bubble
				var headSize = b.setTitle(m, tdb)

				// position bubble
				b.x = 0
				b.y = y

				// select text in bubble 
				var file = cdb.files[f.longName]
				var line = l.y

				// get the function body height
				var height = (l.ey - l.y + 1) * b.body.vps.sy + headSize + 20
				if(height > 6000) height = 6000

				// check if we have to fetch the file
				b.setBody( m, tdb, file, line, height)
				y += height + spacing
				// flip visibility
				if(b.l == -1) b.show()//b.l = b.l2

				// remove callstack reversal
				if(rev){
					var c = m.c
					delete m.c
					m = c
				}
				else m = m.p
			}
			// set total view width
			bubbleBg.vSize = y
			bubbleBg.v_()
			// reset cursor
			stackView.selectFirst(0)
			stackView.hy = 0
			stackView.v_()
			//bubbleBg._h_.ds(bubbleBg.hSize - bubbleBg.hScroll)
			// scroll to end
			ui.redraw()
			// hide left over bubbles
			b = b.next
			while(b){
				if(b.l != -1) b.hide()
				b = b.next
			}
		}

		// main UI
		var mainGroup
		var searchGroup
		var miniView
		var bigView
		var sminiView
		var sbigView
		var hoverView
		var sourceView
		var bubbleBg
		var searchBox

		var searcher

		var pattern = 0
		var regexp = 0
		function matchSearch(m){
			var s = searchBox.t
			if(s != pattern){
				if(s.charAt(0) == '/'){
					try{
						regexp = new RegExp(s.slice(1),"ig")
					} catch(e){
						regexp = 0				
					}
				} else regexp = 0
				pattern = s
			}
			if(!regexp)	return m.s.indexOf( pattern ) != -1	
			else return m.s.match( regexp ) != null
		}

		function doSearch(){
			var s = searchBox.t
			if(s.length){
				mainGroup.hide()
				searchGroup.show()
				// first we clear the sdb
				sdb.clearText()
				if(searcher) clearInterval(searcher)
				sminiView.tvc = null
				sbigView.tvc = null
				var n = tdb.text.first()
				searcher = setInterval(function(){
					var dt = fn.dt()
					// we process n and a few others
					var ntraces = 1000
					var nblocks = 500
					while(n && nblocks>0 && ntraces>0){
						// go through the lines
						for(var i = 0;i<n.ld.length;i++){
							var m = n.ld[i]
							// simple search
							if(matchSearch(m)){
								ntraces--
								sdb.addTrace(m)
							}
						}
						nblocks--
						n = n._d
					}
					sdb.changed()
					if(!n) clearInterval(searcher), searcher = 0
				}, 0)

			} else {
				mainGroup.show()
				searchGroup.hide()
			}
		}

		// main UI
		ui.group(function(n){
			ui.rect(function(n){
				n.f = 't.defbg'
				n.h = 32
				ct.button({
					y:2,
					x:2,
					w:80,
					t:'Theme',
					c:function(){
						if(theme_type == 'dark') theme_type = 'light'
						else theme_type = 'dark'
						ui.theme(themes[theme_type])
					}
				})
				ct.button({
					y:2,
					x:84,
					w:80,
					t:'Clear',
					c:function(){
						clearTraces()
					}
				})
				ct.button({
					y:2,
					w:80,
					x:166,
					t:'Pause',
					c:function(n){
						if(!n.paused){
							paused = n.paused = true
							n.ohc = n.hc
							n.hc = 'vec4(1,0,0,1)'
						} else {
							paused = n.paused = false
							n.hc = n.ohc
						}

						// restart the nodejs app under testing and clears traces
					}
				})			
				ct.button({
					y:2,
					x:248,
					w:22,
					t:'x',
					c:function(){
						searchBox.t = ""
						doSearch()
					}
				})		
				searchBox = ct.edit({
					empty:'search filter',
					y:2,
					x:272,
					w:'p.w - n.x',
					c:function(n){
						doSearch()
					}
				})
			})
			ct.vSplit(function(n){
				n.y = 28

				ui.group(function(n){
					n.h = 200
						ui.test = function(){
							fn(n.eval('h'))
						}
					mainGroup = ct.hSplit(function(n){
						miniView = listView({w:267, zm:0, db:tdb})
						bigView = listView({db:tdb, cursor:miniView})
						// we also have a textView here which we flip to visible occasionally
						// set alloc shader
						cdb.sh.text = miniView.sh.text
					})
					searchGroup = ct.hSplit(function(n){
						sminiView = listView({w:267, zm:0, db:sdb})
						sbigView = listView({db:sdb, cursor:sminiView})
						sbigView.vps.gx = 7
					})
					searchGroup.hide()
				})					

				ct.hSplit(function(n){
					stackView = listView({w:267})
					stackView.vps.gx = 5
					stackView.vps.gy = 5
					stackView.ly = -1
					stackView.viewChange = function(x, y){
						if(stackView.ly != y){
							stackView.ly = y
							var c = stackView.dcs.l.first() || stackView.vcs.l.first()
							if(c && c.d) selectBubble(c.d, true)
						}
					}
					bubbleBg = ui.rect(function(n){
						n.f = 't.defbg'//mix(vec4(.2,.2,.2,1),vec4(.4,.4,.4,1),c.y)'
						n.l = 1
						n._h_ = ct.hScrollHider()
						n._v_ = ct.vScrollHider()
						ct.hvScroll(n)
					})
				})

			})
			// the hover info view
			n.hoverView = hoverView = hoverText()
			n.miniView = miniView
			n.bigView = bigView
			n.bubbleBg = bubbleBg
			n.stackView = stackView
			n.selectCall = selectCall
			hoverView.show(false)
		})

		chan.send({t:'join'})

		ui.drawer()
	})
})
define.settingsData = "{\n\t\"theme\" : \"dark\", // other theme: light\n\t\"ui\":2000, // UI port\n\t\"tgt\":2080, // browser JS port\n\t\"do\":[], // only trace files matching\n\t\"no\":[], // ignore files matching \":match\" for string or \"/match\" for regexp\n\t\"editors\" : { // editor paths per platform, modify these to set up your editor\n\t\t\"darwin\":{\n\t\t\t\"sublime3\":{\n\t\t\t\t\"bin\":\"/Applications/Sublime Text 3.app/Contents/SharedSupport/bin/subl\",\n\t\t\t\t\"args\":[\"$file:$line\"]\n\t\t\t},\n\t\t\t\"sublime2\":{\n\t\t\t\t\"bin\":\"/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl\",\n\t\t\t\t\"args\":[\"$file:$line\"]\n\t\t\t},\n\t\t\t\"textmate\":{\n\t\t\t\t\"bin\":\"/Applications/TextMate.app/Contents/Resources/mate\",\n\t\t\t\t\"args\":[\"$file\",\"--line\",\"$line\"]\n\t\t\t}\n\t\t},\n\t\t\"win32\":{},\n\t\t\"sunos\":{},\n\t\t\"linux\":{},\n\t\t\"freebsd\":{}\n\t}\n}";
define.settings = {
	"theme" : "dark", // other theme: light
	"ui":2000, // UI port
	"tgt":2080, // browser JS port
	"do":[], // only trace files matching
	"no":[], // ignore files matching ":match" for string or "/match" for regexp
	"editors" : { // editor paths per platform, modify these to set up your editor
		"darwin":{
			"sublime3":{
				"bin":"/Applications/Sublime Text 3.app/Contents/SharedSupport/bin/subl",
				"args":["$file:$line"]
			},
			"sublime2":{
				"bin":"/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl",
				"args":["$file:$line"]
			},
			"textmate":{
				"bin":"/Applications/TextMate.app/Contents/Resources/mate",
				"args":["$file","--line","$line"]
			}
		},
		"win32":{},
		"sunos":{},
		"linux":{},
		"freebsd":{}
	}
}
define.factory["/trace/trace_server"](define.mkreq("/trace/trace_server"))