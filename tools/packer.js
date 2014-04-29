// | packer for define.js |_____________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/

require('../core/define')
define(function(require){
	var fn = require('../core/fn')
	var acorn_tools = require('../core/acorn_tools')

	var fs = require('fs')
	var zlib = require('zlib')
	var exec = require('child_process').exec
	var path = require('path')

	// packages up a define(..)
	function pack(body, name, strip){
		var n = acorn_tools.parse(body).tokens
		var s = ''
		if(name){
			if(n._c.t != 'define') throw new Error("unknown file format" + name)
			n._c._d.t = "('"+name+"',"
		}
		n.walk(function(n){
			if(strip) s += n.t + (n.w && n.w.match(/\n/) ? '\n' : n.w.match(/[\s\t]/)?' ':'')
			else s += n.t + n.w
		})
		return s
	}

	var files = {}
	// recursive dependency loader and path processor
	function load(file, base){
		var f = fs.readFileSync(file + '.js').toString()
		f = f.replace(/require\s*(?:\.absolute)?\(["'](.*?)["']\)(\.reloader\(.*?\))?/g, function(x, i){
			if(i.match(/\/define(.js)?$/)) return '' // remove node headers
			if(i.charAt(0) != '.') return x // node require
			var p = define.norm(i, base)
			if(!files[p]) files[p] = load('.' + p, define.path(p))
			return x
		})
		f = f.replace(/"base64:(.*?)"/,function(x, i){
			return '"'+fs.readFileSync(i).toString('base64')+'"'
		})
		return f
	}

	// usage
	if(process.argv.length<4){
		fn('packer.js entrypoint packname[.js|.html] [-u]')
		return 0
	}

	// add main file unstripped
	var main = '/'+process.argv[2]
	// go and output the package
	var out = process.argv[3]

	var pkg = ""
	if(!out.match(/\.html$/)){
		pkg +="#!/usr/bin/env node\n"
	}
	pkg += pack( load('.' + main, main.slice(0,main.lastIndexOf('/'))), main, false) + '\n'

	// add define implementation
	var defimpl = "function define(id,fac){\n" + 
			fs.readFileSync('./core/define.js').toString().match(/\/\/PACKSTART([\s\S]*?)\/\/PACKEND/g,'').join('\n') +
			"\n}\n"
	pkg += pack(defimpl, '', false) + '\n'

	// add al deps stripped
	for(var k in files){
		pkg += pack(files[k], k, k.match(/instrument|io\_channel/)?false:false)+'\n'
	}

	// read and append settings file
	var settings = path.resolve(path.dirname(path.resolve(process.cwd(),process.argv[2])),"tracegl.json")
	var set = fs.readFileSync(settings).toString()
	pkg += 'define.settingsData = '+JSON.stringify(set)+';\n'
	pkg += 'define.settings = '+set+'\n'
	// call the main file
	pkg += 'define.factory["'+main+'"](define.mkreq("'+main+'"))'

	// wrap in html tags
	if(out.match(/\.html$/)){
		pkg = 
		'<html>\n\t<head><title></title><meta http-equiv="Content-Type" CONTENT="text/html; charset=utf-8"></head>\n\t<body style="background-color:black">\n\t\t<script>\n'+
			pkg+
		'\n\t\t</script>\n\t</body>\n</html>'	
	}
    console.log("OK")
	// lets output a single js or html file
	var file = process.argv[3]
	fs.writeFileSync(file, pkg)
})