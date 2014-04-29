// | Code view |______________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define(function(require){

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
