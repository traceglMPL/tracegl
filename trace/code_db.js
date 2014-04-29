// | Code view |______________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define(function(require){

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
