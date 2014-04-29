// | Instrumenter |______________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define(function(require){
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